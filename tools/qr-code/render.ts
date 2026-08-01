/**
 * 二维码绘制 —— 把 qrcode 库产出的模块矩阵，按所选形状重绘到 canvas。
 *
 * 不直接用 qrcode 的 toCanvas（只能出标准方块），而是拿到 modules 矩阵后自己画，
 * 这样才能支持圆点/圆角码点、定位点（眼）独立换形、中心 Logo 等美化。
 *
 * 关键约定：
 *   - 一个 QR 的三个角是"定位图案"（finder pattern，7×7 实心框），它们是识别的关键，
 *     美化时常单独换风格（圆眼/圆角眼）。data 区（其余模块）按 dotShape 画。
 *   - 嵌 Logo 时，中心区域会被覆盖；因此调用方应使用 ≥Q 的纠错等级，
 *     render 本身在中心留白（不画被 Logo 完全覆盖的模块），保证视觉干净。
 */

import QRCode from 'qrcode';
import type { DotShape, EyeShape, QrConfig } from './types';
import type { DotEffectFn } from './custom-styles';

/** qrcode 库的模块矩阵子集（只用到 size / get） */
interface Modules {
  size: number;
  // qrcode 的 BitMatrix.get 返回 number（0/1），统一成 (row,col)=>boolean
  get(row: number, col: number): boolean;
}

/** 渲染产物：canvas 与基础尺寸信息（供导出复用） */
export interface RenderResult {
  canvas: HTMLCanvasElement;
  /** 矩阵边长（模块数） */
  modules: number;
  /** 每个模块的像素边长 */
  scale: number;
}

const MARGIN = 4; // QR 规范静默区（quiet zone），>=4 模块保证识别
const DEFAULT_PX = 1024; // 默认画布像素边长

/**
 * 用 qrcode 库生成模块矩阵（纯数据，不含渲染）。
 * @throws 内容为空或过长无法编码时抛错。
 */
export async function buildModules(
  text: string,
  errorLevel: QrConfig['errorLevel'],
): Promise<Modules> {
  if (!text) throw new Error('请输入要生成二维码的内容');
  const qr = QRCode.create(text, { errorCorrectionLevel: errorLevel });
  // qrcode 的 BitMatrix.get 返回 0/1 number；适配成本模块约定的 boolean。
  return { size: qr.modules.size, get: (r, c) => qr.modules.get(r, c) === 1 };
}

/**
 * 主绘制函数：模块矩阵 + 配置 → 美化后的 canvas。
 * @param logoImage 中心 Logo 的位图；为 null 表示不嵌。
 * @param pixelSide 画布像素边长，默认 1024（高清下载够用）。
 * @param dotEffect 可选的逐码点叠加钩子（来自 AI 风格）。在每个 data 码点画完标准
 *                  形状后被调用，可在其上叠加任意绘制（落雪/高光/描边等）。每个码点
 *                  的调用被 save/restore 包裹 + try/catch 兜底，单点失败不影响全局。
 */
export function drawQr(
  modules: Modules,
  cfg: QrConfig,
  logoImage: ImageBitmap | HTMLImageElement | null,
  pixelSide = DEFAULT_PX,
  dotEffect?: DotEffectFn | null,
): RenderResult {
  const size = modules.size;
  // 每模块像素：画布总像素 / (矩阵 + 两侧静默区)
  const scale = Math.floor(pixelSide / (size + MARGIN * 2));
  const total = scale * (size + MARGIN * 2);

  const canvas = document.createElement('canvas');
  canvas.width = total;
  canvas.height = total;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 背景（空串=透明，PNG 直接抠出来）
  if (cfg.bgColor) {
    ctx.fillStyle = cfg.bgColor;
    ctx.fillRect(0, 0, total, total);
  }

  ctx.fillStyle = cfg.fgColor;
  const offset = MARGIN * scale; // 矩阵左上角在画布上的像素偏移

  // 定位点（眼）区域：左上、右上、左下三个 7×7 块。data 区画 dotShape，眼区画 eyeShape。
  const inFinder = (r: number, c: number): boolean =>
    inBlock(r, c, 0, 0) || inBlock(r, c, 0, size - 7) || inBlock(r, c, size - 7, 0);

  // —— 画 data 区模块 ——
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!modules.get(r, c)) continue;
      if (inFinder(r, c)) continue; // 眼区单独画
      // 中心 Logo 覆盖区跳过，避免码点压在 Logo 上（视觉杂乱）
      if (logoImage && cfg.withLogo && inCenterArea(r, c, size, cfg.logoRatio)) continue;
      const x = offset + c * scale;
      const y = offset + r * scale;
      drawModule(ctx, x, y, scale, cfg.dotShape);
      // AI 风格的逐码点叠加钩子：save/restore 隔离状态，try/catch 兜底单点失败
      if (dotEffect) {
        ctx.save();
        try {
          dotEffect(ctx, x, y, scale, r, c);
        } catch {
          // 单点叠加失败：静默跳过，不影响主码点绘制
        } finally {
          ctx.restore();
        }
        // restore 后 fillStyle 可能被还原，重设回码点色，确保下一个码点正确
        ctx.fillStyle = cfg.fgColor;
      }
    }
  }

  // —— 画三个定位点（眼）——
  drawEye(ctx, offset, offset, scale, cfg.eyeShape); // 左上
  drawEye(ctx, offset + (size - 7) * scale, offset, scale, cfg.eyeShape); // 右上
  drawEye(ctx, offset, offset + (size - 7) * scale, scale, cfg.eyeShape); // 左下

  // —— 中心 Logo ——
  if (logoImage && cfg.withLogo) {
    const side = Math.floor(size * scale * cfg.logoRatio);
    // 居中
    const lx = Math.round((total - side) / 2);
    const ly = Math.round((total - side) / 2);
    // Logo 底垫：一圈背景色描边，避免 Logo 边缘与码点粘连难辨
    const pad = Math.max(2, Math.round(side * 0.06));
    if (cfg.bgColor) {
      ctx.fillStyle = cfg.bgColor;
      roundRect(ctx, lx - pad, ly - pad, side + pad * 2, side + pad * 2, pad);
      ctx.fill();
    }
    // Logo 形状裁剪：圆角(rounded)时把方形位图裁成圆角矩形，避免与码点衔接生硬；
    // square 时直接 drawImage 保持直角。用离屏 canvas + clip 实现。
    if (cfg.logoFit === 'rounded') {
      const radius = Math.round(side * 0.22); // 与码点圆角风格协调的圆角量
      ctx.save();
      roundRect(ctx, lx, ly, side, side, radius);
      ctx.clip();
      ctx.drawImage(logoImage, lx, ly, side, side);
      ctx.restore();
    } else {
      ctx.drawImage(logoImage, lx, ly, side, side);
    }
  }

  return { canvas, modules: size, scale };
}

