/**
 * AI 进度条效果代码 —— 用户选择/上传载体后，由 AI 代码直接绘制整个进度条区域。
 *
 * 新效果（mode='full'）代码契约：
 *   new Function('ctx','W','H','S','p','t','dur','theme','img','frame','layout', code)
 *   layout = { marginX, barW, trackY, trackH, x, y, size, angle }
 *   轨道、进度、时间、载体、尾迹、卫星/流星/爆炸等都由代码自行决定。
 *
 * 旧版 actor 模式（mode='actor'）仍兼容：代码只画角色，渲染层补轨道/时间/尾迹。
 * 保存前校验：静态扫描 → 编译 → 双端点 dryRun（p=0.2 / p=0.8）：
 *   - 两端都必须画出可见像素；
 *   - 两端质心 x 必须明显不同（抓「忽略进度、原地不动」废稿）；
 *   - 变化像素不能接近全屏（抓「整屏填充遮挡歌词」废稿）。
 */

import { readJSON, writeJSON } from '@/core/utils/storage';

import { THEMES, type Theme } from './options';
import { scanDeterministicCode } from './custom-visualizers';
import type { CustomActorDraw, CustomActorFrame, CustomProgressLayout } from './renderer';

const STORAGE_KEY = 'song-video:custom-actors';
const CURRENT_VERSION = 1;
const ID_PREFIX = 'cvact:';

/** actor=旧版只画角色；full=整条进度条由代码绘制 */
export type CustomEffectMode = 'actor' | 'full';

export interface CustomProgressActor {
  /** 形如 cvact:abcd1234 */
  id: string;
  /** 展示名（≤12 字） */
  name: string;
  /** 函数体代码（首行名称注释已剥离） */
  code: string;
  /** 旧数据缺省视为 actor */
  mode?: CustomEffectMode;
  createdAt: number;
}

interface CustomActorBlob {
  version: number;
  items: CustomProgressActor[];
}

// ─────────────────────────── 存储 CRUD ───────────────────────────

export function loadCustomActors(): CustomProgressActor[] {
  const parsed = readJSON(STORAGE_KEY) as Partial<CustomActorBlob> | null;
  if (!parsed) return [];
  const items = parsed.items;
  if (!Array.isArray(items)) return [];
  return items.filter((it): it is CustomProgressActor => {
    if (!it || typeof it !== 'object') return false;
    const o = it as unknown as Record<string, unknown>;
    const modeOk = o.mode === undefined || o.mode === 'actor' || o.mode === 'full';
    return (
      typeof o.id === 'string' &&
      o.id.startsWith(ID_PREFIX) &&
      typeof o.name === 'string' &&
      o.name.trim().length > 0 &&
      typeof o.code === 'string' &&
      o.code.trim().length > 0 &&
      typeof o.createdAt === 'number' &&
      modeOk
    );
  });
}

function persist(items: CustomProgressActor[]): void {
  const blob: CustomActorBlob = { version: CURRENT_VERSION, items };
  writeJSON(STORAGE_KEY, blob);
}

function newId(): string {
  return ID_PREFIX + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** 新增或同名覆盖一条；返回更新后的完整列表（新方案默认 full） */
export function addCustomActor(
  name: string,
  code: string,
  mode: CustomEffectMode = 'full',
): CustomProgressActor[] {
  const trimmed = name.trim().slice(0, 12);
  const items = loadCustomActors();
  const existingIdx = items.findIndex((it) => it.name.trim() === trimmed);
  const entry: CustomProgressActor = {
    id: existingIdx >= 0 ? items[existingIdx]!.id : newId(),
    name: trimmed,
    code,
    mode,
    createdAt: existingIdx >= 0 ? items[existingIdx]!.createdAt : Date.now(),
  };
  if (existingIdx >= 0) items[existingIdx] = entry;
  else items.push(entry);
  persist(items);
  return items;
}

/** 删除一条；返回更新后的完整列表 */
export function removeCustomActor(id: string): CustomProgressActor[] {
  const items = loadCustomActors().filter((it) => it.id !== id);
  persist(items);
  return items;
}

// ─────────────────────────── 编译与运行时包装 ───────────────────────────

type RawActorFn = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  S: number,
  p: number,
  t: number,
  dur: number,
  x: number,
  y: number,
  size: number,
  angle: number,
  theme: Theme,
  img: CanvasImageSource | null,
  frame: CanvasImageSource | null,
  layout: CustomProgressLayout,
) => void;

