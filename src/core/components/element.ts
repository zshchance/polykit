/**
 * 极简 DOM 创建辅助 h()。
 * 不引框架的前提下，让组件代码可读、可类型推导。
 *
 * 用法：
 *   h('div', { class: 'card', onclick: fn }, [child1, '文本'])
 *
 * props 支持：
 *   - class        → className
 *   - style        → CSS 字符串（如 "color:red"）
 *   - on*          → 事件监听（onclick 等）
 *   - 元素原生属性 → 直接赋值（value/checked/disabled/textContent/...）
 *   - 其它（aria-*、data-*、role 等）→ setAttribute
 */
export type Child = Node | string | null | undefined | false;

/**
 * props 类型：原生元素属性 + class/style 特例 + 任意字符串属性（aria, data 等）。
 * 用索引签名 [key: string]: unknown 兼容任意 aria/data 属性，
 * 同时保持对常见原生属性（textContent 等）的补全提示。
 */
export type HProps<K extends keyof HTMLElementTagNameMap> = Partial<
  Omit<HTMLElementTagNameMap[K], 'style' | 'className'>
> & {
  class?: string;
  /** CSS 文本，如 "color:red;font-size:14px" */
  style?: string;
  /** 任意其它属性（aria-*、data-*、role 等），统一走 setAttribute */
  [key: string]: unknown;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: HProps<K> = {},
  children: Child[] | Child = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') {
      el.className = value as string;
    } else if (key === 'style') {
      // style 接受 CSS 字符串（如 "color:red"），直接赋给 cssText
      el.style.cssText = value as string;
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key in el) {
      // set as property (e.g. value, checked, disabled, textContent)
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      // aria-*、data-*、role 等通过属性设置
      el.setAttribute(key, String(value));
    }
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const child of kids) {
    if (child == null || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}
