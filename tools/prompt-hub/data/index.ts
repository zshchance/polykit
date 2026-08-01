/**
 * 提示词库聚合层 —— 把各类目数据文件合并导出，并派生标签统计。
 *
 * 新增类目时：在 data/categories/ 下新建文件 → 在此处 import 并并入 ALL_PROMPTS。
 * main.ts / settings.ts 只依赖这里的聚合结果，不直接读各类目文件。
 */

import type { Prompt } from '../types';
import { WRITING_PROMPTS } from './categories/writing';
import { DESIGN_PROMPTS } from './categories/design';
import { FUN_PROMPTS } from './categories/fun';
import { PRODUCTIVITY_PROMPTS } from './categories/productivity';

/** 全部提示词（类目顺序：写作 → 绘画设计 → 效率学习 → 趣味彩蛋） */
export const ALL_PROMPTS: Prompt[] = [
  ...WRITING_PROMPTS,
  ...DESIGN_PROMPTS,
  ...PRODUCTIVITY_PROMPTS,
  ...FUN_PROMPTS,
];

/** 校验 id 全局唯一（开发期排错用；运行时忽略） */
function assertUniqueIds(): void {
  const seen = new Set<string>();
  for (const p of ALL_PROMPTS) {
    if (seen.has(p.id)) {
      // 不抛错，只警告，避免阻断渲染
      console.warn(`[prompt-hub] 重复的 prompt id: ${p.id}`);
    }
    seen.add(p.id);
  }
}
assertUniqueIds();

/** 标签 → 出现次数（按频次降序，用于"热门标签"胶囊） */
export interface TagCount {
  tag: string;
  count: number;
}

/** 统计所有标签的出现频次，按频次降序返回 */
export function allTagCounts(): TagCount[] {
  const map = new Map<string, number>();
  for (const p of ALL_PROMPTS) {
    for (const t of p.tags) {
      map.set(t, (map.get(t) ?? 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hans-CN'));
}

/** 全部标签集合（去重），用于 settings 校验 */
export const ALL_TAGS: readonly string[] = allTagCounts().map((t) => t.tag);

/** 热门标签 top N（默认 10，用于标签胶囊展示） */
export function topTags(n = 10): string[] {
  return allTagCounts()
    .slice(0, n)
    .map((t) => t.tag);
}

/** 按 id 取提示词 */
export function getPromptById(id: string): Prompt | undefined {
  return ALL_PROMPTS.find((p) => p.id === id);
}

/** 全部彩蛋（fun=true），用于"随机一个" */
export const FUN_PROMPTS_ONLY: Prompt[] = ALL_PROMPTS.filter((p) => p.fun);

/** 今日推荐：固定的精选 id 列表（人工挑选有代表性的） */
const FEATURED_IDS = ['xhs-zhongcao', 'ghibli-transform', 'explain-like-five', 'resume-wuxia'];
export const FEATURED_PROMPTS: Prompt[] = FEATURED_IDS
  .map((id) => getPromptById(id))
  .filter((p): p is Prompt => !!p);
