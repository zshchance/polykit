/**
 * 图片加载 —— 把用户选择的 File 解码为像素数据，供提取算法使用。
 *
 * 全部在浏览器本地完成（createImageBitmap + OffscreenCanvas/Canvas），
 * 不上传任何数据，呼应全站「数据不出本地」。
 *
 * 降采样：超大图（如 4000×6000）像素量达千万级，全部送进量化算法会很慢。
 * 这里按 MAX_DIM 等比缩放后再读取像素，画质足够、提取快。色彩分布几乎不变。
 */

import type { Pixel } from './extractor';

/** 降采样上限：长边超过此值则等比缩小。2000px 对配色提取足够精细。 */
const MAX_DIM = 2000;

export interface LoadedImage {
  /** 像素数组（可能已降采样） */
  pixels: Pixel[];
  /** 宽（降采样后） */
  width: number;
  /** 高（降采样后） */
  height: number;
  /** 原始图片的对象 URL，用于 UI 预览（用完需调用 revokeImage） */
  previewUrl: string;
}

/** 释放预览 URL，避免内存泄漏 */
export function revokeImage(img: LoadedImage): void {
  URL.revokeObjectURL(img.previewUrl);
}

/**
 * 解码图片文件为像素数组。
 * @throws 若文件不是合法图片
 */
export async function loadImage(file: File): Promise<LoadedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件');
  }

  const previewUrl = URL.createObjectURL(file);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('图片解码失败，请换一张试试');
  }

  // 等比降采样
  let w = bitmap.width;
  let h = bitmap.height;
  const scale = Math.min(1, MAX_DIM / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));

  // 优先用 OffscreenCanvas（不触发 DOM 重排），回退普通 canvas
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close?.();
    URL.revokeObjectURL(previewUrl);
    throw new Error('当前环境不支持 2D 画布');
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const { data } = ctx.getImageData(0, 0, w, h);
  // Uint8ClampedArray → Pixel[]；每 4 个值一组（RGBA）
  const pixels: Pixel[] = new Array((data.length / 4) | 0);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    pixels[j] = { r: data[i]!, g: data[i + 1]!, b: data[i + 2]!, a: data[i + 3]! };
  }

  return { pixels, width: w, height: h, previewUrl };
}
