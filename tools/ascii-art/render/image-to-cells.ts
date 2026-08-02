/**
 * 图片 → Cell 网格 —— 字符画的核心渲染管线（纯函数）。
 *
 * 输入：ImageBitmap（或任何可 drawImage 的源）+ 风格参数。
 * 输出：Rendered（Cell[][]），与导出完全解耦。
 *
 * 管线：
 *   1) 按目标字符宽 W + 宽高比系数 aspectRatio 算采样尺寸
 *   2) 离屏 canvas 用 drawImage 一次高质量下采样（浏览器内置重采样，零锯齿）
 *   3) getImageData → 逐像素：
 *        a. 先应用 contrast / brightness / invert 到 RGB（半块真彩也吃这三个参数）
 *        b. alpha < 128 的透明像素 → 色置为 cfg.bg（透出终端背景，无黑块）
 *   4) 半块模式：相邻两像素一组，ch='▀'，fg=上像素色，bg=下像素色（垂直分辨率翻倍）
 *      纯字符模式：每像素亮度(Rec.709) → charset 索引
 *
 * 纯函数：无全局状态、无 DOM 全局副作用（只用临时 canvas）。
 * 便于后续迁 Web Worker（OffscreenCanvas 在 Worker 可用）。
 */

import type { Cell, Rendered } from './types';

/** imageToCells 需要的风格参数子集（从 StyleConfig 投影）。 */
export interface ImageToCellsCfg {
  width: number;
  halfBlock: boolean;
  charset: string;
  aspectRatio: number;
  contrast: number;
  brightness: number;
  invert: boolean;
  colorMode: boolean;
  fg: string;
  bg: string;
}

/** 可 drawImage 且带 width/height 的源（ImageBitmap / OffscreenCanvas / HTMLCanvasElement）。 */
type DrawableSource = CanvasImageSource & { width: number; height: number };

/**
 * 把图片渲染成 Cell 网格。
 * @throws 若 canvas 2d 上下文不可用
 */
export function imageToCells(source: DrawableSource, cfg: ImageToCellsCfg): Rendered {
  const srcW = source.width;
  const srcH = source.height;
  if (srcW <= 0 || srcH <= 0) return [];

  const charset = cfg.charset.length > 0 ? cfg.charset : ' .:-=+*#%@';

  // —— 1) 算采样尺寸 ——
  // 目标字符宽 W，采样高 H = round(W × imgH/imgW × aspectRatio)
  const W = Math.max(8, Math.round(cfg.width));
  const r = srcH / srcW;
  let H = Math.max(1, Math.round(W * r * cfg.aspectRatio));

  // 半块模式：1 字符表达 2 像素行，需要偶数行（奇数则裁掉最后一行像素）
  if (cfg.halfBlock && H % 2 === 1) H = Math.max(2, H - 1);

  // —— 2) drawImage 一次下采样 ——
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(W, H)
      : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('当前环境不支持 2D 画布');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source as CanvasImageSource, 0, 0, W, H);

  const { data } = ctx.getImageData(0, 0, W, H);

  // —— 3) 像素预处理：contrast/brightness/invert + 透明降级 ——
  // 预解析 cfg.bg 为 RGB（透明像素降级用）
  const bgRgb = parseHex(cfg.bg);
  const contrastFactor = (cfg.contrast + 100) / 100; // 0~2，1=不变
  const brightnessDelta = (cfg.brightness / 100) * 255; // -255~255

  // 每像素处理后的 [r,g,b]，存成 number 数组（紧凑）
  const px: number[] = new Array(W * H * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    let pr = data[i]!;
    let pg = data[i + 1]!;
    let pb = data[i + 2]!;
    const a = data[i + 3]!;

    if (a < 128) {
      // 透明像素 → 降级到终端背景色
      pr = bgRgb[0];
      pg = bgRgb[1];
      pb = bgRgb[2];
    }

    // brightness
    pr += brightnessDelta;
    pg += brightnessDelta;
    pb += brightnessDelta;
    // contrast（围绕 128 中点缩放）
    pr = (pr - 128) * contrastFactor + 128;
    pg = (pg - 128) * contrastFactor + 128;
    pb = (pb - 128) * contrastFactor + 128;
    // invert
    if (cfg.invert) {
      pr = 255 - pr;
      pg = 255 - pg;
      pb = 255 - pb;
    }
    // clamp
    px[j] = clamp255(pr);
    px[j + 1] = clamp255(pg);
    px[j + 2] = clamp255(pb);
  }

  // —— 4) 组装 Cell ——
  if (cfg.halfBlock) {
    return buildHalfBlock(px, W, H, cfg);
  }
  return buildText(px, W, H, charset, cfg);
}

/** 半块模式：每两行像素合并成 1 行 Cell，ch='▀'，fg=上行色，bg=下行色。 */
function buildHalfBlock(px: number[], W: number, H: number, cfg: ImageToCellsCfg): Rendered {
  const rows = H / 2; // H 已保证偶数
  const cells: Rendered = [];
  for (let row = 0; row < rows; row++) {
    const upY = row * 2;
    const downY = row * 2 + 1;
    const line: Cell[] = [];
    for (let x = 0; x < W; x++) {
      const upIdx = (upY * W + x) * 3;
      const downIdx = (downY * W + x) * 3;
      const upR = px[upIdx]!, upG = px[upIdx + 1]!, upB = px[upIdx + 2]!;
      const dnR = px[downIdx]!, dnG = px[downIdx + 1]!, dnB = px[downIdx + 2]!;

      if (cfg.colorMode) {
        // 真彩双色
        line.push({
          ch: '▀',
          fg: rgbToHex(upR, upG, upB),
          bg: rgbToHex(dnR, dnG, dnB),
        });
      } else {
        // colorMode 关时半块本应被钳制关掉（settings 保证），这里防御性退化为纯字符
        const lum = (rec709(upR, upG, upB) + rec709(dnR, dnG, dnB)) / 2;
        line.push({ ch: lumToChar(lum, cfg.charset) });
      }
    }
    cells.push(line);
  }
  return cells;
}

/** 纯字符灰度模式：每像素 1 个 Cell，亮度 → charset 索引。 */
function buildText(px: number[], W: number, H: number, charset: string, cfg: ImageToCellsCfg): Rendered {
  const cells: Rendered = [];
  const lastIdx = charset.length - 1;
  for (let y = 0; y < H; y++) {
    const line: Cell[] = [];
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 3;
      const lum = rec709(px[idx]!, px[idx + 1]!, px[idx + 2]!);
      const ch = lumToChar(lum, charset);
      line.push(cfg.colorMode ? { ch, fg: cfg.fg } : { ch, fg: cfg.fg });
    }
    cells.push(line);
  }
  // 防御：lastIdx 仅用于未来按 charset 长度精确分桶，当前 lumToChar 内部已处理
  void lastIdx;
  return cells;
}

// —— 工具函数 ——

/** Rec.709 亮度（感知比 Rec.601 更准，差异微小）。 */
function rec709(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 亮度 0~255 → charset 字符（线性映射到 charset 索引）。 */
function lumToChar(lum: number, charset: string): string {
  const n = charset.length;
  if (n === 0) return ' ';
  const idx = Math.min(n - 1, Math.max(0, Math.round((lum / 255) * (n - 1))));
  return charset[idx]!;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** #rrggbb → [r,g,b]；解析失败回退黑。 */
function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** [r,g,b] → #rrggbb。 */
function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => clamp255(Math.round(v)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
