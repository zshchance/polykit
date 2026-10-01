/**
 * 会话记忆 —— 刷新/重开不丢稿、回到上次浏览位置。
 *
 * 把当前文档内容、文件名、视图模式与三条滚动带的滚动位置写入 localStorage
 * （防抖由调用方控制），下次进入工具时直接恢复到编辑现场，
 * 避免「刷新后内容被清空 / 回到文档顶部」。
 * 遵循全站存储约定：键名 `<slug>:<purpose>`，blob 带 version。
 */
import { readJSON, writeJSON, removeKey } from '@/core/utils/storage';

const STORAGE_KEY = 'markdown-editor:session';

export type ViewMode = 'split' | 'editor' | 'read';

/** 三条滚动带：页面级（页眉/页脚过渡带）、预览区、编辑区 */
export interface ScrollState {
  page: number;
  preview: number;
  editor: number;
}

export const ZERO_SCROLL: ScrollState = { page: 0, preview: 0, editor: 0 };

export interface EditorSession {
  doc: string;
  name: string;
  mode: ViewMode;
  /** 内容大纲面板是否展开（缺省收起） */
  outline: boolean;
  /** 上次浏览位置（缺省顶部） */
  scroll: ScrollState;
  savedAt: number;
}

const MODES: readonly ViewMode[] = ['split', 'editor', 'read'];

/** 单个滚动分量规整：非有限数或负数按 0 处理 */
function normScrollValue(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
}

/** 规整滚动状态（纯函数，供单测）；字段缺失/非法逐分量回落 0 */
export function normalizeScroll(raw: unknown): ScrollState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...ZERO_SCROLL };
  const blob = raw as Record<string, unknown>;
  return {
    page: normScrollValue(blob.page),
    preview: normScrollValue(blob.preview),
    editor: normScrollValue(blob.editor),
  };
}

/**
 * 校验并规整会话数据（纯函数，供单测）。
 * 任何字段非法都整体作废，返回 null 由调用方落回欢迎页。
 */
export function parseSessionBlob(raw: unknown): EditorSession | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const blob = raw as Record<string, unknown>;
  if (blob.version !== 1) return null;
  if (typeof blob.doc !== 'string' || typeof blob.name !== 'string') return null;
  if (typeof blob.savedAt !== 'number' || !Number.isFinite(blob.savedAt)) return null;
  const mode = MODES.includes(blob.mode as ViewMode) ? (blob.mode as ViewMode) : 'split';
  const name = blob.name.trim() || '未命名.md';
  const outline = blob.outline === true;
  return {
    doc: blob.doc,
    name,
    mode,
    outline,
    scroll: normalizeScroll(blob.scroll),
    savedAt: blob.savedAt,
  };
}

/**
 * 会话是否值得恢复：空文档且从未命名 → 视为「没有现场」，直接进欢迎页。
 * （「新建空白文档后立刻刷新」的场景也应回到欢迎页，而不是一间空房间。）
 */
export function isWorthRestoring(session: EditorSession): boolean {
  return session.doc.trim().length > 0 || session.name !== '未命名.md';
}

/** 读取上次会话；无有效会话返回 null */
export function loadSession(): EditorSession | null {
  const raw = readJSON(STORAGE_KEY);
  if (!raw) return null;
  const session = parseSessionBlob(raw);
  return session && isWorthRestoring(session) ? session : null;
}

/** 写入当前会话；存储不可用（隐私模式等）时静默返回 false */
export function saveSession(
  doc: string,
  name: string,
  mode: ViewMode,
  outline: boolean,
  scroll: ScrollState,
): boolean {
  return writeJSON(STORAGE_KEY, {
    version: 1,
    doc,
    name,
    mode,
    outline,
    scroll,
    savedAt: Date.now(),
  });
}

/** 清除会话（关闭文档/放弃现场时），下次进入回到欢迎页 */
export function clearSession(): void {
  removeKey(STORAGE_KEY);
}
