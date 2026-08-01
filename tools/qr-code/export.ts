/**
 * 二维码导出 —— canvas 转 PNG 下载 + 复制到剪贴板。
 *
 * 复用全站 downloadBlob 工具。SVG 导出暂不做：圆点/圆角眼在 SVG 里需逐元素路径，
 * 收益有限且容易和 canvas 渲染不一致；PNG（高清 1024）已满足所有实际用途。
 */

import { downloadBlob } from '@/core/utils/clipboard';

/** 下载 canvas 为 PNG */
export function downloadCanvasPng(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, filename);
  }, 'image/png');
}

/**
 * 复制 canvas 到剪贴板（需要支持 ClipboardItem 的浏览器，且需安全上下文）。
 * @returns 是否成功
 */
export async function copyCanvasToClipboard(canvas: HTMLCanvasElement): Promise<boolean> {
  try {
    if (!navigator.clipboard || !('ClipboardItem' in window) || !window.isSecureContext) {
      return false;
    }
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), 'image/png');
    });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

/** 安全文件名：内容截断 + 加 .png */
export function safeFilename(text: string): string {
  const base = text.trim().slice(0, 20).replace(/[\\/:*?"<>|]+/g, '_') || 'qrcode';
  return `${base}.png`;
}
