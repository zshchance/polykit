/**
 * 名言卡片 —— 通用可折叠选择器构造器。
 *
 * 从 main.ts 拆出：头部按钮显示「标签：当前选中名」，点击展开/收起选项区，
 * 供宽高比 / 动画效果 / 视频清晰度 / 视频帧率四个选择器共用。
 *
 * 依赖方向：只依赖 core 的 h()，不依赖编辑态与其它子模块（纯 UI 原件）；
 * 选中后的业务逻辑由调用方通过 onSelect 注入。
 */

import { h } from '@/core/components/element';

export interface CollapsibleSelectOpts {
  /** 头部右侧额外操作按钮（如动画效果的 ➕ / 💡）；可选 */
  actions?: HTMLElement[];
  /** 某项是否可删除；返回 true 时该项按钮右侧渲染小 ✕。可选 */
  canDelete?: (id: string) => boolean;
  /** 点击某项的删除 ✕ 时调用（负责从存储删 + rebuild）。可选 */
  onDelete?: (id: string) => void;
}
export interface CollapsibleSelect {
  el: HTMLElement;
  /** 刷新当前选中态（切换后调用） */
  refresh: (selectedId: string) => void;
  /** 用新列表重建选项面板（自定义效果增删后调用） */
  rebuild: (newItems: { id: string; name: string }[], selectedId: string) => void;
}
export function collapsibleSelect(
  label: string,
  items: { id: string; name: string }[],
  selectedId: string,
  onSelect: (item: { id: string; name: string }) => void,
  opts: CollapsibleSelectOpts = {},
): CollapsibleSelect {
  const currentLabel = h('span', { class: 'text-[var(--fg)]' });
  const caret = h('span', { class: 'text-[var(--fg-muted)]', textContent: '▸' });
  const header = h(
    'button',
    {
      type: 'button',
      class:
        'flex flex-1 items-center justify-between rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm hover:border-[var(--accent)] transition-colors',
      'aria-expanded': 'false',
      onclick: () => {
        const hidden = panel.classList.toggle('hidden');
        header.setAttribute('aria-expanded', String(!hidden));
        caret.textContent = hidden ? '▸' : '▾';
      },
    },
    [
      h('span', { class: 'flex items-center gap-1.5' }, [
        h('span', { class: 'text-[var(--fg-muted)]', textContent: label }),
        currentLabel,
      ]),
      caret,
    ],
  );

  // 头部行：header（占满）+ 可选操作按钮。这样动画效果行可挂 ➕/💡。
  const headerRow = h('div', { class: 'flex items-center gap-2' }, [
    header,
    ...(opts.actions ?? []),
  ]);

  const panel = h('div', { class: 'hidden flex flex-wrap gap-2 pt-1' });

  function makeOptionButton(it: { id: string; name: string }): HTMLElement {
    const btn = h('button', {
      type: 'button',
      'data-id': it.id,
      class:
        'rounded-md border px-2.5 py-1.5 text-xs transition-all border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--accent)]',
      textContent: it.name,
      onclick: () => {
        onSelect(it);
        refresh(it.id);
        // 选择后自动收起
        panel.classList.add('hidden');
        header.setAttribute('aria-expanded', 'false');
        caret.textContent = '▸';
      },
    });
    // 可删除项：在按钮右侧挂一个 ✕（阻止冒泡以免触发选择）
    if (opts.canDelete?.(it.id) && opts.onDelete) {
      const del = h('button', {
        type: 'button',
        'aria-label': `删除自定义效果 ${it.name}`,
        title: '删除此自定义效果',
        class:
          'ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] leading-none text-[var(--fg-muted)] hover:bg-red-500/15 hover:text-red-500 transition-colors',
        textContent: '✕',
        onclick: (e: Event) => {
          e.stopPropagation();
          opts.onDelete!(it.id);
        },
      });
      return h('span', { class: 'inline-flex items-center' }, [btn, del]);
    }
    return btn;
  }

  function refresh(id: string): void {
    const item = items.find((x) => x.id === id);
    currentLabel.textContent = item ? `：${item.name}` : '';
    for (const child of panel.children) {
      // 容器可能是 span(可删除) 或 button(普通)，取其首个/自身 button 判态
      const btn = (
        child.tagName === 'BUTTON' ? child : child.querySelector('button[data-id]')
      ) as HTMLElement | null;
      if (!btn) continue;
      const isActive = btn.getAttribute('data-id') === id;
      btn.className = isActive
        ? 'rounded-md border px-2.5 py-1.5 text-xs transition-all border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
        : 'rounded-md border px-2.5 py-1.5 text-xs transition-all border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--accent)]';
    }
  }

  function rebuild(newItems: { id: string; name: string }[], selectedId: string): void {
    items.length = 0;
    items.push(...newItems);
    panel.replaceChildren(...newItems.map(makeOptionButton));
    refresh(selectedId);
  }

  panel.append(...items.map(makeOptionButton));
  refresh(selectedId);

  const el = h('div', { class: 'space-y-1' }, [headerRow, panel]);
  return { el, refresh, rebuild };
}
