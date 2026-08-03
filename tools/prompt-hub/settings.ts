/**
 * AI 提示词灵感库 —— 检索态本地持久化（localStorage）。
 *
 * 只记"检索状态"（当前类目、选中的标签、搜索关键词），让用户下次打开能接续浏览。
 * **不记**用户在详情弹层里填写的变量值（保护隐私，且变量值往往是一次性的）。
 *
 * 与项目其它 settings 模块一致：版本化 JSON blob，逐字段校验，
 * 损坏/隐私模式静默回退默认。
 */

import { CATEGORY_IDS } from './types';
import { ALL_TAGS } from './data';

const STORAGE_KEY = 'prompt-hub:filter';
const CURRENT_VERSION = 1;
const MAX_TAGS = 10; // 防止异常数据塞一堆无效标签
const MAX_KEYWORD_LEN = 50;

export interface FilterState {
  /** 类目 id（'all' 或 CATEGORIES 之一） */
  category: string;
  /** 选中的标签（AND 过滤） */
  tags: string[];
  /** 搜索关键词 */
  keyword: string;
  /** 是否仅看「我的收藏」（星标）；独立于 category，可与类目/标签/关键词叠加 */
  starredOnly: boolean;
}

interface FilterBlob {
  version: number;
  category: string;
  tags: string[];
  keyword: string;
  starredOnly?: boolean; // 向后兼容：旧 blob 没有此字段，缺省当 false
}

export function defaultFilter(): FilterState {
  return { category: 'all', tags: [], keyword: '', starredOnly: false };
}

/** 读取检索态；损坏/字段非法时回退默认 */
export function loadFilter(): FilterState {
  const def = defaultFilter();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return def;
    const parsed = JSON.parse(raw) as Partial<FilterBlob>;
    if (!parsed || typeof parsed !== 'object') return def;

    const category =
      typeof parsed.category === 'string' && (CATEGORY_IDS as readonly string[]).includes(parsed.category)
        ? parsed.category
        : def.category;

    const tags = Array.isArray(parsed.tags)
      ? parsed.tags
          .filter((t) => typeof t === 'string' && (ALL_TAGS as readonly string[]).includes(t))
          .slice(0, MAX_TAGS)
      : [];

    const keyword =
      typeof parsed.keyword === 'string'
        ? parsed.keyword.slice(0, MAX_KEYWORD_LEN)
        : '';

    const starredOnly = parsed.starredOnly === true;

    return { category, tags, keyword, starredOnly };
  } catch {
    return def;
  }
}

/** 持久化检索态（隐私模式 / 配额满时静默忽略） */
export function saveFilter(state: FilterState): void {
  try {
    const blob: FilterBlob = { version: CURRENT_VERSION, ...state };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // 静默忽略
  }
}
