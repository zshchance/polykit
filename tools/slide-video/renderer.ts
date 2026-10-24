/**
 * 演示翻页视频 —— 画面渲染器（canvas 2D，参数驱动）。
 *
 * drawFrame(ctx, W, H, input, t) 是纯函数式渲染：t 由预览（AudioContext 时钟）
 * 或录制（同一时钟）驱动，翻页/入场/倒计时全部是 t 的函数——预览与成片逐帧一致。
 *
 * 页面快照架构（内存护栏）：
 *   每页渲染成一张含背景的离屏 canvas（快照），翻页动画只是「上一页快照 +
 *   下一页快照」的合成；快照走 LRU（容量 4：翻到哪渲哪），静态展示期直接
 *   贴当前页快照，入场动画期（约 0.5s）逐帧直绘文字。1080p 导出态快照峰值
 *   内存 ≤ 4 × ~8MB ≈ 34MB，不随页数增长。
 *
 * 缓存世代号（input.epoch）：文稿/主题/字体等任何影响页面外观的变化由调用方
   +1，本模块检测到变化即清空快照与排版缓存。
 */

import type { Page } from './paginate';
import {
  fontOf,
  pageAt,
  type FrameState,
  type SlideVideoOptions,
  type Theme,
  type Timeline,
} from './options';
import { clearPageLayoutCaches, renderThemedPage } from './page-renderer';
import { paintThemeBackground } from './theme-design';
import { drawCornerCurl } from './page-curl';

// ─────────────────────────── 自定义代码契约（供 custom-transitions / custom-countdowns 引用） ───────────────────────────

/** 一次翻页的全部入参：from/to 是与画布同尺寸的页快照（含背景） */
export interface FlipFrame {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  /** 短边（所有尺寸按 S 的比例表达，适配各比例） */
  S: number;
  /** 翻页进度 0→1（线性；建议代码内自行 easing） */
  p: number;
  from: HTMLCanvasElement;
  to: HTMLCanvasElement;
  theme: Theme;
}

/** 自定义翻页动画：把 from → to 合成到 ctx；返回 false = 守卫放弃（回退内置淡入淡出） */
export type FlipDraw = (frame: FlipFrame) => boolean;

/** 倒计时一帧的全部入参 */
export interface CountdownFrame {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  S: number;
  /** 本页剩余秒数 */
  remain: number;
  /** 每页时长（秒） */
  total: number;
  /** 当前页码（1 起） */
  page: number;
  /** 总页数 */
  pages: number;
  theme: Theme;
}

/** 自定义倒计时样式：在页面上方叠加绘制；返回 false = 守卫放弃（隐藏倒计时） */
export type CountdownDraw = (frame: CountdownFrame) => boolean;

// ─────────────────────────── 渲染输入 ───────────────────────────

export interface RenderInput {
  opts: SlideVideoOptions;
  theme: Theme;
  pages: Page[];
  timeline: Timeline;
  customFlip: FlipDraw | null;
  customCountdown: CountdownDraw | null;
  /** 内容/样式世代号：变化时清空快照与排版缓存（调用方每次改动 +1） */
  epoch: number;
}

// ─────────────────────────── 缓存（LRU 快照 + 排版） ───────────────────────────

/** 快照 LRU 容量：当前页 ± 预读足够翻页段使用 */
const LRU_CAP = 4;

const snapCache = new Map<string, HTMLCanvasElement>();
let blankSnap: HTMLCanvasElement | null = null;
let blankKey = '';
let lastEpoch = -1;

/** 清空全部渲染缓存（文稿/样式变化、以及测试初始化时调用） */
export function clearRenderCaches(): void {
  snapCache.clear();
  clearPageLayoutCaches();
  blankSnap = null;
  blankKey = '';
  lastEpoch = -1;
}

function ensureEpoch(epoch: number): void {
  if (epoch !== lastEpoch) {
    snapCache.clear();
    clearPageLayoutCaches();
    blankSnap = null;
    blankKey = '';
    lastEpoch = epoch;
  }
}

