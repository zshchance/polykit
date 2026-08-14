/**
 * 名言卡片 —— 引言编辑表单（左栏输入区）。
 *
 * 从 main.ts 拆出：搜索框 + 结果下拉（doSearch / resultItem / 防抖）、
 * 手动输入三件套（text / author / source，输入即更新预览）、
 * 随机 / 清空 / 保存按钮、库信息提示，以及 applyQuote / syncFromInputs
 * 两个同步入口。inputCol 不含历史面板（由 main.ts 在末尾 append，保持原 DOM 顺序）。
 *
 * 依赖方向：依赖 core 的 h()/on、data/quotes（搜索/随机/计数）、history.addQuote、
 * settings.clearDraft；编辑态与重绘/落库/历史刷新等闭包依赖由 main.ts 通过
 * createQuoteEditor(deps) 显式注入。
 */

import { h } from '@/core/components/element';
import { on } from '@/core/utils/dom';
import { searchQuotes, getRandomQuote, getQuoteCount, type QuoteRecord } from './data/quotes';
import { addQuote, type StoredQuote } from './history';
import { clearDraft } from './settings';
import type { QuoteData } from './templates/types';
import type { QuoteCardState } from './state';

/** createQuoteEditor 的依赖（由 main.ts 注入，替代原闭包变量） */
export interface QuoteEditorDeps {
  /** 共享编辑态（读 quote 回填输入框；写 quote 应用搜索/随机结果） */
  state: QuoteCardState;
  /** 重绘卡片预览 */
  rerenderCard: () => void;
  /** 草稿落库 */
  persistDraft: () => void;
  /** 保存到我的名言后刷新历史面板（由 main.ts 惰性转发到历史面板模块） */
  renderQuoteHistory: (items?: StoredQuote[]) => void;
}

/** 编辑表单 API */
export interface QuoteEditor {
  /** 左栏容器（搜索 + 手动输入 + 操作按钮；历史面板由 main.ts 追加到末尾） */
  inputCol: HTMLElement;
  /** 直接应用一条名言（来自搜索/随机），并重绘 + 落库草稿 */
  applyQuote: (q: QuoteData) => void;
  /** 三个编辑输入框（历史面板加载时同步填入；草稿落库时读取） */
  textInput: HTMLTextAreaElement;
  authorInput: HTMLInputElement;
  sourceInput: HTMLInputElement;
}

