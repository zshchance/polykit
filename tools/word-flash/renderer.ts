/**
 * 文字快闪视频 —— 画面渲染器（canvas 2D，参数驱动）。
 *
 * drawFrame(ctx, W, H, input, t) 是纯函数式渲染：t 由预览（AudioContext 时钟）
 * 或录制（同一时钟）驱动，入场动效全部是卡片进度 p 的函数——预览与成片逐帧一致。
 *
 * 与 slide-video 的差异：快闪没有「翻页过渡」，卡片之间是硬切；表现力来自
 * 大字排版 + 入场动效 + 主题背景 + 可选进度条。每帧只画一张卡，无需页快照缓存。
 *
 * 自定义动效（AI 生成代码）拿到的是「已算好的排版 layout」+ 卡片进度 p，
 * 直接绘制整张卡片视觉；返回 false 或超帧时回退内置动效。
 */

import {
  cardAt,
  fontOf,
  isCustomMotionId,
  type CardFrameState,
  type CardLayout,
  type EmphasisId,
  type FlashOptions,
  type MotionDraw,
  type MotionId,
  type Theme,
  type Timeline,
} from './options';
import type { Card } from './script';
import { fitText, LINE_HEIGHT } from './text-layout';

// ─────────────────────────── 渲染输入 ───────────────────────────

export interface RenderInput {
  opts: FlashOptions;
  theme: Theme;
  cards: Card[];
  timeline: Timeline;
  /** 自定义动效（null = 使用内置） */
  customMotion: MotionDraw | null;
  /** 内容/样式世代号（调用方每次改动 +1；预留给外部缓存失效） */
  epoch: number;
}

// ─────────────────────────── 颜色工具 ───────────────────────────

function hexLuminance(hex: string): number | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** 主色块上的反白文字色 */
function contrastText(color: string): string {
  const lum = hexLuminance(color);
  return lum !== null && lum > 0.62 ? '#141414' : '#ffffff';
}

function ink(theme: Theme, alpha: number): string {
  return theme.light ? `rgba(24,26,28,${alpha})` : `rgba(255,255,255,${alpha})`;
}

