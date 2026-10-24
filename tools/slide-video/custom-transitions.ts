/**
 * 自定义翻页动画 —— AI 生成绘制代码的存储、编译、校验与提示词。
 *
 * 用户在 💡 向导里描述想要的翻页效果 → 组装提示词（可复制给任意 AI 或 ⚡ 直连）
 * → AI 返回「名称注释 + 函数体代码」→ 解析、静态扫描（共享危险名单 + 确定性
 * 名单）、dryRun 双端点像素校验 → 保存到 localStorage，在「翻页动画」区以
 * ⭐ chips 形式选用/删除。
 *
 * 代码约定：new Function('ctx','W','H','S','p','from','to','theme', code)
 * 每次翻页期间逐帧调用（p 从 0 到 1），from/to 是与画布同尺寸的两张页快照
 * （含背景）。必须确定性（禁 Math.random 等：预览实时播放 / 导出逐帧录制 /
 * 进度条回拖必须画面一致）。
 *
 * dryRun 双端点差异校验（本工具特有）：from/to 用两块纯色快照，p=0.5 的
 * 产物须与「只画 from」「只画 to」两个参照各有 ≥100 像素差——同时抓住
 * 「一帧啥也没画」与「瞬间跳到终态（p 任意都画 to）」两类废稿。
 *
 * 存储形态（JSON）：{ "version": 1, "items": CustomFlip[] }
 */

import { readJSON, writeJSON } from '@/core/utils/storage';
import { findDangerousPattern, dangerousCodeReason } from '@/core/utils/ai-code-guard';

import { THEMES, type Theme } from './options';
import type { FlipDraw, FlipFrame } from './renderer';

const STORAGE_KEY = 'slide-video:custom-transitions';
const CURRENT_VERSION = 1;
const ID_PREFIX = 'cflip:';

/** 一条自定义翻页动画（本地存储形态） */
export interface CustomFlip {
  /** 形如 cflip:abcd1234 */
  id: string;
  /** 展示名（≤12 字） */
  name: string;
  /** 函数体代码（首行名称注释在保存前已剥离） */
  code: string;
  createdAt: number;
}

interface CustomFlipBlob {
  version: number;
  items: CustomFlip[];
}

// ─────────────────────────── 存储 CRUD ───────────────────────────

