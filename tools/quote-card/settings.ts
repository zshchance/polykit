/**
 * 名言卡片草稿 —— 本地持久化（localStorage）。
 *
 * 记住用户最后输入的名言内容/落款/出处与所选模板，下次打开页面时自动还原，
 * 免去重复输入。仅存「当前编辑中的草稿」，不与 history.ts（用户主动保存的名言）混用。
 *
 * 设计与 history.ts 一致：带 version 的 JSON blob，损坏/隐私模式时安全回退默认值。
 *
 * 存储形态（JSON）：
 *   { "version": 1, "draft": { "text": string, "author": string, "source"?: string, "templateId": string } }
 */

const STORAGE_KEY = 'quote-card:draft';
const CURRENT_VERSION = 1;

/** 草稿（可被还原的编辑态） */
export interface QuoteDraft {
  text: string;
  author: string;
  source?: string;
  templateId: string;
}

interface DraftBlob {
  version: number;
  draft: QuoteDraft;
}

/** 读取草稿；存储损坏/为空/字段非法时返回 null（调用方用默认值） */
export function loadDraft(): QuoteDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftBlob>;
    if (!parsed || typeof parsed !== 'object') return null;
    const d = parsed.draft;
    if (!d || typeof d !== 'object') return null;
    // 逐字段校验：text/author/templateId 必须是非空字符串，source 可选字符串
    if (typeof d.text !== 'string' || typeof d.author !== 'string' || typeof d.templateId !== 'string') return null;
    if (d.text.length === 0 && d.author.length === 0) return null; // 全空视为无草稿
    const source = typeof d.source === 'string' ? d.source : undefined;
    return { text: d.text, author: d.author, source, templateId: d.templateId };
  } catch {
    return null;
  }
}

/** 持久化草稿（隐私模式 / 配额满时静默忽略） */
export function saveDraft(draft: QuoteDraft): void {
  try {
    const blob: DraftBlob = { version: CURRENT_VERSION, draft };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // 容量满 / 隐私模式禁用 localStorage：静默忽略，不影响功能
  }
}

/** 清除草稿（恢复默认） */
export function clearDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 静默忽略
  }
}
