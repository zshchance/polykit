/**
 * AI 角色绘制代码 —— 进度条「载体」的高级扩展。
 *
 * 与自定义频谱（整屏绘制）不同：这里只画角色本身，轨道、进度、时间、尾迹由渲染层负责。
 * 代码契约：
 *   new Function('ctx','W','H','S','p','t','dur','x','y','size','angle','theme','img','frame', code)
 *   每帧同步调用一次，必须确定性（禁 Math.random/Date.now/performance.now/异步 API）。
 *
 * 保存前校验：静态扫描 → 编译 → 双端点 dryRun（p=0.2 / p=0.8）：
 *   - 两端都必须画出可见像素；
 *   - 两端质心 x 必须明显不同（抓「忽略进度、原地不动」废稿）；
 *   - 变化像素不能接近全屏（抓「整屏填充遮挡歌词」废稿）。
 */

import { readJSON, writeJSON } from '@/core/utils/storage';

import { THEMES, type Theme } from './options';
import { scanDeterministicCode } from './custom-visualizers';
import type { CustomActorDraw, CustomActorFrame } from './renderer';

const STORAGE_KEY = 'song-video:custom-actors';
const CURRENT_VERSION = 1;
const ID_PREFIX = 'cvact:';

export interface CustomProgressActor {
  /** 形如 cvact:abcd1234 */
  id: string;
  /** 展示名（≤12 字） */
  name: string;
  /** 函数体代码（首行名称注释已剥离） */
  code: string;
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
  return items.filter(
    (it): it is CustomProgressActor =>
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

function persist(items: CustomProgressActor[]): void {
  const blob: CustomActorBlob = { version: CURRENT_VERSION, items };
  writeJSON(STORAGE_KEY, blob);
}

function newId(): string {
  return ID_PREFIX + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** 新增或同名覆盖一条；返回更新后的完整列表 */
export function addCustomActor(name: string, code: string): CustomProgressActor[] {
  const trimmed = name.trim().slice(0, 12);
  const items = loadCustomActors();
  const existingIdx = items.findIndex((it) => it.name.trim() === trimmed);
  const entry: CustomProgressActor = {
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

const drawCache = new Map<string, CustomActorDraw | null>();

export function invalidateCustomActorCache(id?: string): void {
  if (id === undefined) drawCache.clear();
  else drawCache.delete(id);
}

/** 按 id 取可执行绘制函数；不存在/非法返回 null（渲染层回退发光圆点） */
export function getCustomActorDraw(id: string): CustomActorDraw | null {
  if (drawCache.has(id)) return drawCache.get(id) ?? null;
  const item = loadCustomActors().find((it) => it.id === id);
  let draw: CustomActorDraw | null = null;
  if (item) {
    if (!scanActorCode(item.code)) {
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

/** 静态扫描（共享危险名单 + 确定性名单） */
export function scanActorCode(code: string): string | null {
  return scanDeterministicCode(code, '角色绘制代码');
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
  const ctx = cv.getContext('2d');
  if (!ctx) return { ok: false, reason: '当前浏览器无法创建画布，无法校验。' };

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, DRY_W, DRY_H);
  const S = Math.min(DRY_W, DRY_H);
  const marginX = DRY_W * 0.12;
  const barW = DRY_W - marginX * 2;
  const x = marginX + barW * p;
  const y = DRY_H * 0.72;
  const size = S * 0.12;

  try {
    ctx.save();
    raw(ctx, DRY_W, DRY_H, S, p, 12.5, 180, x, y, size, 0, THEMES[0]!, sample, sample);
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

export function dryRunActor(code: string): { ok: boolean; reason?: string } {
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
        reason: `p=${p} 时没有画出可见角色——请确认代码确实在 (x, y) 处绘制了内容。`,
      };
    }
    if (result.ratio > MAX_CHANGED_RATIO) {
      return {
        ok: false,
        reason: '代码把大半个画布都涂满了——角色代码只能画角色本身，不能做全屏填充。',
      };
    }
  }

  if (Math.abs(b.result.centroidX - a.result.centroidX) < MIN_MOVE_X) {
    return {
      ok: false,
      reason: '角色在 p=0.2 与 p=0.8 的位置几乎一样——请用传入的 x（或 p）决定绘制位置。',
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

export function buildActorPrompt(description: string): string {
  const desc = description.trim() || '一个会随进度移动的卡通角色';
  return `你是一个精通 Canvas 2D 创意编码（creative coding）的视觉工程师，为音乐视频的「角色进度条」生成角色绘制代码。

【我想要的角色效果】
${desc}

【代码约定（必须严格遵守）】
你的代码是一个「函数体」，工具每帧这样调用它：
new Function('ctx','W','H','S','p','t','dur','x','y','size','angle','theme','img','frame', <你的代码>)(...)
参数说明：
- ctx: CanvasRenderingContext2D，只管往上面画
- W, H: 画布宽高（px）；S = min(W, H)——尺寸一律用 S 的比例（如 S*0.05）表达，适配横竖版
- p: 当前播放进度 0-1（角色位置由它决定；也可用它做追逐/碰撞节奏）
- t: 当前音频时间（秒）；dur: 音频总时长（秒）
- x, y: 角色中心坐标（px）；size: 角色高度基准（px）
- angle: 运动姿态角（弧度，可参考，不一定使用）
- theme: { bg:[起,止], fg, accent, muted, light }——优先使用主题色；地球/火焰等具象材质可少量使用固定颜色
- img: 用户上传的静态素材（CanvasImageSource，可能为 null）
- frame: GIF 动图当前帧（可能为 null）；AI 代码角色默认没有底图素材，请做好 null 分支

【⚠ 硬性禁令（违反会被工具拒收）】
1. 只画「角色相关的局部场景」：可以围绕角色画卫星、追逐物、碰撞/爆炸粒子；不要画轨道、进度条、时间文字、整屏背景。
2. 禁止 Math.random() / Date.now() / new Date() / performance.now() / setTimeout 等非确定性或异步 API；需要随机感用传入的 t 与确定性伪随机（如按粒子下标取模）。
3. 禁止触碰 document / window / fetch / localStorage 等全局对象（工具会静态扫描）。
4. 禁止大面积不透明填充（双端点像素校验会把「涂满画布」拒收）；爆炸也必须是局部效果。
5. ctx.globalAlpha 必须乘法叠加：const base = ctx.globalAlpha; … ctx.globalAlpha = base * 0.8;
6. ctx.save()/ctx.restore() 必须成对；不要 return 值；不要改画布尺寸。
7. img/frame 可能为 null：必须画一个简单占位形状（如程序化地球/发光圆点），不要直接崩。

【构图与性能】
- 角色以 (x, y) 为中心；局部场景整体控制在 (x, y) 附近约 ±4×size 的范围内，不要遮挡上方歌词与封面。
- 每帧绘制调用 ≤ 2000 次；避免大面积 shadowBlur。
- 需要旋转时围绕 (x, y) 自行 rotate。

【复杂玩法（追逐 / 卫星 / 碰撞）】
- 卫星绕地球：角度 = t * 速度 + i * 2π/n，用 cos/sin 画椭圆轨道上的小圆点。
- 追赶物：滞后距离 = 基础距离 * (1 - p)^k，p 越大越接近；可在 p≈0.9 时追上。
- 碰撞爆炸：p ≥ 0.9 后按 (p - 0.9) / 0.1 的进度画放射粒子 + 白色闪光；粒子位置用下标取模做确定性扰动，不要用 Math.random。
- 爆炸半径控制在约 3-4×角色半径内，不要铺满屏幕。

【输出格式】
只输出一个 \`\`\`js 围栏代码块，第一行必须是名称注释：
// 名称：火尾流星
随后是函数体代码。围栏之外不要写任何解释文字。

【示例一：简单角色（展示接口与写法，请按我的需求重新创作）】
\`\`\`js
// 名称：霓虹小行星
const base = ctx.globalAlpha;
const r = size * 0.32;
const wobble = Math.sin(t * 2.4) * size * 0.08;
ctx.globalAlpha = base * 0.95;
if (frame) {
  ctx.drawImage(frame, x - size * 0.45, y - size * 0.45 + wobble, size * 0.9, size * 0.9);
} else {
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(x, y + wobble, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = theme.fg;
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.stroke();
}
ctx.globalAlpha = base;
\`\`\`

【示例二：地球 + 卫星 + 追赶流星 + 终点爆炸（复杂玩法参考）】
\`\`\`js
// 名称：地球追逐战
const base = ctx.globalAlpha;
const r = size * 0.26;

// 三颗卫星绕地球
for (let i = 0; i < 3; i++) {
  const a = t * 2.2 + i * 2.094;
  const sx = x + Math.cos(a) * r * 1.8;
  const sy = y + Math.sin(a) * r * 0.85;
  ctx.globalAlpha = base * 0.85;
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(sx, sy, size * 0.035, 0, Math.PI * 2);
  ctx.fill();
}

// 追赶的流星：p 越大滞后越小，p≈0.9 追上
const lag = size * 2.4 * Math.pow(Math.max(0, 1 - p), 1.7);
const mx = x - lag - size * 0.5;
const my = y - size * 0.12;
if (p < 0.9) {
  ctx.globalAlpha = base * 0.95;
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.arc(mx, my, size * 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = base * 0.6;
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = Math.max(1, size * 0.035);
  ctx.beginPath();
  ctx.moveTo(mx - size * 0.08, my);
  ctx.lineTo(mx - size * 0.65, my + size * 0.04);
  ctx.stroke();
}

// 地球：优先使用上传素材，否则程序化绘制
ctx.globalAlpha = base * 0.95;
if (p < 0.9) {
  if (frame) {
    ctx.drawImage(frame, x - r, y - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = '#2563eb';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.25, y - r * 0.12, r * 0.42, r * 0.26, 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + r * 0.3, y + r * 0.22, r * 0.32, r * 0.2, -0.3, 0, Math.PI * 2);
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
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.72, size * (0.05 - e * 0.02), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = base * (1 - e) * 0.8;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y, r * (1.2 + e * 1.4), 0, Math.PI * 2);
  ctx.fill();
}
ctx.globalAlpha = base;
\`\`\``;
}
