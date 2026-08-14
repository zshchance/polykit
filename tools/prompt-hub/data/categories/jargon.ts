/**
 * 黑话翻译类目聚合 —— 拆分为两个子模块后在这里合并（对外导出不变）：
 *   - jargon-playful.ts：玩法 A，装腔变长版（fun 彩蛋）
 *   - jargon-dictionaries.ts：玩法 B，行业术语词典（双向查询）
 */

import type { Prompt } from '../../types';
import { JARGON_PLAYFUL } from './jargon-playful';
import { JARGON_DICTS } from './jargon-dictionaries';

export const JARGON_PROMPTS: Prompt[] = [...JARGON_PLAYFUL, ...JARGON_DICTS];