// ─────────────────────────── 基础绘制 ───────────────────────────

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function easeInOut(p: number): number {
  return p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
}

/** 页面背景进入页快照，翻页时纸面与装饰是一个整体。 */
export function paintPageBackground(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  theme: Theme,
): void {
  paintThemeBackground(ctx, W, H, theme);
}

// ─────────────────────────── 页快照 ───────────────────────────

/** 取页快照（LRU，容量 4）；idx = -1 为空白页（仅背景，不占 LRU） */
function snapshotOf(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  input: RenderInput,
  idx: number,
): HTMLCanvasElement {
  if (idx < 0) return blankCanvas(ctx, W, H, input);
  const key = `${W}x${H}|${idx}`;
  const hit = snapCache.get(key);
  if (hit) {
    // LRU 触碰：删了重插排到最新
    snapCache.delete(key);
    snapCache.set(key, hit);
    return hit;
  }
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c2 = cv.getContext('2d');
  if (c2) renderThemedPage(c2, W, H, input, idx, 1);
  snapCache.set(key, cv);
  if (snapCache.size > LRU_CAP) {
    const oldest = snapCache.keys().next().value;
    if (oldest !== undefined) snapCache.delete(oldest);
  }
  return cv;
}

function blankCanvas(
  _ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  input: RenderInput,
): HTMLCanvasElement {
  const key = `${W}x${H}`;
  if (blankSnap && blankKey === key) return blankSnap;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c2 = cv.getContext('2d');
  if (c2) paintPageBackground(c2, W, H, input.theme);
  blankSnap = cv;
  blankKey = key;
  return cv;
}

// ─────────────────────────── 内置翻页动画（7 种） ───────────────────────────

type BuiltinFlip = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  pe: number, // eased 0..1
  from: HTMLCanvasElement,
  to: HTMLCanvasElement,
  theme: Theme,
) => void;

const BUILTIN_FLIPS: Record<string, BuiltinFlip> = {
  fade(ctx, _W, _H, pe, from, to) {
    ctx.drawImage(from, 0, 0);
    ctx.save();
    ctx.globalAlpha = pe;
    ctx.drawImage(to, 0, 0);
    ctx.restore();
  },
  slide(ctx, W, _H, pe, from, to) {
    const off = pe * W;
    ctx.drawImage(from, -off, 0);
    ctx.drawImage(to, W - off, 0);
  },
  cover(ctx, W, H, pe, from, to) {
    ctx.drawImage(from, 0, 0);
    const x = (1 - pe) * W;
    ctx.drawImage(to, x, 0);
    // 新页左缘的投影，制造「盖上来」的厚度感
    ctx.save();
    const g = ctx.createLinearGradient(x, 0, x + W * 0.06, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.28)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, W * 0.06, H);
    ctx.restore();
  },
  reveal(ctx, W, H, pe, from, to) {
    ctx.drawImage(to, 0, 0);
    const x = -pe * W;
    ctx.drawImage(from, x, 0);
    ctx.save();
    const g = ctx.createLinearGradient(x + W, 0, x + W - W * 0.06, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.28)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x + W - W * 0.06, 0, W * 0.06, H);
    ctx.restore();
  },
  zoom(ctx, W, H, pe, from, to) {
    ctx.save();
    ctx.globalAlpha = 1 - pe;
    const s1 = 1 - 0.06 * pe;
    ctx.translate(W / 2, H / 2);
    ctx.scale(s1, s1);
    ctx.drawImage(from, -W / 2, -H / 2);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = pe;
    const s2 = 1.06 - 0.06 * pe;
    ctx.translate(W / 2, H / 2);
    ctx.scale(s2, s2);
    ctx.drawImage(to, -W / 2, -H / 2);
    ctx.restore();
  },
  flip(ctx, W, H, pe, from, to, theme) {
    drawCornerCurl(ctx, W, H, pe, from, to, theme);
  },
  blinds(ctx, W, H, pe, from, to) {
    ctx.drawImage(from, 0, 0);
    const N = 8;
    const w = W / N;
    const stagger = 0.6; // 各条之间的错峰总量（占 1.6 的行程）
    for (let i = 0; i < N; i++) {
      const hp = clamp01(pe * (1 + stagger) - (i * stagger) / (N - 1));
      if (hp <= 0) continue;
      const sh = H * hp;
      ctx.drawImage(to, i * w, 0, w, sh, i * w, 0, w, sh);
    }
  },
};

