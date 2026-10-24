/** 单页渲染：主题布局、文字测量、装饰与页码共用一份安全区。 */
import { fontOf } from './options';
import { fitText } from './text-layout';
import {
  drawTrackedText,
  paintThemeBackground,
  paintThemeDecorations,
  themePageSpec,
  type TextBox,
} from './theme-design';
import type { RenderInput } from './renderer';

interface PageLayout {
  titleLines: string[];
  titleSize: number;
  bodyLines: string[];
  bodySize: number;
  spec: ReturnType<typeof themePageSpec>;
  totalLines: number;
}

const layoutCache = new Map<string, PageLayout>();

export function clearPageLayoutCaches(): void {
  layoutCache.clear();
}

function textX(b: TextBox): number {
  return b.align === 'center' ? b.x + b.width / 2 : b.x;
}

function layoutOf(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  input: RenderInput,
  idx: number,
): PageLayout {
  const { opts, theme } = input;
  const page = input.pages[idx]!;
  const key = `${W}x${H}|${idx}|${theme.id}|${theme.design.layout}|${theme.design.typography}|${opts.font ?? 'theme'}|${opts.align ?? 'theme'}|${page.title ?? ''}|${page.body}`;
  const cached = layoutCache.get(key);
  if (cached) return cached;
  const spec = themePageSpec(W, H, theme, page, opts.font, opts.align);
  const S = Math.min(W, H);
  const t = spec.typography;
  const titleFit = page.title
    ? fitText(page.title, {
        maxWidth: spec.title.width,
        maxHeight: spec.title.height,
        startSize: S * t.titleScale,
        minSize: S * 0.032,
        lineHeight: t.titleLineHeight,
        withFont: (size) => {
          ctx.font = fontOf(t.titleFont, t.titleWeight, size);
          return (s) =>
            ctx.measureText(s).width +
            ([...s].length <= 32 ? Math.max(0, [...s].length - 1) * t.tracking * size : 0);
        },
      })
    : { lines: [], size: 0, fits: true };
  const bodyFit = page.body
    ? fitText(page.body, {
        maxWidth: spec.body.width,
        maxHeight: spec.body.height,
        startSize: S * t.bodyScale,
        minSize: S * 0.018,
        lineHeight: t.bodyLineHeight,
        withFont: (size) => {
          ctx.font = fontOf(t.bodyFont, t.bodyWeight, size);
          return (s) => ctx.measureText(s).width;
        },
      })
    : { lines: [], size: 0, fits: true };
  const layout = {
    titleLines: titleFit.lines,
    titleSize: titleFit.size,
    bodyLines: bodyFit.lines,
    bodySize: bodyFit.size,
    spec,
    totalLines: titleFit.lines.length + bodyFit.lines.length,
  };
  if (layoutCache.size > 90) layoutCache.clear();
  layoutCache.set(key, layout);
  return layout;
}

function drawPageNo(
  ctx: CanvasRenderingContext2D,
  input: RenderInput,
  idx: number,
  W: number,
  H: number,
): void {
  const { theme, opts } = input;
  const spec = themePageSpec(W, H, theme, input.pages[idx]!, opts.font, opts.align);
  const S = Math.min(W, H);
  const p = spec.pageNo;
  ctx.save();
  ctx.fillStyle = theme.muted;
  ctx.font = fontOf(spec.typography.bodyFont, '500', S * 0.019);
  ctx.textAlign = p.align;
  ctx.textBaseline = 'middle';
  if (theme.design.layout === 'editorial' || theme.design.layout === 'poster') {
    ctx.fillText(String(idx + 1).padStart(2, '0'), p.x, p.y);
    const width = ctx.measureText(String(idx + 1).padStart(2, '0')).width;
    ctx.strokeStyle = theme.accent;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = S * 0.0015;
    ctx.beginPath();
    const start = p.align === 'right' ? p.x - width - S * 0.08 : p.x + width + S * 0.015;
    ctx.moveTo(start, p.y);
    ctx.lineTo(start + S * 0.065, p.y);
    ctx.stroke();
  } else {
    ctx.fillText(
      `${String(idx + 1).padStart(2, '0')}  /  ${String(input.pages.length).padStart(2, '0')}`,
      p.x,
      p.y,
    );
  }
  ctx.restore();
}

/** enterP=1 时生成静态页快照；其余值用于逐行入场。 */
export function renderThemedPage(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  input: RenderInput,
  idx: number,
  enterP: number,
): void {
  const { theme, opts } = input;
  paintThemeBackground(ctx, W, H, theme);
  const lay = layoutOf(ctx, W, H, input, idx);
  const { spec } = lay;
  const titleBlockH = lay.titleLines.length * lay.titleSize * spec.typography.titleLineHeight;
  const titleTop =
    spec.title.valign === 'middle'
      ? spec.title.y + (spec.title.height - titleBlockH) / 2
      : spec.title.y;
  const titleAccentY =
    lay.titleLines.length > 0 ? titleTop + titleBlockH + Math.min(W, H) * 0.035 : undefined;
  paintThemeDecorations(ctx, W, H, theme, idx, spec, titleAccentY);
  const animated = opts.enter !== 'none' && enterP < 1;
  const ease = (p: number): number => 1 - (1 - p) ** 3;
  const lineP = (lineNo: number): number => {
    if (!animated) return 1;
    const start = (lineNo / Math.max(1, lay.totalLines)) * 0.42;
    return Math.min(1, Math.max(0, (enterP - start) / 0.58));
  };
  let lineNo = 0;

  const drawLines = (
    lines: string[],
    size: number,
    lineHeight: number,
    b: TextBox,
    font: Parameters<typeof fontOf>[0],
    weight: string,
    color: string,
    tracking: number,
  ): void => {
    if (!lines.length || size <= 0) return;
    const lh = size * lineHeight;
    const blockH = lines.length * lh;
    const top = b.valign === 'middle' ? b.y + (b.height - blockH) / 2 : b.y;
    ctx.save();
    ctx.font = fontOf(font, weight, size);
    ctx.textAlign = b.align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    for (let i = 0; i < lines.length; i++) {
      const lp = lineP(lineNo++);
      if (lp <= 0) continue;
      ctx.save();
      ctx.globalAlpha = lp;
      const rise = opts.enter === 'rise' ? (1 - ease(lp)) * size * 0.55 : 0;
      drawTrackedText(
        ctx,
        lines[i]!,
        textX(b),
        top + (i + 0.5) * lh + rise,
        b.width,
        b.align,
        tracking,
      );
      ctx.restore();
    }
    ctx.restore();
  };

  drawLines(
    lay.titleLines,
    lay.titleSize,
    spec.typography.titleLineHeight,
    spec.title,
    spec.typography.titleFont,
    spec.typography.titleWeight,
    theme.fg,
    spec.typography.tracking,
  );
  drawLines(
    lay.bodyLines,
    lay.bodySize,
    spec.typography.bodyLineHeight,
    spec.body,
    spec.typography.bodyFont,
    spec.typography.bodyWeight,
    theme.fg,
    0,
  );
  if (opts.showPageNo) drawPageNo(ctx, input, idx, W, H);
}
