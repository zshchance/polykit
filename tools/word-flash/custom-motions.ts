/**
 * 自定义入场动效 —— AI 生成绘制代码的存储、编译、校验与提示词。
 *
 * 用户在 💡 向导里描述想要的入场效果 → 组装提示词（可复制给任意 AI 或 ⚡ 直连）
 * → AI 返回「名称注释 + 函数体代码」→ 解析、静态扫描（共享危险名单 + 确定性
 * 名单）、dryRun 像素校验 → 保存到 localStorage，在「入场动效」区以 ⭐ chips
 * 形式选用/删除。
 *
 * 代码约定：new Function('ctx','W','H','S','p','card','layout','theme', code)
 * 每帧调用一次，p 为卡片内进度（0→1，覆盖整张卡的停留区间）；card 是卡片内容，
 * layout 是渲染端已算好的折行与字号——AI 代码直接据此绘制文字与特效。
 * 必须确定性（禁 Math.random 等：预览实时播放 / 导出逐帧录制 / 拖动进度条
 * 必须画面一致）。
 *
 * dryRun 校验（本工具特有）：在一块灰底画布上分别跑 p=0.12 与 p=0.5 两帧，
 * 要求「p=0.5 确实画出了内容」且「两帧之间存在可见差异」——抓住「什么都没画」
 * 与「静态文字（没有动效）」两类废稿。
 *
 * 存储形态（JSON）：{ "version": 1, "items": CustomMotion[] }
 */

import { readJSON, writeJSON } from '@/core/utils/storage';
import { findDangerousPattern, dangerousCodeReason } from '@/core/utils/ai-code-guard';

import {
  THEMES,
  type CardLayout,
  type CardMotionInput,
  type MotionDraw,
  type Theme,
} from './options';

const STORAGE_KEY = 'word-flash:custom-motions';
const CURRENT_VERSION = 1;
const ID_PREFIX = 'cmot:';

/** 一条自定义动效（本地存储形态） */
export interface CustomMotion {
  /** 形如 cmot:abcd1234 */
  id: string;
  /** 展示名（≤12 字） */
  name: string;
  /** 函数体代码（首行名称注释在保存前已剥离） */
  code: string;
  createdAt: number;
}

interface CustomMotionBlob {
  version: number;
  items: CustomMotion[];
}

// ─────────────────────────── 存储 CRUD ───────────────────────────

export function loadCustomMotions(): CustomMotion[] {
  const parsed = readJSON(STORAGE_KEY) as Partial<CustomMotionBlob> | null;
  if (!parsed) return [];
  const items = parsed.items;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (it): it is CustomMotion =>
      !!it &&
      typeof it.id === 'string' &&
      it.id.startsWith(ID_PREFIX) &&
      typeof it.name === 'string' &&
      it.name.trim().length > 0 &&
      typeof it.code === 'string' &&
      it.code.trim().length > 0 &&
      typeof it.createdAt === 'number',
  );
}

function persist(items: CustomMotion[]): void {
  const blob: CustomMotionBlob = { version: CURRENT_VERSION, items };
  writeJSON(STORAGE_KEY, blob);
}

function newId(): string {
  return ID_PREFIX + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** 新增或同名覆盖一条；返回更新后的完整列表 */
export function addCustomMotion(name: string, code: string): CustomMotion[] {
  const trimmed = name.trim().slice(0, 12);
  const items = loadCustomMotions();
  const existingIdx = items.findIndex((it) => it.name.trim() === trimmed);
  const entry: CustomMotion = {
    id: existingIdx >= 0 ? items[existingIdx]!.id : newId(),
    name: trimmed,
    code,
    createdAt: existingIdx >= 0 ? items[existingIdx]!.createdAt : Date.now(),
  };
  if (existingIdx >= 0) items[existingIdx] = entry;
  else items.push(entry);
  persist(items);
  return items;
}

/** 删除一条；返回更新后的完整列表 */
export function removeCustomMotion(id: string): CustomMotion[] {
  const items = loadCustomMotions().filter((it) => it.id !== id);
  persist(items);
  return items;
}

// ─────────────────────────── 静态扫描 ───────────────────────────

const NON_DETERMINISTIC_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bMath\s*\.\s*random\b/, label: 'Math.random()' },
  { re: /\bDate\s*\.\s*now\b/, label: 'Date.now()' },
  { re: /\bnew\s+Date\b/, label: 'new Date()' },
  { re: /\bperformance\s*\.\s*now\b/, label: 'performance.now()' },
  {
    re: /\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b/,
    label: 'setTimeout 等异步 API',
  },
];

