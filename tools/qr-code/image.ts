/**
 * 图片解码辅助 —— 上传的二维码图片 / Logo 图片 → 可处理的数据。
 *
 * 复用 createImageBitmap（支持 EXIF 方向、离屏解码），全本地。
 * 给二维码解码用：读出 RGBA 像素；给 Logo 嵌入用：直接返回位图。
 */

export interface DecodedImage {
  /** RGBA 一维像素数组，供 jsQR */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** 原始位图，可供直接 drawImage（如需） */
  bitmap: ImageBitmap;
  /** 预览用对象 URL */
  previewUrl: string;
}

/**
 * 解码图片文件为 RGBA 像素。
 * 大图不降采样——QR 解码对清晰度敏感，降采样可能破坏小码点。
 * @throws 非图片或解码失败
 */
export async function decodeImage(file: File): Promise<DecodedImage> {
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
  const w = bitmap.width;
  const h = bitmap.height;
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  // OffscreenCanvas 与 HTMLCanvasElement 的 2d 上下文类型不同但 API 子集一致，
  // 统一用 CanvasRenderingContext2D 收窄（drawImage/getImageData 两者都支持）。
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) {
    bitmap.close();
    URL.revokeObjectURL(previewUrl);
    throw new Error('当前环境不支持 2D 画布');
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  return { data, width: w, height: h, bitmap, previewUrl };
}

/** 解码图片为 ImageBitmap（供 Logo 嵌入绘制） */
export async function decodeBitmap(file: File): Promise<ImageBitmap> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件');
  }
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('图片解码失败，请换一张试试');
  }
}
