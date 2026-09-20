import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { createCopyButton } from '@/core/components/CopyButton';
import { copyText, downloadBlob } from '@/core/utils/clipboard';
import { FACETS, CATEGORY_ORDER, type StyleEntry, type FacetKey } from './types';
import { ALL_STYLES } from './data';
import { getAiSampleUrl } from './ai-samples';
import { loadFilter, saveFilter, type FilterState } from './settings';

initTheme();

/**
 * 设计风格图鉴 —— 多维检索 + AI 参考图 + 标签/提示词一键复制。
 *
 * 布局（自上而下）：
 *   1. 工具条：搜索框 + 🎲 随机灵感 + 🎛 筛选开关 + 清除
 *   2. 分栏主体：左侧可折叠筛选栏（五个维度胶囊，宽屏 sticky 吸附，
 *      收起时仅留"已选条件"摘要胶囊），右侧卡片网格随筛随看
 *   3. 卡片网格：AI 生成参考图 + 名称/徽章/简介/色板/标签
 *      标签双功能（借鉴音乐资料库）：左半=设为筛选条件，右半 ⧉=复制标签
 *   4. 详情弹层：参考大图（可下载）+ 特点/手法/配色/AI 标签/中英提示词
 *
 * 检索五个维度各自单选（再点取消），维度之间 AND；检索态持久化到 localStorage。
 */
