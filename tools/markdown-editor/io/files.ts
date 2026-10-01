/**
 * 文件打开/保存：File System Access API（Chromium）优先，传统 input/download 降级，
 * 保证 Safari/Firefox 场景依然可用。
 */

export interface OpenedFile {
  name: string;
  text: string;
  handle: FileSystemFileHandle | null;
}

export function supportsFsAccess(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}

const MARKDOWN_TYPES = [
  {
    description: 'Markdown 文档',
    accept: { 'text/markdown': ['.md', '.markdown', '.mdown'] },
  },
];

/** 可拖拽/选择打开的扩展名（用于过滤与非破坏性忽略） */
export const OPENABLE_EXTS = ['.md', '.markdown', '.mdown', '.txt'];

/** 上限 10MB：防御性拒绝超大文件（纯文本场景绰绰有余） */
export const MAX_OPEN_BYTES = 10 * 1024 * 1024;

export function isOpenableName(name: string): boolean {
  const lower = name.toLowerCase();
  return OPENABLE_EXTS.some((ext) => lower.endsWith(ext));
}

/** 经隐藏 input 打开文件（通用降级路径） */
function openViaInput(): Promise<OpenedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.mdown,.txt,text/markdown,text/plain';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      resolve({ name: file.name, text: await file.text(), handle: null });
    });
    // 用户取消：focus 回到页面时清理
    window.addEventListener('focus', () => setTimeout(() => input.remove(), 500), { once: true });
    input.click();
  });
}

/** 打开 Markdown 文件：优先系统文件选择器（FS Access），降级 input */
export async function openMarkdownFile(): Promise<OpenedFile | null> {
  if (supportsFsAccess()) {
    try {
      const [handle] = await window.showOpenFilePicker!({ types: MARKDOWN_TYPES, multiple: false });
      const file = (await handle.getFile()) as File;
      return { name: file.name, text: await file.text(), handle };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null; // 用户取消
      // 其他异常（如权限限制）走降级
    }
  }
  return openViaInput();
}

/** 触发浏览器下载（降级保存路径） */
export function downloadText(filename: string, text: string, mime = 'text/html'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const SAVE_TYPES = [{ description: 'Markdown 文档', accept: { 'text/markdown': ['.md'] } }];

export interface SaveResult {
  name: string;
  via: 'handle' | 'download';
  /** 保存到真实文件时返回句柄（后续 Ctrl/Cmd+S 可直接写入） */
  handle?: FileSystemFileHandle;
}

/** 保存到已打开的文件句柄；无句柄时另存为 */
export async function saveMarkdownFile(
  handle: FileSystemFileHandle | null,
  text: string,
  fallbackName = '未命名.md',
): Promise<SaveResult | null> {
  if (handle) {
    const writable = await handle.createWritable();
    await writable.write(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    await writable.close();
    return { name: handle.name, via: 'handle', handle };
  }
  return saveMarkdownAs(text, fallbackName);
}

/** 另存为：优先系统保存对话框，降级为下载 */
export async function saveMarkdownAs(
  text: string,
  suggestedName = '未命名.md',
): Promise<SaveResult | null> {
  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker!({ suggestedName, types: SAVE_TYPES });
      const writable = await handle.createWritable();
      await writable.write(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
      await writable.close();
      return { name: handle.name, via: 'handle', handle };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
    }
  }
  downloadText(suggestedName, text, 'text/markdown');
  return { name: suggestedName, via: 'download' };
}

export interface DropRejection {
  ok: false;
  reason: 'too-large' | 'not-markdown' | 'no-file';
}

/**
 * 在元素上启用拖拽打开 Markdown 文件。
 * 只接受 .md/.markdown/.mdown/.txt，超大文件与非 Markdown 文件回调 rejection，
 * 由调用方给出轻量提示（不弹窗）。
 */
export function enableDragOpen(
  target: HTMLElement,
  onOpen: (file: OpenedFile) => void,
  onReject?: (r: DropRejection) => void,
): void {
  target.addEventListener('dragover', (e) => {
    e.preventDefault();
    target.classList.add('drag-over');
  });
  target.addEventListener('dragleave', () => target.classList.remove('drag-over'));
  target.addEventListener('drop', async (e) => {
    e.preventDefault();
    target.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (!file) return void onReject?.({ ok: false, reason: 'no-file' });
    if (file.size > MAX_OPEN_BYTES) return void onReject?.({ ok: false, reason: 'too-large' });
    if (!isOpenableName(file.name)) return void onReject?.({ ok: false, reason: 'not-markdown' });
    onOpen({ name: file.name, text: await file.text(), handle: null });
  });
}
