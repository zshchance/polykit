/**
 * 自定义频谱样式 —— AI 生成绘制代码的存储、编译、校验与提示词。
 *
 * 用户在 💡 向导里描述想要的频谱效果 → 组装提示词（可复制给任意 AI 或 ⚡ 直连）
 * → AI 返回「名称注释 + 函数体代码」→ 解析、静态扫描（共享危险名单 + 确定性名单）、
 * dryRun 像素校验（本项目首创：离屏画布填已知底色跑一帧，像素无变化即拒收）→
 * 保存到 localStorage，在「音频可视化」区以 ⭐ chips 形式选用/删除。
 *
 * 代码约定：new Function('ctx','W','H','S','bands','wave','t','dur','theme','layout', code)
 * 每帧调用一次（预览 rAF / 录制 30fps 共用），因此必须确定性（禁 Math.random 等，
 * 否则预览与导出视频逐帧不一致）、globalAlpha 乘法叠加（不打穿开场/结尾淡入淡出）。
 *
 * 存储形态（JSON）：{ "version": 1, "items": CustomVisualizer[] }
 */

import { readJSON, writeJSON } from '@/core/utils/storage';
import { findDangerousPattern, dangerousCodeReason } from '@/core/utils/ai-code-guard';

import { THEMES, type Theme } from './options';
import type { CustomVisualizerDraw, CustomVisualizerFrame } from './renderer';

const STORAGE_KEY = 'song-video:custom-visualizers';
const CURRENT_VERSION = 1;
const ID_PREFIX = 'cviz:';

/** 一条自定义频谱样式（本地存储形态） */
export interface CustomVisualizer {
  /** 形如 cviz:abcd1234 */
  id: string;
  /** 展示名（≤12 字） */
  name: string;
  /** 函数体代码（首行名称注释在保存前已剥离） */
  code: string;
  createdAt: number;
}

interface CustomVisualizerBlob {
  version: number;
  items: CustomVisualizer[];
}

// ─────────────────────────── 存储 CRUD ───────────────────────────

