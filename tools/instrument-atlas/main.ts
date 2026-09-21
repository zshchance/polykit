import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { createCopyButton } from '@/core/components/CopyButton';
import { copyText } from '@/core/utils/clipboard';
import { FACETS, FAMILY_ORDER, type InstrumentEntry, type FacetKey } from './types';
import { ALL_INSTRUMENTS, getInstrumentById } from './data';
import { getPhotoUrl, getAudioUrl, getCredits, type MediaCredit } from './media';
import { loadFilter, saveFilter, type FilterState } from './settings';

initTheme();

/**
 * 乐器百科 —— 多维检索 + 实物照片 + 声音样本试听 + 标签一键复制。
 *
 * 布局（自上而下）：
 *   1. 工具条：搜索框 + 🎲 随机乐器 + 🎛 筛选开关 + 清除
 *   2. 分栏主体：左侧可折叠筛选栏（五个维度胶囊，宽屏 sticky 吸附，
 *      收起时仅留"已选条件"摘要胶囊），右侧卡片网格随筛随看
 *   3. 卡片网格：实物照片（右下角 ▶ 试听）+ 名称（⧉ 复制）/徽章/简介/情绪标签
 *      标签双功能（借鉴风格图鉴）：左半=设为筛选条件，右半 ⧉=复制标签
 *   4. 详情弹层：大图 + 音频播放器（进度条/时间）+ 特点/技巧/情绪/曲风/角色/
 *      搭配乐器（点击跳转相关乐器）/代表曲目/小知识/AI 标签与提示词
 *
 * 检索五个维度各自单选（再点取消），维度之间 AND；检索态持久化到 localStorage。
 * 全站共享一个 Audio 实例，同时只有一个乐器在发声。
 */
