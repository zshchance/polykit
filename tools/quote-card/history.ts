/**
 * 用户手动保存的名言历史 —— 本地持久化（localStorage）。
 *
 * 与内置策展名言库（quotes.json）的区别：这里只存用户"手动保存"的内容，
 * 即用户在输入框编辑后主动点"保存到我的名言"产生的记录（搜索/随机结果不自动入库，
 * 除非用户基于它编辑后显式保存）。
 *
 * 设计：所有数据只存于用户浏览器，不上传、不联网，呼应全站"数据不出本地"。
 * 容量上限 50 条，新条目置顶，按 text+author 去重（同一条重复保存只保留最新）。
 *
 * 存储形态（JSON）：
 *   { "version": 1, "items": StoredQuote[] }
 */

const STORAGE_KEY = 'quote-card:history';
const MAX_ITEMS = 50;

/** 单条用户保存的名言 */
export interface StoredQuote {
  /** 唯一 id，crypto.randomUUID() 生成，作为删除/加载定位 */
  id: string;
  /** 名言正文 */
  text: string;
  /** 落款（作者 / 名字） */
  author: string;
  /** 出处（选填） */
  source?: string;
  /** 保存时间戳（ms） */
  createdAt: number;
}

interface HistoryBlob {
  version: number;
  items: StoredQuote[];
}

/** 读取全部历史；存储损坏或为空时安全回退为空数组 */
export function loadHistory(): StoredQuote[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<HistoryBlob>;
    if (!parsed || !Array.isArray(parsed.items)) return [];
    // 只保留合法字段，过滤脏数据
    return parsed.items.filter(
      (it): it is StoredQuote =>
        typeof it?.id === 'string' &&
        typeof it?.text === 'string' &&
        typeof it?.author === 'string' &&
        typeof it?.createdAt === 'number',
    );
  } catch {
    return [];
  }
}

/** 持久化全部历史 */
export function saveHistory(items: StoredQuote[]): void {
  try {
    const blob: HistoryBlob = { version: 1, items };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // 容量满 / 隐私模式禁用 localStorage：静默忽略，不影响功能
  }
}

/**
 * 新增一条。按 text+author 去重（已存在则移到最前并刷新元数据），
 * 总数超过上限时截断尾部。返回更新后的列表。
 */
export function addQuote(entry: Omit<StoredQuote, 'id' | 'createdAt'>): StoredQuote[] {
  const items = loadHistory();
  const filtered = items.filter(
    (it) => !(it.text === entry.text && it.author === entry.author),
  );
  const record: StoredQuote = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...entry,
  };
  const next = [record, ...filtered].slice(0, MAX_ITEMS);
  saveHistory(next);
  return next;
}

/** 删除指定 id 的一条。返回更新后的列表。 */
export function removeQuote(id: string): StoredQuote[] {
  const next = loadHistory().filter((it) => it.id !== id);
  saveHistory(next);
  return next;
}

/** 清空全部历史 */
export function clearHistory(): void {
  saveHistory([]);
}

export const HISTORY_MAX = MAX_ITEMS;
