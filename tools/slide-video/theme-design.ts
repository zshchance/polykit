/**
 * 主题设计系统 —— 版式参数与确定性 Canvas 装饰。
 *
 * 主题负责视觉设计，文稿只负责内容；纯布局函数在 Node 单测中可验证，
 * 绘制与测量共用 TextBox，避免装饰侵入正文安全区。
 */
import {
  fontOf,
  type AlignId,
  type FontId,
  type SlideVideoOptions,
  type Theme,
  type ThemeTypographyId,
} from './options';
import type { Page } from './paginate';

export interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
  align: AlignId;
  /** 块内垂直对齐；标题多为 top，正文多为 middle */
  valign: 'top' | 'middle';
}

export interface ThemeTypography {
  titleFont: FontId;
  bodyFont: FontId;
  titleWeight: string;
  bodyWeight: string;
  titleScale: number;
  bodyScale: number;
  titleLineHeight: number;
  bodyLineHeight: number;
  tracking: number;
}

export interface ThemePageSpec {
  title: TextBox;
  body: TextBox;
  typography: ThemeTypography;
  pageNo: { x: number; y: number; align: CanvasTextAlign };
  card: { x: number; y: number; width: number; height: number } | null;
}

const TYPOGRAPHY: Record<ThemeTypographyId, ThemeTypography> = {
  classic: {
    titleFont: 'sans',
    bodyFont: 'sans',
    titleWeight: '700',
    bodyWeight: '400',
    titleScale: 0.064,
    bodyScale: 0.043,
    titleLineHeight: 1.32,
    bodyLineHeight: 1.65,
    tracking: 0,
  },
  modern: {
    titleFont: 'sans',
    bodyFont: 'sans',
    titleWeight: '750',
    bodyWeight: '400',
    titleScale: 0.075,
    bodyScale: 0.041,
    titleLineHeight: 1.18,
    bodyLineHeight: 1.65,
    tracking: -0.015,
  },
  editorial: {
    titleFont: 'serif',
    bodyFont: 'serif',
    titleWeight: '700',
    bodyWeight: '400',
    titleScale: 0.068,
    bodyScale: 0.04,
    titleLineHeight: 1.3,
    bodyLineHeight: 1.8,
    tracking: 0.015,
  },
  humanist: {
    titleFont: 'sans',
    bodyFont: 'sans',
    titleWeight: '600',
    bodyWeight: '400',
    titleScale: 0.06,
    bodyScale: 0.043,
    titleLineHeight: 1.35,
    bodyLineHeight: 1.7,
    tracking: 0,
  },
  handwritten: {
    titleFont: 'kai',
    bodyFont: 'kai',
    titleWeight: '600',
    bodyWeight: '400',
    titleScale: 0.065,
    bodyScale: 0.044,
    titleLineHeight: 1.35,
    bodyLineHeight: 1.75,
    tracking: 0.025,
  },
  mono: {
    titleFont: 'mono',
    bodyFont: 'sans',
    titleWeight: '700',
    bodyWeight: '400',
    titleScale: 0.061,
    bodyScale: 0.039,
    titleLineHeight: 1.32,
    bodyLineHeight: 1.72,
    tracking: -0.01,
  },
};

function box(
  x: number,
  y: number,
  width: number,
  height: number,
  align: AlignId,
  valign: TextBox['valign'] = 'middle',
): TextBox {
  return { x, y, width: Math.max(1, width), height: Math.max(1, height), align, valign };
}