function compileRaw(code: string): RawActorFn {
  // eslint-disable-next-line no-new-func -- AI 回填代码约定入口
  return new Function(
    'ctx',
    'W',
    'H',
    'S',
    'p',
    't',
    'dur',
    'x',
    'y',
    'size',
    'angle',
    'theme',
    'img',
    'frame',
    'layout',
    code,
  ) as RawActorFn;
}

const FRAME_BUDGET_MS = 8;
const SLOW_STREAK_LIMIT = 5;

/** 运行时守卫：逐帧 save/restore、抛错停用、连续超帧停用 */
function guardRaw(raw: RawActorFn): CustomActorDraw {
  let dead = false;
  let slowStreak = 0;
  return (frame: CustomActorFrame) => {
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
        frame.t,
        frame.dur,
        frame.x,
        frame.y,
        frame.size,
        frame.angle,
        frame.theme,
        frame.img,
        frame.frame,
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
      if (slowStreak >= SLOW_STREAK_LIMIT) dead = true;
    } else {
      slowStreak = 0;
    }
    return true;
  };
}

interface CachedEffect {
  mode: CustomEffectMode;
  draw: CustomActorDraw;
}

const drawCache = new Map<string, CachedEffect | null>();

export function invalidateCustomActorCache(id?: string): void {
  if (id === undefined) drawCache.clear();
  else drawCache.delete(id);
}

function resolveEffect(id: string): CachedEffect | null {
  if (drawCache.has(id)) return drawCache.get(id) ?? null;
  const item = loadCustomActors().find((it) => it.id === id);
  let entry: CachedEffect | null = null;
  if (item) {
    const mode: CustomEffectMode = item.mode === 'full' ? 'full' : 'actor';
    if (!scanActorCode(item.code)) {
      try {
        entry = { mode, draw: guardRaw(compileRaw(item.code)) };
      } catch {
        entry = null;
      }
    }
  }
  drawCache.set(id, entry);
  return entry;
}

/** 按 id 取可执行绘制函数；不存在/非法返回 null（渲染层回退） */
export function getCustomActorDraw(id: string): CustomActorDraw | null {
  return resolveEffect(id)?.draw ?? null;
}

/** 方案模式：旧数据/非法 id 按 actor 处理 */
export function getCustomEffectMode(id: string): CustomEffectMode {
  return resolveEffect(id)?.mode ?? 'actor';
}

/** 静态扫描（共享危险名单 + 确定性名单） */
export function scanActorCode(code: string): string | null {
  return scanDeterministicCode(code, 'AI 效果代码');
}

// ─────────────────────────── dryRun 双端点校验 ───────────────────────────

const DRY_W = 640;
const DRY_H = 360;
const PIXEL_DIFF_EPSILON = 2;
const MIN_CHANGED = 120;
/** 变化像素超过该比例视为整屏填充（会盖住歌词/背景） */
const MAX_CHANGED_RATIO = 0.62;
/** 两端质心 x 的最小位移 */
const MIN_MOVE_X = 24;

