import { h } from '@/core/components/element';

/**
 * 分类筛选胶囊 —— "全部" + 各分类。
 * 点击切换激活态，触发回调。激活态有背景色过渡。
 */
export interface CategoryChips {
  el: HTMLElement;
  /** 订阅选中分类变化；'' 表示"全部" */
  onChange: (handler: (category: string) => void) => void;
}

export function createCategoryChips(categories: string[]): CategoryChips {
  let active = ''; // '' = 全部
  let handler: (c: string) => void = () => {};

  const container = h('div', {
    class: 'flex flex-wrap gap-2',
    role: 'tablist',
    'aria-label': '按分类筛选工具',
  });

  function render(): void {
    container.replaceChildren(
      chip('全部', '', active === ''),
      ...categories.map((c) => chip(c, c, active === c)),
    );
  }

  function chip(label: string, value: string, isActive: boolean): HTMLButtonElement {
    return h('button', {
      type: 'button',
      role: 'tab',
      'aria-selected': isActive ? 'true' : 'false',
      class: [
        'category-chip',
        'px-3.5',
        'py-1.5',
        'rounded-full',
        'text-sm',
        'font-medium',
        'transition-all',
        'duration-200',
        isActive
          ? 'bg-[var(--accent)] text-[var(--accent-fg)] border border-[var(--accent)]'
          : 'bg-[var(--bg-elevated)] text-[var(--fg-muted)] border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
      ].join(' '),
      textContent: label,
      onclick: () => {
        active = value;
        render();
        handler(active);
      },
    });
  }

  render();

  return {
    el: container,
    onChange: (fn) => {
      handler = fn;
    },
  };
}
