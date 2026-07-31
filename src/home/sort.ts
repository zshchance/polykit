/**
 * 首页工具排序：把用户偏好（置顶 / 自定义顺序）叠加到 registry 策展顺序之上。
 *
 * 优先级（从高到低）：
 *   1. 置顶组在前：pinned 中的工具整体排在非置顶之前。
 *   2. 组内按用户自定义顺序（prefs.order）：越靠前越先。
 *   3. 未在 prefs.order 中的工具：按 registry 兜底（order 权重升序，再按 name）。
 *
 * 不含星标逻辑：星标只影响「只看星标」筛选（在 main.ts 的 filter 层处理），
 * 不参与排序，避免与「置顶/拖拽」两条规则产生冲突的排序心智。
 *
 * 实现为纯函数 + 稳定排序（同 key 保持原相对顺序），不修改入参数组。
 */

import type { RegisteredTool } from '@/core/types';
import type { HomePrefs } from './prefs';

/**
 * 把 tools 按 prefs 排序，返回新数组。
 *
 * @param tools 已经过搜索/分类/星标筛选的列表（相对顺序即 registry 顺序）
 * @param prefs 用户偏好
 */
export function sortTools(tools: RegisteredTool[], prefs: HomePrefs): RegisteredTool[] {
  // 自定义顺序索引：slug → 位置（越小越前）
  const orderIndex = new Map<string, number>();
  prefs.order.forEach((slug, i) => orderIndex.set(slug, i));
  const BIG = Number.MAX_SAFE_INTEGER;

  /** 单组内排序键：自定义顺序优先，其次 registry order，最后 name */
  const keyOf = (t: RegisteredTool): [number, number, string] => [
    orderIndex.has(t.slug) ? (orderIndex.get(t.slug) as number) : BIG,
    t.order,
    t.name,
  ];

  const pinnedSet = new Set(prefs.pinned);
  const pinned = tools.filter((t) => pinnedSet.has(t.slug));
  const normal = tools.filter((t) => !pinnedSet.has(t.slug));

  // 稳定排序：Array.prototype.sort 在各引擎已稳定，直接用
  pinned.sort((a, b) => cmp(keyOf(a), keyOf(b)));
  normal.sort((a, b) => cmp(keyOf(a), keyOf(b)));

  return [...pinned, ...normal];
}

/** 元组字典序比较 */
function cmp(a: [number, number, string], b: [number, number, string]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2].localeCompare(b[2], 'zh-Hans-CN');
}