/** 静态扫描：共享危险名单 + 确定性名单。干净返回 null，否则返回拒收原因 */
export function scanMotionCode(code: string): string | null {
  const danger = findDangerousPattern(code);
  if (danger) return dangerousCodeReason(danger);
  for (const p of NON_DETERMINISTIC_PATTERNS) {
    if (p.re.test(code)) {
      return (
        `代码使用了 ${p.label}。动效在卡片停留期间每帧同步执行，且预览（实时播放）/ ` +
        `导出（逐帧录制）/ 拖动进度条必须画面一致——请只用传入的 p（0→1 进度）表达时间，` +
        `需要随机感用确定性伪随机，例如 'const hash=(i)=>{const x=Math.sin(i*127.1)*43758.5453;return x-Math.floor(x);}'`
      );
    }
  }
  return null;
}

// ─────────────────────────── 编译与运行时包装 ───────────────────────────

/** AI 代码的原始形态：位置参数逐帧调用 */
type RawMotionFn = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  S: number,
  p: number,
  card: CardMotionInput,
  layout: CardLayout,
  theme: Theme,
) => void;

/** 编译函数体（只做语法编译，不扫描不试跑；语法错原样抛出） */
function compileRaw(code: string): RawMotionFn {
  // eslint-disable-next-line no-new-func -- AI 回填代码约定入口（与 slide-video/song-video 一致）
  return new Function(
    'ctx',
    'W',
    'H',
    'S',
    'p',
    'card',
    'layout',
    'theme',
    code,
  ) as RawMotionFn;
}

/** 单帧耗时超过该值视为超帧（录制为 30fps 实时编码，单帧预算约 33ms，留编码余量） */
const FRAME_BUDGET_MS = 8;
/** 连续超帧多少次后本会话放弃（偶发抖动不误杀） */
const SLOW_STREAK_LIMIT = 5;

/**
 * 把原始函数包装成 MotionDraw：
 *   - 每帧 ctx.save()/finally-restore（AI 代码漏 restore 也不污染画面状态）；
 *   - 运行时抛错 → 本会话停用，返回 false 交由调用方回退内置动效；
 *   - 帧耗保护：连续 5 帧 >8ms → 本会话停用（防拖垮实时录制）。
 */
function guardRaw(raw: RawMotionFn): MotionDraw {
  let dead = false;
  let slowStreak = 0;
  return (frame) => {
    if (dead) return false;
    const { ctx } = frame;
    const t0 = performance.now();
    ctx.save();
    try {
      raw(
        frame.ctx,
        frame.W,
        frame.H,
        frame.S,
        frame.p,
        frame.card,
        frame.layout,
        frame.theme,
      );
    } catch {
      dead = true;
      ctx.restore();
      return false;
    }
    const cost = performance.now() - t0;
    ctx.restore();
    if (cost > FRAME_BUDGET_MS) {
      slowStreak++;
      if (slowStreak >= SLOW_STREAK_LIMIT) dead = true; // 本帧已画出，下一帧起回退
    } else {
      slowStreak = 0;
    }
    return true;
  };
}

/**
 * id → 编译产物缓存（含负缓存：编译/扫描失败存 null）。
 * buildRenderInput 每帧执行，绝不能每帧读 localStorage / 重复 new Function；
 * 增删动效时调 invalidateMotionCache 失效。
 */
