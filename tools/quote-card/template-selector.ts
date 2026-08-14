/**
 * 名言卡片 —— 模板选择器（4 列缩略图网格 + 右上角 💡 AI 生成 + 自定义项 ✕ 删除）。
 *
 * 从 main.ts 拆出：templateGrid / makeTemplateButton / rebuildTemplateGrid /
 * updateTemplateSelection / helpTplBtn / templateSelector。与动画选择器交互对称，
 * 但保留缩略图网格（模板风格靠色块预览最直观，折叠成文字按钮会丢这个价值）。
 * 自定义模板由 AI 生成、存 localStorage，通过 getEffectiveTemplates() 与内置模板合并。
 *
 * 依赖方向：依赖 core 的 h()、templates（内置+合并读取）与 custom-templates
 * （自定义 id 判定/删除）；编辑态与重绘/落库/打开 AI 模态等闭包依赖
 * 由 main.ts 通过 createTemplateSelector(deps) 显式注入。
 */

import { h } from '@/core/components/element';
import { confirmDialog } from '@/core/components/Dialog';
import { defaultTemplate, getEffectiveTemplates } from './templates';
import type { CardTemplate } from './templates/types';
import { isCustomTemplateId, removeCustomTemplate } from './custom-templates';
import type { QuoteCardState } from './state';

/** createTemplateSelector 的依赖（由 main.ts 注入，替代原闭包变量） */
export interface TemplateSelectorDeps {
  /** 共享编辑态（读/写 templateId） */
  state: QuoteCardState;
  /** 重绘卡片预览 */
  rerenderCard: () => void;
  /** 草稿落库 */
  persistDraft: () => void;
  /** 打开「AI 生成自定义模板」模态 */
  openTemplateDialog: () => void;
}

/** 模板选择器 API */
export interface TemplateSelector {
  /** 模板选择器外层（标题行「模板」+ 💡，下方网格） */
  templateSelector: HTMLElement;
  /** 用最新「内置 + 自定义」列表重建网格（增删后调用） */
  rebuildTemplateGrid: () => void;
}

export function createTemplateSelector(deps: TemplateSelectorDeps): TemplateSelector {
  const { state, rerenderCard, persistDraft, openTemplateDialog } = deps;

  const templateGrid = h('div', { class: 'grid grid-cols-4 gap-2' });

  function makeTemplateButton(t: CardTemplate): HTMLElement {
    const btn = h(
      'button',
      {
        type: 'button',
        'data-tpl': t.id,
        class: [
          'flex',
          'flex-col',
          'items-center',
          'gap-1.5',
          'rounded-lg',
          'border-2',
          'p-2',
          'transition-all',
          t.id === state.templateId
            ? 'border-[var(--accent)]'
            : 'border-[var(--border)] hover:border-[var(--accent)]',
        ].join(' '),
        onclick: () => {
          state.templateId = t.id;
          updateTemplateSelection();
          rerenderCard();
          persistDraft();
        },
      },
      [
        // 缩略图：用模板真实背景 + 小引号图标，准确预览实际风格
        h(
          'div',
          {
            class: 'relative h-10 w-full overflow-hidden rounded',
            style: `background:${t.preview.background};`,
          },
          [
            h('span', {
              class: 'absolute inset-0 flex items-center justify-center font-serif text-lg',
              style: `color:${t.preview.iconColor};opacity:0.85;`,
              textContent: '\u201C',
            }),
          ],
        ),
        h('span', { class: 'text-xs text-[var(--fg-muted)]', textContent: t.name }),
      ],
    );

    // 自定义模板：右下角挂 ✕ 删除（阻止冒泡以免触发选择）
    if (isCustomTemplateId(t.id)) {
      const del = h('button', {
        type: 'button',
        'aria-label': `删除自定义模板 ${t.name}`,
        title: '删除此自定义模板',
        class:
          'absolute -right-1.5 -bottom-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] text-[11px] leading-none text-[var(--fg-muted)] hover:bg-red-500/15 hover:text-red-500 transition-colors',
        textContent: '✕',
        onclick: (e: Event) => {
          e.stopPropagation();
          const name = t.name;
          // 统一确认框替代原生 confirm（全站约定不弹原生弹窗）
          void confirmDialog(`确定删除${name}吗？此操作不可撤销。`, {
            title: '删除自定义模板',
            danger: true,
            confirmText: '删除',
          }).then((okDel) => {
            if (!okDel) return;
            removeCustomTemplate(t.id);
            // 若删的是当前选中，回退默认模板
            if (state.templateId === t.id) {
              state.templateId = defaultTemplate.id;
              rerenderCard();
              persistDraft();
            }
            rebuildTemplateGrid();
          });
        },
      });
      return h('div', { class: 'relative' }, [btn, del]);
    }
    return btn;
  }

  function rebuildTemplateGrid(): void {
    templateGrid.replaceChildren(...getEffectiveTemplates().map(makeTemplateButton));
    updateTemplateSelection();
  }

  function updateTemplateSelection(): void {
    for (const child of Array.from(templateGrid.children)) {
      // 容器可能是 div.relative(可删除) 或 button(普通)，取其内首个/自身 button 判态
      const btn = (
        child.tagName === 'BUTTON' ? child : child.querySelector('button[data-tpl]')
      ) as HTMLElement | null;
      if (!btn) continue;
      const isActive = btn.getAttribute('data-tpl') === state.templateId;
      btn.className = [
        'flex',
        'flex-col',
        'items-center',
        'gap-1.5',
        'rounded-lg',
        'border-2',
        'p-2',
        'transition-all',
        isActive ? 'border-[var(--accent)]' : 'border-[var(--border)] hover:border-[var(--accent)]',
      ].join(' ');
    }
  }

  rebuildTemplateGrid();

  // 💡 按钮：点开「描述→生成提示词→粘 AI 代码→保存」三步合一的模态（与动画 💡 对称）
  const helpTplBtn = h('button', {
    type: 'button',
    title: '用 AI 生成自定义模板：描述风格 → 生成提示词 → 粘贴 AI 返回的代码 → 保存',
    'aria-label': '用 AI 生成自定义模板',
    class:
      'inline-flex shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
    textContent: '💡',
    onclick: () => openTemplateDialog(),
  });

  // 模板选择器外层（标题行「模板」+ 💡，下方网格）
  const templateSelector = h('div', { class: 'space-y-2' }, [
    h('div', { class: 'flex items-center justify-between' }, [
      h('span', { class: 'text-xs font-medium text-[var(--fg-muted)]', textContent: '模板' }),
      helpTplBtn,
    ]),
    templateGrid,
  ]);

  return { templateSelector, rebuildTemplateGrid };
}
