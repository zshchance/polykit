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
 * 把 ImageBitmap 编码成 dataURL（长边压缩到 maxSide）。
 * - **透明度感知**：若图含 alpha<255 的像素（如透明背景 PNG Logo），用 PNG 编码
 *   保住透明通道；否则用 JPEG（0.85）省体积。JPEG 不支持透明，会把透明像素填成黑，
 *   导致透明 PNG Logo 存盘后背景变黑，所以必须按需切换格式。
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
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);

    // 检测是否含透明像素：抽样扫描 alpha 通道（抽样而非全扫，兼顾速度）。
    // 抽样步长按图大小自适应，保证大图也不会扫太久。
    const data = ctx.getImageData(0, 0, w, h).data;
    const step = Math.max(4, Math.floor((w * h) / 10000)) * 4; // 约采样 ≤1万像素
    let hasAlpha = false;
    for (let i = 3; i < data.length; i += step) {
      if (data[i]! < 255) {
        hasAlpha = true;
        break;
      }
    }

    // 含透明 → PNG（保 alpha）；纯不透明 → JPEG（更小）
    return hasAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
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
