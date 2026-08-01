/**
 * 模板渲染 —— 把用户填写的变量值注入提示词模板的 {{占位符}}。
 *
 * 核心设计：即使变量为空，也要保证生成"完整可用"的提示词。
 *   - 用户填了 → 用用户的值
 *   - 用户没填但有 default → 用 default
 *   - 都没有 → 用 `[label]` 作为占位提示，让用户复制后知道该补什么
 * 这样无论用户是否填写，复制出去的提示词都能直接喂给 AI 使用。
 */

import type { Prompt, Variable } from './types';

/** 取某个变量的"有效值"：用户值 > default > `[label]` 占位 */
function effectiveValue(v: Variable, raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (trimmed) return trimmed;
  if (v.default) return v.default;
  return `[${v.label}]`;
}

/**
 * 把变量值注入模板。
 * @param prompt 提示词条目
 * @param values 用户输入的变量值（key → 文本），缺失的 key 自动用兜底值
 * @returns 渲染后的完整提示词文本
 */
export function renderTemplate(prompt: Prompt, values: Record<string, string> = {}): string {
  let out = prompt.template;
  for (const v of prompt.variables) {
    const val = effectiveValue(v, values[v.key]);
    // 用全局替换；变量键是受控的（我们自己定义），无需转义
    out = out.split(`{{${v.key}}}`).join(val);
  }
  return out;
}

/**
 * 判断某变量当前是否"未填写"（用于 UI 高亮必填项）。
 * 用户没填、又没有 default 时返回 true。
 */
export function isEmpty(v: Variable, raw: string | undefined): boolean {
  return !(raw ?? '').trim() && !v.default;
}

// ────────── 方向变体（variants）支持 ──────────

/**
 * 把某方向的变量覆盖合并到 base variables 之上。
 * 同 key 的变量用 variant 的覆盖（default/placeholder/label 等），新增的追加。
 * 用于支持「黑话↔大白话」双向切换时，text 变量的 default 随方向变化。
 */
export function mergeVariables(
  base: Variable[],
  override: Variable[] | undefined,
): Variable[] {
  if (!override || override.length === 0) return base;
  const map = new Map<string, Variable>(base.map((v) => [v.key, { ...v }]));
  for (const ov of override) {
    const existing = map.get(ov.key);
    map.set(ov.key, existing ? { ...existing, ...ov } : { ...ov });
  }
  return [...map.values()];
}

/**
 * 解析当前应使用的模板：有 variants 且指定了有效 variantId 则用该方向的 template，
 * 否则回退 base 的 template。
 */
export function resolveTemplate(prompt: Prompt, variantId?: string): string {
  if (variantId && prompt.variants) {
    const v = prompt.variants.find((x) => x.id === variantId);
    if (v) return v.template;
  }
  return prompt.template;
}

/**
 * 解析当前应使用的变量集（含方向覆盖）。
 * 无 variantId 或无对应 variant 时返回 base variables。
 */
export function resolveVariables(prompt: Prompt, variantId?: string): Variable[] {
  if (variantId && prompt.variants) {
    const v = prompt.variants.find((x) => x.id === variantId);
    if (v) return mergeVariables(prompt.variables, v.variables);
  }
  return prompt.variables;
}

/**
 * 渲染指定方向的模板（供弹层切换方向时复用）。
 * @param prompt 提示词条目
 * @param variantId 方向 id（可选；不传或无效则用 base template）
 * @param values 用户输入的变量值
 */
export function renderVariant(
  prompt: Prompt,
  variantId: string | undefined,
  values: Record<string, string> = {},
): string {
  // 构造一个"虚拟 prompt"用 base 渲染逻辑，但替换 template
  const tpl = resolveTemplate(prompt, variantId);
  return renderTemplate({ ...prompt, template: tpl }, values);
}