function renderInstrumentAtlas(): void {
  const { content } = renderToolLayout(document.getElementById('app')!, '乐器百科');

  // —— 状态 ——
  const filter: FilterState = loadFilter();

  function persist(): void {
    saveFilter({ ...filter, sel: { ...filter.sel } });
  }

  // —— 全局唯一音频实例 ——
  const player = new Audio();
  player.preload = 'none';
  let playingId: string | null = null;
  const playButtons = new Map<string, HTMLButtonElement>(); // id → 卡片上的 ▶ 按钮

  function syncPlayButtons(): void {
    for (const [id, btn] of playButtons) {
      btn.textContent = id === playingId ? '⏸' : '▶';
      btn.classList.toggle('!bg-[var(--accent)]', id === playingId);
      btn.classList.toggle('!text-[var(--accent-fg)]', id === playingId);
      btn.classList.toggle('!border-[var(--accent)]', id === playingId);
    }
  }

  function stopAudio(): void {
    player.pause();
    playingId = null;
    syncPlayButtons();
  }

  /** 卡片/详情共用：切换某乐器的播放状态 */
  function togglePlay(id: string): void {
    if (playingId === id) {
      stopAudio();
      return;
    }
    const url = getAudioUrl(id);
    if (!url) return;
    player.src = url;
    void player.play().catch(() => {
      playingId = null;
      syncPlayButtons();
    });
    playingId = id;
    syncPlayButtons();
  }

  player.addEventListener('ended', () => {
    playingId = null;
    syncPlayButtons();
  });

  /** 卡片/详情共用的照片；缺图时回退为渐变 + 图标占位。
   *  竖长图（二胡/大提琴等全貌照，高宽比 > 1.4）用 cover 只会露出局部——
   *  加载后自动切换为 contain 完整展示，两侧以背景色留白。 */
  function photoMedia(s: InstrumentEntry, large: boolean): HTMLElement {
    const url = getPhotoUrl(s.id);
    if (url) {
      return h('img', {
        src: url,
        alt: `${s.name}（${s.nameEn}）实物照片`,
        class: large
          ? 'mx-auto block h-auto max-h-80 w-full object-cover'
          : 'block aspect-[4/3] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]',
        loading: 'lazy',
        onload: (e: Event) => {
          const img = e.target as HTMLImageElement;
          if (img.naturalWidth && img.naturalHeight / img.naturalWidth > 1.4) {
            img.classList.remove('object-cover');
            img.classList.add('object-contain', 'bg-[var(--bg)]');
            if (large) {
              // 详情页竖图限高在视口 60% 内完整居中显示：
              // 全宽放开会把 2000px+ 的图推满弹层，正文被挤出首屏
              img.classList.replace('max-h-80', 'max-h-[60vh]');
            }
          }
        },
      });
    }
    return h('div', {
      class: `flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-[var(--accent)]/20 to-[var(--accent)]/5 ${large ? 'text-7xl' : 'text-5xl'}`,
      textContent: s.icon,
    });
  }

  /** 小复制胶囊：点击复制 label，短暂变 ✓（用于特点/技巧/情绪/曲风/角色/AI 标签） */
  function copyChip(label: string, title = `复制「${label}」`): HTMLButtonElement {
    const btn = h('button', {
      type: 'button',
      title,
      class:
        'rounded-full border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-xs text-[var(--fg-muted)] transition-all duration-150 hover:border-[var(--accent)] hover:text-[var(--accent)] cursor-copy',
      textContent: label,
      onclick: async () => {
        const ok = await copyText(label);
        btn.textContent = ok ? '✓ 已复制' : '复制失败';
        btn.classList.add('!text-[var(--accent)]', '!border-[var(--accent)]');
        setTimeout(() => {
          btn.textContent = label;
          btn.classList.remove('!text-[var(--accent)]', '!border-[var(--accent)]');
        }, 900);
      },
    });
    return btn;
  }

  // ────────── 1. 工具条 ──────────
  const searchInput = h('input', {
    type: 'search',
    placeholder: '搜索乐器：钢琴、二胡、史诗、低音、影视…',
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
    textContent: '🎲 随机乐器',
    title: '随机打开一件乐器',
    onclick: () => {
      const pick = ALL_INSTRUMENTS[Math.floor(Math.random() * ALL_INSTRUMENTS.length)]!;
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
    textContent: '没有匹配的乐器，换个关键词或减少筛选条件试试～',
  });

  function matches(s: InstrumentEntry): boolean {
    const kw = filter.keyword.trim().toLowerCase();
    if (kw) {
      const hay = [
        s.name,
        s.nameEn,
        s.desc,
        s.background,
        s.family,
        s.range,
        s.difficulty,
        ...s.moods,
        ...s.genres,
        ...s.roles,
        ...s.timbre,
        ...s.techniques,
        ...s.exemplars,
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
    const list = ALL_INSTRUMENTS.filter(matches);
    playButtons.clear();
    gridHeader.replaceChildren(
      h('span', {
        class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]',
        textContent: list.length > 0 ? `共 ${list.length} 件乐器` : '乐器',
      }),
      h('span', {
        class: 'text-xs text-[var(--fg-muted)]',
        textContent: '点标签=筛选 · 点 ⧉=复制 · ▶=试听 · 点卡片看详情',
      }),
    );
    grid.replaceChildren(
      ...list.map((s, i) => {
        const card = instrumentCard(s);
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
    syncPlayButtons();
  }

  /** 双功能标签（同风格图鉴）：左半文字=设为筛选条件，右半 ⧉=复制文字 */
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

  /** 复制名称按钮（卡片与详情共用）：复制「中文名 英文名」 */
  function copyNameBtn(s: InstrumentEntry, extraCls = ''): HTMLButtonElement {
    const text = `${s.name} ${s.nameEn}`;
    const btn = h('button', {
      type: 'button',
      title: `复制名称「${text}」`,
      'aria-label': `复制名称 ${text}`,
      class: `cursor-copy text-[var(--fg-muted)] opacity-50 transition-opacity hover:opacity-100 ${extraCls}`,
      textContent: '⧉',
      onclick: async (e: MouseEvent) => {
        e.stopPropagation();
        const ok = await copyText(text);
        btn.textContent = ok ? '✓' : '✕';
        setTimeout(() => (btn.textContent = '⧉'), 800);
      },
    });
    return btn;
  }

  function instrumentCard(s: InstrumentEntry): HTMLElement {
    // 试听按钮（有音频才渲染）
    let playBtn: HTMLButtonElement | null = null;
    if (getAudioUrl(s.id)) {
      playBtn = h('button', {
        type: 'button',
        title: `试听 ${s.name} 的声音样本`,
        'aria-label': `试听 ${s.name}`,
        class:
          'absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-black/55 text-sm text-white backdrop-blur-sm transition-all hover:scale-110 hover:bg-[var(--accent)]',
        textContent: '▶',
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          togglePlay(s.id);
        },
      });
      playButtons.set(s.id, playBtn);
    }

    const photoBox = h(
      'div',
      {
        class:
          'relative overflow-hidden rounded-t-xl border-b border-[var(--border)] bg-[var(--bg)]',
      },
      [photoMedia(s, false), ...(playBtn ? [playBtn] : [])],
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
        photoBox,
        h('div', { class: 'p-3.5' }, [
          h('div', { class: 'flex items-baseline gap-2' }, [
            h('span', { class: 'shrink-0 text-lg leading-none', textContent: s.icon }),
            h('span', {
              class: 'shrink-0 font-medium text-[var(--fg)]',
              textContent: s.name,
            }),
            h('span', {
              class: 'min-w-0 truncate text-xs italic text-[var(--fg-muted)]',
              textContent: s.nameEn,
            }),
            h('span', { class: 'ml-auto shrink-0 text-xs' }, [copyNameBtn(s)]),
          ]),
          h('div', { class: 'mt-1.5 flex flex-wrap gap-1' }, [
            h('span', {
              class:
                'rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]',
              textContent: s.family,
            }),
            h('span', {
              class:
                'rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--fg-muted)]',
              textContent: s.range,
            }),
            h('span', {
              class:
                'rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--fg-muted)]',
              textContent: s.difficulty,
            }),
          ]),
          h('p', {
            class: 'mt-2 text-xs leading-relaxed text-[var(--fg-muted)] line-clamp-2',
            textContent: s.desc,
          }),
          h(
            'div',
            { class: 'mt-2.5 flex flex-wrap gap-1' },
            s.moods
              .slice(0, 3)
              .map((m) =>
                dualTag(
                  m,
                  'moods',
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

  /** 详情页音频播放器：播放/暂停 + 进度条（点击跳转）+ 时间 */
  function audioPlayer(s: InstrumentEntry): HTMLElement | null {
    if (!getAudioUrl(s.id)) return null;

    const playPause = h('button', {
      type: 'button',
      'aria-label': '播放/暂停',
      class:
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-sm text-[var(--accent-fg)] transition-transform hover:scale-105',
      textContent: '▶',
      onclick: () => togglePlay(s.id),
    });

    const fill = h('div', {
      class: 'h-full w-0 rounded-full bg-[var(--accent)] transition-[width] duration-150',
    });
    const bar = h(
      'div',
      {
        class: 'h-2 flex-1 cursor-pointer overflow-hidden rounded-full bg-[var(--border)]/60',
        title: '点击跳转播放位置',
        onclick: (e: MouseEvent) => {
          if (playingId !== s.id) return;
          const rect = bar.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
          if (Number.isFinite(player.duration)) player.currentTime = ratio * player.duration;
        },
      },
      [fill],
    );

    const timeEl = h('span', {
      class: 'w-20 shrink-0 text-right font-mono text-[10px] text-[var(--fg-muted)]',
      textContent: '0:00 / 0:00',
    });

    const fmt = (sec: number): string => {
      if (!Number.isFinite(sec)) return '0:00';
      const m = Math.floor(sec / 60);
      const r = Math.floor(sec % 60);
      return `${m}:${String(r).padStart(2, '0')}`;
    };

    const tick = (): void => {
      const active = playingId === s.id;
      playPause.textContent = active && !player.paused ? '⏸' : '▶';
      const cur = active ? player.currentTime : 0;
      const dur = active && Number.isFinite(player.duration) ? player.duration : 0;
      fill.style.width = dur ? `${(cur / dur) * 100}%` : '0%';
      timeEl.textContent = `${fmt(cur)} / ${fmt(dur)}`;
      if (active && !player.paused) requestAnimationFrame(tick);
    };
    player.addEventListener('timeupdate', tick);
    player.addEventListener('play', () => requestAnimationFrame(tick));
    player.addEventListener('pause', tick);
    playButtons.set(s.id, playPause);

    return h(
      'div',
      {
        class:
          'mt-2 flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5',
      },
      [playPause, bar, timeEl],
    );
  }

  /** 素材署名行（Wikimedia Commons 作者/许可，有源链接时可点击跳转） */
  function creditsLine(s: InstrumentEntry): HTMLElement | null {
    const c = getCredits(s.id);
    if (!c?.photo && !c?.audio) return null;
    const bits: HTMLElement[] = [];
    const credit = (label: string, info: MediaCredit): HTMLElement => {
      const text = `${label} © ${info.artist}（${info.license}）`;
      if (!info.source) {
        return h('span', { title: `${label}：${info.title}`, textContent: text });
      }
      return h('a', {
        href: info.source,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: `${label}：${info.title} · ${info.artist} · ${info.license}（点击查看来源）`,
        class: 'underline decoration-dotted underline-offset-2 hover:text-[var(--accent)]',
        textContent: text,
      });
    };
    if (c.photo) bits.push(credit('图片', c.photo));
    if (c.audio) bits.push(credit('音频', c.audio));
    return h(
      'div',
      { class: 'mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--fg-muted)]' },
      [
        h('span', { textContent: '素材：' }),
        ...bits,
        h('span', { textContent: '· 均来自 Wikimedia Commons' }),
      ],
    );
  }

  /** 搭配乐器胶囊：左半（图标+名称）= 跳转该乐器详情，右半 ⧉= 复制名称 */
  function pairingChip(targetId: string): HTMLElement {
    const t = getInstrumentById(targetId);
    if (!t) return h('span');
    const text = `${t.name} ${t.nameEn}`;
    const left = h('span', {
      class: 'inline-flex cursor-pointer items-center gap-1 px-2 py-1 hover:underline',
      title: `查看「${t.name}」的百科介绍`,
      textContent: `${t.icon} ${t.name}`,
      onclick: () => openDetail(t),
    });
    const right = h('span', {
      class:
        'inline-flex cursor-copy items-center border-l border-dashed border-[var(--border)] px-1.5 opacity-50 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10',
      title: `复制名称「${text}」`,
      textContent: '⧉',
      onclick: async (e: MouseEvent) => {
        e.stopPropagation();
        const ok = await copyText(text);
        right.textContent = ok ? '✓' : '✕';
        setTimeout(() => (right.textContent = '⧉'), 800);
      },
    });
    return h(
      'span',
      {
        class:
          'inline-flex items-stretch overflow-hidden rounded-full border border-[var(--border)] bg-[var(--bg)] text-xs text-[var(--fg)] transition-colors hover:border-[var(--accent)] select-none',
      },
      [left, right],
    );
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

  function openDetail(s: InstrumentEntry): void {
    stopAudio();

    const factsRows: [string, string | undefined][] = [
      ['起源', s.facts.origin],
      ['年代', s.facts.era],
      ['别名', s.facts.alias],
      ['调性/定弦', s.facts.tuning],
    ];

    const playerEl = audioPlayer(s);
    const credits = creditsLine(s);

    const nameTitle = h('span', {
      class: 'cursor-copy font-medium text-[var(--fg)] hover:text-[var(--accent)]',
      title: `点击复制名称「${s.name} ${s.nameEn}」`,
      textContent: s.name,
      onclick: async () => {
        const ok = await copyText(`${s.name} ${s.nameEn}`);
        nameTitle.textContent = ok ? `${s.name} ✓` : s.name;
        setTimeout(() => (nameTitle.textContent = s.name), 800);
      },
    });

    const body = h('div', { class: 'flex-1 overflow-y-auto px-5 py-4' }, [
      h('div', { class: 'mb-4' }, [
        h('div', { class: 'overflow-hidden rounded-xl border border-[var(--border)]' }, [
          photoMedia(s, true),
        ]),
        ...(playerEl ? [playerEl] : []),
        ...(credits ? [credits] : []),
      ]),

      h('p', { class: 'text-sm leading-relaxed text-[var(--fg)]', textContent: s.desc }),
      h('div', { class: 'mt-3 rounded-lg bg-[var(--bg)] p-3' }, [
        sectionTitle('背景与编曲应用'),
        h('p', {
          class: 'text-xs leading-relaxed text-[var(--fg-muted)]',
          textContent: s.background,
        }),
      ]),

      h('div', { class: 'mt-4' }, [
        sectionTitle('音色特点 · 点击复制'),
        h(
          'div',
          { class: 'flex flex-wrap gap-1.5' },
          s.timbre.map((t) => copyChip(t)),
        ),
      ]),
      h('div', { class: 'mt-4' }, [
        sectionTitle('常用技巧 · 点击复制'),
        h(
          'div',
          { class: 'flex flex-wrap gap-1.5' },
          s.techniques.map((t) => copyChip(t)),
        ),
      ]),
      h('div', { class: 'mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2' }, [
        h('div', {}, [
          sectionTitle('常见情绪 · 点击复制'),
          h(
            'div',
            { class: 'flex flex-wrap gap-1.5' },
            s.moods.map((m) => copyChip(m)),
          ),
        ]),
        h('div', {}, [
          sectionTitle('适合曲风 · 点击复制'),
          h(
            'div',
            { class: 'flex flex-wrap gap-1.5' },
            s.genres.map((g) => copyChip(g)),
          ),
        ]),
      ]),
      h('div', { class: 'mt-4' }, [
        sectionTitle('编曲角色 · 点击复制'),
        h(
          'div',
          { class: 'flex flex-wrap gap-1.5' },
          s.roles.map((r) => copyChip(r)),
        ),
      ]),

      h('div', { class: 'mt-4' }, [
        sectionTitle('适合搭配 · 点击名称查看该乐器，点 ⧉ 复制'),
        h(
          'div',
          { class: 'flex flex-wrap gap-1.5' },
          s.pairing.map((p) => pairingChip(p)),
        ),
      ]),

      h('div', { class: 'mt-4' }, [
        sectionTitle('代表曲目 · 点击复制'),
        h(
          'div',
          { class: 'flex flex-wrap gap-1.5' },
          s.exemplars.map((e) => copyChip(e)),
        ),
      ]),

      h('div', { class: 'mt-4' }, [
        sectionTitle('小知识'),
        h(
          'div',
          { class: 'grid grid-cols-1 gap-1.5 sm:grid-cols-2' },
          factsRows
            .filter(([, v]) => v)
            .map(([k, v]) =>
              h('div', { class: 'flex gap-2 rounded-lg bg-[var(--bg)] px-3 py-2 text-xs' }, [
                h('span', { class: 'shrink-0 text-[var(--fg-muted)]', textContent: k }),
                h('span', { class: 'text-[var(--fg)]', textContent: v! }),
              ]),
            ),
        ),
      ]),

      h('div', { class: 'mt-4' }, [
        h('div', { class: 'mb-2 flex items-center justify-between' }, [
          sectionTitle('AI 音乐标签 · 点击单枚复制'),
          createCopyButton(() => s.keywords.join(', '), '复制全部标签', '已复制 ✓'),
        ]),
        h(
          'div',
          { class: 'flex flex-wrap gap-1.5' },
          s.keywords.map((k) => copyChip(k, `复制「${k}」`)),
        ),
      ]),

      h('div', { class: 'mt-4' }, [
        promptBlock('AI 音乐提示词（Suno / Udio / 编曲参考）', s.prompt, 3),
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
                  nameTitle,
                  copyNameBtn(s),
                  h('span', {
                    class: 'text-sm italic text-[var(--fg-muted)]',
                    textContent: s.nameEn,
                  }),
                ]),
                h('p', {
                  class: 'mt-0.5 text-xs text-[var(--fg-muted)]',
                  textContent: `${s.family} · ${s.range} · ${s.difficulty}`,
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
    stopAudio();
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
      textContent: `${ALL_INSTRUMENTS.length} 件乐器 × ${FAMILY_ORDER.length} 大谱系，从五个维度（大类 / 音域 / 情绪 / 曲风 / 编曲角色）对照学习：每件乐器都有实物照片、声音样本试听（点卡片右下角 ▶）、音色特点与技巧解析、编曲搭配推荐（可点击跳转），以及可直接复制给 Suno 等 AI 音乐工具的标签与提示词。素材来自 Wikimedia Commons，全部在浏览器本地运行。`,
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

renderInstrumentAtlas();
