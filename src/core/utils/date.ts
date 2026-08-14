/**
 * 日期格式化 —— 全站统一的本地时区格式化。
 * 此前 calendar/holidays/prefs 各自手写拼零实现，收敛到这一份。
 */

/** Date → 'YYYY-MM-DD'（本地时区） */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Date → 'YYYYMMDD'（紧凑版，用于文件名） */
export function toDateCompact(d: Date): string {
  return toDateKey(d).replaceAll('-', '');
}