/** 稳定 hash：噪点只由坐标决定，不随帧闪动 */
function noise(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ─────────────────────────── 背景与装饰 ───────────────────────────

export function paintBackground(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  theme: Theme,
): void {
  const S = Math.min(W, H);
  const kind = theme.design.background;

  if (kind === 'radial' || kind === 'aurora') {
    ctx.fillStyle = theme.bg[0];
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(
      W * 0.5,
      H * 0.38,
      S * 0.02,
      W * 0.5,
      H * 0.38,
      Math.max(W, H) * 0.78,
    );
    glow.addColorStop(0, theme.bg[1]);
    glow.addColorStop(1, theme.bg[0]);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    if (kind === 'aurora') {
      const blob = (cx: number, cy: number, r: number, color: string): void => {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      };
      blob(W * 0.18, H * 0.14, S * 0.55, 'rgba(56,232,255,0.14)');
      blob(W * 0.86, H * 0.82, S * 0.6, 'rgba(199,125,255,0.13)');
      const band = ctx.createLinearGradient(0, H * 0.1, W, H * 0.9);
      band.addColorStop(0, 'rgba(255,255,255,0)');
      band.addColorStop(0.5, 'rgba(255,255,255,0.045)');
      band.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = band;
      ctx.fillRect(0, 0, W, H);
    }
  } else {
    const g = ctx.createLinearGradient(0, 0, W * 0.55, H);
    g.addColorStop(0, theme.bg[0]);
    g.addColorStop(1, theme.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  if (kind === 'grid') {
    ctx.save();
    ctx.strokeStyle = ink(theme, 0.065);
    ctx.lineWidth = Math.max(0.5, S * 0.0011);
    for (let i = 1; i < 10; i++) {
      ctx.beginPath();
      ctx.moveTo((W * i) / 10, 0);
      ctx.lineTo((W * i) / 10, H);
      ctx.stroke();
    }
    for (let i = 1; i < 10; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (H * i) / 10);
      ctx.lineTo(W, (H * i) / 10);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (kind === 'grain') {
    ctx.save();
    ctx.fillStyle = ink(theme, 0.06);
    for (let i = 0; i < 420; i++) {
      const x = noise(i + 11) * W;
      const y = noise(i + 83) * H;
      const r = S * (0.0006 + noise(i + 151) * 0.0014);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 暗色主题加一层克制暗角，让文字更聚焦
  if (!theme.light) {
    const g = ctx.createRadialGradient(
      W * 0.5,
      H * 0.5,
      S * 0.32,
      W * 0.5,
      H * 0.5,
      Math.max(W, H) * 0.8,
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

// ─────────────────────────── 排版 ───────────────────────────

interface LayoutResult extends CardLayout {
  /** 文本块总高（px） */
  blockHeight: number;
}

/** 排版缓存：折行/缩字号需要多次 measureText，每帧重算会拖慢录制 */
const layoutCache = new Map<string, LayoutResult>();
const LAYOUT_CACHE_MAX = 200;

function layoutKey(
  W: number,
  H: number,
  font: string,
  theme: Theme,
  card: Card,
): string {
  return `${W}|${H}|${font}|${theme.design.layout}|${card.title ? 't' : ''}${card.em ? 'e' : ''}|${card.text}`;
}

/** 按卡片文本长度给出起始字号（短句撑满画面，长句自动缩小） */
function startScale(card: Card): number {
  const len = [...card.text].length;
  const base =
    len <= 4 ? 0.3 : len <= 8 ? 0.225 : len <= 14 ? 0.175 : len <= 22 ? 0.145 : len <= 34 ? 0.118 : 0.1;
  return base * (card.title ? 1.16 : 1) * (card.em ? 1.04 : 1);
}

export function buildCardLayout(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  theme: Theme,
  card: Card,
  fontOverride: FlashOptions['font'],
): LayoutResult {
  const font = fontOverride ?? theme.design.font;
  const key = layoutKey(W, H, font, theme, card);
  const cached = layoutCache.get(key);
  if (cached) return cached;

  const S = Math.min(W, H);
  const margin = S * 0.085;
  const maxWidth = W - margin * 2;
  const maxHeight = H * (card.title ? 0.52 : 0.62);
  const startSize = Math.max(S * 0.07, S * startScale(card));
  const minSize = S * 0.05;

  const withFont = (size: number) => {
    ctx.font = fontOf(font, size);
    return (s: string) => ctx.measureText(s).width;
  };

  const fitted = fitText(card.text, {
    maxWidth,
    maxHeight,
    startSize,
    minSize,
    lineHeight: LINE_HEIGHT,
    withFont,
  });

  const size = fitted.size;
  const lineHeight = LINE_HEIGHT;
  const blockHeight = Math.max(size, fitted.lines.length * size * lineHeight);

  let x = W / 2;
  let align: 'left' | 'center' = 'center';
  let centerY = H / 2;
  if (theme.design.layout === 'stack') {
    x = margin;
    align = 'left';
  } else if (theme.design.layout === 'corner') {
    x = margin + S * 0.022;
    align = 'left';
    centerY = H - margin - blockHeight / 2;
  }
  if (card.title) centerY -= S * 0.012;

  const result: LayoutResult = {
    lines: fitted.lines,
    size,
    lineHeight,
    x,
    align,
    centerY,
    font: fontOf(font, size),
    blockHeight,
  };
  if (layoutCache.size >= LAYOUT_CACHE_MAX) layoutCache.clear();
  layoutCache.set(key, result);
  return result;
}

// ─────────────────────────── 缓动 ───────────────────────────

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function easeOutCubic(x: number): number {
  return 1 - (1 - x) ** 3;
}

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

/** 打字机：按字符数截断每一行 */
function revealLines(lines: string[], count: number): string[] {
  let rest = Math.max(0, Math.floor(count));
  return lines.map((line) => {
    const chars = [...line];
    if (rest <= 0) {
      rest -= chars.length;
      return '';
    }
    const take = Math.min(chars.length, rest);
    rest -= chars.length;
    return chars.slice(0, take).join('');
  });
}

// ─────────────────────────── 卡片绘制 ───────────────────────────

/**
 * 画一张卡的正文（背景已由调用方画好）。
 * visible = null 时画全部；否则为逐行可见文本（打字机效果）。
 */
function paintCardBody(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  layout: LayoutResult,
  card: Card,
  theme: Theme,
  emphasis: EmphasisId,
  visible: string[] | null,
): void {
  const S = Math.min(W, H);
  const lh = layout.size * layout.lineHeight;
  const top = layout.centerY - ((layout.lines.length - 1) * lh) / 2;
  const texts = visible ?? layout.lines;
  const band = theme.design.layout === 'band';

  ctx.font = layout.font;
  ctx.textAlign = layout.align;
  ctx.textBaseline = 'middle';

  // —— 高亮色带：文字整块压在主色上 ——
  if (band) {
    let fullWidth = 0;
    for (const line of layout.lines) {
      fullWidth = Math.max(fullWidth, ctx.measureText(line).width);
    }
    const padX = S * 0.05;
    const padY = S * 0.04;
    const bw = Math.min(W * 0.94, fullWidth + padX * 2);
    const bh = layout.blockHeight + padY * 2;
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.roundRect(W / 2 - bw / 2, layout.centerY - bh / 2, bw, bh, S * 0.018);
    ctx.fill();
  }

  // —— 色块反白：强调卡每一行垫一块主色 ——
  if (card.em && emphasis === 'block' && !band) {
    const padX = layout.size * 0.2;
    const padY = layout.size * 0.1;
    ctx.fillStyle = theme.accent;
    texts.forEach((text, i) => {
      if (!text) return;
      const w = ctx.measureText(text).width;
      const bx = layout.align === 'center' ? layout.x - w / 2 : layout.x;
      const by = top + i * lh;
      ctx.beginPath();
      ctx.roundRect(
        bx - padX,
        by - layout.size * 0.5 - padY,
        w + padX * 2,
        layout.size + padY * 2,
        layout.size * 0.08,
      );
      ctx.fill();
    });
  }

  // —— 正文 ——
  const textColor = band
    ? contrastText(theme.accent)
    : card.em && emphasis === 'accent'
      ? theme.accent
      : theme.fg;
  ctx.fillStyle = textColor;
  texts.forEach((text, i) => {
    if (text) ctx.fillText(text, layout.x, top + i * lh);
  });

  // —— 标题 / 下划线强调 ——
  const needUnderline =
    !band && (card.title || (card.em && emphasis === 'underline'));
  if (needUnderline) {
    let idx = -1;
    for (let i = texts.length - 1; i >= 0; i--) {
      if (texts[i]) {
        idx = i;
        break;
      }
    }
    if (idx >= 0) {
      const w = ctx.measureText(texts[idx]!).width;
      const bx = layout.align === 'center' ? layout.x - w / 2 : layout.x;
      const by = top + idx * lh + layout.size * 0.58;
      ctx.fillStyle = theme.accent;
      ctx.fillRect(bx, by, w, layout.size * (card.title ? 0.07 : 0.09));
    }
  }

  // —— 左下角标的竖线装饰 ——
  if (theme.design.layout === 'corner') {
    const margin = S * 0.085;
    const bh = layout.blockHeight * 0.9;
    ctx.fillStyle = theme.accent;
    ctx.fillRect(margin, layout.centerY - bh / 2, S * 0.008, bh);
  }
}

// ─────────────────────────── 动效 ───────────────────────────

interface EntranceResult {
  alpha: number;
  /** 非 null 时按该宽度做左侧裁剪揭示（wipe） */
  clipWidth: number | null;
}

function applyEntrance(
  ctx: CanvasRenderingContext2D,
  motion: MotionId,
  q: number,
  W: number,
  H: number,
  S: number,
): EntranceResult {
  const e = easeOutCubic(q);
  switch (motion) {
    case 'pop': {
      const s = 0.55 + 0.45 * easeOutBack(q);
      ctx.translate(W / 2, H / 2);
      ctx.scale(s, s);
      ctx.translate(-W / 2, -H / 2);
      return { alpha: Math.min(1, q * 2), clipWidth: null };
    }
    case 'slideUp': {
      ctx.translate(0, (1 - e) * S * 0.1);
      return { alpha: Math.min(1, q * 1.8), clipWidth: null };
    }
    case 'zoom': {
      const s = 0.94 + 0.06 * e;
      ctx.translate(W / 2, H / 2);
      ctx.scale(s, s);
      ctx.translate(-W / 2, -H / 2);
      return { alpha: Math.min(1, q * 1.5), clipWidth: null };
    }
    case 'shake': {
      const tx = Math.sin(q * Math.PI * 14) * S * 0.014 * (1 - q);
      ctx.translate(tx, 0);
      return { alpha: Math.min(1, q * 2.5), clipWidth: null };
    }
    case 'flip': {
      const sy = 0.3 + 0.7 * e;
      ctx.translate(W / 2, H / 2);
      ctx.scale(1, sy);
      ctx.translate(-W / 2, -H / 2);
      return { alpha: Math.min(1, q * 1.4), clipWidth: null };
    }
    case 'wipe':
      return { alpha: 1, clipWidth: W * e };
    case 'typewriter':
    case 'none':
    default:
      return { alpha: 1, clipWidth: null };
  }
}

// ─────────────────────────── 进度指示 ───────────────────────────

function paintProgress(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  theme: Theme,
  opts: FlashOptions,
  tl: Timeline,
  t: number,
  index: number,
): void {
  const S = Math.min(W, H);
  if (tl.cards < 1) return;

  if (opts.progress === 'bar' || (opts.progress === 'dots' && tl.cards > 24)) {
    const h = S * 0.008;
    const y = H - S * 0.045;
    ctx.fillStyle = ink(theme, 0.14);
    ctx.beginPath();
    ctx.roundRect(S * 0.06, y, W - S * 0.12, h, h / 2);
    ctx.fill();
    const ratio = clamp01(t / Math.max(0.01, tl.total));
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.roundRect(S * 0.06, y, Math.max(h, (W - S * 0.12) * ratio), h, h / 2);
    ctx.fill();
    return;
  }

  if (opts.progress === 'dots') {
    const gap = S * 0.024;
    const r = S * 0.006;
    const startX = W / 2 - ((tl.cards - 1) * gap) / 2;
    const y = H - S * 0.05;
    for (let i = 0; i < tl.cards; i++) {
      const active = i === index;
      ctx.fillStyle = active ? theme.accent : ink(theme, 0.2);
      ctx.beginPath();
      ctx.arc(startX + i * gap, y, active ? r * 1.5 : r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ─────────────────────────── 主渲染入口 ───────────────────────────

/** 绘制某一时刻的完整画面（预览、录制、AI 向导演播共用） */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  input: RenderInput,
  t: number,
): void {
  const { opts, theme, cards, timeline, customMotion } = input;
  paintBackground(ctx, W, H, theme);

  const state = cardAt(t, timeline);
  if (!state) return;
  const card = cards[state.index];
  if (!card) return;

  const layout = buildCardLayout(ctx, W, H, theme, card, opts.font);
  const isLast = state.index === timeline.cards - 1;
  // 末卡不做退场淡出，保证成片最后一帧仍有文字
  const exitAlpha = isLast ? 1 : clamp01(state.remain / 0.06);
  const motionId: MotionId = isCustomMotionId(opts.motion) ? 'pop' : opts.motion;

  // —— 自定义动效（AI 代码）路径 ——
  if (customMotion) {
    ctx.save();
    ctx.globalAlpha = exitAlpha;
    let ok: boolean;
    try {
      ok = customMotion({
        ctx,
        W,
        H,
        S: Math.min(W, H),
        p: state.p,
        card: { text: card.text, em: card.em, title: card.title },
        layout,
        theme,
      });
    } catch {
      ok = false;
    }
    ctx.restore();
    if (ok) {
      paintProgress(ctx, W, H, theme, opts, timeline, t, state.index);
      return;
    }
    // 守卫放弃：回退内置弹入（按已完成态绘制，避免闪烁）
    ctx.save();
    ctx.globalAlpha = exitAlpha;
    paintCardBody(ctx, W, H, layout, card, theme, opts.emphasis, null);
    ctx.restore();
    paintProgress(ctx, W, H, theme, opts, timeline, t, state.index);
    return;
  }

  // —— 内置动效路径 ——
  const entranceDur = Math.min(0.32, Math.max(0.12, state.dur * 0.5));
  const q = clamp01(state.tIn / entranceDur);
  const S = Math.min(W, H);

  // 打字机：按时间逐字揭示（在卡片前 60% 内打完）
  let visible: string[] | null = null;
  if (motionId === 'typewriter') {
    const totalChars = [...card.text].length;
    const typingDur = Math.min(state.dur * 0.6, 0.08 + totalChars * 0.028);
    const reveal = totalChars * clamp01(state.tIn / Math.max(0.05, typingDur));
    visible = revealLines(layout.lines, reveal);
  }

  ctx.save();
  const entrance = applyEntrance(ctx, motionId, q, W, H, S);
  ctx.globalAlpha = entrance.alpha * exitAlpha;
  if (entrance.clipWidth !== null) {
    ctx.beginPath();
    ctx.rect(0, 0, entrance.clipWidth, H);
    ctx.clip();
  }
  paintCardBody(ctx, W, H, layout, card, theme, opts.emphasis, visible);
  ctx.restore();

  paintProgress(ctx, W, H, theme, opts, timeline, t, state.index);
}

/**
 * 主题墙 / AI 摘要用静态样张：背景 + 卡片正文（不含动效与进度条）。
 * 仅供 16:9 等比例的缩略图；内部按传入画布尺寸重新排版。
 */
export function drawSampleCard(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  theme: Theme,
  card: Card,
  font: FlashOptions['font'] = null,
): void {
  paintBackground(ctx, W, H, theme);
  const layout = buildCardLayout(ctx, W, H, theme, card, font);
  ctx.save();
  paintCardBody(ctx, W, H, layout, card, theme, 'accent', null);
  ctx.restore();
}

/** 供 main.ts 读取当前帧状态（页码/跳转用） */
export function frameStateAt(t: number, timeline: Timeline): CardFrameState | null {
  return cardAt(t, timeline);
}
