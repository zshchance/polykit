import type { HolidaysData } from '@/core/types';
import { invalidateMergedCache, getHolidaysMeta, CACHE_KEY } from './holidays';

/**
 * 可选的在线更新：仅在用户主动点击"检查更新"时触发，日常浏览零网络请求。
 *
 * 默认拉取同结构的 JSON（来自同站的策展文件 URL，隐私中性、无追踪、无第三方）。
 * 失败时静默回退本地数据，UI 提示"已是最新"或"检查失败，使用本地数据"。
 *
 * 缓存策略：仅当远端版本确实更新（数值比较）才写入 localStorage；
 * 防止远端旧数据覆盖仓库内较新的策展数据（合并策略是 cache 覆盖 bundled）。
 */

/** 在线数据源 URL，可通过环境变量在构建期覆盖（Vite define）。默认指向同站策展文件。 */
const UPDATE_URL =
  (import.meta.env.VITE_HOLIDAYS_URL as string | undefined) ||
  new URL('./holidays.json', document.baseURI).href;

const LAST_CHECK_KEY = 'static-toolkit-holidays-checked-at';

export type UpdateResult =
  { ok: true; updated: boolean; version: string } | { ok: false; reason: string };

/** version 形如 "2026"（年份字符串）。解析为数值比较；无法解析按 0 处理 */
function versionNum(v: string): number {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

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
    // 字符串不等 ≠ 更新：远端若是旧年份，报告"已是最新"且不写缓存
    const updated = versionNum(remote.version) > versionNum(current);

    try {
      if (updated) {
        localStorage.setItem(CACHE_KEY, JSON.stringify(remote));
      }
      localStorage.setItem(LAST_CHECK_KEY, new Date().toISOString());
    } catch {
      return { ok: false, reason: '本地存储不可用或已满' };
    }

    // 失效合并缓存，让下次查询读到新数据
    if (updated) invalidateMergedCache();

    return { ok: true, updated, version: updated ? remote.version : current };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : '未知错误' };
  }
}

/** 上次检查更新的时间（ISO 字符串），无则 null */
export function getLastCheckedAt(): string | null {
  return localStorage.getItem(LAST_CHECK_KEY);
}