/** 读取全部自定义翻页动画；存储损坏/为空时返回 [] */
export function loadCustomFlips(): CustomFlip[] {
  const parsed = readJSON(STORAGE_KEY) as Partial<CustomFlipBlob> | null;
  if (!parsed) return [];
  const items = parsed.items;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (it): it is CustomFlip =>
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

function persist(items: CustomFlip[]): void {
  const blob: CustomFlipBlob = { version: CURRENT_VERSION, items };
  writeJSON(STORAGE_KEY, blob);
}

function newId(): string {
  return ID_PREFIX + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** 新增或同名覆盖一条；返回更新后的完整列表 */
export function addCustomFlip(name: string, code: string): CustomFlip[] {
  const trimmed = name.trim().slice(0, 12);
  const items = loadCustomFlips();
  const existingIdx = items.findIndex((it) => it.name.trim() === trimmed);
  const entry: CustomFlip = {
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
export function removeCustomFlip(id: string): CustomFlip[] {
  const items = loadCustomFlips().filter((it) => it.id !== id);
  persist(items);
  return items;
}

// ─────────────────────────── 静态扫描 ───────────────────────────

/**
 * 翻页代码专属的非确定性 API 名单（正确性硬约束，非风格建议）：
 * 预览是实时播放、导出是逐帧录制、进度条可来回拖动，非确定性 API 会导致
 * 三者画面不一致。需要随机感请用 p 与 hash(i) 式确定性伪随机。
 */
const NON_DETERMINISTIC_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bMath\s*\.\s*random\b/, label: 'Math.random()' },
  { re: /\bDate\s*\.\s*now\b/, label: 'Date.now()' },
  { re: /\bnew\s+Date\b/, label: 'new Date()' },
  { re: /\bperformance\s*\.\s*now\b/, label: 'performance.now()' },
  // 函数体每帧同步调用一次，异步 API 会泄漏到帧外、行为不可控
  {
    re: /\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b/,
    label: 'setTimeout 等异步 API',
  },
];

/** 静态扫描：共享危险名单 + 确定性名单。干净返回 null，否则返回拒收原因 */
export function scanFlipCode(code: string): string | null {
  const danger = findDangerousPattern(code);
  if (danger) return dangerousCodeReason(danger);
  for (const p of NON_DETERMINISTIC_PATTERNS) {
    if (p.re.test(code)) {
      return (
        `代码使用了 ${p.label}。翻页代码在过渡期间每帧同步执行，且预览（实时播放）/ ` +
        `导出（逐帧录制）/ 拖动进度条必须画面一致——请只用传入的 p（0→1 进度）表达时间，` +
        `需要随机感用确定性伪随机，例如 'const hash=(i)=>{const x=Math.sin(i*127.1)*43758.5453;return x-Math.floor(x);}'`
      );
    }
  }
  return null;
}

// ─────────────────────────── 编译与运行时包装 ───────────────────────────

/** AI 代码的原始形态：位置参数逐帧调用 */
type RawFlipFn = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  S: number,
  p: number,
  from: HTMLCanvasElement,
  to: HTMLCanvasElement,
  theme: Theme,
) => void;

/** 编译函数体（只做语法编译，不扫描不试跑；语法错原样抛出） */
function compileRaw(code: string): RawFlipFn {
  // eslint-disable-next-line no-new-func -- AI 回填代码约定入口（与 quote-card/qr-code/song-video 一致）
  return new Function('ctx', 'W', 'H', 'S', 'p', 'from', 'to', 'theme', code) as RawFlipFn;
}

/** 单帧耗时超过该值视为超帧（录制为 30fps 实时编码，单帧预算约 33ms，留编码余量） */
const FRAME_BUDGET_MS = 8;
/** 连续超帧多少次后本会话放弃（偶发抖动不误杀） */
const SLOW_STREAK_LIMIT = 5;

/**
 * 把原始函数包装成 FlipDraw：
 *   - 每帧 ctx.save()/finally-restore（AI 代码漏 restore 也不污染画面状态）；
 *   - 运行时抛错 → 本会话停用，返回 false 交由调用方回退内置淡入淡出；
 *   - 帧耗保护：连续 5 帧 >8ms → 本会话停用（防拖垮实时录制）。
 */
function guardRaw(raw: RawFlipFn): FlipDraw {
  let dead = false;
  let slowStreak = 0;
  return (frame: FlipFrame) => {
    if (dead) return false;
    const { ctx } = frame;
    const t0 = performance.now();
    ctx.save();
    try {
      raw(frame.ctx, frame.W, frame.H, frame.S, frame.p, frame.from, frame.to, frame.theme);
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
 * 增删样式时调 invalidateFlipCache 失效。
 */
const drawCache = new Map<string, FlipDraw | null>();

export function invalidateFlipCache(id?: string): void {
  if (id === undefined) drawCache.clear();
  else drawCache.delete(id);
}

/**
 * 按 id 取可执行的包装绘制函数；不存在/代码非法返回 null
 * （渲染层拿到 null 自动回退内置淡入淡出，静默不打断）。
 */
export function getCustomFlipDraw(id: string): FlipDraw | null {
  if (drawCache.has(id)) return drawCache.get(id) ?? null;
  const item = loadCustomFlips().find((v) => v.id === id);
  let draw: FlipDraw | null = null;
  if (item) {
    // 与 quote-card 约定一致：执行前复检危险模式（防存储被篡改后绕过保存时校验）
    if (!scanFlipCode(item.code)) {
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
export function compileFlipForPreview(
  code: string,
): { ok: true; draw: FlipDraw } | { ok: false; reason: string } {
  const scan = scanFlipCode(code);
  if (scan) return { ok: false, reason: scan };
  try {
    return { ok: true, draw: guardRaw(compileRaw(code)) };
  } catch (e) {
    return { ok: false, reason: '代码语法有误：' + (e instanceof Error ? e.message : String(e)) };
  }
}

// ─────────────────────────── dryRun 双端点像素校验 ───────────────────────────

/** dryRun 画布与判定阈值 */
const DRY_W = 640;
const DRY_H = 360;
/** 与参照色任一通道差超过该值即计为「差异像素」（容忍半透明混合的微弱差异） */
const PIXEL_DIFF_EPSILON = 2;
/** 与两个端点参照各需达到的差异像素数 */
const PIXEL_MIN_DIFF = 100;
/** dryRun 用的两张纯色快照（鲜明的两端，任何有效混合/位移都会同时偏离两端） */
const FROM_COLOR: [number, number, number] = [179, 57, 57]; // #b33939
const TO_COLOR: [number, number, number] = [33, 140, 116]; // #218c74

function solidCanvas(color: string): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = DRY_W;
  cv.height = DRY_H;
  const c = cv.getContext('2d');
  if (c) {
    c.fillStyle = color;
    c.fillRect(0, 0, DRY_W, DRY_H);
  }
  return cv;
}

/**
 * 保存前校验：静态扫描 → 编译 → from/to 两块纯色快照，p=0.5 跑一帧 →
 * 与「只画 from」「只画 to」两个参照色各需 ≥100 差异像素。
 * 抓两类废稿：啥也没画（与两端都无差）；瞬间跳终态（p∈(0,1) 恒画某一端）。
 */
export function dryRunFlip(code: string): { ok: boolean; reason?: string } {
  const scan = scanFlipCode(code);
  if (scan) return { ok: false, reason: scan };
  let raw: RawFlipFn;
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

  const from = solidCanvas('#b33939');
  const to = solidCanvas('#218c74');
  const S = Math.min(DRY_W, DRY_H);
  try {
    ctx.save();
    raw(ctx, DRY_W, DRY_H, S, 0.5, from, to, THEMES[0]!);
  } catch (e) {
    return { ok: false, reason: '运行时报错：' + (e instanceof Error ? e.message : String(e)) };
  } finally {
    ctx.restore();
  }

  // 双端点差异计数：中途帧应同时偏离两端（交叉混合/位移/遮挡都会满足）
  let diffFrom = 0;
  let diffTo = 0;
  const img = ctx.getImageData(0, 0, DRY_W, DRY_H).data;
  for (let p = 0; p < img.length; p += 4) {
    const r = img[p]!;
    const g = img[p + 1]!;
    const b = img[p + 2]!;
    if (
      Math.abs(r - FROM_COLOR[0]) > PIXEL_DIFF_EPSILON ||
      Math.abs(g - FROM_COLOR[1]) > PIXEL_DIFF_EPSILON ||
      Math.abs(b - FROM_COLOR[2]) > PIXEL_DIFF_EPSILON
    ) {
      diffFrom++;
    }
    if (
      Math.abs(r - TO_COLOR[0]) > PIXEL_DIFF_EPSILON ||
      Math.abs(g - TO_COLOR[1]) > PIXEL_DIFF_EPSILON ||
      Math.abs(b - TO_COLOR[2]) > PIXEL_DIFF_EPSILON
    ) {
      diffTo++;
    }
    if (diffFrom >= PIXEL_MIN_DIFF && diffTo >= PIXEL_MIN_DIFF) break; // 双双达标可提前退出
  }
  if (diffFrom < PIXEL_MIN_DIFF || diffTo < PIXEL_MIN_DIFF) {
    return {
      ok: false,
      reason:
        '校验未通过：过渡中段（p=0.5）的画面应同时呈现新旧两页的混合状态，' +
        '但当前代码的产物几乎等于单一端点（或什么都没画）。请确认代码用 drawImage 绘制 from 与 to 两页、且效果随 p 变化。',
    };
  }
  return { ok: true };
}

// ─────────────────────────── AI 输出解析 ───────────────────────────

/** 名称注释行（兼容 // 与 # 前缀、中英文冒号、name/名称 等别名） */
const NAME_LINE_RE = /^\s*(?:\/\/|#)\s*(?:名称|name)\s*[:：]\s*(.+?)\s*$/im;

/** 从 AI 整段回复中提取「名称 + 函数体代码」；识别失败返回原因 */
export function parseFlipAIOutput(
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
      reason: '没识别到名称——AI 返回的代码块首行应是「// 名称：对角卷页」这样的注释。',
    };
  }
  return { ok: true, name: name.slice(0, 12), code };
}

// ─────────────────────────── AI 提示词 ───────────────────────────

/**
 * 组装「用 AI 生成自定义翻页动画」的提示词。
 * 约定与禁令必须写全：确定性、只用传入参数、from/to 是快照源。
 */
export function buildFlipPrompt(description: string): string {
  const desc = description.trim() || '优雅流畅的翻页过渡';
  return `你是一个精通 Canvas 2D 创意编码（creative coding）的动效工程师，为演示视频生成「翻页过渡」绘制代码。

【我想要的翻页效果】
${desc}

【代码约定（必须严格遵守）】
你的代码是一个「函数体」，工具会在每次翻页过渡期间逐帧这样调用它：
new Function('ctx','W','H','S','p','from','to','theme', <你的代码>)(...)
参数说明：
- ctx: CanvasRenderingContext2D 画布上下文，只管往上面画
- W, H: 画布宽高（px）；S = min(W, H)——所有尺寸一律用 S 的比例表达（如 S*0.05），适配 16:9 / 9:16 / 1:1
- p: 翻页进度 0→1（线性）。0 = 还停在旧页，1 = 已完全到新页；建议代码内自行 easing（如 p*p*(3-2*p) 平滑）
- from / to: 两张与画布同尺寸的 canvas 快照（旧页 / 新页，自带背景），是唯一的画面来源——用 ctx.drawImage(from, 0, 0) / ctx.drawImage(to, 0, 0) 绘制，可配合 transform / clip / globalAlpha / 阴影做效果
- theme: { bg:[起,止], fg, accent, muted, light } —— 阴影/高光等颜色取自这里（阴影一般用半透明黑即可）

【⚠ 硬性禁令（违反任何一条都会被工具拒收）】
1. 禁止使用 Math.random() / Date.now() / new Date() / performance.now() —— 预览是实时播放、导出是逐帧录制、进度条可来回拖动，非确定性 API 会导致三者画面不一致。过渡的「时间」就是 p，一切变化由 p 驱动；需要随机感用确定性伪随机：
   const hash = (i) => { const x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); };
2. 禁止触碰 document / window / location / fetch / localStorage 等任何全局对象（工具会静态扫描，命中即拒收）——只使用上面传入的参数。
3. 禁止 setTimeout / setInterval / requestAnimationFrame——你的代码每帧被同步调用一次。
4. 不要 return 任何值（绘制即副作用）；不要改画布尺寸；ctx.save()/ctx.restore() 必须成对（若用到变换）。
5. 每一帧都必须画出覆盖整个画面的结果（from/to 至少其一为主体），不能留透明区域——视频没有「透出底」的概念。
6. 性能：每帧绘制调用 ≤ 2000 次（录制是 30fps 实时编码，过重会掉帧）；避免大面积 shadowBlur。

【校验规则（保存时会自动检查）】
工具会用两张纯色样张跑 p=0.5 的一帧，要求画面同时混合新旧两页的特征（与单一端点都有明显像素差）——瞬间切换（任何 p>0 都只画 to）或什么都没画的代码都会被拒收。

【输出格式】
只输出一个 \`\`\`js 围栏代码块，第一行必须是注释声明名称：
// 名称：对角卷页
随后是函数体代码。围栏之外不要写任何解释文字。

【完整示例（展示接口与写法，请按我的需求重新创作，不要照抄）】
\`\`\`js
// 名称：斜切推移
const e = p * p * (3 - 2 * p); // smoothstep 缓动
const sk = 0.12 * (1 - e);     // 斜切量随进度收敛到 0
// 旧页整体向左推移并轻微斜切离场
ctx.save();
ctx.setTransform(1, -sk, 0, 1, -e * W, -sk * e * W);
ctx.drawImage(from, 0, 0);
ctx.restore();
// 新页从右侧跟进，带一条主色光带扫过
const off = (1 - e) * W * 0.25;
ctx.save();
ctx.globalAlpha = Math.min(1, e * 1.6);
ctx.setTransform(1, sk, 0, 1, off, 0);
ctx.drawImage(to, 0, 0);
ctx.restore();
ctx.save();
const bandX = (1 - e) * W;
const g = ctx.createLinearGradient(bandX - S * 0.08, 0, bandX + S * 0.08, 0);
g.addColorStop(0, 'rgba(0,0,0,0)');
g.addColorStop(0.5, theme.accent);
g.addColorStop(1, 'rgba(0,0,0,0)');
ctx.globalAlpha = 0.55 * (1 - Math.abs(e - 0.5) * 2);
ctx.fillStyle = g;
ctx.fillRect(bandX - S * 0.08, 0, S * 0.16, H);
ctx.restore();
\`\`\``;
}
