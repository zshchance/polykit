import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { on } from '@/core/utils/dom';
import { searchQuotes, getRandomQuote, getQuoteCount, type QuoteRecord } from './data/quotes';
import { templates, defaultTemplate, getTemplate } from './templates';
import type { QuoteData } from './templates/types';
import { renderCard, CARD_SIZE } from './card';
import { downloadCard, safeFilename } from './export';

initTheme();

/** 默认展示的名言（首次进入页面即有内容） */
const DEFAULT_QUOTE: QuoteData = {
  text: '千里之行，始于足下。',
  author: '老子',
  source: '道德经',
};

function renderQuoteCard() {
  const { content } = renderToolLayout(document.getElementById('app')!, '名言卡片');

  // —— 状态 ——
  const state: { quote: QuoteData; templateId: string } = {
    quote: { ...DEFAULT_QUOTE },
    templateId: defaultTemplate.id,
  };

  // ─────────────────────────── 卡片画板（右栏预览） ───────────────────────────
  // 画板逻辑尺寸 1080×1080，用 transform scale 缩放以适配容器宽度。
  // 导出时临时移除缩放（.exporting），保证高清原图。
  //
  // 缩放 bug 修复：模板用 cssText 设置样式会清掉 surface 的 width/height/transform，
  // 所以每次 rerenderCard 后必须重新 fit（重写 transform）。card.ts 负责 width/height。
  const cardEl = h('div', {
    class: 'quote-card-surface',
    style: `width:${CARD_SIZE}px;height:${CARD_SIZE}px;transform-origin:top left;box-sizing:border-box;`,
  });

  /** 根据 stage 宽度计算缩放比例并应用到 surface */
  function fitCardToContainer(): void {
    const w = cardStage.clientWidth;
    const scale = w / CARD_SIZE;
    cardEl.style.transform = `scale(${scale})`;
    // stage 高度跟随缩放后的画板
    cardStage.style.height = `${CARD_SIZE * scale}px`;
  }

  /** 重绘卡片内容（用当前 state），并重新应用缩放（模板 cssText 会清掉 transform） */
  function rerenderCard(): void {
    renderCard(cardEl, state.quote, getTemplate(state.templateId));
    fitCardToContainer();
  }

  // 画板外层容器（决定显示宽度，承载缩放后的画板）
  const cardStage = h('div', { class: 'w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)]' }, [cardEl]);

  // 模板选择器
  const templateButtons = templates.map((t) =>
    h('button', {
      type: 'button',
      'data-tpl': t.id,
      class: [
        'flex', 'flex-col', 'items-center', 'gap-1.5', 'rounded-lg', 'border-2', 'p-2', 'transition-all',
        t.id === state.templateId
          ? 'border-[var(--accent)]'
          : 'border-[var(--border)] hover:border-[var(--accent)]',
      ].join(' '),
      onclick: () => {
        state.templateId = t.id;
        updateTemplateSelection();
        rerenderCard();
      },
    }, [
      // 缩略图：用模板真实背景 + 小引号图标，准确预览实际风格
      h('div', {
        class: 'relative h-10 w-full overflow-hidden rounded',
        style: `background:${t.preview.background};`,
      }, [
        h('span', {
          class: 'absolute inset-0 flex items-center justify-center font-serif text-lg',
          style: `color:${t.preview.iconColor};opacity:0.85;`,
          textContent: '\u201C',
        }),
      ]),
      h('span', { class: 'text-xs text-[var(--fg-muted)]', textContent: t.name }),
    ]),
  );
  const templateSelector = h('div', { class: 'grid grid-cols-4 gap-2' }, templateButtons);

  function updateTemplateSelection(): void {
    for (const btn of templateButtons) {
      const isActive = btn.getAttribute('data-tpl') === state.templateId;
      btn.className = [
        'flex', 'flex-col', 'items-center', 'gap-1.5', 'rounded-lg', 'border-2', 'p-2', 'transition-all',
        isActive ? 'border-[var(--accent)]' : 'border-[var(--border)] hover:border-[var(--accent)]',
      ].join(' ');
    }
  }

  // 下载按钮 + 状态提示
  const exportHint = h('div', { class: 'text-sm text-[var(--fg-muted)] min-h-[1.25rem]' });
  const downloadBtn = h('button', {
    type: 'button',
    class:
      'w-full rounded-md bg-[var(--accent)] px-4 py-2.5 text-[var(--accent-fg)] font-medium hover:opacity-90 transition-opacity',
    textContent: '⬇ 下载图片',
    onclick: async () => {
      downloadBtn.textContent = '生成中…';
      downloadBtn.disabled = true;
      // 导出时移除缩放，截图原始 1080×1080
      cardEl.classList.add('exporting');
      cardEl.style.transform = 'none';
      await new Promise((r) => setTimeout(r, 50)); // 等重排
      const result = await downloadCard(cardEl, safeFilename(state.quote));
      // 恢复缩放
      cardEl.classList.remove('exporting');
      fitCardToContainer();
      downloadBtn.textContent = '⬇ 下载图片';
      downloadBtn.disabled = false;
      exportHint.textContent = result.ok ? '✓ 已下载到本地' : `× 导出失败：${result.reason}`;
      exportHint.style.color = result.ok ? '#22c55e' : '#ef4444';
    },
  });

  // 预览列：移动端置顶（order-first），桌面端在右（order 重置为 0）
  const previewCol = h('div', { class: 'space-y-4 min-w-0 order-first lg:order-none lg:sticky lg:top-6' }, [
    cardStage,
    templateSelector,
    downloadBtn,
    exportHint,
  ]);

  // ─────────────────────────── 输入区（左栏） ───────────────────────────

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
        h('p', { class: 'text-sm text-[var(--fg-muted)] py-2', textContent: '本地无匹配，可直接手动输入。' }),
      );
      return;
    }
    searchResults.replaceChildren(
      ...matches.map((m) => resultItem(m)),
    );
  }

  function resultItem(m: QuoteRecord): HTMLElement {
    return h('button', {
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
    }, [
      h('p', { class: 'line-clamp-2 text-[var(--fg)]', textContent: m.text }),
      h('p', { class: 'mt-1 text-xs text-[var(--fg-muted)]', textContent: `— ${m.author}${m.source ? ` · ${m.source}` : ''}` }),
    ]);
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

  /** 从输入框同步到 state 并重绘 */
  function syncFromInputs(): void {
    state.quote = {
      text: textInput.value.trim() || '（请输入名言）',
      author: authorInput.value.trim() || '佚名',
      source: sourceInput.value.trim() || undefined,
    };
    rerenderCard();
  }

  /** 直接应用一条名言（来自搜索/随机），并重绘 */
  function applyQuote(q: QuoteData): void {
    state.quote = q;
    rerenderCard();
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
      syncFromInputs();
    },
  });

  // 库信息提示
  const libInfo = h('p', { class: 'text-xs text-[var(--fg-muted)]', textContent: `本地名言库：${getQuoteCount()} 条 · 数据不出本地` });

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
    // 操作
    h('div', { class: 'flex gap-2' }, [randomBtn, clearBtn]),
    libInfo,
  ]);

  // ─────────────────────────── 两栏布局 ───────────────────────────
  // 响应式：移动端单列堆叠，桌面端两栏（输入在左、预览在右）。
  // 顺序策略：移动端把预览放最上方（卡片是主展示，用户先看到成品再编辑），
  // 桌面端恢复"输入左、预览右"。用 order 实现，无需改 DOM 顺序。
  //
  // 关键：网格列必须用 minmax(0,...) 收缩到 0，否则画板 1080px 的固定宽度
  // 会把网格轨道撑到 1080px、撑破窄屏出现横向滚动条（grid 项默认 min-width:auto 不收缩）。
  const layout = h('div', { class: 'grid gap-6 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]' }, [
    inputCol,
    previewCol,
  ]);

  content.append(layout);

  // 初始渲染（rerenderCard 内部已含 fitCardToContainer，自动应用缩放）
  rerenderCard();
  // 窗口缩放时重新适配
  window.addEventListener('resize', fitCardToContainer);
}

renderQuoteCard();
