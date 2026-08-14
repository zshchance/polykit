/**
 * AI 提示词灵感库 —— 星标 / 置顶本地持久化（localStorage）。
 *
 * 星标⭐ = 收藏标记（"我的收藏"胶囊筛选它）；置顶📌 = 排序（钉在列表最前）。
 * 两个功能相互独立：一条提示词可以只星标、只置顶、两者都要、或都不要。
 *
 * 与项目其它 settings 模块一致：版本化 JSON blob，逐字段校验，
 * 读写经 core/utils/storage 统一容错，损坏/隐私模式静默回退默认。
 * 只存 prompt id（kebab-case 字符串），不存任何用户输入内容（隐私）。
 */

import { readJSON, writeJSON } from '@/core/utils/storage';

import { getPromptById } from './data';

const STORAGE_KEY = 'prompt-hub:favorites';
const CURRENT_VERSION = 1;
const MAX_PER_LIST = 100; // 防止异常数据塞一堆无效 id

export interface FavoritesState {
  /** 已星标的 prompt id */
  starred: string[];
  /** 已置顶的 prompt id */
  pinned: string[];
}

interface FavoritesBlob {
  version: number;
  starred: string[];
  pinned: string[];
}

export function defaultFavorites(): FavoritesState {
  return { starred: [], pinned: [] };
}

/** 读取收藏/置顶；损坏/字段非法时回退默认 */
export function loadFavorites(): FavoritesState {
  const def = defaultFavorites();
  const parsed = readJSON(STORAGE_KEY) as Partial<FavoritesBlob> | null;
  if (!parsed) return def;

  const sanitize = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? arr
          .filter((id): id is string => typeof id === 'string' && !!getPromptById(id))
          // 去重，保持首次出现顺序
          .filter((id, i, self) => self.indexOf(id) === i)
          .slice(0, MAX_PER_LIST)
      : [];

  return {
    starred: sanitize(parsed.starred),
    pinned: sanitize(parsed.pinned),
  };
}

/** 持久化收藏/置顶（隐私模式 / 配额满时静默忽略） */
export function saveFavorites(state: FavoritesState): void {
  const blob: FavoritesBlob = { version: CURRENT_VERSION, ...state };
  writeJSON(STORAGE_KEY, blob);
}
