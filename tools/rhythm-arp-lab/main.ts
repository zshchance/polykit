import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { createCopyButton } from '@/core/components/CopyButton';
import { createDialog } from '@/core/components/Dialog';
import { copyText } from '@/core/utils/clipboard';
import { RHYTHM_FACETS, ARP_FACETS, type RhythmPattern, type ArpPattern, type Mood } from './types';
import { ALL_RHYTHMS, ALL_ARPS } from './data';
import { DrumSynth } from './engine/synth';
import { StepScheduler } from './engine/scheduler';
import { Mixer, fuseSkeleton, type MixerState, type MixMode } from './engine/mixer';
import { diatonicPads, chordName, padRootMidi, ROOT_NAMES, type Tonality } from './engine/harmony';
import { buildPromptEn, buildPromptZh, type ComboContext } from './prompt';
import { loadState, saveState, BPM_MIN, BPM_MAX, type LabState, type LabTab } from './settings';

initTheme();

/** 鼓轨配色（琶音轨用 --accent） */
const TRACK_ROWS = [
  { key: 'kick', label: '底鼓', color: '#f43f5e' },
  { key: 'snare', label: '军鼓', color: '#f59e0b' },
  { key: 'hat', label: '踩镲', color: '#94a3b8' },
] as const;

/** 和弦垫物理键位（A-K 一行） */
const PAD_KEYS = 'asdfghjk';
const STEPS_PER_BAR = 16;

/**
 * 节奏琶音工坊 —— 鼓组律动 × 琶音模式的选型 / 试听 / 提示词工作台。
 *
 * 布局（自上而下）：
 *   1. 工具条：搜索 + 🎲 随机组合 + 🎛 筛选开关 + 清除
 *   2. 双库浏览：Tab（鼓组律动 / 琶音模式）+ 可折叠维度胶囊筛选 + 卡片网格
 *      （点卡片 = 选入工作台；▶ = 独奏试听；ⓘ = 详情弹层）
 *   3. 试听工作台：传输 / BPM / 调性 / 混合模式控制，4×16 步进网格播放头，
 *      8 枚和弦垫（物理键盘 A-K 实时换和声，Z/X 移调，Q/E 大小调，空格启停）
 *   4. 提示词工坊：按当前组合拼装中英双语 AI 音乐提示词，一键复制
 *
 * 音频全部由 Web Audio 实时合成（零音频资产）；检索态与组合状态持久化到 localStorage。
 */