export function createQuoteEditor(deps: QuoteEditorDeps): QuoteEditor {
  const { state, rerenderCard, persistDraft, renderQuoteHistory } = deps;

  // —— 搜索框 + 结果下拉 ——
  const searchInput = h('input', {
    type: 'search',
    class:
      'w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]',
    placeholder: '搜索名言或作者（如 努力 / 鲁迅 / Einstein）',
    autocomplete: 'off',
  });
  const searchResults = h('div', { class: 'mt-2 space-y-1' });

  function doSearch(): void {
    const q = searchInput.value.trim();
    if (!q) {
      searchResults.replaceChildren();
      return;
    }
    const matches = searchQuotes(q);
    if (matches.length === 0) {
      searchResults.replaceChildren(
        h('p', {
          class: 'text-sm text-[var(--fg-muted)] py-2',
          textContent: '本地无匹配，可直接手动输入。',
        }),
      );
      return;
    }
    searchResults.replaceChildren(...matches.map((m) => resultItem(m)));
  }

  function resultItem(m: QuoteRecord): HTMLElement {
    return h(
      'button',
      {
        type: 'button',
        class:
          'block w-full text-left rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5 text-sm hover:border-[var(--accent)] transition-colors',
        onclick: () => {
          applyQuote({ text: m.text, author: m.author, source: m.source ?? undefined });
          textInput.value = m.text;
          authorInput.value = m.author;
          sourceInput.value = m.source ?? '';
          searchInput.value = '';
          searchResults.replaceChildren();
        },
      },
      [
        h('p', { class: 'line-clamp-2 text-[var(--fg)]', textContent: m.text }),
        h('p', {
          class: 'mt-1 text-xs text-[var(--fg-muted)]',
          textContent: `— ${m.author}${m.source ? ` · ${m.source}` : ''}`,
        }),
      ],
    );
  }

  // 防抖搜索
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 200);
  });

  // —— 手动输入 ——
  const textInput = h('textarea', {
    class:
      'w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] resize-y',
    rows: 4,
    placeholder: '输入或粘贴名言内容…',
  }) as HTMLTextAreaElement;
  textInput.value = state.quote.text;

  const authorInput = h('input', {
    type: 'text',
    class:
      'w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]',
    placeholder: '落款（作者 / 你的名字）',
  }) as HTMLInputElement;
  authorInput.value = state.quote.author;

  const sourceInput = h('input', {
    type: 'text',
    class:
      'w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]',
    placeholder: '出处（选填，如《道德经》）',
  }) as HTMLInputElement;
  sourceInput.value = state.quote.source ?? '';

  /** 从输入框同步到 state 并重绘 + 落库草稿 */
  function syncFromInputs(): void {
    state.quote = {
      text: textInput.value.trim() || '（请输入名言）',
      author: authorInput.value.trim() || '佚名',
      source: sourceInput.value.trim() || undefined,
    };
    rerenderCard();
    persistDraft();
  }

  /** 直接应用一条名言（来自搜索/随机），并重绘 + 落库草稿 */
  function applyQuote(q: QuoteData): void {
    state.quote = q;
    rerenderCard();
    persistDraft();
  }

  // 输入即更新预览
  on(textInput, ['input'], syncFromInputs);
  on(authorInput, ['input'], syncFromInputs);
  on(sourceInput, ['input'], syncFromInputs);

  // —— 操作按钮：随机 / 清空 ——
  const randomBtn = h('button', {
    type: 'button',
    class:
      'flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm hover:border-[var(--accent)] transition-colors',
    textContent: '🎲 随机一条',
    onclick: () => {
      const q = getRandomQuote();
      applyQuote({ text: q.text, author: q.author, source: q.source ?? undefined });
      textInput.value = q.text;
      authorInput.value = q.author;
      sourceInput.value = q.source ?? '';
    },
  });
  const clearBtn = h('button', {
    type: 'button',
    class:
      'flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm hover:border-[var(--accent)] transition-colors',
    textContent: '🗑 清空',
    onclick: () => {
      textInput.value = '';
      authorInput.value = '';
      sourceInput.value = '';
      searchInput.value = '';
      searchResults.replaceChildren();
      clearDraft(); // 清空编辑态时一并清除草稿记忆
      syncFromInputs();
    },
  });

  // —— 保存到我的名言（只存用户手动保存的内容）——
  const saveHint = h('div', { class: 'text-sm text-[var(--fg-muted)] min-h-[1.25rem]' });
  const saveBtn = h('button', {
    type: 'button',
    class:
      'flex-[1.4] rounded-md bg-[var(--accent)] px-3 py-2 text-sm text-[var(--accent-fg)] font-medium hover:opacity-90 transition-opacity whitespace-nowrap',
    textContent: '💾 保存',
    onclick: () => {
      const text = textInput.value.trim();
      const author = authorInput.value.trim() || '佚名';
      if (!text) {
        saveHint.textContent = '× 名言内容不能为空';
        saveHint.style.color = '#ef4444';
        return;
      }
      const items = addQuote({ text, author, source: sourceInput.value.trim() || undefined });
      renderQuoteHistory(items);
      saveHint.textContent = '✓ 已保存到我的名言';
      saveHint.style.color = '#22c55e';
      setTimeout(() => {
        saveHint.textContent = '';
      }, 2000);
    },
  });

  // 库信息提示
  const libInfo = h('p', {
    class: 'text-xs text-[var(--fg-muted)]',
    textContent: `本地名言库：${getQuoteCount()} 条 · 数据不出本地`,
  });

  // 「我的名言」历史面板（折叠）由 main.ts 创建后追加到 inputCol 末尾，
  // 与拆分前 children 顺序一致。
  const inputCol = h('div', { class: 'space-y-5 min-w-0' }, [
    // 搜索
    h('div', { class: 'space-y-1' }, [
      h('label', { class: 'text-sm font-medium', textContent: '搜索名言' }),
      searchInput,
      searchResults,
    ]),
    // 手动输入
    h('div', { class: 'space-y-3' }, [
      h('label', { class: 'text-sm font-medium', textContent: '或手动输入' }),
      textInput,
      authorInput,
      sourceInput,
    ]),
    // 操作：保存 / 随机 / 清空（同排，保存置首为主操作）
    h('div', { class: 'flex gap-2' }, [saveBtn, randomBtn, clearBtn]),
    saveHint,
    libInfo,
  ]);

  return { inputCol, applyQuote, textInput, authorInput, sourceInput };
}
