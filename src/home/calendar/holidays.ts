import type { DayInfo, HolidaysData } from '@/core/types';
// Vite 原生支持 JSON 导入；tsconfig 已开启 resolveJsonModule。
import bundledHolidays from './holidays.json';

/**
 * 节假日数据层。
 *
 * 三级数据来源（按优先级合并，后者覆盖前者）：
 *   1. bundled：打包进仓库的 holidays.json（权威公告策展，离线可用）
 *   2. cache  ：localStorage 里"在线更新"写入的较新版本（仅当版本更新）
 *
 * 合并策略：cache 的年份覆盖 bundled 的同年份；bundled 独有的年份保留。
 * 这样在线更新只补充/修正数据，不会因接口缺失而丢失已有假日。
 */

const CACHE_KEY = 'static-toolkit-holidays';

/** 读取并校验缓存数据；非法时返回 null */
function readCache(): HolidaysData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HolidaysData;
    if (!parsed || typeof parsed !== 'object' || !parsed.years) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 当前生效的合并数据（懒加载，模块级单例） */
let merged: HolidaysData | null = null;

function loadMerged(): HolidaysData {
  if (merged) return merged;
  const cache = readCache();
  if (!cache) {
    merged = bundledHolidays as HolidaysData;
    return merged;
  }
  // 合并：cache 的年份覆盖 bundled 同名年份
  merged = {
    ...bundledHolidays,
    ...cache,
    years: { ...(bundledHolidays as HolidaysData).years, ...cache.years },
  };
  return merged;
}

/** YYYY-MM-DD */
function fmtKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 查询某一天的信息。
 * 返回的 DayInfo 已考虑调休：法定 workday（补班）优先级高于自然周末判定。
 */
export function getDayInfo(date: Date): DayInfo | null {
  const data = loadMerged();
  const year = String(date.getFullYear());
  const yearMap = data.years[year];
  if (!yearMap) return null;
  const key = fmtKey(date);
  const info = yearMap[key];
  if (info) return info;

  // 无显式记录时，不额外推断（不把普通周末标为假日，避免误判）
  return null;
}

/** 当前生效数据的版本/来源/更新时间（用于 UI 展示溯源信息） */
export function getHolidaysMeta(): {
  version: string;
  source: string;
  updatedAt: string;
} {
  const data = loadMerged();
  return {
    version: data.version,
    source: data.source,
    updatedAt: data.updatedAt,
  };
}

/** 供 update.ts 写入缓存后失效合并缓存（下次查询重新合并） */
export function invalidateMergedCache(): void {
  merged = null;
}

export { CACHE_KEY };
