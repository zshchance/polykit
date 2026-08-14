import { h } from '@/core/components/element';

/**
 * 分类筛选胶囊 —— "全部" + 各分类。
 * 点击切换激活态，触发回调。激活态有背景色过渡。
 *
 * 语义：这是一组单选按钮（非 tab——tablist 需要配套 tabpanel 与方向键导航，
 * 此前只有 role 声明没有对应行为，反而误导辅助技术）。改用 group +
 * aria-pressed 的切换按钮组，语义自洽。
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
    role: 'group',
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
      'aria-pressed': isActive ? 'true' : 'false',
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
