import { h } from '@/core/components/element';

/**
 * 搜索框组件 —— 客户端实时筛选工具。
 *
 * 匹配范围：工具名、描述、关键词。
 * 防抖 150ms，避免每次按键立即重渲染整张卡片网格。
 * 聚焦时强调描边 + 微放大，提供视觉反馈。
 */
export interface SearchBar {
  /** 输入框本体（绑事件用） */
  el: HTMLInputElement;
  /** 外层容器（含搜索图标），挂布局用 */
  container: HTMLElement;
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
  });

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

  return {
    el: input,
    container: wrapper,
    onChange: (fn) => {
      handler = fn;
    },
  };
}
