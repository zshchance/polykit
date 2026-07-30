/** 剪贴板与文件下载辅助 */

/**
 * 复制文本到剪贴板。优先用现代 Clipboard API，失败时回退到 execCommand。
 * 返回是否成功，调用方据此切换按钮文案（如 "已复制 ✓"）。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 回退到下方传统方案
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 触发浏览器下载一个 Blob。
 * 用于"导出图片/导出文本文件"类功能。
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延迟释放，避免某些浏览器下载未开始就 revoke
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 下载文本内容为文件 */
export function downloadText(text: string, filename: string, mime = 'text/plain'): void {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}
