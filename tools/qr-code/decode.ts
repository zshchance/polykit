/**
 * 二维码解码 —— 用 jsQR 从 RGBA 像素中识别二维码内容。
 *
 * 纯函数（输入像素数据，输出文本或 null），无副作用，可独立测试。
 * 用于"上传已有二维码 → 提取内容 → 用所选风格重绘美化"。
 */

import jsQR from 'jsqr';

export interface DecodeResult {
  /** 识别出的文本/URL；为 null 表示未识别到 */
  text: string | null;
  /** 矩阵边长（模块数），来自 jsQR；识别失败为 0 */
  version: number;
}

/**
 * 解码。
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

/** 解码失败时给用户的人类可读原因 */
export function decodeFailReason(): string {
  return '未识别到二维码，请确认图片清晰、完整、对比度足够';
}
