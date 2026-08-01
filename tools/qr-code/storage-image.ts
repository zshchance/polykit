/**
 * 图片 ↔ dataURL 工具 —— 用于把用户上传的 Logo / 识别原图持久化到 localStorage。
 *
 * ImageBitmap / File 不可序列化，必须转成 base64 dataURL 才能存进 localStorage。
 * 为避免高分辨率照片撑爆 ~5MB 上限，统一压缩到长边 ≤ maxSide 再编码。
 *
 * 全部原生 API（canvas.toDataURL / fetch / createImageBitmap），零新增依赖。
 */

/** 默认压缩上限：长边超过此值则等比缩小 */
const DEFAULT_MAX_SIDE = 800;

/**
 * 把 ImageBitmap 编码成 dataURL（JPEG，长边压缩到 maxSide）。
 * - JPEG 而非 PNG：照片类图体积小一个数量级（PNG 存照片反而更大）。
 * - quality 0.85：肉眼几乎无差，体积约为 0.92 的 60-70%。
 * @returns dataURL 字符串；失败返回 null（不阻塞功能）
 */
export async function bitmapToDataUrl(
  bitmap: ImageBitmap,
  maxSide = DEFAULT_MAX_SIDE,
): Promise<string | null> {
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    // 大图 / 跨域 / canvas 被污染等：静默失败
    return null;
  }
}

/**
 * 把 dataURL 还原成可绘制的 ImageBitmap。
 * 用 fetch(dataUrl) → blob → createImageBitmap，比 Image 元素更直接、支持离屏。
 * @returns ImageBitmap；失败返回 null
 */
export async function dataUrlToBitmap(dataUrl: string): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}
