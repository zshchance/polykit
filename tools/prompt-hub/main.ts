import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { createCopyButton } from '@/core/components/CopyButton';
import { CATEGORIES, categoryName, type Prompt } from './types';
import { ALL_PROMPTS, FUN_PROMPTS_ONLY, FEATURED_PROMPTS, topTags } from './data';
import { renderVariant, resolveVariables } from './template';
import { loadFilter, saveFilter, type FilterState } from './settings';

initTheme();

/**
 * AI 提示词灵感库 —— 搜索 / 标签筛选 / 随机发现 → 卡片网格 → 详情弹层 → 复制即用。
 *
 * 布局（自上而下）：
 *   1. 搜索框 + 🎲 灵机一动（随机彩蛋）
 *   2. 类目胶囊（全部 + 各类目）+ 热门标签胶囊（多选 AND 过滤）
 *   3. 今日推荐（精选 3-4 张，常驻置顶）
 *   4. 提示词卡片网格（icon + 标题 + desc + 标签；彩蛋带 ✨ 徽章）
 *   5. 点击卡片 → 详情弹层（变量输入 + 实时预览 + 复制）
 *
 * 检索三件套跑在同一套数据上：category + tags AND 过滤 + keyword 模糊匹配。
 * 检索态持久化（类目/标签/关键词），变量输入值不持久化（隐私）。
 */
