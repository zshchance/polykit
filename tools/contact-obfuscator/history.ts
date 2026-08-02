/**
 * 历史记录持久化 —— 记住用户生成过的防检测字符，方便重新复制。
 *
 * 范式照搬 password-generator/history.ts：versioned blob + 脏数据过滤 +
 * 按业务值去重 + 置顶截断。所有数据仅在浏览器 localStorage，不上传。
 */

const STORAGE_KEY = 'contact-obfuscator:history';
const MAX_ITEMS = 30;
const CURRENT_VERSION = 1;

/** 一条历史记录 */
export interface StoredResult {
  /** crypto.randomUUID() 生成 */
  id: string;
  /** 原始输入 */
  input: string;
  /** 变换后的防检测文本 */
  output: string;
  /** 给人的示意说明 */
  note: string;
  /** 创建时间戳（ms） */
  createdAt: number;
}

interface HistoryBlob {
  version: number;
  items: StoredResult[];
}

/** 读取全部历史；存储损坏/为空时返回 [] */
export function loadHistory(): StoredResult[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<HistoryBlob>;
    if (!parsed || typeof parsed !== 'object') return [];
    const items = parsed.items;
    if (!Array.isArray(items)) return [];
    // 逐条校验：字段类型齐全才保留
    return items.filter(
      (it): it is StoredResult =>
        !!it &&
        typeof it?.id === 'string' &&
        typeof it?.input === 'string' &&
        typeof it?.output === 'string' &&
        typeof it?.note === 'string' &&
        typeof it?.createdAt === 'number',
    );
  } catch {
    return [];
  }
}

/** 持久化全部历史（隐私模式 / 配额满时静默忽略） */
function saveHistory(items: StoredResult[]): void {
  try {
    const blob: HistoryBlob = { version: CURRENT_VERSION, items };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // 容量满 / 隐私模式：静默忽略
  }
}

/**
 * 新增一条；按 input+output 去重（同原文同结果不重复存），置顶并截断到上限。
 * 返回更新后的完整列表供 UI 重渲染。
 */
export function addResult(entry: Omit<StoredResult, 'id' | 'createdAt'>): StoredResult[] {
  const items = loadHistory();
  // 按 input + output 组合去重
  const filtered = items.filter((it) => !(it.input === entry.input && it.output === entry.output));
  const record: StoredResult = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...entry,
  };
  const next = [record, ...filtered].slice(0, MAX_ITEMS);
  saveHistory(next);
  return next;
}

/** 删除一条；返回更新后的完整列表 */
export function removeResult(id: string): StoredResult[] {
  const next = loadHistory().filter((it) => it.id !== id);
  saveHistory(next);
  return next;
}

/** 清空全部历史 */
export function clearHistory(): void {
  saveHistory([]);
}

/** 历史上限（给 UI 显示用） */
export const HISTORY_MAX = MAX_ITEMS;
