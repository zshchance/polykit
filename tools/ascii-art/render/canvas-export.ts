/**
 * Canvas 自绘导出 —— 所见即所得。
 *
 * 为什么不用 html-to-image：
 *   html-to-image 把 DOM 克隆进 SVG foreignObject 再栅格化。对「同字元素」这类
 *   依赖 per-cell transform:scaleX 的渲染，SVG foreignObject 的子像素处理与浏览器
 *   DOM 渲染不一致，逐列累积漂移（实测：预览方正，导出 PNG 越到后面的字越走形）。
 *
 *   Canvas 自绘直接按与预览相同的几何模型绘制：
 *     - 列宽 = 半角 advance（0.6em，运行时测量）
 *     - 行高 = 字号（line-height 1）
 *     - 压缩字（Cell.w）用 ctx.scale(ratio, 1) 横向压窄 —— canvas 变换几何精确，无中间层
 *   → 导出与预览 100% 所见即所得，彻底消除累积误差。
 */

import type { Rendered, StyleConfig, Cell } from '../types';
import { getTerminalMeta } from '../presets';
import { downloadBlob } from '@/core/utils/clipboard';
import { EXPORT_TARGET_WIDTH } from '../export';

export type ExportResult = { ok: true } | { ok: false; reason: string };

/** 导出画布放大倍数（2x 高清，导出逻辑尺寸不变）。 */
const PIXEL_RATIO = 2;

/** 字体栈（与预览 pre 一致）。 */
const FONT_STACK = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

/** 半角/全角 advance 比（scaleX 压缩系数）：JBM 半角 0.6em、中文全角 1em → ≈0.6。 */
let fullToHalfRatio: number | null = null;
export function getFullToHalfRatio(): number {
  if (fullToHalfRatio !== null) return fullToHalfRatio;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return (fullToHalfRatio = 0.6);
    ctx.font = `32px ${FONT_STACK}`;
    const half = ctx.measureText('M').width;
    const full = ctx.measureText('中').width;
    fullToHalfRatio = half > 0 && full > 0 ? half / full : 0.6;
  } catch {
    fullToHalfRatio = 0.6;
  }
  return fullToHalfRatio;
}

/**
 * 把 Cell 网格 + 终端外框直接绘制成 canvas（所见即所得）。
 * @param cells Cell 网格（行 × 列）
 * @param cfg 风格配置（终端外观）
 * @param W 网格列数（导出字号 = EXPORT_TARGET_WIDTH / W）
 * @throws 若 canvas 2d 上下文不可用
 */