function renderStyleAtlas(): void {
  const { content } = renderToolLayout(document.getElementById('app')!, '设计风格图鉴');

  // —— 状态 ——
  const filter: FilterState = loadFilter();

  function persist(): void {
    saveFilter({ ...filter, sel: { ...filter.sel } });
  }

  /** 卡片/详情共用的参考图；缺图时回退为配色渐变 + 图标占位（理论上有图必达） */
  function sampleMedia(s: StyleEntry, large: boolean): HTMLElement {
    const aiUrl = getAiSampleUrl(s.id);
    if (aiUrl) {
      return h('img', {
        src: aiUrl,
        alt: `${s.name}（${s.nameEn}）AI 生成参考图`,
        class: large
          ? 'block h-auto w-full'
          : 'block aspect-[4/3] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]',
        loading: 'lazy',
      });
    }
    const [c0, , c2] = s.palette.map((p) => p.hex);
    return h('div', {
      class: `flex aspect-[4/3] items-center justify-center ${large ? 'text-7xl' : 'text-5xl'}`,
      style: `background:linear-gradient(135deg, ${c0}, ${c2});`,
      textContent: s.icon,
    });
  }

  /** 小复制胶囊：点击复制 label，短暂变 ✓（用于特点/手法/情绪/场景/AI 标签） */
  function copyChip(label: string, title = `复制「${label}」`): HTMLButtonElement {
    const btn = h('button', {
      type: 'button',
      title,
      class:
        'rounded-full border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-xs text-[var(--fg-muted)] transition-all duration-150 hover:border-[var(--accent)] hover:text-[var(--accent)] cursor-copy',
      textContent: label,
      onclick: async () => {
        const ok = await copyText(label);
        const original = label;
        btn.textContent = ok ? '✓ 已复制' : '复制失败';
        btn.classList.add('!text-[var(--accent)]', '!border-[var(--accent)]');
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove('!text-[var(--accent)]', '!border-[var(--accent)]');
        }, 900);
      },
    });
    return btn;
  }

  // ────────── 1. 工具条 ──────────
  const searchInput = h('input', {
    type: 'search',
    placeholder: '搜索风格：包豪斯、霓虹、海报、治愈…',
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
    textContent: '🎲 随机灵感',
    title: '随机打开一种风格',
    onclick: () => {
      const pick = ALL_STYLES[Math.floor(Math.random() * ALL_STYLES.length)]!;
      openDetail(pick);
    },
  });

  const filterToggleBtn = h('button', {
    type: 'button',
    class:
      'shrink-0 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
    onclick: () => {
      filter.panelOpen = !filter.panelOpen;
      renderPanel();
      persist();
    },
  });

  const clearBtn = h('button', {
    type: 'button',
    class:
      'shrink-0 rounded-lg px-3 py-2.5 text-sm text-[var(--fg-muted)] transition-colors hover:text-[var(--accent)]',
    textContent: '清除',
    title: '清空关键词与全部筛选条件',
    onclick: () => {
      for (const k of Object.keys(filter.sel)) filter.sel[k as FacetKey] = null;
      filter.keyword = '';
      searchInput.value = '';
      syncChips();
      renderPanel();
      renderGrid();
      persist();
    },
  });

  const toolbar = h('div', { class: 'flex gap-2' }, [
    searchInput,
    randomBtn,
    filterToggleBtn,
    clearBtn,
  ]);

  // ────────── 2. 筛选侧栏（五维度胶囊，可折叠，宽屏 sticky） ──────────
  const asideWrap = h('aside', { class: 'shrink-0 lg:w-64 lg:self-stretch xl:w-72' });
  const chipButtons = new Map<string, HTMLButtonElement>(); // `${key}::${value}` → chip

  const panelHeader = h(
    'div',
    { class: 'flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5' },
    [
      h('span', {
        class: 'text-xs font-semibold text-[var(--fg)] select-none',
        textContent: '🎛 筛选条件',
      }),
      h('button', {
        type: 'button',
        title: '收起筛选栏，只留卡片网格',
        class:
          'rounded-md px-2 py-0.5 text-xs text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--fg)]',
        textContent: '收起 ⇤',
        onclick: () => {
          filter.panelOpen = false;
          renderPanel();
          persist();
        },
      }),
    ],
  );

  const facetRows = FACETS.map((f) =>
    h('div', { class: 'py-2' }, [
      h('div', {
        class: 'mb-1.5 text-xs font-semibold text-[var(--fg-muted)] select-none',
        textContent: `${f.icon} ${f.label}`,
      }),
      h(
        'div',
        { class: 'flex flex-wrap gap-1.5' },
        f.values.map((v) => {
          const btn = h('button', {
            type: 'button',
            'aria-pressed': 'false',
            class:
              'rounded-full border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-xs text-[var(--fg-muted)] transition-all duration-150 hover:border-[var(--accent)] hover:text-[var(--accent)]',
            textContent: v,
            onclick: () => {
              filter.sel[f.key] = filter.sel[f.key] === v ? null : v;
              syncChips();
              renderSummary();
              renderGrid();
              persist();
            },
          });
          chipButtons.set(`${f.key}::${v}`, btn);
          return btn;
        }),
      ),
    ]),
  );

  const panelEl = h(
    'div',
    {
      class:
        'rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] lg:sticky lg:top-4 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto',
    },
    [panelHeader, h('div', { class: 'divide-y divide-[var(--border)] px-4 py-2' }, facetRows)],
  );

  const summaryEl = h('div', { class: 'mt-2 hidden flex-wrap items-center gap-1.5 text-xs' });

  function activeCount(): number {
    return FACETS.filter((f) => filter.sel[f.key]).length;
  }

  function syncChips(): void {
    for (const f of FACETS) {
      for (const v of f.values) {
        const btn = chipButtons.get(`${f.key}::${v}`)!;
        const active = filter.sel[f.key] === v;
        btn.setAttribute('aria-pressed', String(active));
        btn.className = active
          ? 'rounded-full border border-[var(--accent)] bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--accent-fg)] transition-all duration-150'
          : 'rounded-full border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-xs text-[var(--fg-muted)] transition-all duration-150 hover:border-[var(--accent)] hover:text-[var(--accent)]';
      }
    }
  }

  function renderSummary(): void {
    const chosen = FACETS.filter((f) => filter.sel[f.key]);
    summaryEl.classList.toggle('hidden', filter.panelOpen || chosen.length === 0);
    summaryEl.classList.toggle('flex', !filter.panelOpen && chosen.length > 0);
    summaryEl.replaceChildren(
      h('span', { class: 'text-[var(--fg-muted)]', textContent: '已选：' }),
      ...chosen.map((f) => {
        const v = filter.sel[f.key]!;
        return h('button', {
          type: 'button',
          title: '点击移除该条件',
          class:
            'rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2.5 py-0.5 text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20',
          textContent: `${f.label}: ${v} ✕`,
          onclick: () => {
            filter.sel[f.key] = null;
            syncChips();
            renderSummary();
            renderGrid();
            persist();
          },
        });
      }),
    );
  }

  function renderPanel(): void {
    const n = activeCount();
    filterToggleBtn.textContent =
      (filter.panelOpen ? '🎛 收起筛选' : '🎛 筛选') + (n ? ` · ${n}` : '');
    filterToggleBtn.classList.toggle('!border-[var(--accent)]', n > 0);
    filterToggleBtn.classList.toggle('!text-[var(--accent)]', n > 0);
    asideWrap.style.display = filter.panelOpen ? '' : 'none';
    asideWrap.replaceChildren(...(filter.panelOpen ? [panelEl] : []));
    renderSummary();
  }

  // ────────── 3. 卡片网格 ──────────
  const gridHeader = h('div', { class: 'flex items-center justify-between' }, []);
  const grid = h('div', { class: 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3' });
  const emptyHint = h('div', {
    class:
      'rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] px-6 py-10 text-center text-sm text-[var(--fg-muted)]',
    textContent: '没有匹配的风格，换个关键词或减少筛选条件试试～',
  });

  function matches(s: StyleEntry): boolean {
    const kw = filter.keyword.trim().toLowerCase();
    if (kw) {
      const hay = [
        s.name,
        s.nameEn,
        s.desc,
        s.background,
        s.category,
        s.era,
        ...s.moods,
        ...s.scenes,
        ...s.traits,
        ...s.techniques,
        ...s.keywords,
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    for (const f of FACETS) {
      const sel = filter.sel[f.key];
      if (!sel) continue;
      const v: string | string[] = s[f.key];
      if (Array.isArray(v) ? !v.includes(sel) : v !== sel) return false;
    }
    return true;
  }

  let firstPaint = true;

  function renderGrid(): void {
    const list = ALL_STYLES.filter(matches);
    gridHeader.replaceChildren(
      h('span', {
        class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]',
        textContent: list.length > 0 ? `共 ${list.length} 种风格` : '风格',
      }),
      h('span', {
        class: 'text-xs text-[var(--fg-muted)]',
        textContent: '点标签=筛选 · 点 ⧉=复制 · 点卡片看详情',
      }),
    );
    grid.replaceChildren(
      ...list.map((s, i) => {
        const card = styleCard(s);
        if (firstPaint) {
          card.classList.add('stagger-item');
          card.style.setProperty('--stagger-index', String(i));
        }
        return card;
      }),
    );
    if (firstPaint) {
      grid.classList.add('stagger-ready');
      firstPaint = false;
    }
    grid.style.display = list.length > 0 ? '' : 'none';
    emptyHint.style.display = list.length > 0 ? 'none' : '';
  }

  /** 双功能标签（借鉴音乐资料库）：左半文字=设为筛选条件，右半 ⧉=复制文字 */
  function dualTag(text: string, facetKey: FacetKey, colorCls: string): HTMLElement {
    const left = h('span', {
      class: 'cursor-pointer px-2 py-0.5 hover:underline',
      title: `筛选「${text}」`,
      textContent: text,
      onclick: (e: MouseEvent) => {
        e.stopPropagation();
        filter.sel[facetKey] = filter.sel[facetKey] === text ? null : text;
        syncChips();
        renderPanel();
        renderGrid();
        persist();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    });
    const right = h('span', {
      class:
        'cursor-copy border-l border-dashed border-[var(--border)] px-1.5 py-0.5 opacity-50 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10',
      title: `复制「${text}」`,
      textContent: '⧉',
      onclick: async (e: MouseEvent) => {
        e.stopPropagation();
        const ok = await copyText(text);
        right.textContent = ok ? '✓' : '✕';
        right.classList.add('!opacity-100');
        setTimeout(() => {
          right.textContent = '⧉';
          right.classList.remove('!opacity-100');
        }, 900);
      },
    });
    return h(
      'span',
      {
        class: `inline-flex items-stretch overflow-hidden rounded-full border text-[10px] select-none ${colorCls}`,
      },
      [left, right],
    );
  }

  /** 卡片内小色板：点击复制 hex */
  function miniSwatch(hex: string, name: string): HTMLButtonElement {
    const btn = h('button', {
      type: 'button',
      title: `${name} ${hex}（点击复制）`,
      'aria-label': `复制色值 ${hex}`,
      class:
        'h-4 flex-1 cursor-copy text-[8px] leading-none text-transparent transition-all hover:scale-y-125',
      style: `background:${hex};`,
      onclick: async (e: MouseEvent) => {
        e.stopPropagation();
        const ok = await copyText(hex);
        btn.textContent = ok ? '✓' : '✕';
        setTimeout(() => (btn.textContent = ''), 700);
      },
    });
    return btn;
  }

  function styleCard(s: StyleEntry): HTMLElement {
    const sampleBox = h(
      'div',
      { class: 'overflow-hidden rounded-t-xl border-b border-[var(--border)] bg-[var(--bg)]' },
      [sampleMedia(s, false)],
    );

    return h(
      'div',
      {
        role: 'button',
        tabindex: '0',
        'aria-label': `${s.name} ${s.nameEn}`,
        class:
          'group relative cursor-pointer overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] transition-all duration-200 hover:-translate-y-1 hover:border-[var(--accent)] hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
        onclick: () => openDetail(s),
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openDetail(s);
          }
        },
      },
      [
        sampleBox,
        h('div', { class: 'p-3.5' }, [
          h('div', { class: 'flex items-baseline gap-2' }, [
            h('span', { class: 'text-lg leading-none', textContent: s.icon }),
            h('span', { class: 'font-medium text-[var(--fg)]', textContent: s.name }),
            h('span', {
              class: 'text-xs italic text-[var(--fg-muted)]',
              textContent: s.nameEn,
            }),
          ]),
          h('div', { class: 'mt-1.5 flex flex-wrap gap-1' }, [
            h('span', {
              class:
                'rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]',
              textContent: s.category,
            }),
            h('span', {
              class:
                'rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--fg-muted)]',
              textContent: s.era,
            }),
            ...s.moods.slice(0, 2).map((m) =>
              h('span', {
                class:
                  'rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--fg-muted)]',
                textContent: m,
              }),
            ),
          ]),
          h('p', {
            class: 'mt-2 text-xs leading-relaxed text-[var(--fg-muted)] line-clamp-2',
            textContent: s.desc,
          }),
          h(
            'div',
            { class: 'mt-2.5 flex overflow-hidden rounded-md' },
            s.palette.map((p) => miniSwatch(p.hex, p.name)),
          ),
          h(
            'div',
            { class: 'mt-2.5 flex flex-wrap gap-1' },
            s.traits.map((t) =>
              dualTag(
                t,
                'traits',
                'border-[var(--accent)]/25 bg-[var(--accent)]/8 text-[var(--accent)]',
              ),
            ),
          ),
        ]),
      ],
    );
  }

  // ────────── 4. 详情弹层 ──────────
  const detailOverlay = h('div', {
    class: 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4 backdrop-blur-sm',
    role: 'dialog',
    'aria-modal': 'true',
    onclick: (e: Event) => {
      if (e.target === detailOverlay) closeDetail();
    },
  });

  /** 详情分区标题 */
  function sectionTitle(text: string): HTMLElement {
    return h('div', {
      class: 'mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]',
      textContent: text,
    });
  }

  /** 大色板（详情用）：色块 + 名称 + hex，整块点击复制 */
  function bigSwatch(hex: string, name: string): HTMLButtonElement {
    const label = h('span', {
      class: 'mt-1 block font-mono text-[10px] text-[var(--fg-muted)]',
      textContent: hex,
    });
    const btn = h(
      'button',
      {
        type: 'button',
        title: `复制 ${hex}`,
        class:
          'group/swatch cursor-copy overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] text-left transition-all hover:border-[var(--accent)]',
        onclick: async () => {
          const ok = await copyText(hex);
          label.textContent = ok ? '已复制 ✓' : '复制失败';
          setTimeout(() => (label.textContent = hex), 900);
        },
      },
      [
        h('div', { class: 'h-10 w-full', style: `background:${hex};` }),
        h('div', { class: 'px-1.5 py-1' }, [
          h('span', { class: 'block truncate text-[10px] text-[var(--fg)]', textContent: name }),
          label,
        ]),
      ],
    );
    return btn;
  }

  /** 提示词卡片：标题 + 复制按钮 + 只读文本域 */
  function promptBlock(title: string, text: string, rows = 3): HTMLElement {
    const area = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-xs leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows,
      readonly: true,
      value: text,
    }) as HTMLTextAreaElement;
    return h('div', { class: 'space-y-1.5' }, [
      h('div', { class: 'flex items-center justify-between' }, [
        sectionTitle(title),
        createCopyButton(() => area.value, '复制', '已复制 ✓'),
      ]),
      area,
    ]);
  }

  function openDetail(s: StyleEntry): void {
    // AI 参考图（按本词条英文提示词离线生成，全部词条均有图）
    const aiUrl = getAiSampleUrl(s.id);

    let downloadBtn: HTMLButtonElement | null = null;
    if (aiUrl) {
      const btn = h('button', {
        type: 'button',
        class:
          'inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
        textContent: '⬇ 下载参考图',
        title: '下载 AI 生成参考图（webp），可当作 AI 绘图的风格参考',
        onclick: async () => {
          btn.disabled = true;
          btn.textContent = '下载中…';
          try {
            const blob = await (await fetch(aiUrl)).blob();
            downloadBlob(blob, `${s.id}-${s.nameEn}.webp`);
            btn.textContent = '已下载 ✓';
          } catch {
            btn.textContent = '下载失败';
          }
          setTimeout(() => {
            btn.textContent = '⬇ 下载参考图';
            btn.disabled = false;
          }, 1500);
        },
      });
      downloadBtn = btn;
    }

    const allKeywords = () => s.keywords.join(', ');

    const body = h('div', { class: 'flex-1 overflow-y-auto px-5 py-4' }, [
      h('div', { class: 'mb-4' }, [
        h('div', { class: 'overflow-hidden rounded-xl border border-[var(--border)]' }, [
          sampleMedia(s, true),
        ]),
        h('div', { class: 'mt-1.5 flex flex-wrap items-center justify-between gap-2' }, [
          h('span', {
            class: 'text-[11px] text-[var(--fg-muted)]',
            textContent: 'AI 生成参考图（按本词条英文提示词离线生成）',
          }),
          ...(downloadBtn ? [downloadBtn] : []),
        ]),
      ]),

      h('p', { class: 'text-sm leading-relaxed text-[var(--fg)]', textContent: s.desc }),
      h('div', { class: 'mt-3 rounded-lg bg-[var(--bg)] p-3' }, [
        sectionTitle('背景与创作思路'),
        h('p', {
          class: 'text-xs leading-relaxed text-[var(--fg-muted)]',
          textContent: s.background,
        }),
      ]),

      h('div', { class: 'mt-4' }, [
        sectionTitle('视觉特点 · 点击复制'),
        h(
          'div',
          { class: 'flex flex-wrap gap-1.5' },
          s.traits.map((t) => copyChip(t)),
        ),
      ]),
      h('div', { class: 'mt-4' }, [
        sectionTitle('创作手法 · 点击复制'),
        h(
          'div',
          { class: 'flex flex-wrap gap-1.5' },
          s.techniques.map((t) => copyChip(t)),
        ),
      ]),
      h('div', { class: 'mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2' }, [
        h('div', {}, [
          sectionTitle('情绪气质 · 点击复制'),
          h(
            'div',
            { class: 'flex flex-wrap gap-1.5' },
            s.moods.map((m) => copyChip(m)),
          ),
        ]),
        h('div', {}, [
          sectionTitle('适用场景 · 点击复制'),
          h(
            'div',
            { class: 'flex flex-wrap gap-1.5' },
            s.scenes.map((sc) => copyChip(sc)),
          ),
        ]),
      ]),

      h('div', { class: 'mt-4' }, [
        sectionTitle('代表配色 · 点击色块复制 hex'),
        h(
          'div',
          { class: 'grid grid-cols-5 gap-1.5' },
          s.palette.map((p) => bigSwatch(p.hex, p.name)),
        ),
      ]),

      h('div', { class: 'mt-4' }, [
        h('div', { class: 'mb-2 flex items-center justify-between' }, [
          sectionTitle('AI 风格标签 · 点击单枚复制'),
          createCopyButton(allKeywords, '复制全部标签', '已复制 ✓'),
        ]),
        h(
          'div',
          { class: 'flex flex-wrap gap-1.5' },
          s.keywords.map((k) => copyChip(k, `复制「${k}」`)),
        ),
      ]),

      h('div', { class: 'mt-4 space-y-4' }, [
        promptBlock('英文 AI 提示词（Midjourney / SD 等）', s.prompt, 3),
        promptBlock('中文 AI 提示词', s.promptZh, 3),
      ]),
    ]);

    const modal = h(
      'div',
      {
        class:
          'flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl',
      },
      [
        h(
          'div',
          {
            class:
              'flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4',
          },
          [
            h('div', { class: 'flex items-start gap-2.5' }, [
              h('span', { class: 'text-2xl leading-none', textContent: s.icon }),
              h('div', {}, [
                h('div', { class: 'flex flex-wrap items-center gap-2' }, [
                  h('span', { class: 'font-medium text-[var(--fg)]', textContent: s.name }),
                  h('span', {
                    class: 'text-sm italic text-[var(--fg-muted)]',
                    textContent: s.nameEn,
                  }),
                ]),
                h('p', {
                  class: 'mt-0.5 text-xs text-[var(--fg-muted)]',
                  textContent: `${s.category} · ${s.era}`,
                }),
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
          ],
        ),
        body,
      ],
    );

    detailOverlay.replaceChildren(modal);
    detailOverlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeDetail(): void {
    detailOverlay.style.display = 'none';
    detailOverlay.replaceChildren();
    document.body.style.overflow = '';
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && detailOverlay.style.display === 'flex') closeDetail();
  });

  // ────────── 装配 ──────────
  content.append(
    h('p', {
      class: 'mb-5 text-sm text-[var(--fg-muted)]',
      textContent: `${ALL_STYLES.length} 种经典与当代视觉风格 × ${CATEGORY_ORDER.length} 大谱系，从五个维度（大类 / 年代 / 情绪 / 特征 / 场景）对照学习：每种风格都有 AI 生成参考图、特点手法解析、代表配色，以及可直接复制给 AI 绘图工具的标签与中英提示词。左侧筛选栏可折叠，宽屏下吸附在侧，边筛选边看结果。全部在浏览器本地运行。`,
    }),
    toolbar,
    summaryEl,
    h('div', { class: 'mt-4 flex flex-col gap-5 lg:flex-row lg:items-start' }, [
      asideWrap,
      h('div', { class: 'min-w-0 flex-1 space-y-3' }, [gridHeader, grid, emptyHint]),
    ]),
  );
  document.body.append(detailOverlay);

  syncChips();
  renderPanel();
  renderGrid();
}

renderStyleAtlas();