function renderLab(): void {
  const { content } = renderToolLayout(document.getElementById('app')!, '节奏琶音工坊');

  // ────────── 状态与引擎 ──────────
  const state: LabState = loadState();
  const synth = new DrumSynth();

  function selectedRhythm(): RhythmPattern | null {
    return ALL_RHYTHMS.find((r) => r.id === state.rhythmId) ?? null;
  }
  function selectedArp(): ArpPattern | null {
    return ALL_ARPS.find((a) => a.id === state.arpId) ?? null;
  }

  /** 生效 BPM：用户未手动设定时，跟随选中节奏型的推荐中值 */
  function effectiveBpm(): number {
    if (state.bpm !== null) return state.bpm;
    const r = selectedRhythm();
    return r ? Math.round((r.bpmRange[0] + r.bpmRange[1]) / 2) : 120;
  }

  const mixerState: MixerState = {
    rhythm: selectedRhythm(),
    arp: selectedArp(),
    mixMode: state.mixMode,
    chord: null,
    bpm: effectiveBpm(),
    drumsMuted: false,
    arpMuted: false,
  };
  const mixer = new Mixer(synth, mixerState);
  const scheduler = new StepScheduler({
    getContext: () => synth.ensure(),
    onStep: (step, time) => mixer.onStep(step, time),
  });

  function persist(): void {
    saveState({
      ...state,
      rhythmSel: { ...state.rhythmSel },
      arpSel: { ...state.arpSel },
    });
  }

  // ────────── 播放控制 ──────────
  let activePad: number | null = null;
  let playheadTimer: ReturnType<typeof setInterval> | null = null;
  let lastPlayheadStep: number | null = null;
  let gridRows: HTMLElement[][] = [];

  function startPlayback(): void {
    synth.ensure();
    scheduler.swing = mixerState.rhythm?.swing ?? 0;
    syncTempo();
    scheduler.start();
    transportBtn.textContent = '⏹ 停止';
    // 播放头用 setInterval 而非 rAF：后台标签页 rAF 会完全停摆，而音频
    // 调度走音频时钟不受影响，20fps 的界面高亮用定时器最稳
    playheadTimer = setInterval(playheadTick, 50);
  }

  function stopPlayback(): void {
    scheduler.stop();
    transportBtn.textContent = '▶ 播放';
    if (playheadTimer !== null) clearInterval(playheadTimer);
    playheadTimer = null;
    lastPlayheadStep = null;
    paintPlayhead(null);
  }

  function togglePlayback(): void {
    if (scheduler.playing) stopPlayback();
    else startPlayback();
  }

  function playheadTick(): void {
    const step = scheduler.currentStep();
    if (step !== lastPlayheadStep) {
      lastPlayheadStep = step;
      paintPlayhead(step);
    }
  }

  function paintPlayhead(step: number | null): void {
    for (const row of gridRows) {
      for (let i = 0; i < row.length; i++) {
        const on = step === i;
        row[i]!.classList.toggle('ring-2', on);
        row[i]!.classList.toggle('ring-[var(--fg)]', on);
      }
    }
  }

  // ────────── 选型操作 ──────────
  function selectRhythm(id: string): void {
    state.rhythmId = id;
    mixerState.rhythm = selectedRhythm();
    persist();
    renderTabs();
    renderGrid();
    renderBench();
    updateWorkbench();
  }

  function selectArp(id: string): void {
    state.arpId = id;
    mixerState.arp = selectedArp();
    mixer.resetArpCursor();
    persist();
    renderTabs();
    renderGrid();
    renderBench();
    updateWorkbench();
  }

  /** 卡片「▶ 试听」：选入并独奏该声部（另一声部静音，可在工作台恢复） */
  function soloAudition(kind: 'rhythm' | 'arp', id: string): void {
    if (kind === 'rhythm') selectRhythm(id);
    else selectArp(id);
    mixerState.drumsMuted = kind === 'arp';
    mixerState.arpMuted = kind === 'rhythm';
    synth.setLayerMuted('drums', mixerState.drumsMuted);
    synth.setLayerMuted('arp', mixerState.arpMuted);
    syncMuteButtons();
    if (kind === 'arp' && !mixerState.chord) triggerPad(0, false);
    if (!scheduler.playing) startPlayback();
  }

  function randomCombo(): void {
    const r = ALL_RHYTHMS[Math.floor(Math.random() * ALL_RHYTHMS.length)]!;
    const a = ALL_ARPS[Math.floor(Math.random() * ALL_ARPS.length)]!;
    state.rhythmId = r.id;
    state.arpId = a.id;
    mixerState.rhythm = r;
    mixerState.arp = a;
    mixer.resetArpCursor();
    mixerState.drumsMuted = false;
    mixerState.arpMuted = false;
    synth.setLayerMuted('drums', false);
    synth.setLayerMuted('arp', false);
    syncMuteButtons();
    persist();
    renderTabs();
    renderGrid();
    updateWorkbench();
    if (!mixerState.chord) triggerPad(Math.floor(Math.random() * 4), false);
    if (!scheduler.playing) startPlayback();
    renderBench(); // 折叠态下随机组合也要刷新摘要条
  }

  // ────────── 和弦垫 ──────────
  function triggerPad(i: number, autostart = true): void {
    const pads = diatonicPads(state.keyPc, state.tonality);
    const p = pads[i];
    if (!p) return;
    mixerState.chord = { rootMidi: padRootMidi(p.rootPc), quality: p.quality };
    activePad = i;
    renderPads();
    if (autostart && !scheduler.playing) startPlayback();
  }

  function setKeyPc(pc: number): void {
    state.keyPc = ((pc % 12) + 12) % 12;
    rootSelect.value = String(state.keyPc);
    if (activePad !== null) triggerPad(activePad, false); // 已按下的垫随调性实时移调
    renderPads();
    updatePrompt();
    persist();
  }

  function setTonality(t: Tonality): void {
    state.tonality = t;
    syncTonalityButtons();
    if (activePad !== null) triggerPad(activePad, false);
    renderPads();
    updatePrompt();
    persist();
  }

  // ────────── 1. 工具条 ──────────
  const searchInput = h('input', {
    type: 'search',
    placeholder: '搜索：四踩、Trap、上行、慵懒…',
    class:
      'w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
  }) as HTMLInputElement;
  searchInput.value = state.keyword;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  searchInput.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.keyword = searchInput.value;
      renderGrid();
      persist();
    }, 200);
  });

  const randomBtn = h('button', {
    type: 'button',
    class:
      'shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
    textContent: '🎲 随机组合',
    title: '随机选一组节奏 × 琶音并立即试听',
    onclick: randomCombo,
  });

  const filterToggleBtn = h('button', {
    type: 'button',
    class:
      'shrink-0 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
    onclick: () => {
      state.panelOpen = !state.panelOpen;
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
      state.rhythmSel = { genre: null, moods: null };
      state.arpSel = { form: null, moods: null };
      state.keyword = '';
      searchInput.value = '';
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

  // ────────── 2. 双库 Tab ──────────
  const tabButtons = new Map<LabTab, HTMLButtonElement>();
  const tabBar = h(
    'div',
    { class: 'mt-4 flex gap-2' },
    (['rhythm', 'arp'] as const).map((tab) => {
      const btn = h('button', {
        type: 'button',
        onclick: () => {
          if (state.tab === tab) return;
          state.tab = tab;
          persist();
          renderTabs();
          renderPanel();
          renderGrid();
        },
      });
      tabButtons.set(tab, btn);
      return btn;
    }),
  );

  function renderTabs(): void {
    const r = selectedRhythm();
    const a = selectedArp();
    const labels: Record<LabTab, string> = {
      rhythm: `🥁 鼓组律动 ${ALL_RHYTHMS.length}${r ? ` · 已选「${r.name}」` : ''}`,
      arp: `🎹 琶音模式 ${ALL_ARPS.length}${a ? ` · 已选「${a.name}」` : ''}`,
    };
    for (const [tab, btn] of tabButtons) {
      const active = state.tab === tab;
      btn.textContent = labels[tab];
      btn.className = active
        ? 'rounded-lg border border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-2 text-sm font-medium text-[var(--accent)]'
        : 'rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]';
    }
  }

  // ────────── 3. 筛选侧栏（随 Tab 切换维度词表） ──────────
  interface FacetView {
    label: string;
    icon: string;
    values: readonly string[];
    get: () => string | null;
    set: (v: string | null) => void;
  }

  function facetViews(): FacetView[] {
    return state.tab === 'rhythm'
      ? RHYTHM_FACETS.map((f) => ({
          label: f.label,
          icon: f.icon,
          values: f.values,
          get: () => state.rhythmSel[f.key],
          set: (v: string | null) => {
            state.rhythmSel[f.key] = v;
          },
        }))
      : ARP_FACETS.map((f) => ({
          label: f.label,
          icon: f.icon,
          values: f.values,
          get: () => state.arpSel[f.key],
          set: (v) => {
            state.arpSel[f.key] = v;
          },
        }));
  }

  const asideWrap = h('aside', { class: 'shrink-0 lg:w-56 lg:self-stretch xl:w-64' });
  const summaryEl = h('div', { class: 'mt-2 hidden flex-wrap items-center gap-1.5 text-xs' });

  function activeFilterCount(): number {
    return facetViews().filter((f) => f.get()).length;
  }

  function renderSummary(): void {
    const chosen = facetViews().filter((f) => f.get());
    summaryEl.classList.toggle('hidden', state.panelOpen || chosen.length === 0);
    summaryEl.classList.toggle('flex', !state.panelOpen && chosen.length > 0);
    summaryEl.replaceChildren(
      h('span', { class: 'text-[var(--fg-muted)]', textContent: '已选：' }),
      ...chosen.map((f) =>
        h('button', {
          type: 'button',
          title: '点击移除该条件',
          class:
            'rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-2.5 py-0.5 text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20',
          textContent: `${f.label}: ${f.get()} ✕`,
          onclick: () => {
            f.set(null);
            renderPanel();
            renderGrid();
            persist();
          },
        }),
      ),
    );
  }

  function renderPanel(): void {
    const n = activeFilterCount();
    filterToggleBtn.textContent =
      (state.panelOpen ? '🎛 收起筛选' : '🎛 筛选') + (n ? ` · ${n}` : '');
    filterToggleBtn.classList.toggle('!border-[var(--accent)]', n > 0);
    filterToggleBtn.classList.toggle('!text-[var(--accent)]', n > 0);
    asideWrap.style.display = state.panelOpen ? '' : 'none';
    if (!state.panelOpen) {
      renderSummary();
      return;
    }

    const facetRows = facetViews().map((f) =>
      h('div', { class: 'py-2' }, [
        h('div', {
          class: 'mb-1.5 text-xs font-semibold text-[var(--fg-muted)] select-none',
          textContent: `${f.icon} ${f.label}`,
        }),
        h(
          'div',
          { class: 'flex flex-wrap gap-1.5' },
          f.values.map((v) => {
            const active = f.get() === v;
            return h('button', {
              type: 'button',
              'aria-pressed': String(active),
              class: active
                ? 'rounded-full border border-[var(--accent)] bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--accent-fg)] transition-all duration-150'
                : 'rounded-full border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-xs text-[var(--fg-muted)] transition-all duration-150 hover:border-[var(--accent)] hover:text-[var(--accent)]',
              textContent: v,
              onclick: () => {
                f.set(f.get() === v ? null : v);
                renderPanel();
                renderGrid();
                persist();
              },
            });
          }),
        ),
      ]),
    );

    asideWrap.replaceChildren(
      h(
        'div',
        {
          class:
            'rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] lg:sticky lg:top-4 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto',
        },
        [
          h(
            'div',
            {
              class:
                'flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5',
            },
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
                  state.panelOpen = false;
                  renderPanel();
                  persist();
                },
              }),
            ],
          ),
          h('div', { class: 'divide-y divide-[var(--border)] px-4 py-2' }, facetRows),
        ],
      ),
    );
    renderSummary();
  }

  // ────────── 4. 卡片网格（34 条规模无需分批，一次渲染） ──────────
  const gridHeader = h('div', { class: 'flex items-center justify-between' }, []);
  const grid = h('div', { class: 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3' });
  const emptyHint = h('div', {
    class:
      'rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] px-6 py-10 text-center text-sm text-[var(--fg-muted)]',
  });

  function matchesRhythm(r: RhythmPattern): boolean {
    const kw = state.keyword.trim().toLowerCase();
    if (kw) {
      const hay = [r.name, r.nameEn, r.desc, r.genre, ...r.moods, r.promptFragmentZh]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    if (state.rhythmSel.genre && r.genre !== state.rhythmSel.genre) return false;
    if (state.rhythmSel.moods && !r.moods.includes(state.rhythmSel.moods as Mood)) return false;
    return true;
  }

  function matchesArp(a: ArpPattern): boolean {
    const kw = state.keyword.trim().toLowerCase();
    if (kw) {
      const hay = [a.name, a.nameEn, a.desc, a.form, ...a.moods, a.promptFragmentZh]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    if (state.arpSel.form && a.form !== state.arpSel.form) return false;
    if (state.arpSel.moods && !a.moods.includes(state.arpSel.moods as Mood)) return false;
    return true;
  }

  /** 鼓律动缩略图：三轨 × 16 步点阵 */
  function rhythmViz(r: RhythmPattern, large: boolean): HTMLElement {
    const hPx = large ? 12 : 6;
    return h(
      'div',
      { class: large ? 'space-y-1.5' : 'space-y-[3px]' },
      TRACK_ROWS.map(({ key, label, color }) =>
        h('div', { class: 'flex items-center gap-1.5' }, [
          ...(large
            ? [
                h('span', {
                  class: 'w-8 shrink-0 text-[10px] text-[var(--fg-muted)] select-none',
                  textContent: label,
                }),
              ]
            : []),
          h(
            'div',
            { class: 'flex flex-1 gap-[2px]' },
            Array.from({ length: STEPS_PER_BAR }, (_, i) =>
              h('div', {
                class: 'flex-1 rounded-[2px]',
                style: `height:${hPx}px;background:${
                  r.tracks[key].includes(i)
                    ? color
                    : 'color-mix(in srgb, var(--border) 55%, transparent)'
                }`,
              }),
            ),
          ),
        ]),
      ),
    );
  }

  /** 琶音缩略图：按细分列出的音高柱（休止 = 底部小点） */
  function arpViz(a: ArpPattern, large: boolean): HTMLElement {
    const cols = a.subdivision === 16 ? 16 : 8;
    const maxN = Math.max(1, ...a.notes.filter((n) => n >= 0));
    return h(
      'div',
      { class: 'flex items-end gap-[2px]', style: `height:${large ? 56 : 36}px` },
      Array.from({ length: cols }, (_, i) => {
        const n = a.notes[i % a.notes.length]!;
        if (n < 0) {
          return h('div', {
            class: 'flex-1 self-end rounded-full',
            style: 'height:3px;background:var(--border)',
            title: '休止',
          });
        }
        const ratio = n / maxN;
        return h('div', {
          class: 'flex-1 rounded-t-[2px]',
          style: `height:${25 + Math.round(ratio * 75)}%;background:var(--accent);opacity:${0.45 + 0.55 * ratio}`,
        });
      }),
    );
  }

  const cardActionBtn =
    'rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]';

  function cardShell(selected: boolean, onSelect: () => void, label: string): HTMLElement {
    return h('div', {
      role: 'button',
      tabindex: '0',
      'aria-label': label,
      class:
        'group relative cursor-pointer overflow-hidden rounded-xl border bg-[var(--bg-elevated)] transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ' +
        (selected
          ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]'
          : 'border-[var(--border)] hover:-translate-y-1 hover:border-[var(--accent)] hover:shadow-lg'),
      onclick: onSelect,
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      },
    });
  }

  function badge(text: string, accent = false): HTMLElement {
    return h('span', {
      class: accent
        ? 'rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]'
        : 'rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--fg-muted)]',
      textContent: text,
    });
  }

  function rhythmCard(r: RhythmPattern): HTMLElement {
    const selected = state.rhythmId === r.id;
    const card = cardShell(selected, () => selectRhythm(r.id), `${r.name} ${r.nameEn}`);
    card.append(
      h('div', { class: 'p-3.5' }, [
        h('div', { class: 'flex items-baseline gap-2' }, [
          h('span', { class: 'text-lg leading-none', textContent: r.icon }),
          h('span', { class: 'font-medium text-[var(--fg)]', textContent: r.name }),
          h('span', { class: 'text-xs italic text-[var(--fg-muted)]', textContent: r.nameEn }),
          ...(selected
            ? [
                h('span', {
                  class: 'ml-auto text-xs font-medium text-[var(--accent)]',
                  textContent: '✓ 已选入',
                }),
              ]
            : []),
        ]),
        h('div', { class: 'mt-1.5 flex flex-wrap gap-1' }, [
          badge(r.genre, true),
          ...r.moods.map((m) => badge(m)),
          ...(r.swing ? [badge(`摇摆 ${Math.round(r.swing * 100)}%`)] : []),
        ]),
        h('div', { class: 'mt-2.5' }, [rhythmViz(r, false)]),
        h('p', {
          class: 'mt-2 text-xs leading-relaxed text-[var(--fg-muted)] line-clamp-2',
          textContent: r.desc,
        }),
        h('div', { class: 'mt-2.5 flex items-center justify-between' }, [
          h('span', {
            class: 'text-[10px] text-[var(--fg-muted)]',
            textContent: `BPM ${r.bpmRange[0]}-${r.bpmRange[1]}`,
          }),
          h('div', { class: 'flex gap-1.5' }, [
            h('button', {
              type: 'button',
              class: cardActionBtn,
              textContent: '▶ 试听',
              title: '独奏试听此律动（琶音静音）',
              onclick: (e: MouseEvent) => {
                e.stopPropagation();
                soloAudition('rhythm', r.id);
              },
            }),
            h('button', {
              type: 'button',
              class: cardActionBtn,
              textContent: 'ⓘ 详情',
              onclick: (e: MouseEvent) => {
                e.stopPropagation();
                openRhythmDetail(r);
              },
            }),
          ]),
        ]),
      ]),
    );
    return card;
  }

  function arpCard(a: ArpPattern): HTMLElement {
    const selected = state.arpId === a.id;
    const card = cardShell(selected, () => selectArp(a.id), `${a.name} ${a.nameEn}`);
    card.append(
      h('div', { class: 'p-3.5' }, [
        h('div', { class: 'flex items-baseline gap-2' }, [
          h('span', { class: 'text-lg leading-none', textContent: a.icon }),
          h('span', { class: 'font-medium text-[var(--fg)]', textContent: a.name }),
          h('span', { class: 'text-xs italic text-[var(--fg-muted)]', textContent: a.nameEn }),
          ...(selected
            ? [
                h('span', {
                  class: 'ml-auto text-xs font-medium text-[var(--accent)]',
                  textContent: '✓ 已选入',
                }),
              ]
            : []),
        ]),
        h('div', { class: 'mt-1.5 flex flex-wrap gap-1' }, [
          badge(a.form, true),
          ...a.moods.map((m) => badge(m)),
          badge(a.subdivision === 16 ? '十六分' : '八分'),
          badge(a.octaves === 2 ? '双八度' : '单八度'),
        ]),
        h('div', { class: 'mt-2.5' }, [arpViz(a, false)]),
        h('p', {
          class: 'mt-2 text-xs leading-relaxed text-[var(--fg-muted)] line-clamp-2',
          textContent: a.desc,
        }),
        h('div', { class: 'mt-2.5 flex items-center justify-end gap-1.5' }, [
          h('button', {
            type: 'button',
            class: cardActionBtn,
            textContent: '▶ 试听',
            title: '独奏试听此琶音（鼓静音，用当前和弦）',
            onclick: (e: MouseEvent) => {
              e.stopPropagation();
              soloAudition('arp', a.id);
            },
          }),
          h('button', {
            type: 'button',
            class: cardActionBtn,
            textContent: 'ⓘ 详情',
            onclick: (e: MouseEvent) => {
              e.stopPropagation();
              openArpDetail(a);
            },
          }),
        ]),
      ]),
    );
    return card;
  }

  let firstPaint = true;

  function renderGrid(): void {
    const isRhythm = state.tab === 'rhythm';
    const cards: HTMLElement[] = isRhythm
      ? ALL_RHYTHMS.filter(matchesRhythm).map((r) => rhythmCard(r))
      : ALL_ARPS.filter(matchesArp).map((a) => arpCard(a));
    gridHeader.replaceChildren(
      h('span', {
        class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]',
        textContent: `共 ${cards.length} 条`,
      }),
      h('span', {
        class: 'text-xs text-[var(--fg-muted)]',
        textContent: '点卡片 = 选入工作台 · ▶ = 独奏试听 · ⓘ = 详情',
      }),
    );
    grid.replaceChildren(
      ...cards.map((card, i) => {
        if (firstPaint) {
          card.classList.add('stagger-item');
          card.style.setProperty('--stagger-index', String(i));
        }
        return card;
      }),
    );
    if (firstPaint && cards.length > 0) {
      grid.classList.add('stagger-ready');
      firstPaint = false;
    }
    grid.style.display = cards.length > 0 ? '' : 'none';
    emptyHint.style.display = cards.length > 0 ? 'none' : '';
    emptyHint.textContent = isRhythm
      ? '没有匹配的鼓律动，换个关键词或减少筛选条件试试～'
      : '没有匹配的琶音模式，换个关键词或减少筛选条件试试～';
  }

  // ────────── 5. 详情弹层 ──────────
  const dlg = createDialog({ label: '模式详情', panelClass: 'max-w-xl' });

  function sectionTitle(text: string): HTMLElement {
    return h('div', {
      class: 'mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]',
      textContent: text,
    });
  }

  /** 小复制胶囊：点击复制 label，短暂变 ✓（情绪标签用） */
  function copyChip(label: string): HTMLButtonElement {
    const btn = h('button', {
      type: 'button',
      title: `复制「${label}」`,
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

  /** 提示词片段卡片：标题 + 复制按钮 + 只读文本域 */
  function fragmentBlock(title: string, text: string): HTMLElement {
    const area = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-xs leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows: 2,
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

  function detailHeader(icon: string, name: string, nameEn: string, sub: string): HTMLElement {
    return h('div', { class: 'flex items-start gap-2.5' }, [
      h('span', { class: 'text-2xl leading-none', textContent: icon }),
      h('div', {}, [
        h('div', { class: 'flex flex-wrap items-center gap-2' }, [
          h('span', { class: 'font-medium text-[var(--fg)]', textContent: name }),
          h('span', { class: 'text-sm italic text-[var(--fg-muted)]', textContent: nameEn }),
        ]),
        h('p', { class: 'mt-0.5 text-xs text-[var(--fg-muted)]', textContent: sub }),
      ]),
    ]);
  }

  function detailActions(onSelect: () => void, onSolo: () => void): HTMLElement {
    return h('div', { class: 'mt-1 flex gap-2' }, [
      h('button', {
        type: 'button',
        class:
          'inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
        textContent: '✓ 选入工作台',
        onclick: () => {
          onSelect();
          dlg.close();
        },
      }),
      h('button', {
        type: 'button',
        class:
          'inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-2 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
        textContent: '▶ 独奏试听',
        onclick: () => {
          onSolo();
          dlg.close();
        },
      }),
    ]);
  }

  function openRhythmDetail(r: RhythmPattern): void {
    dlg.body.replaceChildren(
      h('div', { class: 'space-y-4' }, [
        detailHeader(
          r.icon,
          r.name,
          r.nameEn,
          `${r.genre} · BPM ${r.bpmRange[0]}-${r.bpmRange[1]}${r.swing ? ` · 摇摆 ${Math.round(r.swing * 100)}%` : ''}`,
        ),
        h('div', { class: 'rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3' }, [
          rhythmViz(r, true),
        ]),
        h('p', { class: 'text-sm leading-relaxed text-[var(--fg)]', textContent: r.desc }),
        h('div', {}, [
          sectionTitle('情绪气质 · 点击复制'),
          h(
            'div',
            { class: 'flex flex-wrap gap-1.5' },
            r.moods.map((m) => copyChip(m)),
          ),
        ]),
        fragmentBlock('英文提示词片段', r.promptFragment),
        fragmentBlock('中文提示词片段', r.promptFragmentZh),
        detailActions(
          () => selectRhythm(r.id),
          () => soloAudition('rhythm', r.id),
        ),
      ]),
    );
    dlg.open();
  }

  function openArpDetail(a: ArpPattern): void {
    dlg.body.replaceChildren(
      h('div', { class: 'space-y-4' }, [
        detailHeader(
          a.icon,
          a.name,
          a.nameEn,
          `${a.form} · ${a.subdivision === 16 ? '十六分音符' : '八分音符'} · ${a.octaves === 2 ? '双八度' : '单八度'}`,
        ),
        h('div', { class: 'rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3' }, [
          arpViz(a, true),
        ]),
        h('p', { class: 'text-sm leading-relaxed text-[var(--fg)]', textContent: a.desc }),
        h('div', {}, [
          sectionTitle('情绪气质 · 点击复制'),
          h(
            'div',
            { class: 'flex flex-wrap gap-1.5' },
            a.moods.map((m) => copyChip(m)),
          ),
        ]),
        fragmentBlock('英文提示词片段', a.promptFragment),
        fragmentBlock('中文提示词片段', a.promptFragmentZh),
        detailActions(
          () => selectArp(a.id),
          () => soloAudition('arp', a.id),
        ),
      ]),
    );
    dlg.open();
  }

  // ────────── 6. 试听工作台（页面顶部，可折叠；展开时吸顶悬停） ──────────
  // 结构：标题/控制条 + [吸顶区：传输 + 步进网格播放头] + [文档流区：控制行 + 和弦垫]。
  // 展开且页面下滚浏览曲库时，传输与播放头始终吸顶可见，边选边听。
  const comboLabel = h('span', {
    class: 'min-w-0 truncate text-sm text-[var(--fg-muted)]',
  });

  const transportBtn = h('button', {
    type: 'button',
    class:
      'inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-medium text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
    textContent: '▶ 播放',
    title: '播放/停止（空格）',
    onclick: togglePlayback,
  });

  const benchToggleBtn = h('button', {
    type: 'button',
    class:
      'shrink-0 rounded-md px-2 py-1 text-xs text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--fg)]',
    title: '折叠/展开试听工作台',
    onclick: () => {
      state.benchOpen = !state.benchOpen;
      renderBench();
      persist();
    },
  });

  const bpmSlider = h('input', {
    type: 'range',
    min: String(BPM_MIN),
    max: String(BPM_MAX),
    step: '1',
    class: 'w-36 accent-[var(--accent)] sm:w-44',
    title: '拖动设定 BPM',
  }) as HTMLInputElement;
  const bpmValue = h('span', {
    class: 'w-16 text-sm font-medium tabular-nums text-[var(--fg)]',
  });
  bpmSlider.addEventListener('input', () => {
    state.bpm = Number(bpmSlider.value);
    syncTempo();
    updatePrompt();
    persist();
  });
  const bpmResetBtn = h('button', {
    type: 'button',
    class: cardActionBtn,
    textContent: '跟随推荐',
    title: 'BPM 重置为当前节奏型的推荐中值',
    onclick: () => {
      state.bpm = null;
      syncTempo();
      updatePrompt();
      persist();
    },
  });

  function syncTempo(): void {
    const bpm = effectiveBpm();
    scheduler.bpm = bpm;
    mixerState.bpm = bpm;
    bpmSlider.value = String(bpm);
    bpmValue.textContent = `${bpm} BPM`;
    bpmResetBtn.classList.toggle('!border-[var(--accent)]', state.bpm === null);
    bpmResetBtn.classList.toggle('!text-[var(--accent)]', state.bpm === null);
  }

  const rootSelect = h(
    'select',
    {
      class:
        'rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      title: '主音（Z/X 半音移调）',
      onchange: () => setKeyPc(Number(rootSelect.value)),
    },
    ROOT_NAMES.map((n, i) => h('option', { value: String(i), textContent: n })),
  ) as HTMLSelectElement;
  rootSelect.value = String(state.keyPc);

  const tonalityButtons = new Map<Tonality, HTMLButtonElement>();
  for (const t of ['major', 'minor'] as const) {
    const btn = h('button', {
      type: 'button',
      textContent: t === 'major' ? '大调' : '小调',
      title: t === 'major' ? '大调（Q）' : '小调（E）',
      onclick: () => setTonality(t),
    });
    tonalityButtons.set(t, btn);
  }

  function syncTonalityButtons(): void {
    for (const [t, btn] of tonalityButtons) {
      btn.className = activeBtnClass(state.tonality === t);
    }
  }

  function activeBtnClass(active: boolean): string {
    return active
      ? 'rounded-lg border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)]'
      : 'rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-xs text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]';
  }

  const MIX_MODE_LABEL: Record<MixMode, string> = { layer: '双层叠加', fuse: '融合音型' };
  const MIX_MODE_HINT: Record<MixMode, string> = {
    layer: '双层叠加：鼓与琶音各自独立进行，琶音均匀流动在鼓点之上。',
    fuse: '融合音型：琶音贴着鼓点走——只在底鼓/军鼓的骨架重拍上发声，时值自动延伸。',
  };
  const mixModeButtons = new Map<MixMode, HTMLButtonElement>();
  const mixModeHint = h('p', { class: 'text-xs text-[var(--fg-muted)]' });
  for (const m of ['layer', 'fuse'] as const) {
    const btn = h('button', {
      type: 'button',
      textContent: MIX_MODE_LABEL[m],
      onclick: () => {
        if (state.mixMode === m) return;
        state.mixMode = m;
        mixerState.mixMode = m;
        syncMixModeUI();
        renderStepGrid();
        updatePrompt();
        persist();
      },
    });
    mixModeButtons.set(m, btn);
  }

  function syncMixModeUI(): void {
    for (const [m, btn] of mixModeButtons) {
      btn.className = activeBtnClass(state.mixMode === m);
    }
    mixModeHint.textContent = MIX_MODE_HINT[state.mixMode];
  }

  const drumMuteBtn = h('button', {
    type: 'button',
    textContent: '🥁 鼓',
    title: '鼓声部开关',
    onclick: () => {
      mixerState.drumsMuted = !mixerState.drumsMuted;
      synth.setLayerMuted('drums', mixerState.drumsMuted);
      syncMuteButtons();
    },
  });
  const arpMuteBtn = h('button', {
    type: 'button',
    textContent: '🎹 琶音',
    title: '琶音声部开关',
    onclick: () => {
      mixerState.arpMuted = !mixerState.arpMuted;
      synth.setLayerMuted('arp', mixerState.arpMuted);
      syncMuteButtons();
    },
  });

  function syncMuteButtons(): void {
    for (const [btn, muted] of [
      [drumMuteBtn, mixerState.drumsMuted],
      [arpMuteBtn, mixerState.arpMuted],
    ] as const) {
      btn.className =
        'rounded-lg border px-3 py-1.5 text-xs transition-colors ' +
        (muted
          ? 'border-[var(--border)] bg-[var(--bg)] text-[var(--fg-muted)] opacity-40'
          : 'border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--accent)]');
      btn.setAttribute('aria-pressed', String(!muted));
    }
  }

  /** 琶音行触发步：叠加模式按细分均分，融合模式取鼓骨架 */
  function arpTriggerSteps(): boolean[] {
    const out = Array<boolean>(STEPS_PER_BAR).fill(false);
    const a = mixerState.arp;
    if (!a) return out;
    if (mixerState.mixMode === 'fuse') {
      for (const s of fuseSkeleton(mixerState.rhythm)) out[s] = true;
    } else {
      const every = a.subdivision === 16 ? 1 : 2;
      for (let i = 0; i < STEPS_PER_BAR; i += every) out[i] = true;
    }
    return out;
  }

  const stepGridWrap = h('div', { class: 'space-y-1.5' });

  function renderStepGrid(): void {
    const r = mixerState.rhythm;
    gridRows = [];
    const rows: { label: string; active: boolean[]; color: string }[] = TRACK_ROWS.map(
      ({ key, label, color }) => ({
        label,
        color,
        active: Array.from({ length: STEPS_PER_BAR }, (_, i) =>
          r ? r.tracks[key].includes(i) : false,
        ),
      }),
    );
    rows.push({ label: '琶音', color: 'var(--accent)', active: arpTriggerSteps() });

    stepGridWrap.replaceChildren(
      ...rows.map(({ label, active, color }) => {
        const cells: HTMLElement[] = [];
        const rowEl = h('div', { class: 'flex items-center gap-2' }, [
          h('span', {
            class: 'w-8 shrink-0 text-[10px] text-[var(--fg-muted)] select-none',
            textContent: label,
          }),
          h(
            'div',
            { class: 'flex flex-1 items-center gap-[3px]' },
            Array.from({ length: STEPS_PER_BAR }, (_, i) => {
              const cell = h('div', {
                class: 'h-6 flex-1 rounded-[3px] transition-shadow',
                style:
                  `background:${active[i] ? color : 'color-mix(in srgb, var(--border) 45%, transparent)'}` +
                  (i % 4 === 0 && i > 0 ? ';margin-left:6px' : ''),
              });
              cells.push(cell);
              return cell;
            }),
          ),
        ]);
        gridRows.push(cells);
        return rowEl;
      }),
    );
    paintPlayhead(lastPlayheadStep);
  }

  const padsWrap = h('div', { class: 'grid grid-cols-4 gap-2 sm:grid-cols-8' });

  function renderPads(): void {
    const pads = diatonicPads(state.keyPc, state.tonality);
    padsWrap.replaceChildren(
      ...pads.map((p, i) => {
        const active = i === activePad;
        return h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(active),
            title: `触发 ${chordName(p.rootPc, p.quality)}（键 ${PAD_KEYS[i]!.toUpperCase()}）`,
            class:
              'flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2 transition-all ' +
              (active
                ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] shadow-md'
                : 'border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] hover:border-[var(--accent)] hover:text-[var(--accent)]'),
            onclick: () => triggerPad(i),
          },
          [
            h('span', {
              class: `text-[9px] font-mono ${active ? 'opacity-70' : 'text-[var(--fg-muted)]'}`,
              textContent: PAD_KEYS[i]!.toUpperCase(),
            }),
            h('span', {
              class: 'text-sm font-semibold',
              textContent: chordName(p.rootPc, p.quality),
            }),
            h('span', {
              class: `text-[9px] ${active ? 'opacity-70' : 'text-[var(--fg-muted)]'}`,
              textContent: p.degree,
            }),
          ],
        );
      }),
    );
  }

  function updateWorkbench(): void {
    const r = selectedRhythm();
    const a = selectedArp();
    comboLabel.textContent =
      r && a ? `${r.icon} ${r.name} × ${a.icon} ${a.name}` : '从下方两个库各选一条，组合即在此发声';
    syncTempo();
    renderStepGrid();
    updatePrompt();
  }

  // 吸顶区（展开时 sticky）：标题 + 传输 + 步进网格播放头
  const benchHead = h('div', {
    class:
      'space-y-3 rounded-t-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 sm:p-5',
  });
  // 文档流区（展开时显示，不吸顶）：控制行 + 和弦垫 + 键位说明
  const benchBody = h('div', {
    class:
      'space-y-4 rounded-b-xl border border-t-0 border-[var(--border)] bg-[var(--bg-elevated)] px-4 pb-4 sm:px-5 sm:pb-5',
  });
  // 折叠态：仅留一行可点的摘要条
  const benchCollapsedBar = h('button', {
    type: 'button',
    class:
      'hidden w-full items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 text-left transition-colors hover:border-[var(--accent)]',
    onclick: () => {
      state.benchOpen = true;
      renderBench();
      persist();
    },
  });

  function renderBench(): void {
    const open = state.benchOpen;
    benchToggleBtn.textContent = open ? '收起 ▴' : '展开 ▾';
    benchHead.style.display = open ? '' : 'none';
    benchBody.style.display = open ? '' : 'none';
    benchCollapsedBar.style.display = open ? 'none' : '';
    if (!open) {
      const r = selectedRhythm();
      const a = selectedArp();
      benchCollapsedBar.replaceChildren(
        h('span', { class: 'text-sm', textContent: '🎛' }),
        h('span', {
          class: 'min-w-0 flex-1 truncate text-sm text-[var(--fg-muted)]',
          textContent:
            r && a
              ? `${r.name} × ${a.name} · ${effectiveBpm()} BPM`
              : '试听工作台（展开后可实时混合试听）',
        }),
        h('span', {
          class: 'shrink-0 text-xs text-[var(--fg-muted)]',
          textContent: scheduler.playing ? '▶ 播放中 · 展开 ▾' : '展开 ▾',
        }),
      );
    }
  }

  benchHead.replaceChildren(
    h('div', { class: 'flex flex-wrap items-center gap-3' }, [
      h('span', {
        class: 'text-sm font-semibold text-[var(--fg)] select-none',
        textContent: '🎛 试听工作台',
      }),
      comboLabel,
      h('div', { class: 'ml-auto flex items-center gap-2' }, [transportBtn, benchToggleBtn]),
    ]),
    stepGridWrap,
  );
  benchBody.replaceChildren(
    h('div', { class: 'flex flex-wrap items-center gap-x-4 gap-y-2.5 pt-1' }, [
      h('label', { class: 'flex items-center gap-2 text-xs text-[var(--fg-muted)]' }, [
        'BPM',
        bpmSlider,
        bpmValue,
        bpmResetBtn,
      ]),
      h('label', { class: 'flex items-center gap-2 text-xs text-[var(--fg-muted)]' }, [
        '调性',
        rootSelect,
        ...tonalityButtons.values(),
      ]),
      h('div', { class: 'flex items-center gap-2 text-xs text-[var(--fg-muted)]' }, [
        '混合',
        ...mixModeButtons.values(),
      ]),
      h('div', { class: 'flex items-center gap-2 text-xs text-[var(--fg-muted)]' }, [
        '声部',
        drumMuteBtn,
        arpMuteBtn,
      ]),
    ]),
    mixModeHint,
    h('div', {}, [
      h('div', {
        class:
          'mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)] select-none',
        textContent: '和弦垫 · 点击或按键实时换和声',
      }),
      padsWrap,
    ]),
    h('p', {
      class: 'text-[11px] leading-relaxed text-[var(--fg-muted)]',
      textContent: '键盘：A–K 触发和弦垫 · Z/X 半音移调 · Q 大调 / E 小调 · 空格 播放/停止',
    }),
  );

  // 吸顶容器只包 benchHead（展开）或折叠条；benchBody 留在文档流中随页面滚动
  const workbenchEl = h('div', { class: 'sticky top-0 z-30 -mx-4 px-4 pt-2 pb-2' }, [
    benchCollapsedBar,
    benchHead,
  ]);

  // ────────── 7. 提示词工坊 ──────────
  function comboContext(): ComboContext | null {
    const rhythm = selectedRhythm();
    const arp = selectedArp();
    if (!rhythm || !arp) return null;
    return {
      rhythm,
      arp,
      mixMode: state.mixMode,
      bpm: effectiveBpm(),
      keyPc: state.keyPc,
      tonality: state.tonality,
    };
  }

  const promptAreaClass =
    'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-xs leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]';
  const promptEnArea = h('textarea', {
    class: promptAreaClass,
    rows: 3,
    readonly: true,
  }) as HTMLTextAreaElement;
  const promptZhArea = h('textarea', {
    class: promptAreaClass,
    rows: 3,
    readonly: true,
  }) as HTMLTextAreaElement;

  const promptEmpty = h('div', {
    class:
      'rounded-lg border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--fg-muted)]',
    textContent: '先在上方各选一条鼓律动和琶音模式，组合提示词会自动生成在这里。',
  });
  const promptBlocks = h('div', { class: 'space-y-4' }, [
    h('div', { class: 'space-y-1.5' }, [
      h('div', { class: 'flex items-center justify-between' }, [
        sectionTitle('英文提示词（Suno / Udio / Stable Audio）'),
        createCopyButton(() => promptEnArea.value, '复制', '已复制 ✓'),
      ]),
      promptEnArea,
    ]),
    h('div', { class: 'space-y-1.5' }, [
      h('div', { class: 'flex items-center justify-between' }, [
        sectionTitle('中文提示词'),
        createCopyButton(() => promptZhArea.value, '复制', '已复制 ✓'),
      ]),
      promptZhArea,
    ]),
    h('div', { class: 'flex justify-end' }, [
      createCopyButton(
        () => `${promptEnArea.value}\n\n${promptZhArea.value}`,
        '⧉ 一键复制中英双语',
        '已复制 ✓',
      ),
    ]),
  ]);

  function updatePrompt(): void {
    const ctx = comboContext();
    promptEnArea.value = ctx ? buildPromptEn(ctx) : '';
    promptZhArea.value = ctx ? buildPromptZh(ctx) : '';
    promptBlocks.style.display = ctx ? '' : 'none';
    promptEmpty.style.display = ctx ? 'none' : '';
  }

  const workshopEl = h(
    'section',
    {
      class:
        'mt-6 space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 sm:p-5',
    },
    [
      h('div', { class: 'flex flex-wrap items-center gap-3' }, [
        h('span', {
          class: 'text-sm font-semibold text-[var(--fg)] select-none',
          textContent: '🧪 提示词工坊',
        }),
        h('span', {
          class: 'text-xs text-[var(--fg-muted)]',
          textContent: '随组合 / BPM / 调性 / 混合模式实时更新',
        }),
      ]),
      promptEmpty,
      promptBlocks,
    ],
  );

  // ────────── 8. 键盘交互 ──────────
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (dlg.isOpen()) return;
    const t = e.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable)
    ) {
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const k = e.key.toLowerCase();
    const padIdx = PAD_KEYS.indexOf(k);
    if (padIdx >= 0) {
      triggerPad(padIdx);
      return;
    }
    if (k === 'z') setKeyPc(state.keyPc - 1);
    else if (k === 'x') setKeyPc(state.keyPc + 1);
    else if (k === 'q') setTonality('major');
    else if (k === 'e') setTonality('minor');
    else if (k === ' ') {
      e.preventDefault(); // 阻止聚焦按钮的原生空格激活，空格永远 = 播放/停止
      togglePlayback();
    }
  });

  // ────────── 装配 ──────────
  // 顺序：简介 → 试听工作台（吸顶）→ 工作台详情区（和弦垫，文档流）→ 工具条/曲库 → 提示词工坊
  content.append(
    h('p', {
      class: 'mb-4 text-sm text-[var(--fg-muted)]',
      textContent: `${ALL_RHYTHMS.length} 种鼓组律动 × ${ALL_ARPS.length} 种琶音模式：在下方曲库点选组合，工作台吸顶跟随、边选边听，和弦垫（A-K）随时切换和声，融合模式让琶音贴着鼓点走。选定组合自动拼成中英双语 AI 音乐提示词，一键复制给 Suno / Udio。全部在浏览器本地实时合成，零音频文件。`,
    }),
    workbenchEl,
    benchBody,
    h('div', { class: 'mt-6' }, [toolbar, tabBar, summaryEl]),
    h('div', { class: 'mt-4 flex flex-col gap-5 lg:flex-row lg:items-start' }, [
      asideWrap,
      h('div', { class: 'min-w-0 flex-1 space-y-3' }, [gridHeader, grid, emptyHint]),
    ]),
    workshopEl,
  );

  renderTabs();
  renderPanel();
  renderGrid();
  syncTonalityButtons();
  syncMixModeUI();
  syncMuteButtons();
  renderPads();
  renderBench();
  updateWorkbench();
}

renderLab();