/** 横竖屏分别构图；纯标题页自动变成封面，而不是留下空白正文区。 */
export function themePageSpec(
  W: number,
  H: number,
  theme: Theme,
  page: Page,
  font: SlideVideoOptions['font'],
  align: SlideVideoOptions['align'],
): ThemePageSpec {
  const S = Math.min(W, H);
  const portrait = H > W * 1.2;
  const landscape = W > H * 1.2;
  const m = S * 0.095;
  const layout = theme.design.layout;
  const typography = { ...TYPOGRAPHY[theme.design.typography] };
  if (font) {
    typography.titleFont = font;
    typography.bodyFont = font;
  }
  let title = box(m, H * 0.15, W - 2 * m, S * 0.22, 'center');
  let body = box(m, H * 0.39, W - 2 * m, H * 0.45, 'center');
  let pageNo = { x: W / 2, y: H - S * 0.045, align: 'center' as CanvasTextAlign };
  let card: ThemePageSpec['card'] = null;

  if (layout === 'poster') {
    title = box(W * 0.095, H * 0.17, W * 0.77, S * 0.27, 'left', 'top');
    body = box(W * 0.095, H * 0.56, W * (portrait ? 0.81 : 0.65), H * 0.27, 'left');
    pageNo = { x: W - S * 0.07, y: H - S * 0.06, align: 'right' };
  } else if (layout === 'editorial') {
    if (landscape) {
      title = box(W * 0.105, H * 0.2, W * 0.3, S * 0.34, 'left', 'top');
      body = box(W * 0.515, H * 0.19, W * 0.35, H * 0.59, 'left');
    } else {
      title = box(W * 0.12, H * 0.16, W * 0.74, S * 0.28, 'left', 'top');
      body = box(W * 0.12, H * 0.46, W * 0.74, H * 0.37, 'left');
    }
    pageNo = { x: W - S * 0.075, y: H - S * 0.065, align: 'right' };
  } else if (layout === 'card') {
    card = { x: W * 0.085, y: H * 0.115, width: W * 0.83, height: H * 0.765 };
    title = box(W * 0.15, H * 0.205, W * 0.7, S * 0.22, 'left', 'top');
    body = box(W * 0.15, H * 0.435, W * 0.7, H * 0.33, 'left');
    pageNo = { x: W * 0.5, y: H * 0.823, align: 'center' };
  } else if (layout === 'notebook') {
    title = box(W * 0.13, H * 0.17, W * 0.72, S * 0.22, 'left', 'top');
    body = box(W * 0.13, H * 0.41, W * 0.71, H * 0.4, 'left');
    pageNo = { x: W * 0.85, y: H * 0.88, align: 'right' };
  } else if (layout === 'sidebar' && landscape) {
    title = box(W * 0.13, H * 0.19, W * 0.25, S * 0.38, 'left', 'top');
    body = box(W * 0.47, H * 0.19, W * 0.38, H * 0.58, 'left');
    pageNo = { x: W * 0.13, y: H * 0.84, align: 'left' };
  } else if (layout === 'sidebar') {
    title = box(W * 0.14, H * 0.16, W * 0.68, S * 0.26, 'left', 'top');
    body = box(W * 0.14, H * 0.43, W * 0.7, H * 0.38, 'left');
    pageNo = { x: W * 0.14, y: H * 0.87, align: 'left' };
  } else if (layout === 'focus') {
    title = box(W * 0.13, H * 0.18, W * 0.74, S * 0.25, 'center');
    body = box(
      W * (portrait ? 0.14 : 0.2),
      H * 0.45,
      W * (portrait ? 0.72 : 0.6),
      H * 0.35,
      'center',
    );
  }

  if (!page.title) {
    body =
      layout === 'poster'
        ? box(W * 0.1, H * 0.2, W * 0.75, H * 0.59, 'left')
        : box(body.x, H * 0.19, body.width, H * 0.61, body.align);
  } else if (!page.body) {
    const coverW = layout === 'editorial' && landscape ? W * 0.52 : W * 0.76;
    title = box(
      (W - coverW) / 2,
      H * 0.3,
      coverW,
      S * 0.4,
      layout === 'poster' || layout === 'notebook' ? 'left' : 'center',
    );
    typography.titleScale *= 1.18;
  }
  if (align) {
    title.align = align;
    body.align = align;
  }
  return { title, body, typography, pageNo, card };
}

/** 稳定 hash：纹理只由主题与坐标决定，不回拖或逐帧闪动。 */
function noise(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function ink(theme: Theme, alpha: number): string {
  return theme.light ? `rgba(38,43,45,${alpha})` : `rgba(255,255,255,${alpha})`;
}

function ellipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rotation = 0,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
}