const drawCache = new Map<string, MotionDraw | null>();

export function invalidateMotionCache(id?: string): void {
  if (id === undefined) drawCache.clear();
  else drawCache.delete(id);
}

/**
 * 按 id 取可执行的包装绘制函数；不存在/代码非法返回 null
 * （渲染层拿到 null 自动回退内置动效，静默不打断）。
 */
export function getCustomMotionDraw(id: string): MotionDraw | null {
  if (drawCache.has(id)) return drawCache.get(id) ?? null;
  const item = loadCustomMotions().find((v) => v.id === id);
  let draw: MotionDraw | null = null;
  if (item) {
    // 执行前复检危险模式（防存储被篡改后绕过保存时校验）
    if (!scanMotionCode(item.code)) {
      try {
        draw = guardRaw(compileRaw(item.code));
      } catch {
        draw = null;
      }
    }
  }
  drawCache.set(id, draw);
  return draw;
}

/** 编译一段代码用于向导弹窗里的「样张演播」（扫描 + 编译 + 运行时守卫，不做像素校验） */
export function compileMotionForPreview(
  code: string,
): { ok: true; draw: MotionDraw } | { ok: false; reason: string } {
  const scan = scanMotionCode(code);
  if (scan) return { ok: false, reason: scan };
  try {
    return { ok: true, draw: guardRaw(compileRaw(code)) };
  } catch (e) {
    return { ok: false, reason: '代码语法有误：' + (e instanceof Error ? e.message : String(e)) };
  }
}

// ─────────────────────────── dryRun 像素校验 ───────────────────────────

const DRY_W = 640;
const DRY_H = 360;
/** 灰底：既能让浅色文字显形，也能让深色色块显形 */
const DRY_BG = '#808080';
/** 颜色通道差超过该值即计为「与灰底不同」 */
const PIXEL_EPSILON = 6;
/** p=0.5 帧至少要有这么多内容像素（证明真的画了东西） */
const MIN_CONTENT_PIXELS = 200;
/** 两帧之间至少要有这么多像素变化（证明动效随时间推进） */
const MIN_FRAME_DIFF = 40;

/** dryRun 用的样张排版（与渲染端真实 layout 结构一致） */
function dryLayout(): CardLayout {
  return {
    lines: ['快闪', '视频'],
    size: 84,
    lineHeight: 1.3,
    x: DRY_W / 2,
    align: 'center',
    centerY: DRY_H / 2,
    font: `800 84px ui-sans-serif, system-ui, -apple-system, 'PingFang SC', sans-serif`,
  };
}

function dryCard(): CardMotionInput {
  return { text: '快闪视频', em: true, title: false };
}

function drawDryFrame(
  raw: RawMotionFn,
  p: number,
): { data: Uint8ClampedArray } | { error: string } {
  const cv = document.createElement('canvas');
  cv.width = DRY_W;
  cv.height = DRY_H;
  const ctx = cv.getContext('2d');
  if (!ctx) return { error: '当前浏览器无法创建画布，无法校验。' };
  ctx.fillStyle = DRY_BG;
  ctx.fillRect(0, 0, DRY_W, DRY_H);
  try {
    ctx.save();
    raw(ctx, DRY_W, DRY_H, DRY_H, p, dryCard(), dryLayout(), THEMES[0]!);
  } catch (e) {
    return { error: '运行时报错：' + (e instanceof Error ? e.message : String(e)) };
  } finally {
    ctx.restore();
  }
  return { data: ctx.getImageData(0, 0, DRY_W, DRY_H).data };
}