/** (r,c) 是否落在以 (baseR,baseC) 为左上的 7×7 定位点框内 */
function inBlock(r: number, c: number, baseR: number, baseC: number): boolean {
  return r >= baseR && r < baseR + 7 && c >= baseC && c < baseC + 7;
}

/** 模块是否落在中心 Logo 覆盖区（按边长比例） */
function inCenterArea(r: number, c: number, size: number, ratio: number): boolean {
  const side = Math.ceil(size * ratio);
  const start = Math.floor((size - side) / 2);
  const end = start + side;
  return r >= start && r < end && c >= start && c < end;
}

/** 单个 data 模块按形状绘制（ctx 已设 fillStyle，scale 为像素边长） */
function drawModule(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, shape: DotShape): void {
  switch (shape) {
    case 'square':
      ctx.fillRect(x, y, s, s);
      break;
    case 'dot':
      // 圆点：直径取模块边长，相邻圆点会留细缝形成"点阵"质感
      ctx.beginPath();
      ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'rounded':
      roundRect(ctx, x, y, s, s, s * 0.3);
      ctx.fill();
      break;
  }
}

/**
 * 画一个定位点（眼）。标准 finder 是 7×7：
 *   外层 7×7 实心框（1 模块宽的黑边）→ 内层 5×5 空白间隙 → 中心 3×3 实心。
 * 横切一行的模块序列应为：1111111 / 1000001 / 1011101 / …
 *
 * 画法：用一个 evenodd 复合路径画"7×7 外框 - 5×5 间隙"得到外环（含黑边+白缝），
 * 再单独 fill 中心 3×3。eyeShape 控制圆角程度（square=直角、rounded=小圆角、circle=圆）。
 */
function drawEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  shape: EyeShape,
): void {
  const outer = 7 * s;
  const gap = 5 * s; // 内部空白间隙（7×7 减去 1 模块边框）
  const core = 3 * s; // 中心实心块
  const gapOffset = 1 * s; // 间隙相对外框的偏移
  const coreOffset = 2 * s; // 中心 3×3 相对外框的偏移

  const outerR = shape === 'square' ? 0 : shape === 'rounded' ? outer * 0.18 : outer / 2;
  const gapR = shape === 'square' ? 0 : shape === 'rounded' ? gap * 0.18 : gap / 2;
  const coreR = shape === 'square' ? 0 : shape === 'rounded' ? core * 0.25 : core / 2;

  // 外环：evenodd 同时画 7×7 与 5×5，重叠（中心 5×5）被镂空 → 得到 1 模块宽的黑边。
  ctx.beginPath();
  rectPath(ctx, x, y, outer, outerR);
  rectPath(ctx, x + gapOffset, y + gapOffset, gap, gapR);
  ctx.fill('evenodd');

  // 中心 3×3 实心（圆形眼时画圆点）
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(x + coreOffset + core / 2, y + coreOffset + core / 2, core / 2, 0, Math.PI * 2);
  } else {
    rectPath(ctx, x + coreOffset, y + coreOffset, core, coreR);
  }
  ctx.fill();
}

/** 往当前路径追加一个圆角矩形（不 beginPath，用于 evenodd 复合路径） */
function rectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, r: number): void {
  if (r <= 0) {
    ctx.rect(x, y, w, w);
    return;
  }
  const rr = Math.min(r, w / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + w, rr);
  ctx.arcTo(x + w, y + w, x, y + w, rr);
  ctx.arcTo(x, y + w, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 独立画一个圆角矩形并 fill（非 evenodd，给 Logo 底垫用） */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
