/**
 * 密码历史记录 —— 本地持久化（localStorage）。
 *
 * 设计：所有数据只存于用户浏览器，不上传、不联网，呼应全站"数据不出本地"。
 * 容量上限 50 条，新条目置顶，按值去重（同一密码重复生成只保留最新一条）。
 *
 * 存储形态（JSON）：
 *   { "version": 1, "items": StoredPassword[] }
 * 顶层带 version 便于日后字段变更时做迁移。
 */

const STORAGE_KEY = 'password-generator:history';
const MAX_ITEMS = 50;

/** 单条历史记录 */
export interface StoredPassword {
  /** 唯一 id，crypto.randomUUID() 生成，作为删除定位 */
  id: string;
  /** 密码明文 */
  value: string;
  /** 长度 */
  length: number;
  /** 生成时间戳（ms） */
  createdAt: number;
  /** 估算熵（位），便于在历史里展示强度提示 */
  strengthBits: number;
}

interface HistoryBlob {
  version: number;
  items: StoredPassword[];
}

/** 读取全部历史；存储损坏或为空时安全回退为空数组 */
export function loadHistory(): StoredPassword[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<HistoryBlob>;
    if (!parsed || !Array.isArray(parsed.items)) return [];
    // 只保留合法字段，过滤脏数据
    return parsed.items.filter(
      (it): it is StoredPassword =>
        typeof it?.id === 'string' &&
        typeof it?.value === 'string' &&
        typeof it?.length === 'number' &&
        typeof it?.createdAt === 'number',
    );
  } catch {
    return [];
  }
}

/** 持久化全部历史 */
export function saveHistory(items: StoredPassword[]): void {
  try {
    const blob: HistoryBlob = { version: 1, items };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // 容量满 / 隐私模式禁用 localStorage：静默忽略，不影响功能
  }
}

/**
 * 新增一条。按 value 去重（已存在则移到最前并刷新元数据），
 * 总数超过上限时截断尾部。返回更新后的列表。
 */
export function addPassword(entry: Omit<StoredPassword, 'id' | 'createdAt'>): StoredPassword[] {
  const items = loadHistory();
  const filtered = items.filter((it) => it.value !== entry.value);
  const record: StoredPassword = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...entry,
  };
  const next = [record, ...filtered].slice(0, MAX_ITEMS);
  saveHistory(next);
  return next;
}

/** 删除指定 id 的一条。返回更新后的列表。 */
export function removePassword(id: string): StoredPassword[] {
  const next = loadHistory().filter((it) => it.id !== id);
  saveHistory(next);
  return next;
}

/** 清空全部历史 */
export function clearHistory(): void {
  saveHistory([]);
}

export const HISTORY_MAX = MAX_ITEMS;