function renderPromptHub(): void {
  const { content } = renderToolLayout(document.getElementById('app')!, 'AI 提示词灵感库');

  // —— 状态 ——
  const restored = loadFilter();
  const filter: FilterState = { ...restored };

  function persist(): void {
    saveFilter({ ...filter });
  }

  /** 应用当前检索：类目 + 标签(OR 取并集) + 关键词(模糊) */
  function applyFilter(list: Prompt[]): Prompt[] {
    let r = list;
    if (filter.category !== 'all') r = r.filter((p) => p.category === filter.category);
    if (filter.tags.length > 0) {
      // 多标签取并集（命中任一即入选），而非要求同时满足所有标签
      r = r.filter((p) => filter.tags.some((t) => p.tags.includes(t)));
    }
    const kw = filter.keyword.trim().toLowerCase();
    if (kw) {
      r = r.filter((p) => {
        const hay = (p.title + ' ' + p.desc + ' ' + p.tags.join(' ') + ' ' + categoryName(p.category)).toLowerCase();
        return hay.includes(kw);
      });
    }
    return r;
  }

  // ────────── 1. 搜索框 + 随机 ──────────
  const searchInput = h('input', {
    type: 'search',
    placeholder: '搜索提示词：小红书、简历、变画风、生日…',
    class:
      'w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
  }) as HTMLInputElement;
  searchInput.value = filter.keyword;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  searchInput.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filter.keyword = searchInput.value;
      renderGrid();
      persist();
    }, 200);
  });

  const randomBtn = h('button', {
    type: 'button',
    class:
      'shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
    textContent: '🎲 灵机一动',
    title: '随机抽一个趣味彩蛋',
    onclick: () => {
      const pool = FUN_PROMPTS_ONLY;
      const pick = pool[Math.floor(Math.random() * pool.length)]!;
      openDetail(pick);
    },
  });

  const searchBar = h('div', { class: 'flex gap-2' }, [searchInput, randomBtn]);

  // ────────── 2. 类目 + 标签胶囊 ──────────
  const categoryRow = h('div', { class: 'flex flex-wrap gap-2' }, []);
  function renderCategoryRow(): void {
    categoryRow.replaceChildren(
      chip('✨ 全部', 'all', filter.category === 'all'),
      ...CATEGORIES.map((c) => chip(`${c.icon} ${c.name}`, c.id, filter.category === c.id)),
    );
  }
  function chip(label: string, value: string, isActive: boolean): HTMLButtonElement {
    return h('button', {
      type: 'button',
      class: [
        'rounded-full px-3.5 py-1.5 text-sm font-medium transition-all duration-200 border',
        isActive
          ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)]'
          : 'bg-[var(--bg-elevated)] text-[var(--fg-muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
      ].join(' '),
      textContent: label,
      onclick: () => {
        filter.category = value;
        renderCategoryRow();
        renderGrid();
        persist();
      },
    });
  }

  const tagRow = h('div', { class: 'flex flex-wrap gap-2' }, []);
  function renderTagRow(): void {
    tagRow.replaceChildren(
      ...topTags(12).map((t) => {
        const isActive = filter.tags.includes(t);
        return h('button', {
          type: 'button',
          'aria-pressed': String(isActive),
          class: [
            'rounded-full px-2.5 py-1 text-xs transition-all duration-150 border',
            isActive
              ? 'bg-[var(--fg)] text-[var(--bg)] border-[var(--fg)]'
              : 'bg-transparent text-[var(--fg-muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
          ].join(' '),
          textContent: isActive ? `✓ ${t}` : `# ${t}`,
          onclick: () => {
            if (isActive) filter.tags = filter.tags.filter((x) => x !== t);
            else filter.tags = [...filter.tags, t];
            renderTagRow();
            renderGrid();
            persist();
          },
        });
      }),
    );
  }

  // ────────── 3. 今日推荐（精选，常驻置顶） ──────────
  const featuredArea = h('div', { class: 'space-y-2' });
  function renderFeatured(): void {
    // 有检索条件时隐藏推荐区（避免干扰筛选结果）
    const hasFilter = filter.category !== 'all' || filter.tags.length > 0 || filter.keyword.trim() !== '';
    featuredArea.style.display = hasFilter ? 'none' : '';
    if (hasFilter) return;
    featuredArea.replaceChildren(
      h('div', { class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '今日推荐' }),
      h('div', { class: 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3' },
        FEATURED_PROMPTS.map((p) => promptCard(p)),
      ),
    );
  }

  // ────────── 4. 卡片网格 ──────────
  const gridHeader = h('div', { class: 'flex items-center justify-between' }, []);
  const grid = h('div', { class: 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3' });
  const emptyHint = h('div', {
    class: 'rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] px-6 py-10 text-center text-sm text-[var(--fg-muted)]',
    textContent: '没有匹配的提示词，换个关键词或标签试试～',
  });

  function renderGrid(): void {
    const list = applyFilter(ALL_PROMPTS);
    // 头部计数
    gridHeader.replaceChildren(
      h('span', {
        class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]',
        textContent: list.length > 0 ? `共 ${list.length} 个提示词` : '提示词',
      }),
    );
    grid.replaceChildren(...list.map((p) => promptCard(p)));
    grid.style.display = list.length > 0 ? '' : 'none';
    emptyHint.style.display = list.length > 0 ? 'none' : '';
    renderFeatured();
  }

  /** 单张卡片 */
  function promptCard(p: Prompt): HTMLElement {
    return h('button', {
      type: 'button',
      class:
        'group relative text-left rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-[var(--accent)]',
      onclick: () => openDetail(p),
    }, [
      // 彩蛋徽章
      p.fun
        ? (h('span', {
            class:
              'absolute right-3 top-3 rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]',
            textContent: '✨ 彩蛋',
          }) as HTMLElement)
        : (h('span') as HTMLElement),
      h('div', { class: 'flex items-start gap-2.5' }, [
        h('span', { class: 'text-2xl leading-none', textContent: p.icon }),
        h('div', { class: 'min-w-0 flex-1' }, [
          h('div', { class: 'font-medium text-[var(--fg)]', textContent: p.title }),
          h('p', {
            class: 'mt-1 text-xs leading-snug text-[var(--fg-muted)] line-clamp-2',
            textContent: p.desc,
          }),
        ]),
      ]),
      h('div', { class: 'mt-2.5 flex flex-wrap gap-1' },
        p.tags.slice(0, 3).map((t) =>
          h('span', {
            class: 'rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)]',
            textContent: t,
          }),
        ),
      ),
    ]);
  }

  // ────────── 5. 详情弹层 ──────────
  let currentPrompt: Prompt | null = null;
  const detailOverlay = h('div', {
    class:
      'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4 backdrop-blur-sm',
    role: 'dialog',
    'aria-modal': 'true',
    onclick: (e: Event) => {
      if (e.target === detailOverlay) closeDetail();
    },
  });

  function openDetail(p: Prompt): void {
    currentPrompt = p;
    // values / preview 跨方向切换持久存在；切换方向时按新方向的变量 default 重置
    const values: Record<string, string> = {};
    const preview = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows: 12,
      readonly: true,
    }) as HTMLTextAreaElement;

    // 复制按钮：点击瞬间取最新预览值（preview 跨方向持久，getter 始终拿到当前值）
    const copyBtn = createCopyButton(() => preview.value, '复制提示词', '已复制 ✓');

    // 当前翻译方向（仅 p.variants 存在时使用）
    let currentVariantId: string | undefined = p.variants ? p.variants[0]?.id : undefined;

    // 内容区容器：切换方向时整体重建（变量输入 + 预览）
    const bodyContent = h('div');

    function refreshPreview(): void {
      if (!currentPrompt) {
        preview.value = '';
        return;
      }
      preview.value = renderVariant(currentPrompt, currentVariantId, values);
    }

    /** 按当前方向渲染内容区：变量输入框（含 default 预填）+ 预览 */
    function renderBody(): void {
      const vars = resolveVariables(p, currentVariantId);
      // 切换方向时重置 values（用新方向的 default 预填），避免上一个方向的残留
      for (const k of Object.keys(values)) delete values[k];

      const varInputs = vars.map((v) => {
        const input = h(v.multiline ? 'textarea' : 'input', {
          ...(v.multiline ? { rows: 3 } : {}),
          placeholder: v.placeholder ?? '',
          class:
            'w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
        }) as HTMLInputElement | HTMLTextAreaElement;
        input.addEventListener('input', () => {
          values[v.key] = input.value;
          refreshPreview();
        });
        // 预填 default（让用户不填也能得到完整可用提示词）
        if (v.default) {
          input.value = v.default;
          values[v.key] = v.default;
        }
        return h('div', { class: 'space-y-1' }, [
          h('label', {
            class: 'flex items-center gap-1 text-xs font-medium text-[var(--fg-muted)]',
            textContent: v.label + (v.required ? ' *' : ''),
          }),
          input,
        ]);
      });

      // 当前方向的说明（variant.desc 优先，回退卡片 desc）
      const variant = p.variants?.find((x) => x.id === currentVariantId);
      const descText = variant?.desc ?? p.desc;

      bodyContent.replaceChildren(
        h('p', { class: 'mb-4 text-sm leading-relaxed text-[var(--fg-muted)]', textContent: descText }),
        ...(varInputs.length > 0
          ? [h('div', { class: 'mb-4 space-y-3' }, [
              h('div', { class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '填写你的内容' }),
              ...varInputs,
            ])]
          : [h('div', { class: 'mb-4 text-xs text-[var(--fg-muted)]', textContent: '这条提示词可以直接复制使用，无需填写。' })]),
        h('div', { class: 'space-y-2' }, [
          h('div', { class: 'flex items-center justify-between' }, [
            h('span', { class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '生成结果（复制后粘贴给 AI）' }),
            copyBtn,
          ]),
          preview,
        ]),
      );
      refreshPreview();
    }

    // 方向切换控件容器（仅 variants 存在时显示）。初始内容由 rebuildDirectionRow 填充。
    const directionRow: HTMLElement | null =
      p.variants && p.variants.length > 0
        ? h('div', { class: 'flex items-center gap-2 border-b border-[var(--border)] px-5 py-3' })
        : null;

    /** 重建方向切换行（高亮当前方向）；切换方向后重建内容区（重置 values + 切模板） */
    function rebuildDirectionRow(): void {
      if (!directionRow || !p.variants) return;
      directionRow.replaceChildren(
        h('span', { class: 'text-xs font-medium text-[var(--fg-muted)]', textContent: '翻译方向' }),
        h('div', { class: 'flex flex-wrap gap-1.5' },
          p.variants.map((vv) => {
            const a = vv.id === currentVariantId;
            return h('button', {
              type: 'button',
              'aria-pressed': String(a),
              class: [
                'rounded-md px-2.5 py-1 text-xs border transition-all duration-150',
                a
                  ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)]'
                  : 'bg-[var(--bg-elevated)] text-[var(--fg-muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
              ].join(' '),
              textContent: vv.label,
              onclick: () => {
                currentVariantId = vv.id;
                rebuildDirectionRow();
                renderBody();
              },
            });
          }),
        ),
      );
    }
    rebuildDirectionRow();

    renderBody();

    const modal = h('div', {
      class:
        'flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl',
    }, [
      // 头部
      h('div', {
        class: 'flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4',
      }, [
        h('div', { class: 'flex items-start gap-2.5' }, [
          h('span', { class: 'text-2xl leading-none', textContent: p.icon }),
          h('div', {}, [
            h('div', { class: 'flex items-center gap-2' }, [
              h('span', { class: 'font-medium text-[var(--fg)]', textContent: p.title }),
              ...(p.fun
                ? [h('span', { class: 'rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]', textContent: '✨ 彩蛋' })]
                : []),
            ]),
            h('p', { class: 'mt-0.5 text-xs text-[var(--fg-muted)]', textContent: `${categoryName(p.category)} · ${p.tags.join(' / ')}` }),
          ]),
        ]),
        h('button', {
          type: 'button',
          class:
            'shrink-0 rounded-md px-2 py-1 text-sm text-[var(--fg-muted)] hover:bg-[var(--bg)] hover:text-[var(--fg)]',
          'aria-label': '关闭',
          textContent: '✕',
          onclick: closeDetail,
        }),
      ]),
      // 方向切换行（仅双向提示词有）
      ...(directionRow ? [directionRow] : []),
      // 内容：变量输入 + 预览（可随方向切换重建）
      h('div', { class: 'flex-1 overflow-y-auto px-5 py-4' }, [bodyContent]),
    ]);

    detailOverlay.replaceChildren(modal);
    detailOverlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeDetail(): void {
    currentPrompt = null;
    detailOverlay.style.display = 'none';
    detailOverlay.replaceChildren();
    document.body.style.overflow = '';
  }

  // ESC 关闭弹层
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && detailOverlay.style.display === 'flex') closeDetail();
  });

  // ────────── 装配 ──────────
  content.append(
    h('p', {
      class: 'mb-5 text-sm text-[var(--fg-muted)]',
      textContent: '精选实用与趣味 AI 提示词模板。搜索、筛选、或点「灵机一动」随机发现灵感——填好你的内容，一键复制给 AI。全部在浏览器本地运行。',
    }),
    searchBar,
    h('div', { class: 'mt-4 space-y-2' }, [categoryRow, tagRow]),
    h('div', { class: 'mt-6' }, [featuredArea]),
    h('div', { class: 'mt-6 space-y-3' }, [gridHeader, grid, emptyHint]),
  );
  document.body.append(detailOverlay);

  renderCategoryRow();
  renderTagRow();
  renderGrid();
}

renderPromptHub();
