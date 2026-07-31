import type { CardTemplate } from './types';
import { minimal } from './minimal';
import { gradient } from './gradient';
import { paper } from './paper';
import { dark } from './dark';

/**
 * 模板注册表。
 * 新增模板：实现 CardTemplate 契约，在此数组追加即可被选择器自动发现。
 * 顺序即默认展示顺序；首个为默认选中模板。
 */
export const templates: CardTemplate[] = [minimal, gradient, paper, dark];

/** 默认模板 */
export const defaultTemplate: CardTemplate = templates[0]!;

/** 按 id 取模板 */
export function getTemplate(id: string): CardTemplate {
  return templates.find((t) => t.id === id) ?? defaultTemplate;
}
