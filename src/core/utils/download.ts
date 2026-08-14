/**
 * 下载/导出共享工具 —— 文件名清洗与 dataURL 转换。
 *
 * 此前 quote-card / ascii-art / qr-code 的 export.ts 各自复制这两段逻辑
 * （video-export.ts 里还有第四份内联），收敛到这一份。
 */

import { downloadBlob } from './clipboard';

export { downloadBlob };

/**
 * 清洗字符串为文件系统安全片段：
 * 去掉路径非法字符与换行，空白转下划线，按需截断。
 */
export function sanitizeFilePart(s: string, maxLen = 30): string {
  return s
    .replace(/[\\/:*?"<>|\n\r]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, maxLen);
}

/** data:image/...;base64,... → Blob */
export function dataURLtoBlob(dataUrl: string): Blob {
  const [meta, base64] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(meta ?? '')?.[1] ?? 'image/png';
  const bin = atob(base64 ?? '');
  const len = bin.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
