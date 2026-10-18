/**
 * 能力路由（纯函数）。
 *
 * 按供应商优先级（providers 数组顺序）× 供应商内模型添加顺序，
 * 解析满足所需能力集合的候选模型列表。aiChat() 依次尝试，失败顺延。
 */

import type { AIConfig, AIModel, AIProvider, ModelCapability } from './types';

export interface RoutedModel {
  provider: AIProvider;
  model: AIModel;
}

/**
 * 能力超集判断：model.capabilities ⊇ need。
 * ['text','image'] 的模型可服务 ['text'] 请求；反向不可。
 */
export function satisfies(model: AIModel, need: readonly ModelCapability[]): boolean {
  return need.every((c) => model.capabilities.includes(c));
}

/**
 * 解析候选模型，按调用优先级排序。
 * 过滤条件：供应商与模型均启用；能力满足需求。
 * need 为空数组视同 ['text']（工具缺省走纯文本对话）。
 */
export function resolveCandidates(
  config: AIConfig,
  need: readonly ModelCapability[] = ['text'],
): RoutedModel[] {
  const required: readonly ModelCapability[] = need.length > 0 ? need : ['text'];
  const out: RoutedModel[] = [];
  for (const provider of config.providers) {
    if (!provider.enabled) continue;
    for (const model of config.models) {
      if (model.providerId !== provider.id || !model.enabled) continue;
      if (satisfies(model, required)) out.push({ provider, model });
    }
  }
  return out;
}

/** 首选候选（无则 null），供设置页「路由预览」展示 */
export function primaryFor(
  config: AIConfig,
  need: readonly ModelCapability[] = ['text'],
): RoutedModel | null {
  return resolveCandidates(config, need)[0] ?? null;
}
