import { h } from '@/core/components/element';

/**
 * 搜索框组件 —— 客户端实时筛选工具。
 *
 * 匹配范围：工具名、描述、关键词。
 * 防抖 150ms，避免每次按键立即重渲染整张卡片网格。
 * 聚焦时强调描边 + 微放大，提供视觉反馈。
 */
export interface SearchBar {
  el: HTMLInputElement;
  /** 订阅查询变化（已防抖） */
  onChange: (handler: (query: string) => void) => void;
}

export function createSearchBar(placeholder = '搜索工具…'): SearchBar {
  const input = h('input', {
    type: 'search',
    class:
      'search-bar w-full rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 pl-11 text-base text-[var(--fg)] placeholder:text-[var(--fg-muted)] outline-none transition-all focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20',
    placeholder,
    autocomplete: 'off',
    'aria-label': '搜索工具',
  }) as HTMLInputElement;

  // 包一层 relative，便于绝对定位搜索图标
  const wrapper = h('div', { class: 'relative' }, [
    h('span', {
      class:
        'pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--fg-muted)] text-lg',
      textContent: '🔍',
      'aria-hidden': 'true',
    }),
    input,
  ]);

  // 防抖订阅
  let timer: ReturnType<typeof setTimeout> | undefined;
  let handler: (q: string) => void = () => {};

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => handler(input.value.trim()), 150);
  });

  // 用闭包把 wrapper 暴露出去：挂在 el 上不便（input 是 leaf），
  // 这里让 el 实际指向 input，但渲染时调用方应使用 container() 取外壳。
  // 为简洁起见，给 input 挂一个属性指向 wrapper。
  (input as unknown as { _wrapper: HTMLElement })._wrapper = wrapper;

  return {
    el: input,
    onChange: (fn) => {
      handler = fn;
    },
  };
}

/** 取搜索框的外层容器（含图标），用于挂到布局 */
export function searchBarContainer(input: HTMLInputElement): HTMLElement {
  return (input as unknown as { _wrapper: HTMLElement })._wrapper;
}
