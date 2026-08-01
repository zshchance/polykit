/**
 * 图片编码 —— 把位图按指定格式/画质/最长边渲染并编码为 Blob。
 *
 * 走原生 canvas.toBlob：
 *   - JPEG / WebP：第三参为画质 0-1（有损压缩）
 *   - PNG：无损，画质参数被忽略
 *   - ICO：不在本模块处理（见 ico.ts，需多尺寸拼装）
 *
 * JPEG 不支持透明通道，遇到透明图（PNG/WebP 含 alpha）时先在白底上绘制，
 * 避免透明区被填成显眼的纯黑。
 *
 * 全部原生 API，零新增依赖。
 */

import type { OutputFormat } from './types';

export interface ConvertOptions {
  format: OutputFormat;
  /** 画质 1-100（仅 JPEG/WebP 生效） */
  quality: number;
  /** 最长边像素上限，0 表示不缩放 */
  maxLongEdge: number;
}

export interface ConvertResult {
  blob: Blob;
  width: number;
  height: number;
}

/** 各格式对应的 MIME */
const MIME: Record<Exclude<OutputFormat, 'ico'>, string> = {
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  png: 'image/png',
};

/** 计算按最长边缩放后的目标尺寸（不放大） */
export function scaledSize(srcW: number, srcH: number, maxLongEdge: number): { w: number; h: number } {
  if (!maxLongEdge || maxLongEdge <= 0) return { w: srcW, h: srcH };
  const longest = Math.max(srcW, srcH);
  if (longest <= maxLongEdge) return { w: srcW, h: srcH };
  const scale = maxLongEdge / longest;
  return { w: Math.max(1, Math.round(srcW * scale)), h: Math.max(1, Math.round(srcH * scale)) };
}

/**
 * 把位图绘制到 canvas 并按目标尺寸缩放。
 * 抽出便于 ico.ts 复用同一段「最长边缩放」逻辑。
 */
export function drawToCanvas(
  bitmap: ImageBitmap | ImageData,
  w: number,
  h: number,
  fillBackground: string | null = null,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('当前环境不支持 2D 画布');
  if (fillBackground) {
    ctx.fillStyle = fillBackground;
    ctx.fillRect(0, 0, w, h);
  }
  // ImageBitmap 与 ImageData 都能被 drawImage / putImageData 接受；
  // 这里统一用 drawImage（位图场景），ImageData 场景请另行 putImageData。
  ctx.drawImage(bitmap as ImageBitmap, 0, 0, w, h);
  return canvas;
}

/** canvas.toBlob 的 Promise 化包装 */
function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('编码失败（当前浏览器可能不支持该格式）'));
      },
      mime,
      quality,
    );
  });
}

/**
 * 把位图转换为指定格式 Blob（非 ICO）。
 * 若 format==='ico'，请改用 ico.ts 的 encodeIco。
 * @throws 不支持的格式 / 编码失败
 */
export async function convertToBlob(
  bitmap: ImageBitmap,
  opts: ConvertOptions,
): Promise<ConvertResult> {
  const { format, quality, maxLongEdge } = opts;
  if (format === 'ico') {
    throw new Error("ICO 请使用 ico.ts 的 encodeIco，不要调用 convertToBlob(format='ico')");
  }

  const { w, h } = scaledSize(bitmap.width, bitmap.height, maxLongEdge);
  // JPEG 不支持透明：透明区需填底（白），否则会变成黑色
  const fill = format === 'jpeg' ? '#ffffff' : null;
  const canvas = drawToCanvas(bitmap, w, h, fill);

  const mime = MIME[format];
  const q = format === 'png' ? undefined : Math.max(0.01, Math.min(1, quality / 100));
  const blob = await canvasToBlob(canvas, mime, q);
  return { blob, width: w, height: h };
}