export function paintThemeBackground(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  theme: Theme,
): void {
  const kind = theme.design.background;
  if (kind === 'radial' || kind === 'aurora') {
    ctx.fillStyle = theme.bg[0];
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(
      W * 0.68,
      H * 0.32,
      0,
      W * 0.68,
      H * 0.32,
      Math.max(W, H) * 0.82,
    );
    glow.addColorStop(0, theme.bg[1]);
    glow.addColorStop(1, theme.bg[0]);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    if (kind === 'aurora') {
      const band = ctx.createLinearGradient(0, 0, W, H);
      band.addColorStop(0, 'rgba(151,116,220,0)');
      band.addColorStop(0.48, 'rgba(151,116,220,0.16)');
      band.addColorStop(0.65, 'rgba(101,211,196,0.12)');
      band.addColorStop(1, 'rgba(101,211,196,0)');
      ctx.fillStyle = band;
      ctx.fillRect(0, 0, W, H);
    }
  } else {
    const g = ctx.createLinearGradient(0, 0, W * 0.45, H);
    g.addColorStop(0, theme.bg[0]);
    g.addColorStop(1, theme.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  if (kind === 'paper') {
    ctx.save();
    ctx.strokeStyle = ink(theme, 0.045);
    ctx.lineWidth = Math.max(0.35, Math.min(W, H) * 0.00065);
    for (let i = 0; i < 340; i++) {
      const x = noise(i + 11) * W;
      const y = noise(i + 83) * H;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (noise(i + 191) - 0.5) * 7, y + noise(i + 29) * 2.5);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function leaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.bezierCurveTo(size * 0.95, -size * 0.45, size * 0.85, size * 0.55, 0, size);
  ctx.bezierCurveTo(-size * 0.85, size * 0.45, -size * 0.75, -size * 0.5, 0, -size);
  ctx.fill();
  ctx.strokeStyle = 'rgba(70,45,30,0.18)';
  ctx.lineWidth = Math.max(0.4, size * 0.035);
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.7);
  ctx.lineTo(0, size * 1.15);
  ctx.stroke();
  ctx.restore();
}

function snowflake(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.6, r * 0.045);
  for (let i = 0; i < 6; i++) {
    ctx.rotate(Math.PI / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -r);
    ctx.moveTo(0, -r * 0.58);
    ctx.lineTo(-r * 0.18, -r * 0.76);
    ctx.moveTo(0, -r * 0.58);
    ctx.lineTo(r * 0.18, -r * 0.76);
    ctx.stroke();
  }
  ctx.restore();
}

/** 装饰只落在边角与非正文区，保持高级感来自留白，而不是元素数量。 */
export function paintThemeDecorations(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  theme: Theme,
  pageIndex: number,
  spec: ThemePageSpec,
  titleAccentY?: number,
): void {
  const S = Math.min(W, H);
  const kind = theme.design.decoration;
  ctx.save();
  if (spec.card) {
    const c = spec.card;
    ctx.shadowColor = theme.light ? 'rgba(38,65,54,0.12)' : 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = S * 0.035;
    ctx.shadowOffsetY = S * 0.012;
    ctx.fillStyle = theme.light ? 'rgba(255,255,252,0.66)' : 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.roundRect(c.x, c.y, c.width, c.height, S * 0.025);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = ink(theme, 0.1);
    ctx.lineWidth = S * 0.0014;
    ctx.stroke();
  }

  if (kind === 'stars') {
    for (let i = 0; i < 52; i++) {
      const x = noise(i + 7) * W;
      const y = noise(i + 59) * H;
      const r = S * (0.0007 + noise(i + 113) * 0.0017);
      ctx.globalAlpha = 0.2 + noise(i + 31) * 0.5;
      ctx.fillStyle = '#d6edfa';
      ellipse(ctx, x, y, r, r);
      ctx.fill();
    }
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = S * 0.0012;
    ctx.beginPath();
    ctx.ellipse(W * 0.9, H * 0.12, W * 0.24, H * 0.31, -0.55, 0, Math.PI * 1.5);
    ctx.stroke();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = theme.accent;
    ctx.fillRect(W * 0.095, H * 0.105, S * 0.065, S * 0.004);
  } else if (kind === 'grid') {
    ctx.strokeStyle = ink(theme, 0.07);
    ctx.lineWidth = S * 0.0008;
    for (let i = 1; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo((W * i) / 8, 0);
      ctx.lineTo((W * i) / 8, H);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.065;
    ctx.fillStyle = theme.fg;
    ctx.font = fontOf('serif', '400', S * 0.22);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(String(pageIndex + 1).padStart(2, '0'), W * 0.94, H * 0.94);
  } else if (kind === 'horizon') {
    const g = ctx.createRadialGradient(W * 0.77, H * 0.7, 0, W * 0.77, H * 0.7, S * 0.2);
    g.addColorStop(0, 'rgba(255,208,138,0.3)');
    g.addColorStop(0.75, 'rgba(255,208,138,0.09)');
    g.addColorStop(1, 'rgba(255,208,138,0)');
    ctx.fillStyle = g;
    ellipse(ctx, W * 0.77, H * 0.7, S * 0.2, S * 0.2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,232,202,0.24)';
    ctx.lineWidth = S * 0.0014;
    ctx.beginPath();
    ctx.moveTo(W * 0.08, H * 0.86);
    ctx.lineTo(W * 0.92, H * 0.86);
    ctx.stroke();
  } else if (kind === 'blobs') {
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ellipse(ctx, W * 0.91, H * 0.06, S * 0.17, S * 0.17);
    ctx.fill();
    ctx.fillStyle = 'rgba(50,127,108,0.09)';
    ellipse(ctx, W * 0.04, H * 0.94, S * 0.2, S * 0.2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(50,127,108,0.18)';
    ctx.lineWidth = S * 0.0018;
    ctx.beginPath();
    ctx.arc(W * 0.9, H * 0.85, S * 0.08, 0, Math.PI * 1.4);
    ctx.stroke();
  } else if (kind === 'aurora') {
    ctx.lineWidth = S * 0.0014;
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = i % 2 ? 'rgba(139,211,202,0.12)' : 'rgba(209,172,245,0.14)';
      ctx.beginPath();
      ctx.moveTo(-W * 0.05, H * (0.9 + i * 0.025));
      ctx.bezierCurveTo(
        W * 0.3,
        H * (0.72 + i * 0.02),
        W * 0.65,
        H * (1.06 - i * 0.03),
        W * 1.05,
        H * (0.74 + i * 0.025),
      );
      ctx.stroke();
    }
  } else if (kind === 'petals') {
    ctx.strokeStyle = 'rgba(139,83,91,0.25)';
    ctx.lineWidth = S * 0.002;
    ctx.beginPath();
    ctx.moveTo(W * 0.78, -H * 0.02);
    ctx.quadraticCurveTo(W * 0.84, H * 0.1, W * 0.94, H * 0.16);
    ctx.stroke();
    for (let i = 0; i < 10; i++) {
      const x = i < 4 ? W * (0.8 + i * 0.045) : noise(i + 13) * W;
      const y = i < 4 ? H * (0.025 + i * 0.028) : H * (0.83 + noise(i + 41) * 0.15);
      leaf(
        ctx,
        x,
        y,
        S * (0.009 + noise(i + 70) * 0.005),
        noise(i + 21) * 5,
        'rgba(190,112,130,0.3)',
      );
    }
  } else if (kind === 'paper') {
    ctx.strokeStyle = 'rgba(154,106,67,0.16)';
    ctx.lineWidth = S * 0.0012;
    ctx.beginPath();
    ctx.moveTo(W * 0.1, H * 0.12);
    ctx.lineTo(W * 0.1, H * 0.86);
    ctx.stroke();
    for (let i = 0; i < 7; i++) {
      const y = H * (0.46 + i * 0.052);
      ctx.beginPath();
      ctx.moveTo(W * 0.13, y);
      ctx.lineTo(W * 0.88, y);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(W * 0.77, H * 0.12);
    ctx.rotate(-0.08);
    ctx.strokeStyle = 'rgba(154,106,67,0.42)';
    ctx.lineWidth = S * 0.003;
    ctx.beginPath();
    ctx.roundRect(0, 0, S * 0.065, S * 0.024, S * 0.004);
    ctx.stroke();
    ctx.restore();
  } else if (kind === 'forest') {
    for (let side = 0; side < 2; side++) {
      const bx = side ? W * 0.92 : W * 0.07;
      const by = side ? H * 0.92 : H * 0.04;
      ctx.strokeStyle = 'rgba(199,223,183,0.22)';
      ctx.lineWidth = S * 0.002;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(
        bx + (side ? -1 : 1) * S * 0.06,
        by - S * 0.09,
        bx + (side ? -1 : 1) * S * 0.035,
        by - S * 0.18,
      );
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        leaf(
          ctx,
          bx + (side ? -1 : 1) * S * (0.015 + i * 0.008),
          by - S * (0.035 + i * 0.032),
          S * 0.017,
          side ? -0.7 : 0.7,
          'rgba(174,205,150,0.14)',
        );
      }
    }
  } else if (kind === 'autumn') {
    ctx.strokeStyle = 'rgba(111,73,44,0.28)';
    ctx.lineWidth = S * 0.002;
    ctx.beginPath();
    ctx.moveTo(W * 0.78, H * 0.03);
    ctx.quadraticCurveTo(W * 0.88, H * 0.08, W * 0.97, H * 0.23);
    ctx.stroke();
    const colors = ['rgba(166,95,54,0.42)', 'rgba(182,126,62,0.36)', 'rgba(126,110,65,0.3)'];
    for (let i = 0; i < 11; i++) {
      const top = i < 6;
      const x = top ? W * (0.78 + noise(i + 2) * 0.19) : W * (0.02 + noise(i + 3) * 0.16);
      const y = top ? H * (0.02 + noise(i + 8) * 0.17) : H * (0.84 + noise(i + 12) * 0.13);
      leaf(ctx, x, y, S * (0.013 + noise(i + 31) * 0.012), noise(i + 49) * 5, colors[i % 3]!);
    }
  } else if (kind === 'snow') {
    for (let i = 0; i < 45; i++) {
      const r = S * (0.001 + noise(i + 15) * 0.002);
      ctx.fillStyle = `rgba(255,255,255,${0.35 + noise(i + 55) * 0.5})`;
      ellipse(ctx, noise(i + 77) * W, noise(i + 109) * H, r, r);
      ctx.fill();
    }
    snowflake(ctx, W * 0.88, H * 0.14, S * 0.062, 'rgba(255,255,255,0.58)');
    snowflake(ctx, W * 0.12, H * 0.85, S * 0.035, 'rgba(100,141,163,0.22)');
    ctx.strokeStyle = 'rgba(100,141,163,0.2)';
    ctx.lineWidth = S * 0.0012;
    ctx.beginPath();
    ctx.moveTo(W * 0.35, H * 0.89);
    ctx.lineTo(W * 0.65, H * 0.89);
    ctx.stroke();
  }

  if (
    pageIndex >= 0 &&
    theme.design.layout !== 'card' &&
    kind !== 'grid' &&
    titleAccentY !== undefined
  ) {
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = theme.accent;
    const x =
      spec.title.align === 'center'
        ? spec.title.x + spec.title.width / 2 - S * 0.022
        : spec.title.x;
    const y = titleAccentY;
    ctx.fillRect(x, y, S * 0.044, S * 0.003);
  }
  ctx.restore();
}

/** 标题字距仅在短标题上启用，正文保持浏览器原生排版。 */
export function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  align: AlignId,
  tracking: number,
): void {
  if (!tracking || text.length > 32) {
    ctx.fillText(text, x, y, maxWidth);
    return;
  }
  const fontSize = Number(/([\d.]+)px/.exec(ctx.font)?.[1] ?? 16);
  const spacing = fontSize * tracking;
  const chars = [...text];
  const width =
    chars.reduce((sum, ch) => sum + ctx.measureText(ch).width, 0) + spacing * (chars.length - 1);
  let cursor = align === 'center' ? x - width / 2 : x;
  const previous = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const ch of chars) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + spacing;
  }
  ctx.textAlign = previous;
}
