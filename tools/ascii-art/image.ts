/**
 * 图片加载 —— 把用户选择的 File 解码为 ImageBitmap，供 imageToCells 直接消费。
 *
 * 全部本地完成（createImageBitmap，不上传任何数据），呼应全站「数据不出本地」。
 * 不在此处下采样：imageToCells 内部用 drawImage 一次高质量下采样到目标尺寸，
 * 这里只负责解码 + EXIF 方向校正（手机照片防方向错误，照搬 color-extractor）。
 */

export interface LoadedImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** 原始文件名（用于生成下载文件名）。 */
  name: string;
}

/** 释放 bitmap，避免内存泄漏。 */
export function revokeImage(img: LoadedImage): void {
  img.bitmap.close?.();
}

/**
 * 解码图片文件为 ImageBitmap。
 * @throws 若文件不是合法图片或解码失败
 */
export async function loadImage(file: File): Promise<LoadedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件');
  }
  let bitmap: ImageBitmap;
  try {
    // imageOrientation: 'from-image' 尊重 EXIF 方向标记，手机照片不会躺倒
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('图片解码失败，请换一张试试');
  }
  return { bitmap, width: bitmap.width, height: bitmap.height, name: file.name };
}
