/**
 * 二维码解码 —— 用 jsQR 从 RGBA 像素中识别二维码内容。
 *
 * 纯函数（输入像素数据，输出文本或结果数组），无副作用，可独立测试。
 *
 * 两套 API：
 *   - decodeQr：识别单个二维码（返回第一个结果或 null）
 *   - detectAllQr：识别图中所有二维码（海报场景：一张图含多个码 + 头像 + 文字）
 *
 * jsQR 单次调用只返回一个码，且不暴露内部的"候选定位点列表"。所以多码识别用
 * 经典的「检测 + 遮蔽」迭代：全图扫到一个码 → 记录其内容与位置 → 把该码区域
 * 在像素缓冲里抹成纯色（破坏它）→ 再扫一次 → 直到扫不到为止。
 * 配合「正反色都试」可识别深底浅码（反色二维码，如微信海报里的彩色码）。
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

/**
 * 解码单个二维码（首个）。
 * @param data RGBA 一维像素（length = w*h*4）
 */
export function decodeQr(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): DecodeResult {
  // attemptBoth：正反色都试，提高对深底浅码（反色）二维码的识别率
  const res = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
  if (!res) return { text: null, version: 0 };
  return { text: res.data, version: res.version };
}

/**
 * 识别图中所有二维码。
 *
 * 「检测 + 遮蔽」迭代：
 *   1. 在（剩余可见的）像素上跑 jsQR（正反色都试）。
 *   2. 命中 → 记录文本 + 由四角算包围盒 → 把该包围盒（略外扩）像素抹成中灰，
 *      让下次扫描不再命中它。
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
    const res = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
    if (!res || !res.data) break;

    // 四角 → 包围盒
    const loc = res.location;
    const xs = [loc.topLeftCorner.x, loc.topRightCorner.x, loc.bottomRightCorner.x, loc.bottomLeftCorner.x];
    const ys = [loc.topLeftCorner.y, loc.topRightCorner.y, loc.bottomRightCorner.y, loc.bottomLeftCorner.y];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const box = {
      x: Math.max(0, Math.floor(minX)),
      y: Math.max(0, Math.floor(minY)),
      width: Math.min(width, Math.ceil(maxX)) - Math.max(0, Math.floor(minX)),
      height: Math.min(height, Math.ceil(maxY)) - Math.max(0, Math.floor(minY)),
    };

    found.push({ text: res.data, version: res.version, box });

    // 遮蔽：把包围盒（外扩 8px，防止边缘残留定位点）抹成中灰 128。
    // 用纯灰避免与"黑码白底"或"白码黑底"任一极性形成新的对比，降低误重复命中。
    maskRegion(data, width, box.x, box.y, box.width, box.height, 8, 128, 128, 128);

    // 同文本去重：同一码被遮蔽不彻底时可能二次命中，跳过文本完全相同者
    if (found.filter((f) => f.text === res.data).length > 1) {
      found.pop();
    }
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
