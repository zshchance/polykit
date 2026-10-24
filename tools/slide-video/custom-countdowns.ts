/**
 * 自定义倒计时样式 —— AI 生成绘制代码的存储、编译、校验与提示词。
 *
 * 用户在 💡 向导里描述想要的倒计时效果 → 组装提示词 → AI 返回「名称注释 +
 * 函数体代码」→ 解析、静态扫描（共享危险名单 + 确定性名单）、dryRun 保底
 * 像素校验 → 保存到 localStorage，在「翻页倒计时」区以 ⭐ chips 选用/删除。
 *
 * 代码约定：new Function('ctx','W','H','S','remain','total','page','pages','theme', code)
 * 每帧调用一次（remain = 本页剩余秒数）。倒计时是叠在正文上的「角落小部件」，
 * 提示词明确禁止全屏填充；dryRun 用「保底校验」把这条软约束变成可测的硬约束。
 *
 * dryRun 保底校验（本工具特有）：灰底跑一帧，要求
 *   ① ≥100 像素发生变化（确实画了东西）；
 *   ② ≥70% 像素保持不变（没有全屏不透明填充糊死正文）。
 *
 * 存储形态（JSON）：{ "version": 1, "items": CustomCountdown[] }
 */

import { readJSON, writeJSON } from '@/core/utils/storage';
import { findDangerousPattern, dangerousCodeReason } from '@/core/utils/ai-code-guard';

import { THEMES, type Theme } from './options';
import type { CountdownDraw, CountdownFrame } from './renderer';

const STORAGE_KEY = 'slide-video:custom-countdowns';
const CURRENT_VERSION = 1;
const ID_PREFIX = 'ccd:';

/** 一条自定义倒计时样式（本地存储形态） */
export interface CustomCountdown {
  /** 形如 ccd:abcd1234 */
  id: string;
  /** 展示名（≤12 字） */
  name: string;
  /** 函数体代码（首行名称注释在保存前已剥离） */
  code: string;
  createdAt: number;
}

interface CustomCountdownBlob {
  version: number;
  items: CustomCountdown[];
}

// ─────────────────────────── 存储 CRUD ───────────────────────────