export function dryRunMotion(code: string): { ok: boolean; reason?: string } {
  const scan = scanMotionCode(code);
  if (scan) return { ok: false, reason: scan };
  let raw: RawMotionFn;
  try {
    raw = compileRaw(code);
  } catch (e) {
    return { ok: false, reason: '代码语法有误：' + (e instanceof Error ? e.message : String(e)) };
  }

  const mid = drawDryFrame(raw, 0.5);
  if ('error' in mid) return { ok: false, reason: mid.error };
  const early = drawDryFrame(raw, 0.12);
  if ('error' in early) return { ok: false, reason: early.error };

  const a = mid.data;
  const b = early.data;
  let content = 0;
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) {
    const ar = a[i]!;
    const ag = a[i + 1]!;
    const ab = a[i + 2]!;
    const br = b[i]!;
    const bg = b[i + 1]!;
    const bb = b[i + 2]!;
    if (
      Math.abs(ar - 128) > PIXEL_EPSILON ||
      Math.abs(ag - 128) > PIXEL_EPSILON ||
      Math.abs(ab - 128) > PIXEL_EPSILON
    ) {
      content++;
    }
    if (
      Math.abs(ar - br) > PIXEL_EPSILON ||
      Math.abs(ag - bg) > PIXEL_EPSILON ||
      Math.abs(ab - bb) > PIXEL_EPSILON
    ) {
      diff++;
    }
    if (content >= MIN_CONTENT_PIXELS && diff >= MIN_FRAME_DIFF) break; // 双双达标可提前退出
  }

  if (content < MIN_CONTENT_PIXELS) {
    return {
      ok: false,
      reason:
        '校验未通过：p=0.5 时画面几乎是空白的。请确认代码按 layout 把 card.text 的文字画了出来' +
        '（折行文本在 layout.lines 里）。',
    };
  }
  if (diff < MIN_FRAME_DIFF) {
    return {
      ok: false,
      reason:
        '校验未通过：p=0.12 与 p=0.5 两帧几乎一样——看起来是静态文字，没有入场动效。' +
        '请让画面元素随 p 变化（位移、缩放、透明、逐行揭开等）。',
    };
  }
  return { ok: true };
}

// ─────────────────────────── AI 输出解析 ───────────────────────────

