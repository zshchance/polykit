/**
 * 图片加载 —— 把用户选择的 File 解码为可绘制位图，供压缩/转换使用。
 *
 * 与 color-extractor/qr-code 的 image.ts 同源：
 *   - 全部浏览器本地完成（createImageBitmap），不上传，呼应「数据不出本地」
 *   - imageOrientation:'from-image' 让含 EXIF 方向标记的手机照片正确朝向
 *   - 这里不做降采样（原尺寸保留，是否缩放交给用户用「最长边」控件决定）
 *
 * 注意：ImageBitmap 在某些环境（如部分 Safari）createImageBitmap 对 HEIC 等格式
 * 可能失败；失败时抛错由 main.ts 友好提示。
 */

export interface LoadedImage {
  /** 解码后的位图（原尺寸） */
  bitmap: ImageBitmap;
  /** 原始图片的对象 URL，用于 UI 预览（用完需调用 revokeImage） */
  url: string;
  width: number;
  height: number;
  /** 文件字节数，用于显示原图大小 */
  bytes: number;
  /** 文件名（用于下载文件命名） */
  name: string;
}

/** 释放对象 URL，避免内存泄漏 */
export function revokeImage(img: LoadedImage): void {
  URL.revokeObjectURL(img.url);
  img.bitmap.close?.();
}

/**
 * 解码图片文件为位图。
 * @throws 若文件不是合法图片或解码失败
 */
export async function loadImage(file: File): Promise<LoadedImage> {
  if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif|bmp|avif|ico|svg)$/i.test(file.name)) {
    throw new Error('请选择图片文件');
  }

  const url = URL.createObjectURL(file);

  let bitmap: ImageBitmap;
  try {
    // imageOrientation 让带 EXIF 方向标记的图片（手机拍摄）自动正向显示
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('图片解码失败，请换一张试试（部分浏览器不支持 HEIC/AVIF）');
  }

  return {
    bitmap,
    url,
    width: bitmap.width,
    height: bitmap.height,
    bytes: file.size,
    name: file.name,
  };
}
