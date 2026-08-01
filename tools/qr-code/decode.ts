/**
 * 二维码解码 —— 用 jsQR 从 RGBA 像素中识别二维码内容。
 *
 * 纯函数（输入像素数据，输出文本或结果数组），无副作用，可独立测试。
 *
 * 两套 API：
 *   - decodeQr：识别单个二维码（返回第一个结果或 null）
 *   - detectAllQr：识别图中所有二维码（海报场景：一张图含多个码 + 头像 + 文字）
 *
 * 关键鲁棒性：jsQR 对某些图（如高分辨率彩色码、微信绿码海报）在原始尺寸下
 * 常识别失败，但缩小一档后即可。因此所有解码都走「多尺度 + 反色」重试：
 * 原始 → 缩小到若干档 → 任一命中即用。这是主流扫码库（zxing 等）的标准做法。
 *
 * jsQR 单次调用只返回一个码，多码识别用「检测 + 遮蔽」迭代（见 detectAllQr）。
 */

import jsQR from 'jsqr';

/** 单个识别结果 */
export interface DecodeResult {
  /** 识别出的文本/URL；为 null 表示未识别到 */
  text: string | null;
  /** 矩阵边长（模块数），来自 jsQR；识别失败为 0 */
  version: number;
}

/** 一个检测到的码在原图中的位置（包围盒 + 四角像素坐标） */
export interface DetectedCode {
  text: string;
  version: number;
  /** 包围盒（像素，相对原图），用于裁剪预览/高亮 */
  box: { x: number; y: number; width: number; height: number };
}

/** 缩小重试档位（相对原图长边的比例）。jsQR 对大图常需缩小一档才稳。 */
const SCALE_TRIES = [1, 0.6, 0.4, 0.28];

/**
 * 在"指定像素缓冲"上跑一次 jsQR（正反色都试）。
 * 返回原始结果（含四角位置），不命中返回 null。
 */
function scanOnce(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ReturnType<typeof jsQR> {
  return jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
}

/**
 * 把原图按 scale 缩小到一张新 canvas，返回其像素与尺寸。
 * scale=1 时直接返回原图（不拷贝，避免无谓开销）。
 */
function scaleDown(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  scale: number,
): { data: Uint8ClampedArray; width: number; height: number } | null {
  if (scale >= 1) return { data: src, width: srcW, height: srcH };
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  // 用离屏 canvas 缩放（drawImage 自带高质量重采样）
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  // 先把源像素贴到一张等尺寸 canvas，再缩放绘制。
  // 用 new Uint8ClampedArray(src) 拷贝一份，确保底层是普通 ArrayBuffer
  // （源可能来自 SharedArrayBuffer，ImageData 构造器不接受）。
  const tmp = document.createElement('canvas');
  tmp.width = srcW;
  tmp.height = srcH;
  tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(src), srcW, srcH), 0, 0);
  ctx.drawImage(tmp, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
}

/**
 * 解码单个二维码（首个）。多尺度 + 反色重试，命中即返回。
 * @param data RGBA 一维像素（length = w*h*4）
 */
export function decodeQr(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): DecodeResult {
  for (const scale of SCALE_TRIES) {
    const view = scaleDown(data, width, height, scale);
    if (!view) continue;
    const res = scanOnce(view.data, view.width, view.height);
    if (res && res.data) return { text: res.data, version: res.version };
  }
  return { text: null, version: 0 };
}

/**
 * 识别图中所有二维码。
 *
 * 「检测 + 遮蔽」迭代 + 多尺度：
 *   1. 在（剩余可见的）像素上，按多尺度重试跑 jsQR，命中第一个即记。
 *   2. 记录文本 + 由四角算包围盒 → 把该包围盒（略外扩）像素抹成中灰，让下次扫描不再命中它。
 *   3. 重复直到不再命中，或达到 max 上限。
 *
 * @param data  RGBA 一维像素（会被就地修改以遮蔽已识别码，调用方需传入可改副本）
 * @param width  图宽
 * @param height 图高
 * @param max    最多识别几个码，防止异常图无限循环，默认 12
 */
export function detectAllQr(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  max = 12,
): DetectedCode[] {
  const found: DetectedCode[] = [];
  for (let i = 0; i < max; i++) {
    // 多尺度重试：在同一份"剩余像素"上，从原始尺寸到逐档缩小依次试
    let res: ReturnType<typeof jsQR> = null;
    let usedScale = 1;
    for (const scale of SCALE_TRIES) {
      const view = scaleDown(data, width, height, scale);
      if (!view) continue;
      const r = scanOnce(view.data, view.width, view.height);
      if (r && r.data) {
        res = r;
        usedScale = scale;
        break;
      }
    }
    if (!res || !res.data) break;

    // 注意：缩小档命中时，res.location 的坐标是缩小后的，需还原到原图坐标
    const f = 1 / usedScale;
    const loc = res.location;
    const xs = [loc.topLeftCorner.x, loc.topRightCorner.x, loc.bottomRightCorner.x, loc.bottomLeftCorner.x];
    const ys = [loc.topLeftCorner.y, loc.topRightCorner.y, loc.bottomRightCorner.y, loc.bottomLeftCorner.y];
    const minX = Math.min(...xs) * f;
    const maxX = Math.max(...xs) * f;
    const minY = Math.min(...ys) * f;
    const maxY = Math.max(...ys) * f;
    const box = {
      x: Math.max(0, Math.floor(minX)),
      y: Math.max(0, Math.floor(minY)),
      width: Math.min(width, Math.ceil(maxX)) - Math.max(0, Math.floor(minX)),
      height: Math.min(height, Math.ceil(maxY)) - Math.max(0, Math.floor(minY)),
    };

    // 同文本去重（遮蔽不彻底时可能二次命中同一码）
    if (found.some((c) => c.text === res!.data)) {
      // 已记录过，仅遮蔽后继续找别的
      maskRegion(data, width, box.x, box.y, box.width, box.height, 8, 128, 128, 128);
      continue;
    }

    found.push({ text: res.data, version: res.version, box });
    maskRegion(data, width, box.x, box.y, box.width, box.height, 8, 128, 128, 128);
  }
  return found;
}

/** 把指定矩形区域（可外扩 pad）的像素抹成指定颜色，用于遮蔽已识别码 */
function maskRegion(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  w: number,
  h: number,
  pad: number,
  r: number,
  g: number,
  b: number,
): void {
  const x0 = Math.max(0, x - pad);
  const y0 = Math.max(0, y - pad);
  const x1 = Math.min(width, x + w + pad);
  const y1 = Math.min(data.length / 4 / width, y + h + pad);
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * width + px) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
}

/** 解码失败时给用户的人类可读原因 */
export function decodeFailReason(): string {
  return '未识别到二维码，请确认图片清晰、完整、对比度足够';
}