// ─────────────────────────── 内置倒计时（4 种） ───────────────────────────

type BuiltinCountdown = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  S: number,
  remain: number,
  total: number,
  theme: Theme,
  pos: SlideVideoOptions['countdownPos'],
) => void;

const COUNT_MARGIN = 0.075;

function cornerPos(
  pos: SlideVideoOptions['countdownPos'],
  W: number,
  H: number,
  S: number,
): [number, number] {
  const m = S * COUNT_MARGIN;
  switch (pos) {
    case 'bl':
      return [m, H - m];
    case 'tr':
      return [W - m, m];
    case 'tl':
      return [m, m];
    default:
      return [W - m, H - m];
  }
}

const BUILTIN_COUNTDOWNS: Record<string, BuiltinCountdown> = {
  number(ctx, W, H, S, remain, _total, theme, pos) {
    const [cx, cy] = cornerPos(pos, W, H, S);
    ctx.save();
    ctx.fillStyle = theme.accent;
    ctx.font = fontOf('sans', '800', S * 0.034);
    ctx.textAlign = pos === 'tr' || pos === 'br' ? 'right' : 'left';
    ctx.textBaseline = pos === 'tr' || pos === 'tl' ? 'top' : 'bottom';
    ctx.globalAlpha = remain < 1 ? 0.45 + 0.55 * Math.abs(Math.sin(remain * Math.PI * 2)) : 0.92;
    ctx.fillText(String(Math.max(0, Math.ceil(remain - 0.001))), cx, cy);
    ctx.restore();
  },
  bar(ctx, W, H, S, remain, total, theme) {
    const m = S * 0.06;
    const y = H - S * 0.022;
    const h = S * 0.007;
    ctx.save();
    ctx.fillStyle = theme.muted;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(m, y, W - m * 2, h);
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = theme.accent;
    ctx.fillRect(m, y, (W - m * 2) * clamp01(total > 0 ? remain / total : 0), h);
    ctx.restore();
  },
  ring(ctx, W, H, S, remain, total, theme, pos) {
    const [cx, cy] = cornerPos(pos, W, H, S);
    const r = S * 0.036;
    const frac = clamp01(total > 0 ? remain / total : 0);
    ctx.save();
    ctx.lineWidth = S * 0.006;
    ctx.strokeStyle = theme.muted;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = theme.accent;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = theme.fg;
    ctx.font = fontOf('sans', '700', S * 0.026);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.max(0, Math.ceil(remain - 0.001))), cx, cy);
    ctx.restore();
  },
};

// ─────────────────────────── 主渲染入口 ───────────────────────────

/** 无内容时的占位画面（主题渐变 + 引导文案） */
function drawPlaceholder(ctx: CanvasRenderingContext2D, W: number, H: number, theme: Theme): void {
  paintPageBackground(ctx, W, H, theme);
  const S = Math.min(W, H);
  ctx.save();
  ctx.fillStyle = theme.muted;
  ctx.font = fontOf('sans', '500', S * 0.03);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('在左侧「演示文稿」粘贴文字，这里会自动分页并实时预览', W / 2, H / 2);
  ctx.restore();
}