/** 读取全部自定义频谱样式；存储损坏/为空时返回 [] */
export function loadCustomVisualizers(): CustomVisualizer[] {
  const parsed = readJSON(STORAGE_KEY) as Partial<CustomVisualizerBlob> | null;
  if (!parsed) return [];
  const items = parsed.items;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (it): it is CustomVisualizer =>
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

function persist(items: CustomVisualizer[]): void {
  const blob: CustomVisualizerBlob = { version: CURRENT_VERSION, items };
  writeJSON(STORAGE_KEY, blob);
}

function newId(): string {
  return ID_PREFIX + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** 新增或同名覆盖一条；返回更新后的完整列表 */
export function addCustomVisualizer(name: string, code: string): CustomVisualizer[] {
  const trimmed = name.trim().slice(0, 12);
  const items = loadCustomVisualizers();
  const existingIdx = items.findIndex((it) => it.name.trim() === trimmed);
  const entry: CustomVisualizer = {
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
export function removeCustomVisualizer(id: string): CustomVisualizer[] {
  const items = loadCustomVisualizers().filter((it) => it.id !== id);
  persist(items);
  return items;
}

// ─────────────────────────── 静态扫描 ───────────────────────────

/**
 * 频谱代码专属的非确定性 API 名单（正确性硬约束，非风格建议）：
 * 预览是实时播放、导出是逐帧录制、进度条可来回拖动，非确定性 API 会导致
 * 三者画面不一致。需要随机感请用 t 与 hash(i,t) 式确定性伪随机。
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

/**
 * 通用静态扫描：共享危险名单 + 确定性名单。干净返回 null，否则返回拒收原因。
 * subject 用于提示语（如「频谱代码」「角色绘制代码」）。
 */
export function scanDeterministicCode(code: string, subject = '这段代码'): string | null {
  const danger = findDangerousPattern(code);
  if (danger) return dangerousCodeReason(danger);
  for (const p of NON_DETERMINISTIC_PATTERNS) {
    if (p.re.test(code)) {
      return (
        `代码使用了 ${p.label}。${subject}每帧同步执行，且预览（实时播放）/ 导出（逐帧录制）` +
        `/ 拖动进度条必须画面一致——请改用传入的 t 与确定性伪随机，例如 ` +
        `'const hash=(i,t)=>{const x=Math.sin(i*127.1+Math.floor(t*30)*311.7)*43758.5453;return x-Math.floor(x);}'`
      );
    }
  }
  return null;
}

/** 频谱代码静态扫描（保持原有调用点语义） */
export function scanVisualizerCode(code: string): string | null {
  return scanDeterministicCode(code, '频谱代码');
}

// ─────────────────────────── 编译与运行时包装 ───────────────────────────

/** AI 代码的原始形态：位置参数逐帧调用 */
type RawVizFn = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  S: number,
  bands: Uint8Array,
  wave: Uint8Array,
  t: number,
  dur: number,
  theme: Theme,
  layout: CustomVisualizerFrame['layout'],
) => void;

/** 编译函数体（只做语法编译，不扫描不试跑；语法错原样抛出） */
function compileRaw(code: string): RawVizFn {
  // eslint-disable-next-line no-new-func -- AI 回填代码约定入口（与 quote-card/qr-code 一致）
  return new Function(
    'ctx',
    'W',
    'H',
    'S',
    'bands',
    'wave',
    't',
    'dur',
    'theme',
    'layout',
    code,
  ) as RawVizFn;
}

/** 单帧耗时超过该值视为超帧（录制为 30fps 实时编码，单帧预算约 33ms，留编码余量） */
const FRAME_BUDGET_MS = 8;
/** 连续超帧多少次后本会话放弃（偶发抖动不误杀） */
const SLOW_STREAK_LIMIT = 5;

/**
 * 把原始函数包装成 CustomVisualizerDraw：
 *   - 每帧 ctx.save()/finally-restore（AI 代码漏 restore 也不污染内容层状态）；
 *   - 运行时抛错 → 本会话停用，返回 false 交由调用方回退内置频谱；
 *   - 帧耗保护：连续 5 帧 >8ms → 本会话停用（防拖垮实时录制）。
 */
function guardRaw(raw: RawVizFn): CustomVisualizerDraw {
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
        frame.bands,
        frame.wave,
        frame.t,
        frame.dur,
        frame.theme,
        frame.layout,
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
 * 增删样式时调 invalidateVisualizerCache 失效。
 */
const drawCache = new Map<string, CustomVisualizerDraw | null>();

export function invalidateVisualizerCache(id?: string): void {
  if (id === undefined) drawCache.clear();
  else drawCache.delete(id);
}

/**
 * 按 id 取可执行的包装绘制函数；不存在/代码非法返回 null
 * （渲染层拿到 null 自动回退内置条形频谱，静默不打断）。
 */
export function getCustomVisualizerDraw(id: string): CustomVisualizerDraw | null {
  if (drawCache.has(id)) return drawCache.get(id) ?? null;
  const item = loadCustomVisualizers().find((v) => v.id === id);
  let draw: CustomVisualizerDraw | null = null;
  if (item) {
    // 与 quote-card 约定一致：执行前复检危险模式（防存储被篡改后绕过保存时校验）
    if (!scanVisualizerCode(item.code)) {
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

// ─────────────────────────── dryRun 像素校验 ───────────────────────────

/**
 * 编译一段代码用于向导弹窗里的「合成频谱演播」（静态扫描 + 编译 + 运行时守卫；
 * 不做像素校验——演播画布本身就是实时可视化校验）。
 */
export function compileVisualizerForPreview(
  code: string,
): { ok: true; draw: CustomVisualizerDraw } | { ok: false; reason: string } {
  const scan = scanVisualizerCode(code);
  if (scan) return { ok: false, reason: scan };
  try {
    return { ok: true, draw: guardRaw(compileRaw(code)) };
  } catch (e) {
    return { ok: false, reason: '代码语法有误：' + (e instanceof Error ? e.message : String(e)) };
  }
}

/** dryRun / 演播用的合成频谱（能量充足的类音乐包络，正弦叠加，确定性） */
export function syntheticBands(count: number, t: number, out?: Uint8Array): Uint8Array {
  const buf = out ?? new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const beat = 0.6 + 0.4 * Math.sin(t * Math.PI * 2 * 1.1); // 约 1.1Hz 节拍起伏
    const tilt = 1 - (i / count) * 0.55; // 低频能量高、高频低
    const wob = 0.75 + 0.25 * Math.sin(i * 0.7 + t * 3.1);
    const v = 128 + 120 * beat * tilt * wob * 0.85;
    buf[i] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return buf;
}

/** dryRun 画布与判定阈值 */
const DRY_W = 640;
const DRY_H = 360;
/** 与底色任一通道差超过该值即计为「变化像素」（容忍半透明 alpha 混合的微弱差异） */
const PIXEL_DIFF_EPSILON = 2;
/** 变化像素达到该数才认定「画出了可见内容」 */
const PIXEL_MIN_CHANGED = 100;

/**
 * 保存前校验：静态扫描 → 编译 → 离屏画布填已知底色 (#808080) 跑一帧 →
 * 像素差异计数。频谱场景「一帧啥也没画」即失败（与二维码码点「空代码合法」不同）。
 */
export function dryRunVisualizer(code: string): { ok: boolean; reason?: string } {
  const scan = scanVisualizerCode(code);
  if (scan) return { ok: false, reason: scan };
  let raw: RawVizFn;
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

  const bands = syntheticBands(64, 12.5);
  const wave = new Uint8Array(2048);
  for (let i = 0; i < wave.length; i++) {
    wave[i] = Math.round(128 + 100 * Math.sin((i / wave.length) * Math.PI * 2 * 3));
  }
  const S = Math.min(DRY_W, DRY_H);
  try {
    ctx.save();
    raw(ctx, DRY_W, DRY_H, S, bands, wave, 12.5, 180, THEMES[0]!, {
      coverCx: DRY_W / 2,
      coverCy: DRY_H * 0.36,
      coverR: S * 0.17,
    });
  } catch (e) {
    return { ok: false, reason: '运行时报错：' + (e instanceof Error ? e.message : String(e)) };
  } finally {
    ctx.restore();
  }

  // 像素校验：任一通道与底色 (128,128,128) 差 >2 即变化；达到阈值才通过
  let changed = 0;
  const img = ctx.getImageData(0, 0, DRY_W, DRY_H).data;
  for (let p = 0; p < img.length; p += 4) {
    if (
      Math.abs(img[p]! - 128) > PIXEL_DIFF_EPSILON ||
      Math.abs(img[p + 1]! - 128) > PIXEL_DIFF_EPSILON ||
      Math.abs(img[p + 2]! - 128) > PIXEL_DIFF_EPSILON
    ) {
      changed++;
      if (changed >= PIXEL_MIN_CHANGED) break; // 达到阈值即可提前退出
    }
  }
  if (changed < PIXEL_MIN_CHANGED) {
    return {
      ok: false,
      reason: '代码在这一帧没有画出可见内容——请确认确实调用了 ctx 的绘制方法（fill/stroke 等）。',
    };
  }
  return { ok: true };
}

// ─────────────────────────── AI 输出解析 ───────────────────────────

/** 名称注释行（兼容 // 与 # 前缀、中英文冒号、name/名称 等别名） */
const NAME_LINE_RE = /^\s*(?:\/\/|#)\s*(?:名称|name)\s*[:：]\s*(.+?)\s*$/im;

/** 从 AI 整段回复中提取「名称 + 函数体代码」；识别失败返回 null 原因 */
export function parseVisualizerAIOutput(
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
      reason: '没识别到名称——AI 返回的代码块首行应是「// 名称：极光幕帘」这样的注释。',
    };
  }
  return { ok: true, name: name.slice(0, 12), code };
}

// ─────────────────────────── AI 提示词 ───────────────────────────

/**
 * 组装「用 AI 生成自定义频谱样式」的提示词。
 * 约定与禁令必须写全：确定性（预览/导出/拖动一致）、globalAlpha 乘法、禁全屏填充。
 */
export function buildVisualizerPrompt(description: string): string {
  const desc = description.trim() || '有创意、随音乐跳动的频谱';
  return `你是一个精通 Canvas 2D 创意编码（creative coding）的视觉工程师，为音乐视频生成「频谱可视化」绘制代码。

【我想要的频谱效果】
${desc}

【代码约定（必须严格遵守）】
你的代码是一个「函数体」，工具会这样调用它（每帧一次）：
new Function('ctx','W','H','S','bands','wave','t','dur','theme','layout', <你的代码>)(...)
参数说明：
- ctx: CanvasRenderingContext2D 画布上下文，只管往上面画
- W, H: 画布宽高（px）；S = min(W, H)——所有尺寸一律用 S 的比例表达（如 S*0.05），适配 16:9 / 9:16 / 1:1
- bands: Uint8Array(64)，对数分桶的频段能量 0-255（低频在前）；静音时全 0
- wave: Uint8Array(2048)，时域波形 0-255（128 = 中线）
- t: 当前音频时间（秒，从歌曲起点计）；dur: 音频总时长（秒）
- theme: { bg:[起,止], fg, accent, muted, light } —— 颜色只能取自这里，以 theme.accent 为主
- layout: { coverCx, coverCy, coverR } —— 画面中专辑封面黑胶盘的圆心与半径（构图参考，即使无封面也存在）

【⚠ 硬性禁令（违反任何一条都会被工具拒收）】
1. 禁止使用 Math.random() / Date.now() / new Date() / performance.now() —— 预览是实时播放、导出是逐帧录制、进度条可来回拖动，非确定性 API 会导致画面不一致。需要随机感请用确定性伪随机：
   const hash = (i, t) => { const x = Math.sin(i * 127.1 + Math.floor(t * 30) * 311.7) * 43758.5453; return x - Math.floor(x); };
2. 禁止触碰 document / window / location / fetch / localStorage 等任何全局对象（工具会静态扫描，命中即拒收）——只使用上面传入的参数。
3. 禁止 setTimeout / setInterval / requestAnimationFrame——你的代码每帧被同步调用一次。
4. 禁止对整个画布做不透明全屏填充（如 fillRect(0,0,W,H) 用不透明色）——你画在背景与歌词之上，全屏填充会盖住它们。
5. ctx.globalAlpha 必须乘法叠加：const base = ctx.globalAlpha; … ctx.globalAlpha = base * 0.6; ——开场/结尾有整体淡入淡出，直接赋值会打穿动画。
6. 不要 return 任何值（绘制即副作用）；不要改画布尺寸；ctx.save()/ctx.restore() 必须成对。

【构图要求】
- 画面中部偏下是歌词区（单行大字或滚动列表），layout 处是封面圆盘——频谱沿画面底部、环绕封面或画面边缘布置，避免大面积遮挡歌词。
- 静音帧（bands 全 0）也要有稳定的「待机」画面，不能完全消失。
- 性能：每帧绘制调用 ≤ 2000 次（录制是 30fps 实时编码，过重会掉帧）；避免大面积 shadowBlur。

【输出格式】
只输出一个 \`\`\`js 围栏代码块，第一行必须是注释声明名称：
// 名称：极光幕帘
随后是函数体代码。围栏之外不要写任何解释文字。

【完整示例（展示接口与写法，请按我的需求重新创作，不要照抄）】
\`\`\`js
// 名称：呼吸光环
const n = 64;
const base = ctx.globalAlpha;
ctx.strokeStyle = theme.accent;
ctx.lineWidth = S * 0.008;
ctx.lineCap = 'round';
for (let i = 0; i < n; i++) {
  const v = bands[i] / 255;
  const ang = (i / n) * Math.PI * 2 + t * 0.2;
  const r1 = layout.coverR * 1.15;
  const len = S * 0.015 + v * S * 0.07;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  ctx.globalAlpha = base * (0.25 + v * 0.7);
  ctx.beginPath();
  ctx.moveTo(layout.coverCx + cos * r1, layout.coverCy + sin * r1);
  ctx.lineTo(layout.coverCx + cos * (r1 + len), layout.coverCy + sin * (r1 + len));
  ctx.stroke();
}
ctx.globalAlpha = base;
\`\`\``;
}
