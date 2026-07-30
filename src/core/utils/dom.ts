/** DOM 查询辅助：强类型 + 缺失即报错，避免各工具里重复写 querySelector 模板代码 */

/** 取单个元素，找不到则抛错（开发期尽早暴露 HTML 选择器写错） */
export function qs<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`元素未找到: ${selector}`);
  return el;
}

/** 取单个元素，找不到返回 null */
export function qsOptional<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null {
  return (root.querySelector<T>(selector) ?? null);
}

/** 取所有匹配元素 */
export function qsAll<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

/**
 * 监听多个事件类型到同一处理函数，返回取消监听的函数。
 * 适合一个输入框要同时响应 input/change/keyup 的场景。
 */
export function on<K extends keyof HTMLElementEventMap>(
  el: HTMLElement,
  events: K[],
  handler: (e: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): () => void {
  events.forEach((evt) => el.addEventListener(evt, handler as EventListener, options));
  return () => events.forEach((evt) => el.removeEventListener(evt, handler as EventListener, options));
}
