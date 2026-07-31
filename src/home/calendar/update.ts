import type { HolidaysData } from '@/core/types';
import { invalidateMergedCache, getHolidaysMeta } from './holidays';

/**
 * 可选的在线更新：仅在用户主动点击"检查更新"时触发，日常浏览零网络请求。
 *
 * 默认拉取同结构的 JSON（来自同站的策展文件 URL，隐私中性、无追踪、无第三方）。
 * 失败时静默回退本地数据，UI 提示"已是最新"或"检查失败，使用本地数据"。
 *
 * 缓存策略：写入 localStorage 带时间戳；版本更新才覆盖。
 */

/** 在线数据源 URL，可通过环境变量在构建期覆盖（Vite define）。默认指向同站策展文件。 */
const UPDATE_URL =
  (import.meta.env.VITE_HOLIDAYS_URL as string | undefined) ||
  new URL('./holidays.json', document.baseURI).href;

const UPDATE_KEY = 'static-toolkit-holidays';
const LAST_CHECK_KEY = 'static-toolkit-holidays-checked-at';

export type UpdateResult =
  | { ok: true; updated: boolean; version: string }
  | { ok: false; reason: string };

/**
 * 主动检查并应用在线更新。返回结构化结果供 UI 反馈。
 */
export async function checkForUpdates(): Promise<UpdateResult> {
  try {
    const res = await fetch(UPDATE_URL, { cache: 'no-store' });
    if (!res.ok) return { ok: false, reason: `网络错误（${res.status}）` };

    const remote = (await res.json()) as HolidaysData;
    if (!remote?.years) return { ok: false, reason: '数据格式无效' };

    const current = getHolidaysMeta().version;
    const updated = remote.version !== current;

    // 写入缓存（带时间戳）
    localStorage.setItem(UPDATE_KEY, JSON.stringify(remote));
    localStorage.setItem(LAST_CHECK_KEY, new Date().toISOString());

    // 失效合并缓存，让下次查询读到新数据
    invalidateMergedCache();

    return { ok: true, updated, version: remote.version };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : '未知错误' };
  }
}

/** 上次检查更新的时间（ISO 字符串），无则 null */
export function getLastCheckedAt(): string | null {
  return localStorage.getItem(LAST_CHECK_KEY);
}