/** 名称注释行（兼容 // 与 # 前缀、中英文冒号、name/名称 等别名） */
const NAME_LINE_RE = /^\s*(?:\/\/|#)\s*(?:名称|name)\s*[:：]\s*(.+?)\s*$/im;

/** 从 AI 整段回复中提取「名称 + 函数体代码」；识别失败返回原因 */
export function parseMotionAIOutput(
  raw: string,
): { ok: true; name: string; code: string } | { ok: false; reason: string } {
  const fence = /```(?:js|javascript)?\s*\n([\s\S]*?)\n?```/i.exec(raw);
  const body = fence ? fence[1]!.trim() : raw.replace(/```[a-z]*\s*$/gim, '').trim();
  if (!body)
    return { ok: false, reason: '没识别到代码——请把 AI 的整段回复（含 ```js 代码块）粘进来。' };
  const nameMatch = NAME_LINE_RE.exec(body);
  const name = nameMatch?.[1]?.trim() ?? '';
  // 名称注释行从代码体剥离，不污染将执行的函数体
  const code = nameMatch ? body.replace(nameMatch[0], '').trim() : body;
  if (!name) {
    return {
      ok: false,
      reason: '没识别到名称——AI 返回的代码块首行应是「// 名称：逐字弹跳」这样的注释。',
    };
  }
  return { ok: true, name: name.slice(0, 12), code };
}

// ─────────────────────────── AI 提示词 ───────────────────────────

/**
 * 组装「用 AI 生成自定义入场动效」的提示词。
 * 约定与禁令必须写全：确定性、只用传入参数、文字必须由 layout 绘制。
 */
export function buildMotionPrompt(description: string): string {
  const desc = description.trim() || '干脆有力的快闪入场动效';
  return `你是一个精通 Canvas 2D 创意编码（creative coding）的动效工程师，为竖屏「文字快闪视频」生成一张卡片的入场动效绘制代码。

【我想要的入场效果】
${desc}

【代码约定（必须严格遵守）】
你的代码是一个「函数体」，工具会在卡片停留期间逐帧这样调用它：
new Function('ctx','W','H','S','p','card','layout','theme', <你的代码>)(...)
参数说明：
- ctx: CanvasRenderingContext2D 画布上下文。背景已由工具画好，你只负责整张卡片视觉
- W, H: 画布宽高（px）；S = min(W, H)——所有尺寸一律用 S 的比例表达（如 S*0.05），适配 16:9 / 9:16 / 1:1
- p: 卡片内进度 0→1（整张卡的停留区间）。0 = 刚切到这张卡，1 = 即将切走；入场动效建议在前 30% 内完成，之后保持可读
- card: { text: 纯文本, em: 是否强调卡, title: 是否标题卡 }
- layout: 已算好的排版 {
    lines: 已折行的文本数组,
    size: 字号 px,
    lineHeight: 行高倍数,
    x: 文字锚点 x,
    align: 'left' | 'center'（与 ctx.textAlign 一致）,
    centerY: 文本块垂直中心 y,
    font: 已绑定字号的 canvas font 简写
  }
  绘制文字的标准写法：
  ctx.font = layout.font; ctx.textAlign = layout.align; ctx.textBaseline = 'middle';
  const lh = layout.size * layout.lineHeight;
  const top = layout.centerY - ((layout.lines.length - 1) * lh) / 2;
  第 i 行画在 (layout.x, top + i * lh)。必须把 layout.lines 的文字画出来（这是卡片的内容）。
- theme: { bg:[起,止], fg, accent, muted, light, design } —— 文字/装饰颜色取自这里

【⚠ 硬性禁令（违反任何一条都会被工具拒收）】
1. 禁止使用 Math.random() / Date.now() / new Date() / performance.now() —— 预览是实时播放、导出是逐帧录制、进度条可来回拖动，非确定性 API 会导致三者画面不一致。时间就是 p，一切变化由 p 驱动；需要随机感用确定性伪随机：
   const hash = (i) => { const x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); };
2. 禁止触碰 document / window / fetch / localStorage 等任何全局对象（工具会静态扫描，命中即拒收）——只使用上面传入的参数。
3. 禁止 setTimeout / setInterval / requestAnimationFrame——你的代码每帧被同步调用一次。
4. 不要 return 任何值；不要改画布尺寸；ctx.save()/ctx.restore() 必须成对。
5. 文字必须清晰可读：不要把字号无谓缩到看不清；强调卡可以用 accent 做色块或描边。
6. 性能：每帧绘制调用 ≤ 2000 次（录制是 30fps 实时编码，过重会掉帧）；避免大面积 shadowBlur。

【校验规则（保存时会自动检查）】
工具会在灰底画布上分别跑 p=0.12 与 p=0.5：p=0.5 必须确实画出了内容（不是空白），
且两帧之间必须有可见差异（证明有动效，而不是静态文字）。静态排版会被拒收。

【输出格式】
只输出一个 \`\`\`js 围栏代码块，第一行必须是注释声明名称：
// 名称：逐行弹跳
随后是函数体代码。围栏之外不要写任何解释文字。

【完整示例（展示接口与写法，请按我的需求重新创作，不要照抄）】
\`\`\`js
// 名称：逐行弹跳
const e = Math.min(1, Math.max(0, (p - 0.04) * 2.6)); // 前 40% 内完成入场
ctx.save();
ctx.font = layout.font;
ctx.textAlign = layout.align;
ctx.textBaseline = 'middle';
const lh = layout.size * layout.lineHeight;
const top = layout.centerY - ((layout.lines.length - 1) * lh) / 2;
layout.lines.forEach((line, i) => {
  const q = Math.min(1, Math.max(0, e - i * 0.18));
  const pop = 1 + 0.34 * Math.sin(q * Math.PI);
  ctx.save();
  ctx.globalAlpha = q;
  ctx.fillStyle = card.em ? theme.accent : theme.fg;
  ctx.translate(layout.x, top + i * lh);
  ctx.scale(pop, pop);
  ctx.fillText(line, 0, 0);
  ctx.restore();
});
ctx.restore();
\`\`\``;
}
