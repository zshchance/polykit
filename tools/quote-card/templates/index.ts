import type { CardTemplate } from './types';
import { minimal } from './minimal';
import { gradient } from './gradient';
import { paper } from './paper';
import { dark } from './dark';

/**
 * 内置模板注册表。
 * 新增内置模板：实现 CardTemplate 契约，在此数组追加即可被选择器自动发现。
 * 顺序即默认展示顺序；首个为默认选中模板。
 *
 * 自定义模板（用户用 AI 生成、存 localStorage）通过 provider 注入合并，
 * 见 setCustomTemplateProvider / getEffectiveTemplates。
 */
export const templates: CardTemplate[] = [minimal, gradient, paper, dark];

/** 默认模板 */
export const defaultTemplate: CardTemplate = templates[0]!;

/**
 * 自定义模板提供者钩子：由入口（main.ts）在启动时注入，桥接 custom-templates.ts。
 *
 * 为什么要这层间接（与 animations.ts 的 setCustomAnimProvider 完全对称）：
 *   保持「内置注册表」与「用户自定义」两侧架构一致，降低认知负担。入口初始化后，
 *   自定义模板的增删（在 localStorage 里）都会通过它实时反映到 getEffectiveTemplates。
 *   main.ts 负责把 loadCustomTemplates().map(toCardTemplate) 接进来。
 */
let customTemplateProvider: (() => CardTemplate[]) | null = null;
export function setCustomTemplateProvider(fn: (() => CardTemplate[]) | null): void {
  customTemplateProvider = fn;
}

/** 内置 + 用户自定义模板的合并列表（内置在前、自定义在后） */
export function getEffectiveTemplates(): CardTemplate[] {
  const customs = customTemplateProvider ? customTemplateProvider() : [];
  return customs.length > 0 ? [...templates, ...customs] : [...templates];
}

/** 按 id 取模板（在内置 + 自定义合并列表里查），找不到回退默认 */
export function getTemplate(id: string): CardTemplate {
  const list = getEffectiveTemplates();
  return list.find((t) => t.id === id) ?? defaultTemplate;
}

/**
 * id 是否合法（在内置 + 自定义合并列表里存在）—— 供草稿校验用。
 * 删除一个自定义模板后，若草稿还指向它，下次刷新会被判非法、回退默认模板。
 */
export function isValidTemplateId(id: string): boolean {
  return getEffectiveTemplates().some((t) => t.id === id);
}