function makeSampleImage(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 96;
  const ctx = cv.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(48, 48, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  return cv;
}

interface EndpointResult {
  changed: number;
  ratio: number;
  centroidX: number;
}

function runEndpoint(
  raw: RawActorFn,
  p: number,
  sample: HTMLCanvasElement,
): { ok: true; result: EndpointResult } | { ok: false; reason: string } {
  const cv = document.createElement('canvas');
  cv.width = DRY_W;
  cv.height = DRY_H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { ok: false, reason: '当前浏览器无法创建画布，无法校验。' };

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, DRY_W, DRY_H);
  const S = Math.min(DRY_W, DRY_H);
  const marginX = DRY_W * 0.12;
  const barW = DRY_W - marginX * 2;
  const trackH = S * 0.006;
  const trackY = DRY_H - S * 0.052;
  const x = marginX + barW * p;
  const size = S * 0.12;
  const y = trackY - size / 2;
  const layout: CustomProgressLayout = {
    marginX,
    barW,
    trackY,
    trackH,
    x,
    y,
    size,
    angle: 0,
  };

  try {
    ctx.save();
    raw(ctx, DRY_W, DRY_H, S, p, 12.5, 180, x, y, size, 0, THEMES[0]!, sample, sample, layout);
  } catch (e) {
    return {
      ok: false,
      reason: '运行时报错：' + (e instanceof Error ? e.message : String(e)),
    };
  } finally {
    ctx.restore();
  }

  const img = ctx.getImageData(0, 0, DRY_W, DRY_H).data;
  let changed = 0;
  let sumX = 0;
  for (let py = 0; py < DRY_H; py++) {
    for (let px = 0; px < DRY_W; px++) {
      const i = (py * DRY_W + px) * 4;
      if (
        Math.abs(img[i]! - 128) > PIXEL_DIFF_EPSILON ||
        Math.abs(img[i + 1]! - 128) > PIXEL_DIFF_EPSILON ||
        Math.abs(img[i + 2]! - 128) > PIXEL_DIFF_EPSILON
      ) {
        changed++;
        sumX += px;
      }
    }
  }
  return {
    ok: true,
    result: {
      changed,
      ratio: changed / (DRY_W * DRY_H),
      centroidX: changed > 0 ? sumX / changed : 0,
    },
  };
}

export function dryRunProgressEffect(code: string): { ok: boolean; reason?: string } {
  const scan = scanActorCode(code);
  if (scan) return { ok: false, reason: scan };
  let raw: RawActorFn;
  try {
    raw = compileRaw(code);
  } catch (e) {
    return {
      ok: false,
      reason: '代码语法有误：' + (e instanceof Error ? e.message : String(e)),
    };
  }

  const sample = makeSampleImage();
  const a = runEndpoint(raw, 0.2, sample);
  const b = runEndpoint(raw, 0.8, sample);
  if (!a.ok) return { ok: false, reason: a.reason };
  if (!b.ok) return { ok: false, reason: b.reason };

  for (const [p, result] of [[0.2, a.result] as const, [0.8, b.result] as const]) {
    if (result.changed < MIN_CHANGED) {
      return {
        ok: false,
        reason: `p=${p} 时没有画出可见内容——请确认代码绘制了轨道/载体/进度等可见元素。`,
      };
    }
    if (result.ratio > MAX_CHANGED_RATIO) {
      return {
        ok: false,
        reason: '代码把大半个画布都涂满了——AI 效果只能在底部进度条区域活动，不能做全屏填充。',
      };
    }
  }

  if (Math.abs(b.result.centroidX - a.result.centroidX) < MIN_MOVE_X) {
    return {
      ok: false,
      reason: '进度条在 p=0.2 与 p=0.8 的位置几乎一样——请用传入的 p / x 决定载体与进度位置。',
    };
  }
  return { ok: true };
}

// ─────────────────────────── AI 输出解析与提示词 ───────────────────────────

