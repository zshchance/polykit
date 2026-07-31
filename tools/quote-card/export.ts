import { toPng } from 'html-to-image';
import { downloadBlob } from '@/core/utils/clipboard';

/**
 * 卡片导出：用 html-to-image 把 DOM 画板转为 PNG 并下载。
 *
 * pixelRatio: 2 → 1080×1080 画板导出为 2160×2160 高清图。
 * cacheBust: 避免缓存导致背景图/字体未及时更新。
 *
 * 导出前需临时移除画板的缩放变换（main.ts 为适配屏幕做了 scale），
 * 由调用方在导出按钮处处理：导出时给画板加 .exporting 类复位 transform，
 * 截图完成再移除。本函数专注截图本身。
 */

export type ExportResult = { ok: true } | { ok: false; reason: string };

export async function downloadCard(
  cardEl: HTMLElement,
  filename: string,
): Promise<ExportResult> {
  try {
    const dataUrl = await toPng(cardEl, {
      pixelRatio: 2,
      cacheBust: true,
      // 画板背景由模板内联设置，无需再设 backgroundColor
    });
    const blob = dataURLtoBlob(dataUrl);
    downloadBlob(blob, filename);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : '未知错误' };
  }
}

/** data:image/png;base64,... → Blob */
function dataURLtoBlob(dataUrl: string): Blob {
  const [meta, base64] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(meta)?.[1] ?? 'image/png';
  const bin = atob(base64 ?? '');
  const len = bin.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/**
 * 生成安全文件名：替换非法字符，限制长度。
 * @param quote 名言（取作者+正文片段）
 * @param ext 文件扩展名（含点，如 '.png' / '.webm'），默认 '.png'
 */
export function safeFilename(quote: { text: string; author: string }, ext = '.png'): string {
  const sanitize = (s: string) =>
    s.replace(/[\\/:*?"<>|\n\r]/g, '').replace(/\s+/g, '_').slice(0, 20);
  const name = `${sanitize(quote.author)}-${sanitize(quote.text)}`.slice(0, 40);
  return `名言_${name}${ext}`;
}