export function drawAsciiCanvas(cells: Rendered, cfg: StyleConfig, W: number): HTMLCanvasElement {
  const fontSize = EXPORT_TARGET_WIDTH / W;
  const ratio = getFullToHalfRatio();
  const colW = fontSize * ratio; // 半角列宽（= 半角 advance）
  const rowH = fontSize; // 行高（line-height 1）
  const cols = W;
  const rows = cells.length;
  const contentW = cols * colW;
  const contentH = rows * rowH;

  const meta = getTerminalMeta(cfg.terminal);
  const padding = cfg.padding;
  const border = 1; // frame border 1px
  const titlebarH = cfg.showFrame ? 30 : 0; // 标题栏高（8px padding×2 + 13px 字号）

  const logicalW = contentW + padding * 2 + border * 2;
  const logicalH = titlebarH + contentH + padding * 2 + border * 2;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(logicalW * PIXEL_RATIO);
  canvas.height = Math.ceil(logicalH * PIXEL_RATIO);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前环境不支持 2D 画布');
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);

  // 背景（整个 canvas）
  ctx.fillStyle = cfg.bg;
  ctx.fillRect(0, 0, logicalW, logicalH);

  // 圆角裁剪（模拟 frame border-radius + overflow hidden），仅 showFrame
  if (cfg.showFrame && meta.radius > 0) {
    ctx.save();
    roundRectPath(ctx, 0, 0, logicalW, logicalH, meta.radius);
    ctx.clip();
  }

  if (cfg.showFrame) {
    // 标题栏背景
    if (meta.barBg) {
      ctx.fillStyle = meta.barBg;
      ctx.fillRect(0, 0, logicalW, titlebarH);
    }
    // 三圆点（左 12px 起，间距 6px）
    if (meta.dots) {
      const dotR = 6;
      let dx = 12 + dotR;
      for (const color of meta.dots) {
        ctx.beginPath();
        ctx.arc(dx, titlebarH / 2, dotR, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        dx += dotR * 2 + 6;
      }
    }
    // 标题文字（居中，13px）
    if (cfg.title) {
      ctx.fillStyle = readableBarFg(cfg.bg);
      ctx.font = `13px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cfg.title, logicalW / 2, titlebarH / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }
    // 边框
    ctx.strokeStyle = 'rgba(128,128,128,0.25)';
    ctx.lineWidth = border;
    ctx.strokeRect(0.5, 0.5, logicalW - 1, logicalH - 1);
  }

  // 内容区（screen padding）
  const originX = border + padding;
  const originY = (cfg.showFrame ? titlebarH : 0) + border + padding;

  // 逐 cell 绘制
  ctx.font = `${fontSize}px ${FONT_STACK}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  for (let y = 0; y < rows; y++) {
    const row = cells[y]!;
    const py = originY + y * rowH;
    for (let x = 0; x < row.length && x < cols; x++) {
      const c = row[x]!;
      drawCell(ctx, c, originX + x * colW, py, colW, rowH, cfg, fontSize, ratio);
    }
  }

  // CRT 扫描线（内容区，每 4px 一条 1px 半透明黑线，复刻 repeating-linear-gradient）
  if (cfg.crtScanlines) {
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    for (let yy = originY; yy < originY + contentH; yy += 4) {
      ctx.fillRect(originX, yy, contentW, 1);
    }
  }

  if (cfg.showFrame && meta.radius > 0) ctx.restore();

  return canvas;
}

/** 绘制单个 Cell（背景 + 字形 + 压缩字缩放）。 */
function drawCell(
  ctx: CanvasRenderingContext2D,
  c: Cell,
  px: number,
  py: number,
  colW: number,
  rowH: number,
  cfg: StyleConfig,
  fontSize: number,
  ratio: number,
): void {
  // 背景色（半块模式=下半像素色；find-word 高亮底）
  if (c.bg) {
    ctx.fillStyle = c.bg;
    ctx.fillRect(px, py, colW, rowH);
  }
  const ch = c.ch;
  if (!ch || ch === ' ') return;
  const color = c.fg ?? cfg.fg;
  ctx.fillStyle = color;
  if (cfg.crtGlow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = fontSize * 0.4; // ≈ 8px @20.5px，与 DOM text-shadow 0 0 8px 近似
  }
  if (c.w) {
    // 压缩字：横向压到半角列宽（同预览 scaleX(ratio)，canvas 变换几何精确）
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(ratio, 1);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  } else {
    ctx.fillText(ch, px, py);
  }
  if (cfg.crtGlow) {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }
}

/** 圆角矩形路径（arcTo 实现，兼容无 ctx.roundRect 的环境）。 */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 标题栏文字色：背景亮 → 深色字，否则浅色字（与 terminal-frame 一致）。 */
function readableBarFg(bg: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(bg.trim());
  if (!m) return '#e5e7eb';
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 140 ? '#1a1a1a' : '#e5e7eb';
}

/**
 * 导出 PNG：Canvas 自绘（所见即所得）。
 * @param cells Cell 网格
 * @param cfg 风格配置
 * @param W 网格列数（导出字号基准）
 * @param filename 下载文件名
 */
export async function downloadPngCanvas(cells: Rendered, cfg: StyleConfig, W: number, filename: string): Promise<ExportResult> {
  try {
    // 等 webfont（fillText 用 "JetBrains Mono"，未就绪会 fallback → 导出与预览不一致）
    if (document.fonts && document.fonts.ready) {
      await Promise.race([
        document.fonts.ready,
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ]);
    }
    const canvas = drawAsciiCanvas(cells, cfg, W);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return { ok: false, reason: 'PNG 编码失败' };
    downloadBlob(blob, filename);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : '未知错误' };
  }
}