/** 读取全部自定义倒计时样式；存储损坏/为空时返回 [] */
export function loadCustomCountdowns(): CustomCountdown[] {
  const parsed = readJSON(STORAGE_KEY) as Partial<CustomCountdownBlob> | null;
  if (!parsed) return [];
  const items = parsed.items;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (it): it is CustomCountdown =>
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

function persist(items: CustomCountdown[]): void {
  const blob: CustomCountdownBlob = { version: CURRENT_VERSION, items };
  writeJSON(STORAGE_KEY, blob);
}

function newId(): string {
  return ID_PREFIX + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** 新增或同名覆盖一条；返回更新后的完整列表 */
export function addCustomCountdown(name: string, code: string): CustomCountdown[] {
  const trimmed = name.trim().slice(0, 12);
  const items = loadCustomCountdowns();
  const existingIdx = items.findIndex((it) => it.name.trim() === trimmed);
  const entry: CustomCountdown = {
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
export function removeCustomCountdown(id: string): CustomCountdown[] {
  const items = loadCustomCountdowns().filter((it) => it.id !== id);
  persist(items);
  return items;
}

// ─────────────────────────── 静态扫描 ───────────────────────────

/**
 * 倒计时代码专属的非确定性 API 名单（正确性硬约束）：
 * 预览实时播放 / 导出逐帧录制 / 进度条回拖必须画面一致。
 * 「时间」就是 remain（本页剩余秒数），一切变化由它驱动。
 */
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
export function scanCountdownCode(code: string): string | null {
  const danger = findDangerousPattern(code);
  if (danger) return dangerousCodeReason(danger);
  for (const p of NON_DETERMINISTIC_PATTERNS) {
    if (p.re.test(code)) {
      return (
        `代码使用了 ${p.label}。倒计时代码每帧同步执行，且预览（实时播放）/ 导出（逐帧录制）` +
        `/ 拖动进度条必须画面一致——请只用传入的 remain（剩余秒数）表达时间。`
      );
    }
  }
  return null;
}

// ─────────────────────────── 编译与运行时包装 ───────────────────────────

/** AI 代码的原始形态：位置参数逐帧调用 */
type RawCountdownFn = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  S: number,
  remain: number,
  total: number,
  page: number,
  pages: number,
  theme: Theme,
) => void;

/** 编译函数体（只做语法编译，不扫描不试跑；语法错原样抛出） */
function compileRaw(code: string): RawCountdownFn {
  // eslint-disable-next-line no-new-func -- AI 回填代码约定入口（与 quote-card/qr-code/song-video 一致）
  return new Function(
    'ctx',
    'W',
    'H',
    'S',
    'remain',
    'total',
    'page',
    'pages',
    'theme',
    code,
  ) as RawCountdownFn;
}

/** 单帧耗时预算与连续超帧放弃阈值（同 custom-transitions） */
const FRAME_BUDGET_MS = 8;
const SLOW_STREAK_LIMIT = 5;

/**
 * 把原始函数包装成 CountdownDraw：
 *   - 每帧 ctx.save()/finally-restore；
 *   - 运行时抛错 → 本会话停用，返回 false（渲染层静默隐藏倒计时）；
 *   - 帧耗保护：连续 5 帧 >8ms → 本会话停用。
 */
function guardRaw(raw: RawCountdownFn): CountdownDraw {
  let dead = false;
  let slowStreak = 0;
  return (frame: CountdownFrame) => {
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
        frame.remain,
        frame.total,
        frame.page,
        frame.pages,
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
      if (slowStreak >= SLOW_STREAK_LIMIT) dead = true;
    } else {
      slowStreak = 0;
    }
    return true;
  };
}

/** id → 编译产物缓存（含负缓存）；增删样式时调 invalidateCountdownCache 失效 */
const drawCache = new Map<string, CountdownDraw | null>();

export function invalidateCountdownCache(id?: string): void {
  if (id === undefined) drawCache.clear();
  else drawCache.delete(id);
}

/** 按 id 取可执行的包装绘制函数；不存在/代码非法返回 null（渲染层静默隐藏） */
export function getCustomCountdownDraw(id: string): CountdownDraw | null {
  if (drawCache.has(id)) return drawCache.get(id) ?? null;
  const item = loadCustomCountdowns().find((v) => v.id === id);
  let draw: CountdownDraw | null = null;
  if (item) {
    // 执行前复检危险模式（防存储被篡改后绕过保存时校验）
    if (!scanCountdownCode(item.code)) {
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

/** 编译一段代码用于向导弹窗里的「走秒演播」（扫描 + 编译 + 运行时守卫，不做像素校验） */
export function compileCountdownForPreview(
  code: string,
): { ok: true; draw: CountdownDraw } | { ok: false; reason: string } {
  const scan = scanCountdownCode(code);
  if (scan) return { ok: false, reason: scan };
  try {
    return { ok: true, draw: guardRaw(compileRaw(code)) };
  } catch (e) {
    return { ok: false, reason: '代码语法有误：' + (e instanceof Error ? e.message : String(e)) };
  }
}

// ─────────────────────────── dryRun 保底像素校验 ───────────────────────────

const DRY_W = 640;
const DRY_H = 360;
/** 与底色任一通道差超过该值即计为「变化像素」（容忍半透明 alpha 混合的微弱差异） */
const PIXEL_DIFF_EPSILON = 2;
/** 变化像素达到该数才认定「画了可见内容」 */
const PIXEL_MIN_CHANGED = 100;
/** 未变化像素占比下限：倒计时是角落小部件，全屏填充（>30% 面积被改）即拒收 */
const KEEP_RATIO_MIN = 0.7;
/** dryRun 底色（中性灰） */
const BASE = 128;

/**
 * 保存前校验：静态扫描 → 编译 → 灰底跑一帧（remain=3.2, total=8）→
 *   ① ≥100 像素变化（没画东西 = 失败）；
 *   ② ≥70% 像素不变（全屏填充糊死正文 = 失败）。
 */
export function dryRunCountdown(code: string): { ok: boolean; reason?: string } {
  const scan = scanCountdownCode(code);
  if (scan) return { ok: false, reason: scan };
  let raw: RawCountdownFn;
  try {
    raw = compileRaw(code);
  } catch (e) {
    return { ok: false, reason: '代码语法有误：' + (e instanceof Error ? e.message : String(e)) };
  }
  const cv = document.createElement('canvas');
  cv.width = DRY_W;
  cv.height = DRY_H;
  const ctx = cv.getContext('2d');
  if (!ctx) return { ok: false, reason: '当前浏览器无法创建画布，无法校验。' };
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, DRY_W, DRY_H);

  try {
    ctx.save();
    raw(ctx, DRY_W, DRY_H, Math.min(DRY_W, DRY_H), 3.2, 8, 2, 5, THEMES[0]!);
  } catch (e) {
    return { ok: false, reason: '运行时报错：' + (e instanceof Error ? e.message : String(e)) };
  } finally {
    ctx.restore();
  }

  let changed = 0;
  const img = ctx.getImageData(0, 0, DRY_W, DRY_H).data;
  const totalPx = img.length / 4;
  for (let p = 0; p < img.length; p += 4) {
    if (
      Math.abs(img[p]! - BASE) > PIXEL_DIFF_EPSILON ||
      Math.abs(img[p + 1]! - BASE) > PIXEL_DIFF_EPSILON ||
      Math.abs(img[p + 2]! - BASE) > PIXEL_DIFF_EPSILON
    ) {
      changed++;
    }
  }
  if (changed < PIXEL_MIN_CHANGED) {
    return {
      ok: false,
      reason: '代码在这一帧没有画出可见内容——请确认确实调用了 ctx 的绘制方法（fill/stroke 等）。',
    };
  }
  if (changed > totalPx * (1 - KEEP_RATIO_MIN)) {
    return {
      ok: false,
      reason:
        '校验未通过：倒计时是叠加在正文上的角落小部件，不应覆盖大面积画面（当前改动了超过 30% 的像素）。' +
        '请把绘制范围收缩到角落约 S*0.3 见方的区域内。',
    };
  }
  return { ok: true };
}

// ─────────────────────────── AI 输出解析 ───────────────────────────

/** 名称注释行（兼容 // 与 # 前缀、中英文冒号、name/名称 等别名） */
const NAME_LINE_RE = /^\s*(?:\/\/|#)\s*(?:名称|name)\s*[:：]\s*(.+?)\s*$/im;

/** 从 AI 整段回复中提取「名称 + 函数体代码」；识别失败返回原因 */
export function parseCountdownAIOutput(
  raw: string,
): { ok: true; name: string; code: string } | { ok: false; reason: string } {
  const fence = /```(?:js|javascript)?\s*\n([\s\S]*?)\n?```/i.exec(raw);
  const body = fence ? fence[1]!.trim() : raw.replace(/```[a-z]*\s*$/gim, '').trim();
  if (!body)
    return { ok: false, reason: '没识别到代码——请把 AI 的整段回复（含 ```js 代码块）粘进来。' };
  const nameMatch = NAME_LINE_RE.exec(body);
  const name = nameMatch?.[1]?.trim() ?? '';
  const code = nameMatch ? body.replace(nameMatch[0], '').trim() : body;
  if (!name) {
    return {
      ok: false,
      reason: '没识别到名称——AI 返回的代码块首行应是「// 名称：沙漏细语」这样的注释。',
    };
  }
  return { ok: true, name: name.slice(0, 12), code };
}

// ─────────────────────────── AI 提示词 ───────────────────────────

/** 组装「用 AI 生成自定义倒计时样式」的提示词 */
export function buildCountdownPrompt(description: string): string {
  const desc = description.trim() || '优雅低调的翻页倒计时';
  return `你是一个精通 Canvas 2D 创意编码（creative coding）的动效工程师，为演示翻页视频生成「翻页倒计时」绘制代码。

【我想要的倒计时效果】
${desc}

【代码约定（必须严格遵守）】
你的代码是一个「函数体」，工具会在每页停留期间逐帧这样调用它：
new Function('ctx','W','H','S','remain','total','page','pages','theme', <你的代码>)(...)
参数说明：
- ctx: CanvasRenderingContext2D 画布上下文，只管往上面画
- W, H: 画布宽高（px）；S = min(W, H)——所有尺寸一律用 S 的比例表达（如 S*0.03）
- remain: 本页剩余秒数（浮点，从每页时长递减到 0；翻页动画期间也会被调用）
- total: 每页时长（秒）。比值 remain/total 就是进度
- page / pages: 当前页码（1 起）/ 总页数
- theme: { bg:[起,止], fg, accent, muted, light } —— 颜色只能取自这里，以 theme.accent 为主

【⚠ 硬性禁令（违反任何一条都会被工具拒收）】
1. 禁止使用 Math.random() / Date.now() / new Date() / performance.now() —— 预览是实时播放、导出是逐帧录制、进度条可来回拖动，非确定性 API 会导致三者画面不一致。「时间」就是 remain，一切变化由它驱动。
2. 禁止触碰 document / window / location / fetch / localStorage 等任何全局对象（工具会静态扫描，命中即拒收）——只使用上面传入的参数。
3. 禁止 setTimeout / setInterval / requestAnimationFrame——你的代码每帧被同步调用一次。
4. 禁止全屏填充或大面积覆盖——倒计时是叠加在正文文字上的「角落小部件」，绘制范围请收缩在一个角落约 S*0.3 见方的区域（工具会用像素校验：改动画布超过 30% 的像素即拒收）。
5. ctx.globalAlpha 乘法叠加：const base = ctx.globalAlpha; … ctx.globalAlpha = base * 0.6;（若需要半透明）。
6. 不要 return 任何值；不要改画布尺寸；ctx.save()/ctx.restore() 必须成对。

【构图建议】
- 整数秒切换时可做轻微的脉冲/缩放强调（remain 的小数部分可算相位）；
- remain 归零前的最后 1 秒可加强提示感（如颜色变亮、轻微放大）；
- 页码信息（page/pages）可作次要元素，字号明显小于倒计时主体；
- 性能：每帧绘制调用 ≤ 500 次；避免 shadowBlur 大面积使用。

【输出格式】
只输出一个 \`\`\`js 围栏代码块，第一行必须是注释声明名称：
// 名称：沙漏细语
随后是函数体代码。围栏之外不要写任何解释文字。

【完整示例（展示接口与写法，请按我的需求重新创作，不要照抄）】
\`\`\`js
// 名称：呼吸圆点
const m = S * 0.075;          // 角落边距
const cx = W - m;             // 右下角
const cy = H - m;
const sec = Math.max(0, Math.ceil(remain - 0.001));
const frac = total > 0 ? remain / total : 0;
const phase = remain - Math.floor(remain); // 秒内相位
const r = S * 0.026 * (1 + 0.08 * Math.sin(phase * Math.PI * 2));
ctx.save();
// 进度弧
ctx.lineWidth = S * 0.005;
ctx.lineCap = 'round';
ctx.strokeStyle = theme.muted;
ctx.globalAlpha = 0.4;
ctx.beginPath();
ctx.arc(cx, cy, r, 0, Math.PI * 2);
ctx.stroke();
ctx.strokeStyle = theme.accent;
ctx.globalAlpha = 0.95;
ctx.beginPath();
ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
ctx.stroke();
// 剩余秒数
ctx.fillStyle = theme.fg;
ctx.font = '700 ' + (S * 0.022) + 'px ui-sans-serif, system-ui, sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText(String(sec), cx, cy);
ctx.restore();
\`\`\``;
}
