/**
 * 名言卡片 —— 「我的名言」历史面板（折叠）。
 *
 * 从 main.ts 拆出：historyToggle / historyPanel / historyCount / historyIndicator /
 * loadHistoryItem / renderQuoteHistory。点击某条 → 加载到卡片 + 填入输入框；
 * 每条可单独删除；顶部可一键全清。数据只存用户手动保存的内容（history.ts）。
 *
 * 依赖方向：依赖 core 的 h() 与 history.ts（读取/删除/清空）；
 * 「加载到卡片」所需的 applyQuote 与三个输入框由 main.ts 从编辑表单模块
 * 转发注入（createHistoryPanel(deps)），本模块不直接依赖编辑表单。
 */

import { h } from '@/core/components/element';
import { confirmDialog } from '@/core/components/Dialog';
import { loadHistory, removeQuote, clearHistory, HISTORY_MAX, type StoredQuote } from './history';
import type { QuoteData } from './templates/types';

/** createHistoryPanel 的依赖（由 main.ts 注入，替代原闭包变量） */
export interface HistoryPanelDeps {
  /** 直接应用一条名言到卡片并重绘 + 落库（来自编辑表单模块） */
  applyQuote: (q: QuoteData) => void;
  /** 三个编辑输入框（加载历史时同步填入） */
  textInput: HTMLTextAreaElement;
  authorInput: HTMLInputElement;
  sourceInput: HTMLInputElement;
}

/** 历史面板 API */
export interface HistoryPanel {
  /** 折叠开关按钮（「我的名言（N）」） */
  historyToggle: HTMLElement;
  /** 面板内容区（默认 hidden，点开关展开） */
  historyPanel: HTMLElement;
  /** 渲染历史列表（不传 items 则从 localStorage 读） */
  renderQuoteHistory: (items?: StoredQuote[]) => void;
}

export function createHistoryPanel(deps: HistoryPanelDeps): HistoryPanel {
  const { applyQuote, textInput, authorInput, sourceInput } = deps;

  const historyCount = h('span', { class: 'font-mono text-[var(--fg-muted)]', textContent: '0' });
  const historyIndicator = h('span', { class: 'text-xs', textContent: '▶' });
  let historyOpen = false;
  const historyPanel = h('div', { class: 'space-y-2' }, []);
  historyPanel.classList.add('hidden'); // 默认折叠

  const historyToggle = h(
    'button',
    {
      type: 'button',
      class:
        'flex w-full items-center justify-between rounded-md px-2 py-2 text-sm text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--bg)] transition-colors',
      'aria-expanded': 'false',
      onclick: () => {
        historyOpen = !historyOpen;
        historyPanel.classList.toggle('hidden', !historyOpen);
        historyToggle.setAttribute('aria-expanded', String(historyOpen));
        historyIndicator.textContent = historyOpen ? '▼' : '▶';
      },
    },
    [h('span', {}, ['我的名言（', historyCount, '）']), historyIndicator],
  );

  /** 把某条历史加载到卡片 + 输入框 */
  function loadHistoryItem(q: StoredQuote): void {
    applyQuote({ text: q.text, author: q.author, source: q.source });
    textInput.value = q.text;
    authorInput.value = q.author;
    sourceInput.value = q.source ?? '';
  }

  /** 渲染历史列表 */
  function renderQuoteHistory(items?: StoredQuote[]): void {
    const list = items ?? loadHistory();
    historyCount.textContent = String(list.length);
    historyPanel.replaceChildren();

    if (list.length === 0) {
      historyPanel.append(
        h('p', {
          class: 'py-4 text-center text-sm text-[var(--fg-muted)]',
          textContent: '还没有保存的名言。编辑后点"保存到我的名言"。',
        }),
      );
      return;
    }

    // 顶部：全部清除
    historyPanel.append(
      h('div', { class: 'flex justify-end' }, [
        h(
          'button',
          {
            type: 'button',
            class:
              'text-xs text-[var(--fg-muted)] hover:text-red-500 transition-colors underline-offset-2 hover:underline',
            textContent: '全部清除',
            onclick: () => {
              // 统一确认框替代原生 confirm（全站约定不弹原生弹窗）
              void confirmDialog('确定清除全部我的名言吗？此操作不可撤销。', {
                title: '清除我的名言',
                danger: true,
                confirmText: '清除',
              }).then((okDel) => {
                if (okDel) {
                  clearHistory();
                  renderQuoteHistory([]);
                }
              });
            },
          },
          [],
        ),
      ]),
    );

    for (const q of list) {
      historyPanel.append(
        h(
          'div',
          {
            class:
              'flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2',
          },
          [
            // 点击正文区 → 加载这条到卡片
            h(
              'button',
              {
                type: 'button',
                class: 'flex-1 min-w-0 text-left transition-colors',
                title: '点击加载到卡片',
                onclick: () => loadHistoryItem(q),
              },
              [
                h('p', {
                  class: 'line-clamp-2 text-sm text-[var(--fg)]',
                  textContent: q.text,
                }),
                h('p', {
                  class: 'mt-0.5 truncate text-xs text-[var(--fg-muted)]',
                  textContent: `— ${q.author}${q.source ? ` · ${q.source}` : ''}`,
                }),
              ],
            ),
            // 单条删除
            h(
              'button',
              {
                type: 'button',
                'aria-label': '删除此条',
                class:
                  'shrink-0 rounded-md border border-[var(--border)] px-2 py-1.5 text-sm text-[var(--fg-muted)] hover:text-red-500 hover:border-red-400 transition-colors',
                textContent: '✕',
                onclick: () => renderQuoteHistory(removeQuote(q.id)),
              },
              [],
            ),
          ],
        ),
      );
    }

    // 底部隐私提示
    historyPanel.append(
      h('p', {
        class: 'pt-1 text-center text-xs text-[var(--fg-muted)]',
        textContent: `仅存于本浏览器，清除浏览器数据即消失（上限 ${HISTORY_MAX} 条）`,
      }),
    );
  }

  renderQuoteHistory();

  return { historyToggle, historyPanel, renderQuoteHistory };
}
