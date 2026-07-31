import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { on } from '@/core/utils/dom';
import { searchQuotes, getRandomQuote, getQuoteCount, type QuoteRecord } from './data/quotes';
import { templates, defaultTemplate, getTemplate } from './templates';
import type { QuoteData } from './templates/types';
import { renderCard } from './card';
import { downloadCard, safeFilename } from './export';
import {
  loadHistory,
  addQuote,
  removeQuote,
  clearHistory,
  HISTORY_MAX,
  type StoredQuote,
} from './history';
import { loadDraft, saveDraft, clearDraft } from './settings';
import { ASPECTS, getAspect, type AspectId } from './aspect';
import { ANIMATIONS, getAnimation, type AnimId } from './animations';
import { exportVideo } from './video-export';

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
  // 启动时恢复上次编辑的草稿（内容/落款/出处/模板/宽高比/动画），无草稿则用默认值
  const restored = loadDraft();
  const state: {
    quote: QuoteData;
    templateId: string;
    aspectId: AspectId;
    animId: AnimId;
  } = {
    quote: restored
      ? { text: restored.text || DEFAULT_QUOTE.text, author: restored.author || DEFAULT_QUOTE.author, source: restored.source }
      : { ...DEFAULT_QUOTE },
    templateId: restored?.templateId ?? defaultTemplate.id,
    aspectId: restored?.aspectId ?? '1:1',
    animId: restored?.animId ?? 'fade',
  };

  /** 当前宽高比对象 */
  const currentAspect = () => getAspect(state.aspectId);
  /** 当前动画效果 */
  const currentAnim = () => getAnimation(state.animId);

  /** 把当前编辑态落库为草稿（输入/模板/宽高/动画变化时调用） */
  function persistDraft(): void {
    saveDraft({
      text: textInput.value,
      author: authorInput.value,
      source: sourceInput.value.trim() || undefined,
      templateId: state.templateId,
      aspectId: state.aspectId,
      animId: state.animId,
    });
  }

  // ─────────────────────────── 卡片画板（右栏预览） ───────────────────────────
  // 画板逻辑尺寸由当前宽高比决定（短边 1080），用 transform scale 缩放以适配容器宽度。
  // 导出时临时移除缩放（.exporting），保证高清原图。
  //
  // 缩放 bug 修复：模板用 cssText 设置样式会清掉 surface 的 width/height/transform，
  // 所以每次 rerenderCard 后必须重新 fit（重写 transform）。card.ts 负责 width/height。
  const cardEl = h('div', {
    class: 'quote-card-surface',
    style: `width:${currentAspect().w}px;height:${currentAspect().h}px;transform-origin:top left;box-sizing:border-box;`,
  });

  /** 当前播放中的动画（供视频导出复用；切换时取消旧的） */
  let currentAnimObj: Animation | null = null;

  /** 根据 stage 宽度（及竖版可用高度）计算缩放比例并应用到 surface */
  function fitCardToContainer(): void {
    const a = currentAspect();
    const w = cardStage.clientWidth;
    const scale = w / a.w;
    cardEl.style.transform = `scale(${scale})`;
    // stage 高度跟随缩放后的画板
    cardStage.style.height = `${a.h * scale}px`;
  }

  /** 重绘卡片内容（用当前 state），重新应用缩放，并播放入场动画 */
  function rerenderCard(): void {
    // 取消上一段动画
    currentAnimObj?.cancel();
    renderCard(cardEl, state.quote, getTemplate(state.templateId), currentAspect());
    fitCardToContainer();
    // 构建并播放入场动画（WAAPI）
    const contentEl = cardEl.querySelector('.quote-card-content') as HTMLElement | null;
    if (contentEl) {
      currentAnimObj = currentAnim().build(contentEl, state.quote);
    }
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
        persistDraft();
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

  // —— 宽高比选择器 ——
  const aspectButtons = ASPECTS.map((a) =>
    h('button', {
      type: 'button',
      'data-aspect': a.id,
      class: [
        'rounded-md border px-2.5 py-1.5 text-xs transition-all',
        a.id === state.aspectId
          ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
          : 'border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--accent)]',
      ].join(' '),
      textContent: a.label,
      onclick: () => {
        state.aspectId = a.id;
        updateAspectSelection();
        rerenderCard();
        persistDraft();
      },
    }),
  );
  const aspectSelector = h('div', { class: 'flex flex-wrap gap-2' }, aspectButtons);
  function updateAspectSelection(): void {
    for (const btn of aspectButtons) {
      const isActive = btn.getAttribute('data-aspect') === state.aspectId;
      btn.className = [
        'rounded-md border px-2.5 py-1.5 text-xs transition-all',
        isActive
          ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
          : 'border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--accent)]',
      ].join(' ');
    }
  }

  // —— 动画效果选择器 ——
  const animButtons = ANIMATIONS.map((an) =>
    h('button', {
      type: 'button',
      'data-anim': an.id,
      class: [
        'rounded-md border px-2.5 py-1.5 text-xs transition-all',
        an.id === state.animId
          ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
          : 'border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--accent)]',
      ].join(' '),
      textContent: an.name,
      onclick: () => {
        state.animId = an.id;
        updateAnimSelection();
        rerenderCard(); // 重新播放新动画
        persistDraft();
      },
    }),
  );
  const animSelector = h('div', { class: 'flex flex-wrap gap-2' }, animButtons);
  function updateAnimSelection(): void {
    for (const btn of animButtons) {
      const isActive = btn.getAttribute('data-anim') === state.animId;
      btn.className = [
        'rounded-md border px-2.5 py-1.5 text-xs transition-all',
        isActive
          ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
          : 'border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--accent)]',
      ].join(' ');
    }
  }

  // 小节标题工具
  const sectionLabel = (text: string) =>
    h('span', { class: 'text-xs font-medium text-[var(--fg-muted)]', textContent: text });

  // 导出按钮（图片 + 视频）+ 状态提示
  const exportHint = h('div', { class: 'text-sm text-[var(--fg-muted)] min-h-[1.25rem]' });

  const downloadImgBtn = h('button', {
    type: 'button',
    class:
      'flex-1 rounded-md bg-[var(--accent)] px-4 py-2.5 text-[var(--accent-fg)] font-medium hover:opacity-90 transition-opacity',
    textContent: '📷 导出图片',
    onclick: async () => {
      downloadImgBtn.textContent = '生成中…';
      downloadImgBtn.disabled = true;
      // 图片导出需截「动画完成后的成品」：把动画跳到终态（finish），
      // 否则逐字/淡入等动画停在中间帧会截到半透明/缺字画面。
      try {
        currentAnimObj?.finish();
      } catch {
        // 忽略
      }
      cardEl.classList.add('exporting');
      cardEl.style.transform = 'none';
      await new Promise((r) => setTimeout(r, 50)); // 等重排
      const result = await downloadCard(cardEl, safeFilename(state.quote, '.png'));
      // 恢复
      cardEl.classList.remove('exporting');
      fitCardToContainer();
      // 重新播放动画（finish 后动画在终态，重播给预览一个完整入场）
      rerenderCard();
      downloadImgBtn.textContent = '📷 导出图片';
      downloadImgBtn.disabled = false;
      exportHint.textContent = result.ok ? '✓ 图片已下载' : `× 导出失败：${result.reason}`;
      exportHint.style.color = result.ok ? '#22c55e' : '#ef4444';
    },
  });

  const downloadVideoBtn = h('button', {
    type: 'button',
    class:
      'flex-1 rounded-md border border-[var(--accent)] bg-[var(--bg-elevated)] px-4 py-2.5 text-[var(--accent)] font-medium hover:opacity-90 transition-opacity',
    textContent: '🎬 导出视频',
    onclick: async () => {
      downloadVideoBtn.textContent = '录制中…';
      downloadVideoBtn.disabled = true;
      downloadImgBtn.disabled = true;
      exportHint.textContent = '正在录制动画过程，请稍候…';
      exportHint.style.color = 'var(--fg-muted)';
      // 导出态：surface 复位 transform、原始尺寸；重渲染确保最新内容
      currentAnimObj?.cancel();
      cardEl.classList.add('exporting');
      cardEl.style.transform = 'none';
      renderCard(cardEl, state.quote, getTemplate(state.templateId), currentAspect());
      await new Promise((r) => setTimeout(r, 80)); // 等重排 + 字体
      try {
        const result = await exportVideo({
          surface: cardEl,
          aspect: currentAspect(),
          effect: currentAnim(),
          quote: state.quote,
        });
        exportHint.textContent = result.ok ? '✓ 视频已下载（WebM）' : `× 视频导出失败：${result.reason}`;
        exportHint.style.color = result.ok ? '#22c55e' : '#ef4444';
      } finally {
        // 恢复预览态
        cardEl.classList.remove('exporting');
        rerenderCard();
        downloadVideoBtn.textContent = '🎬 导出视频';
        downloadVideoBtn.disabled = false;
        downloadImgBtn.disabled = false;
      }
    },
  });

  const exportRow = h('div', { class: 'flex gap-2' }, [downloadImgBtn, downloadVideoBtn]);

  // 预览列：移动端置顶（order-first），桌面端在右（order 重置为 0）
  const previewCol = h('div', { class: 'space-y-4 min-w-0 order-first lg:order-none lg:sticky lg:top-6' }, [
    cardStage,
    // 模板
    h('div', { class: 'space-y-2' }, [sectionLabel('模板'), templateSelector]),
    // 宽高比
    h('div', { class: 'space-y-2' }, [sectionLabel('宽高比'), aspectSelector]),
    // 动画效果
    h('div', { class: 'space-y-2' }, [sectionLabel('动画效果'), animSelector]),
    // 导出
    exportRow,
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

  // ────────── 我的名言历史面板（折叠）──────────
  // 点击某条 → 加载到卡片 + 填入输入框；每条可单独删除；顶部可一键全清
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
              if (confirm('确定清除全部我的名言吗？此操作不可撤销。')) {
                clearHistory();
                renderQuoteHistory([]);
              }
            },
          },
          [],
        ),
      ]),
    );

    for (const q of list) {
      historyPanel.append(
        h('div', {
          class:
            'flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2',
        }, [
          // 点击正文区 → 加载这条到卡片
          h(
            'button',
            {
              type: 'button',
              class:
                'flex-1 min-w-0 text-left transition-colors',
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
        ]),
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
    // 操作：保存 / 随机 / 清空（同排，保存置首为主操作）
    h('div', { class: 'flex gap-2' }, [saveBtn, randomBtn, clearBtn]),
    saveHint,
    libInfo,
    // 我的名言历史（折叠）
    historyToggle,
    historyPanel,
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