const NAME_LINE_RE = /^\s*(?:\/\/|#)\s*(?:名称|name)\s*[:：]\s*(.+?)\s*$/im;

export function parseActorAIOutput(
  raw: string,
): { ok: true; name: string; code: string } | { ok: false; reason: string } {
  const fence = /```(?:js|javascript)?\s*\n([\s\S]*?)\n?```/i.exec(raw);
  const body = fence ? fence[1]!.trim() : raw.replace(/```[a-z]*\s*$/gim, '').trim();
  if (!body) {
    return { ok: false, reason: '没识别到代码——请把 AI 的整段回复（含 ```js 代码块）粘进来。' };
  }
  const nameMatch = NAME_LINE_RE.exec(body);
  const name = nameMatch?.[1]?.trim() ?? '';
  const code = nameMatch ? body.replace(nameMatch[0], '').trim() : body;
  if (!name) {
    return {
      ok: false,
      reason: '没识别到名称——AI 返回的代码块首行应是「// 名称：火尾流星」这样的注释。',
    };
  }
  return { ok: true, name: name.slice(0, 12), code };
}

/** 新版 AI 效果提示词：代码直接绘制整条进度条（轨道 / 时间 / 载体 / 尾迹 / 局部特效） */
export function buildProgressEffectPrompt(description: string): string {
  const desc = description.trim() || '一个有创意的进度条效果';
  return `你是一个精通 Canvas 2D 创意编码（creative coding）的视觉工程师，为音乐视频绘制「整条进度条」。
注意：AI 效果模式下，渲染层不会自动画轨道、时间或尾迹——这些全部由你的代码负责。

【我想要的进度条效果】
${desc}

【代码契约（必须严格遵守）】
你的代码是一个「函数体」，工具每帧这样调用它：
new Function('ctx','W','H','S','p','t','dur','theme','img','frame','layout', <你的代码>)(...)
参数说明：
- ctx: CanvasRenderingContext2D
- W, H: 画布宽高（px）；S = min(W, H)——尺寸一律用 S 的比例表达
- p: 当前播放进度 0-1
- t: 当前音频时间（秒）；dur: 音频总时长（秒）
- theme: { bg:[起,止], fg, accent, muted, light }——优先使用主题色；地球/火焰等具象材质可少量使用固定颜色
- img: 用户选择的静态载体（CanvasImageSource，可能为 null）
- frame: 载体当前帧（静态图=同一张；GIF=当前帧；未选择载体=null）。是否绘制、何时隐藏、如何变换完全由你决定
- layout: {
    marginX, barW,      // 轨道左右边距与宽度
    trackY, trackH,     // 轨道底线 y 与轨道高度
    x, y,               // 当前进度对应的载体中心坐标
    size, angle         // 载体高度基准与参考角度
  }

【必须绘制的内容】
1. 轨道与进度填充：样式自定（细线 / 胶囊 / 发光带 / 跑道均可）。
2. 时间文字：当前时间与总时长，格式建议 mm:ss；AI 模式渲染层不再自动画时间。
3. 载体：frame/img 不为 null 时可 drawImage；为 null 时画程序化兜底（如矢量地球、发光圆点）。
4. 尾迹与局部特效：可选，但应围绕当前进度位置。
5. 复杂玩法可以画卫星、追逐物、碰撞爆炸等，但都必须在底部进度条附近。

【⚠ 硬性禁令（违反会被工具拒收）】
1. 只绘制底部进度条区域；不要画封面、歌词、标题或整屏背景。
2. 禁止 Math.random() / Date.now() / new Date() / performance.now() / setTimeout 等非确定性或异步 API；需要随机感用 t 与确定性伪随机（按粒子下标取模）。
3. 禁止触碰 document / window / fetch / localStorage 等全局对象（工具会静态扫描）。
4. 禁止大面积不透明填充（双端点像素校验会把「涂满画布」拒收）；爆炸也必须是局部效果。
5. ctx.globalAlpha 必须乘法叠加：const base = ctx.globalAlpha; … ctx.globalAlpha = base * 0.8;
6. ctx.save()/ctx.restore() 必须成对；不要 return 值；不要改画布尺寸。
7. img/frame 可能为 null：必须保留程序化兜底，不要直接崩。

【构图画布】
- 主要活动范围在 layout.trackY 上下约 ±4×size；不要遮挡上方歌词与封面。
- 时间文字放在 trackY + trackH 下方约 0.024×S 处。
- 每帧绘制调用 ≤ 2000 次；避免大面积 shadowBlur。

【载体控制】
- 显示：ctx.drawImage(frame, x - w/2, y - h/2, w, h)。
- 隐藏：条件不满足时不调用 drawImage；例如 p ≥ 0.9 进入爆炸阶段后不再画地球。
- 变换：save → translate/rotate/scale/globalAlpha → drawImage → restore；可实现位移、自转、缩放、淡入淡出、局部显隐。
- 尺寸可用 frame.width / frame.height（HTMLImageElement 用 naturalWidth / naturalHeight）。

【复杂玩法（追逐 / 卫星 / 碰撞）】
- 卫星绕地球：角度 = t * 速度 + i * 2π/n，用 cos/sin 画椭圆轨道上的小圆点。
- 追赶物：滞后距离 = 基础距离 * (1 - p)^k，p 越大越接近；可在 p≈0.9 时追上。
- 碰撞爆炸：p ≥ 0.9 后按 (p - 0.9) / 0.1 的进度画放射粒子 + 白色闪光；粒子位置用下标取模做确定性扰动。
- 爆炸半径控制在约 3-4×载体半径内，不要铺满屏幕。

【输出格式】
只输出一个 \`\`\`js 围栏代码块，第一行必须是名称注释：
// 名称：地球追逐战
随后是函数体代码。围栏之外不要写任何解释文字。

【完整示例（展示接口与写法，请按我的需求重新创作）】
\`\`\`js
// 名称：地球追逐战
const base = ctx.globalAlpha;
const g = layout;
const cx = g.x, cy = g.y, cs = g.size, r = cs * 0.26;

// 轨道与进度
ctx.fillStyle = 'rgba(128,128,128,0.35)';
ctx.fillRect(g.marginX, g.trackY, g.barW, g.trackH);
ctx.fillStyle = theme.accent;
ctx.fillRect(g.marginX, g.trackY, g.barW * p, g.trackH);

// 时间
const fmt = (s) => {
  const v = Math.max(0, Math.floor(s));
  return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0');
};
ctx.font = '500 ' + (S * 0.02) + 'px ui-sans-serif, system-ui, sans-serif';
ctx.textBaseline = 'alphabetic';
ctx.fillStyle = theme.muted;
ctx.textAlign = 'left';
ctx.fillText(fmt(t), g.marginX, g.trackY + g.trackH + S * 0.024);
ctx.textAlign = 'right';
ctx.fillText(fmt(dur), g.marginX + g.barW, g.trackY + g.trackH + S * 0.024);

// 尾迹
const trailLen = cs * 2.6;
ctx.globalAlpha = base * 0.5;
ctx.strokeStyle = theme.accent;
ctx.lineWidth = Math.max(2, cs * 0.08);
ctx.lineCap = 'round';
ctx.beginPath();
ctx.moveTo(cx - trailLen, cy);
ctx.lineTo(cx, cy);
ctx.stroke();
ctx.globalAlpha = base;

// 卫星
for (let i = 0; i < 3; i++) {
  const a = t * 2.2 + i * 2.094;
  const sx = cx + Math.cos(a) * r * 1.8;
  const sy = cy + Math.sin(a) * r * 0.85;
  ctx.globalAlpha = base * 0.85;
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(sx, sy, cs * 0.035, 0, Math.PI * 2);
  ctx.fill();
}

// 追赶的流星：p 越大滞后越小，p≈0.9 追上
const lag = cs * 2.4 * Math.pow(Math.max(0, 1 - p), 1.7);
if (p < 0.9) {
  ctx.globalAlpha = base * 0.95;
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.arc(cx - lag - cs * 0.5, cy - cs * 0.12, cs * 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = base * 0.6;
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = Math.max(1, cs * 0.035);
  ctx.beginPath();
  ctx.moveTo(cx - lag - cs * 0.58, cy - cs * 0.12);
  ctx.lineTo(cx - lag - cs * 1.15, cy - cs * 0.08);
  ctx.stroke();
}

// 载体：优先画 img/frame；p>=0.9 不画即隐藏
ctx.globalAlpha = base * 0.95;
if (p < 0.9) {
  if (frame) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle * 0.15);
    ctx.drawImage(frame, -r, -r, r * 2, r * 2);
    ctx.restore();
  } else {
    ctx.fillStyle = '#2563eb';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.25, cy - r * 0.12, r * 0.42, r * 0.26, 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.3, cy + r * 0.22, r * 0.32, r * 0.2, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 撞击爆炸：最后 10% 进度
if (p >= 0.9) {
  const e = Math.min(1, (p - 0.9) / 0.1);
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const d = r * (1.1 + e * 2.4) * (0.65 + ((i * 37) % 11) / 11 * 0.6);
    ctx.globalAlpha = base * (1 - e * 0.45) * 0.9;
    ctx.fillStyle = i % 3 === 0 ? '#fde68a' : i % 3 === 1 ? '#fb923c' : theme.accent;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.72, cs * (0.05 - e * 0.02), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = base * (1 - e) * 0.8;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, r * (1.2 + e * 1.4), 0, Math.PI * 2);
  ctx.fill();
}
ctx.globalAlpha = base;
\`\`\``;
}
