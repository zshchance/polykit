/**
 * 极简 DOM 创建辅助 h()。
 * 不引框架的前提下，让组件代码可读、可类型推导。
 *
 * 用法：
 *   h('div', { class: 'card', onclick: fn }, [child1, '文本'])
 */
export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  children: Child[] | Child = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    if (key === 'class') {
      el.className = value as string;
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key in el) {
      // set as property (e.g. value, checked, disabled, textContent)
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
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