/**
 * 画一帧。t（秒）来自调用方时钟（预览/录制共用 AudioContext 时钟）。
 * 无页面时画占位画面。
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  input: RenderInput,
  t: number,
): void {
  ensureEpoch(input.epoch);
  const st: FrameState | null = pageAt(t, input.timeline, input.opts.firstPageFlip);
  if (!st) {
    drawPlaceholder(ctx, W, H, input.theme);
    return;
  }
  const S = Math.min(W, H);
  const { opts, timeline } = input;

  // —— 页面层：翻页段 / 入场段 / 静置段 ——
  if (st.mode === 'flip-in') {
    const from = snapshotOf(ctx, W, H, input, st.fromPage);
    const to = snapshotOf(ctx, W, H, input, st.page);
    drawFlip(ctx, W, H, S, input, st.p, from, to);
  } else if (st.enterP < 1 && opts.enter !== 'none' && timeline.enterDur > 0) {
    renderThemedPage(ctx, W, H, input, st.page, st.enterP);
  } else {
    ctx.drawImage(snapshotOf(ctx, W, H, input, st.page), 0, 0);
  }

  // —— 倒计时覆盖层（最上层；自定义样式守卫放弃则静默隐藏） ——
  drawCountdown(ctx, W, H, S, input, st);
}

function drawFlip(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  S: number,
  input: RenderInput,
  p: number,
  from: HTMLCanvasElement,
  to: HTMLCanvasElement,
): void {
  const sel = input.opts.flip;
  if (sel.startsWith('cflip:') && input.customFlip) {
    const drew = input.customFlip({ ctx, W, H, S, p, from, to, theme: input.theme });
    if (drew) return;
  }
  const kind = sel.startsWith('cflip:') ? 'fade' : sel;
  const fn = BUILTIN_FLIPS[kind] ?? BUILTIN_FLIPS.fade!;
  ctx.save();
  fn(ctx, W, H, easeInOut(clamp01(p)), from, to, input.theme);
  ctx.restore();
}

function drawCountdown(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  S: number,
  input: RenderInput,
  st: FrameState,
): void {
  const sel = input.opts.countdown;
  if (sel === 'none') return;
  if (sel.startsWith('ccd:')) {
    if (!input.customCountdown) return;
    input.customCountdown({
      ctx,
      W,
      H,
      S,
      remain: st.remain,
      total: input.timeline.pageDur,
      page: st.page + 1,
      pages: input.pages.length,
      theme: input.theme,
    });
    return;
  }
  const fn = BUILTIN_COUNTDOWNS[sel];
  if (fn) fn(ctx, W, H, S, st.remain, input.timeline.pageDur, input.theme, input.opts.countdownPos);
}

/**
 * 供向导「演播画布」用：直绘一页样张（不走快照/时间轴）。
 * 演播画布固定 480×270，与预览（短边 540 起）及导出尺寸都不相同，
 * 排版缓存键（WxH|idx）天然不与主画面冲突。
 */
export function drawSamplePage(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  theme: Theme,
  font: SlideVideoOptions['font'],
  align: SlideVideoOptions['align'],
  page: Page,
  enterP: number,
): void {
  const input: RenderInput = {
    opts: { ...DEFAULT_RENDER_OPTS, font, align },
    theme,
    pages: [page],
    timeline: { pages: 1, pageDur: 4, flipDur: 0.6, enterDur: 0.5, total: 4 },
    customFlip: null,
    customCountdown: null,
    epoch: -1,
  };
  renderThemedPage(ctx, W, H, input, 0, enterP);
}

/** drawSamplePage 用最小渲染选项；主题自行决定默认字体与对齐。 */
const DEFAULT_RENDER_OPTS: SlideVideoOptions = {
  contentText: '',
  aspect: '16:9',
  resolution: '720',
  pageDur: 4,
  flipDur: 0.8,
  flip: 'flip',
  firstPageFlip: true,
  enter: 'fade',
  countdown: 'none',
  countdownPos: 'br',
  showPageNo: false,
  theme: 'midnight',
  accentColor: null,
  font: null,
  align: null,
  soundEffect: 'none',
  soundVolume: 55,
  bgmVolume: 70,
  bgmLoop: true,
};
