/**
 * 乐器百科 —— 检索态本地持久化（localStorage）。
 *
 * 只记"浏览状态"：五个维度各自的选中值、搜索关键词、筛选面板开合。
 * 与项目其它 settings 模块一致：版本化 JSON blob，逐字段校验，
 * 读写经 core/utils/storage 统一容错，损坏/隐私模式静默回退默认。
 */

import { readJSON, writeJSON } from '@/core/utils/storage';
import { FACETS, type FacetKey } from './types';

const STORAGE_KEY = 'instrument-atlas:filter';
const CURRENT_VERSION = 1;
const MAX_KEYWORD_LEN = 50;

export type FacetSelections = Record<FacetKey, string | null>;

export interface FilterState {
  /** 每个维度选中的值（null = 不限） */
  sel: FacetSelections;
  keyword: string;
  /** 筛选面板是否展开 */
  panelOpen: boolean;
}

interface FilterBlob {
  version: number;
  sel: Record<string, string | null>;
  keyword: string;
  panelOpen: boolean;
}

const FACET_VALUES = new Map(FACETS.map((f) => [f.key, f.values] as const));

export function defaultFilter(): FilterState {
  return {
    sel: { family: null, range: null, moods: null, genres: null, roles: null },
    keyword: '',
    panelOpen: true,
  };
}

/** 读取检索态；损坏/字段非法时回退默认 */
export function loadFilter(): FilterState {
  const def = defaultFilter();
  const parsed = readJSON(STORAGE_KEY) as Partial<FilterBlob> | null;
  if (!parsed) return def;

  const sel: FacetSelections = { ...def.sel };
  if (parsed.sel && typeof parsed.sel === 'object') {
    for (const [key, allowed] of FACET_VALUES) {
      const v = (parsed.sel as Record<string, unknown>)[key];
      sel[key] = typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v : null;
    }
  }

  const keyword =
    typeof parsed.keyword === 'string' ? parsed.keyword.slice(0, MAX_KEYWORD_LEN) : def.keyword;
  const panelOpen = typeof parsed.panelOpen === 'boolean' ? parsed.panelOpen : def.panelOpen;

  return { sel, keyword, panelOpen };
}

/** 持久化检索态（隐私模式 / 配额满时静默忽略） */
export function saveFilter(state: FilterState): void {
  const blob: FilterBlob = { version: CURRENT_VERSION, ...state };
  writeJSON(STORAGE_KEY, blob);
}
