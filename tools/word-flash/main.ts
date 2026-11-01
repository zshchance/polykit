import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { confirmDialog } from '@/core/components/Dialog';
import { sanitizeFilePart } from '@/core/utils/download';

import {
  getSharedAudioContext,
  loadAudioFile,
  mixToMono,
  resumeAudioContext,
  type LoadedAudio,
} from './audio';
import { detectBeatTimes } from './beat';
import {
  addCustomTheme,
  loadCustomThemes,
  removeCustomTheme,
  toRenderTheme,
} from './custom-themes';
import { openContentHelp } from './content-help';
import { cardBudget, parseScript, SAMPLE_TEXT, type Card } from './script';
import { computeTimeline } from './timeline';
import {
  ASPECTS,
  EMPHASES,
  FONTS,
  MOTIONS,
  PACES,
  PROGRESSES,
  RESOLUTIONS,
  SYNCS,
  THEMES,
  DEFAULT_THEME_DESIGN,
  getAspect,
  getResolution,
  getTheme,
  isCustomMotionId,
  type AspectId,
  type EmphasisId,
  type FlashOptions,
  type FontId,
  type MotionSelection,
  type PaceId,
  type ProgressId,
  type ResolutionId,
  type SoundEffectId,
  type SyncId,
  type Theme,
  type Timeline,
  type CardFrameState,
} from './options';
import { cardAt } from './options';
import { drawFrame, drawSampleCard, type RenderInput } from './renderer';
import {
  playSoundEffect,
  scheduleCardSounds,
  SOUND_EFFECTS,
  type SoundPlayback,
} from './sound-effects';
import {
  getCustomMotionDraw,
  invalidateMotionCache,
  loadCustomMotions,
  removeCustomMotion,
} from './custom-motions';
import {
  loadCustomSchemes,
  removeCustomScheme,
  schemeOptionPatches,
  type CustomScheme,
  type ParsedScheme,
} from './custom-schemes';
import { createAiDialogs } from './ai-dialogs';
import { startRecording, isWakeLockSupported, type RecordHandle } from './recorder';
import { CONTENT_MAX, loadOptions, saveOptions } from './settings';

initTheme();

/** 预览画布内部分辨率：短边 540（预览流畅；导出按分辨率档位另行放大） */
const PREVIEW_SHORT = 540;
/** 导出帧率（实时录制，30fps 兼顾流畅与丢帧风险） */
const EXPORT_FPS = 30;
/** 卡片 chips 超过该数量切换为紧凑样式（只显序号） */
const CHIP_COMPACT = 16;

/** 秒 → mm:ss */
function fmt(sec: number): string {
  const v = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

type SegmentItem<T extends string> = { id: T; label: string; hint?: string };

/**
 * 分段按钮组（工具站通用交互）：单选、高亮当前项。
 * 返回 set() 供外部在状态回填时刷新高亮。
 */
function makeSegment<T extends string>(
  items: SegmentItem<T>[],
  current: T,
  onChange: (id: T) => void,
): { wrap: HTMLElement; set: (id: T) => void } {
  const btns: HTMLButtonElement[] = [];
  const paint = (id: T): void => {
    for (const b of btns) {
      const active = b.dataset.segId === id;
      b.className =
        'rounded-md border px-2.5 py-1.5 text-sm transition-colors ' +
        (active
          ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]'
          : 'border-[var(--border)] bg-[var(--bg)] text-[var(--fg-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]');
    }
  };
  const wrap = h('div', { class: 'flex flex-wrap gap-2' }, []);
  for (const item of items) {
    const btn = h(
      'button',
      {
        type: 'button',
        'data-seg-id': item.id,
        title: item.hint ?? '',
        onclick: () => {
          onChange(item.id);
          paint(item.id);
        },
      },
      [item.label],
    ) as HTMLButtonElement;
    btns.push(btn);
    wrap.append(btn);
  }
  paint(current);
  return { wrap, set: paint };
}

/** 通用字段标签 */
function fieldLabel(text: string): HTMLElement {
  return h('p', { class: 'text-sm font-medium text-[var(--fg-muted)]', textContent: text });
}

/** 设置行：标签 + 控件（窄面板上下排布更稳） */
function row(label: string, control: HTMLElement): HTMLElement {
  return h('div', { class: 'space-y-2' }, [fieldLabel(label), control]);
}

// ─────────────────────────── 文件选择卡 ───────────────────────────

interface PickerSpec {
  label: string;
  accept: string;
  hint: string;
  onFile: (file: File) => void | Promise<void>;
  onClear: () => void;
}

interface FilePicker {
  wrap: HTMLElement;
  setName: (name: string | null) => void;
  setError: (msg: string) => void;
}

function makeFilePicker(spec: PickerSpec): FilePicker {
  const input = h('input', {
    type: 'file',
    accept: spec.accept,
    class: 'hidden',
  }) as HTMLInputElement;
  const nameEl = h('span', {
    class: 'flex-1 truncate text-sm text-[var(--fg-muted)]',
    textContent: '未选择文件',
  });
  const errEl = h('p', { class: 'hidden text-xs text-red-500' });
  const clearBtn = h(
    'button',
    {
      type: 'button',
      'aria-label': `移除${spec.label}`,
      title: '移除文件',
      class:
        'hidden shrink-0 rounded-md px-2 py-1 text-sm text-[var(--fg-muted)] hover:text-red-500 transition-colors',
      textContent: '✕',
      onclick: () => {
        setName(null);
        setError('');
        spec.onClear();
      },
    },
    [],
  );
  const card = h(
    'div',
    {
      class:
        'flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 transition-colors hover:border-[var(--accent)]',
    },
    [],
  );

  const setName = (name: string | null): void => {
    nameEl.textContent = name ?? '未选择文件';
    nameEl.classList.toggle('text-[var(--fg)]', !!name);
    clearBtn.classList.toggle('hidden', !name);
  };
  const setError = (msg: string): void => {
    if (msg) {
      errEl.textContent = `⚠ ${msg}`;
      errEl.classList.remove('hidden');
    } else {
      errEl.classList.add('hidden');
    }
  };

  async function handleFile(f: File | undefined): Promise<void> {
    if (!f) return;
    setError('');
    try {
      await spec.onFile(f);
      setName(f.name);
    } catch (e) {
      setName(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  input.addEventListener('change', () => {
    void handleFile(input.files?.[0]);
    input.value = ''; // 允许重复选择同一文件
  });
  const chooseBtn = h(
    'button',
    {
      type: 'button',
      class:
        'shrink-0 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--fg)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors',
      onclick: () => input.click(),
    },
    ['选择文件'],
  );

  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    card.classList.add('border-[var(--accent)]');
  });
  card.addEventListener('dragleave', () => card.classList.remove('border-[var(--accent)]'));
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('border-[var(--accent)]');
    void handleFile(e.dataTransfer?.files?.[0]);
  });
  card.addEventListener('click', (e) => {
    if (e.target === card || e.target === nameEl) input.click();
  });

  card.append(input, chooseBtn, nameEl, clearBtn);
  const wrap = h('div', { class: 'space-y-1' }, [
    h('div', { class: 'flex items-baseline justify-between gap-2' }, [
      fieldLabel(spec.label),
      h('span', { class: 'text-xs text-[var(--fg-muted)]', textContent: spec.hint }),
    ]),
    card,
    errEl,
  ]);
  return { wrap, setName, setError };
}

// ─────────────────────────── 页面 ───────────────────────────

function render(): void {
  const { content } = renderToolLayout(document.getElementById('app')!, '文字快闪视频');

  // —— 业务状态 ——
  const opts: FlashOptions = loadOptions();
  // 首次打开预填示例文案（可编辑、随设置记忆），首屏即有效果
  if (!opts.contentText.trim()) {
    opts.contentText = SAMPLE_TEXT;
    saveOptions(opts);
  }
  let bgm: LoadedAudio | null = null;
  /** BGM 节拍点（秒；null = 未检测） */
  let beats: number[] | null = null;

  // —— 派生数据缓存（预览每帧调用 buildRenderInput，切卡/时间轴不能每帧重算） ——
  let scriptCache: { key: string; cards: Card[]; truncated: boolean } | null = null;
  let timelineCache: Timeline | null = null;
  /** 渲染世代号：任何影响画面外观的变化 +1 */
  let renderEpoch = 0;

  function invalidateDerived(): void {
    scriptCache = null;
    timelineCache = null;
    renderEpoch++;
  }

  function getCards(): { cards: Card[]; truncated: boolean } {
    const key = `${opts.aspect}|${opts.contentText.length}|${opts.contentText.slice(0, 64)}|${opts.contentText.slice(-32)}`;
    if (!scriptCache || scriptCache.key !== key) {
      const r = parseScript(opts.contentText, cardBudget(opts.aspect));
      scriptCache = { key, cards: r.cards, truncated: r.truncated };
    }
    return scriptCache;
  }

  function getTimeline(): Timeline {
    if (!timelineCache) {
      timelineCache = computeTimeline(opts, getCards().cards, beats);
    }
    return timelineCache;
  }

  /** 按 id 解析主题：内置 6 套，或 localStorage 里的自定义主题（未知 id 回退默认） */
  function resolveTheme(id: string): Theme {
    const builtin = THEMES.find((t) => t.id === id);
    if (builtin) return builtin;
    const custom = loadCustomThemes().find((c) => c.id === id);
    if (custom) return toRenderTheme(custom);
    return getTheme(undefined);
  }

  function buildRenderInput(): RenderInput {
    const theme = resolveTheme(opts.theme);
    return {
      opts,
      theme: opts.accentColor ? { ...theme, accent: opts.accentColor } : theme,
      cards: getCards().cards,
      timeline: getTimeline(),
      // 自定义动效：id → 编译产物走模块级缓存（本函数每帧执行，不能重复编译）
      customMotion:
        typeof opts.motion === 'string' && isCustomMotionId(opts.motion)
          ? getCustomMotionDraw(opts.motion)
          : null,
      epoch: renderEpoch,
    };
  }

  // ──────────────── 预览画布与播放器 ────────────────
  const previewCanvas = h('canvas', { class: 'block h-full w-full' }) as HTMLCanvasElement;
  const canvasFrame = h(
    'div',
    {
      class: 'mx-auto overflow-hidden rounded-xl border border-[var(--border)] bg-black shadow-lg',
    },
    [previewCanvas],
  );

  function applyAspectToCanvas(): void {
    const a = getAspect(opts.aspect);
    const scale = PREVIEW_SHORT / 1080;
    const cw = Math.round((a.w * scale) / 2) * 2;
    const ch = Math.round((a.h * scale) / 2) * 2;
    previewCanvas.width = cw;
    previewCanvas.height = ch;
    canvasFrame.style.aspectRatio = `${cw} / ${ch}`;
    canvasFrame.style.width = `min(100%, calc((100dvh - 16rem) * ${cw} / ${ch}))`;
  }

  // 预览音频链路：BufferSource → Gain → 扬声器（录制用独立链路，互不影响）。
  const audioCtx = getSharedAudioContext();
  const previewGain = audioCtx.createGain();
  previewGain.connect(audioCtx.destination);

  let previewSrc: AudioBufferSourceNode | null = null;
  let previewSounds: SoundPlayback | null = null;
  let audition: SoundPlayback | null = null;
  let playing = false;
  let pausedAt = 0;
  let playStartCtxTime = 0;
  let previewRaf = 0;
  let recording = false;
  let handle: RecordHandle | null = null;

  function totalDuration(): number {
    return getTimeline().total;
  }

  function currentPreviewT(): number {
    return playing ? audioCtx.currentTime - playStartCtxTime + pausedAt : pausedAt;
  }

  function hasContent(): boolean {
    return getCards().cards.length > 0;
  }

  function drawPreview(t: number): void {
    const ctx = previewCanvas.getContext('2d');
    if (!ctx) return;
    drawFrame(ctx, previewCanvas.width, previewCanvas.height, buildRenderInput(), t);
  }

  function releasePreviewSrc(): void {
    if (!previewSrc) return;
    try {
      previewSrc.stop();
      previewSrc.disconnect();
    } catch {
      /* 尚未 start / 已 stop：忽略 */
    }
    previewSrc = null;
  }

  function releasePreviewSounds(): void {
    previewSounds?.stop();
    previewSounds = null;
  }

  function syncPlayBtn(): void {
    playBtn.textContent = playing ? '⏸' : '▶';
    playBtn.disabled = !hasContent() || recording;
    seekSlider.disabled = !hasContent();
    prevBtn.disabled = !hasContent() || recording;
    nextBtn.disabled = !hasContent() || recording;
  }

  function currentFrame(): CardFrameState | null {
    return cardAt(currentPreviewT(), getTimeline());
  }

  function syncCardLabel(): void {
    const tl = getTimeline();
    const frame = currentFrame();
    cardLabel.textContent = frame ? `${frame.index + 1} / ${tl.cards}` : '0 / 0';
    paintCardChips();
  }

  function stopPreview(resetToStart: boolean): void {
    releasePreviewSrc();
    releasePreviewSounds();
    audition?.stop();
    playing = false;
    cancelAnimationFrame(previewRaf);
    if (resetToStart) {
      pausedAt = 0;
      drawStaticFrame();
    } else {
      drawPreview(pausedAt);
      syncTimeUI(pausedAt);
      syncCardLabel();
    }
    syncPlayBtn();
  }

  function playFrom(offset: number): void {
    if (!hasContent()) return;
    releasePreviewSrc();
    releasePreviewSounds();
    audition?.stop();
    void resumeAudioContext();
    // BGM 从时间轴同一起点续播（循环模式取模；非循环且已播完则静音继续）
    if (bgm) {
      const src = audioCtx.createBufferSource();
      src.buffer = bgm.buffer;
      src.loop = opts.bgmLoop;
      previewGain.gain.value = opts.bgmVolume / 100;
      src.connect(previewGain);
      if (opts.bgmLoop || offset < bgm.duration) {
        try {
          src.start(0, Math.max(0, offset % bgm.duration));
        } catch {
          /* 忽略：个别浏览器对极短 offset 抛错 */
        }
      }
      previewSrc = src;
    }
    pausedAt = offset;
    playStartCtxTime = audioCtx.currentTime;
    previewSounds = scheduleCardSounds({
      ctx: audioCtx,
      destination: audioCtx.destination,
      timeline: getTimeline(),
      effect: opts.soundEffect,
      volume: opts.soundVolume,
      when: playStartCtxTime,
      offset,
    });
    playing = true;
    syncPlayBtn();
    previewRaf = requestAnimationFrame(previewLoop);
  }

  function previewLoop(): void {
    if (!playing) return;
    const t = currentPreviewT();
    if (t >= totalDuration()) {
      stopPreview(true); // 播完回到首页完整静态帧
      return;
    }
    drawPreview(t);
    syncTimeUI(t);
    syncCardLabel();
    previewRaf = requestAnimationFrame(previewLoop);
  }

  function togglePlay(): void {
    if (!hasContent() || recording) return;
    if (playing) {
      pausedAt = currentPreviewT();
      stopPreview(false);
    } else {
      const from = pausedAt >= totalDuration() - 0.05 ? 0 : pausedAt;
      playFrom(from);
    }
  }

  /** 跳到某张卡：落在入场完成之后（避免跳进入场中段看不到完整文字） */
  function jumpToCard(i: number): void {
    const tl = getTimeline();
    if (tl.cards < 1) return;
    const idx = Math.min(tl.cards - 1, Math.max(0, i));
    const t = Math.min(
      tl.starts[idx]! + tl.durations[idx]! * 0.62,
      Math.max(0, tl.total - 0.01),
    );
    if (playing) playFrom(t);
    else {
      pausedAt = t;
      drawPreview(t);
      syncTimeUI(t);
      syncCardLabel();
    }
  }

  // —— 播放控制 UI ——
  const playBtn = h(
    'button',
    {
      type: 'button',
      class:
        'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-lg text-[var(--accent-fg)] hover:opacity-90 transition-opacity disabled:opacity-40',
      textContent: '▶',
      title: '预览播放（与成片一致）',
      onclick: togglePlay,
    },
    [],
  ) as HTMLButtonElement;

  const prevBtn = h(
    'button',
    {
      type: 'button',
      class:
        'shrink-0 rounded-md border border-[var(--border)] px-2 py-1 text-sm text-[var(--fg-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-40',
      textContent: '◀',
      title: '上一张',
      'aria-label': '上一张',
      onclick: () => jumpToCard((currentFrame()?.index ?? 0) - 1),
    },
    [],
  ) as HTMLButtonElement;
  const nextBtn = h(
    'button',
    {
      type: 'button',
      class:
        'shrink-0 rounded-md border border-[var(--border)] px-2 py-1 text-sm text-[var(--fg-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-40',
      textContent: '▶',
      title: '下一张',
      'aria-label': '下一张',
      onclick: () => jumpToCard((currentFrame()?.index ?? 0) + 1),
    },
    [],
  ) as HTMLButtonElement;
  const cardLabel = h('span', {
    class: 'shrink-0 font-mono text-xs text-[var(--fg-muted)]',
    textContent: '0 / 0',
  });

  const timeLabel = h('span', {
    class: 'shrink-0 font-mono text-xs text-[var(--fg-muted)]',
    textContent: '00:00 / 00:00',
  });

  const seekSlider = h('input', {
    type: 'range',
    min: '0',
    max: '1000',
    value: '0',
    class: 'w-full accent-[var(--accent)] disabled:opacity-40',
    'aria-label': '预览进度',
  }) as HTMLInputElement;

  let seekDragging = false;

  function syncTimeUI(t: number): void {
    const total = totalDuration();
    timeLabel.textContent = `${fmt(t)} / ${fmt(total)}`;
    if (!seekDragging) seekSlider.value = String(total > 0 ? (t / total) * 1000 : 0);
  }

  seekSlider.addEventListener('pointerdown', () => {
    seekDragging = true;
  });
  seekSlider.addEventListener('pointerup', () => {
    seekDragging = false;
  });
  seekSlider.addEventListener('input', () => {
    const v = (Number(seekSlider.value) / 1000) * totalDuration();
    if (!playing) {
      pausedAt = v;
      drawPreview(v);
      syncTimeUI(v);
      syncCardLabel();
    }
  });
  seekSlider.addEventListener('change', () => {
    const v = (Number(seekSlider.value) / 1000) * totalDuration();
    if (playing) playFrom(v);
    else {
      pausedAt = v;
      drawPreview(v);
      syncTimeUI(v);
      syncCardLabel();
    }
  });

  /**
   * 静态示意帧：暂停位置原样绘制；初始位置（t=0）落在第一张卡入场起点，
   * 改画「入场完成」时刻，保证未播放时构图完整可见。
   */
  function drawStaticFrame(): void {
    if (pausedAt > 0.01) {
      drawPreview(pausedAt);
      return;
    }
    const tl = getTimeline();
    const t =
      tl.cards > 0
        ? Math.min(
            tl.starts[0]! + tl.durations[0]! * 0.62,
            Math.max(0, tl.total - 0.01),
          )
        : 0;
    drawPreview(t);
    syncTimeUI(t);
    syncCardLabel();
  }

  // ──────────────── 文案输入 ────────────────
  const contentInput = h('textarea', {
    class:
      'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)] font-mono',
    rows: 10,
    'aria-label': '快闪文案',
    placeholder:
      '一行一句，粘贴你的文案…\n\n# 开头 = 标题卡\n**整句** 或 【整句】 = 强调卡\n空行与 --- 只是分隔，不产生卡片',
  }) as HTMLTextAreaElement;
  contentInput.value = opts.contentText;

  const cardCountLabel = h('span', { class: 'text-xs text-[var(--fg-muted)]' });
  const truncatedLabel = h('span', {
    class: 'hidden text-xs text-[var(--holiday-legal)]',
    textContent: '已达 200 张上限，超出部分被截断',
  });

  /** 文案格式帮助：提示词里的字数上限跟随当前画幅 */
  const openScriptHelp = (): void => openContentHelp(() => contentInput.value, () => opts.aspect);

  /** 卡片 chips（点击跳转预览；超过 CHIP_COMPACT 张切紧凑样式） */
  const cardChipsWrap = h('div', { class: 'flex flex-wrap gap-1.5' }, []);

  function rebuildCardChips(): void {
    const { cards } = getCards();
    cardChipsWrap.replaceChildren();
    cardChipsWrap.classList.toggle('hidden', cards.length === 0);
    const compact = cards.length > CHIP_COMPACT;
    cards.forEach((c, i) => {
      const label = compact ? String(i + 1) : `${i + 1}·${c.text.slice(0, 8)}`;
      cardChipsWrap.append(
        h(
          'button',
          {
            type: 'button',
            'data-card-idx': String(i),
            title: `第 ${i + 1} 张：${c.text.slice(0, 40)}`,
            class: compact
              ? 'min-w-6 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 text-xs text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]'
              : 'rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
            textContent: label,
            onclick: () => jumpToCard(i),
          },
          [],
        ),
      );
    });
    paintCardChips();
    truncatedLabel.classList.toggle('hidden', !getCards().truncated);
  }

  function paintCardChips(): void {
    const cur = currentFrame()?.index ?? -1;
    for (const b of cardChipsWrap.querySelectorAll('button[data-card-idx]')) {
      const el = b as HTMLButtonElement;
      const active = Number(el.dataset.cardIdx) === cur;
      el.style.borderColor = active ? 'var(--accent)' : '';
      el.style.color = active ? 'var(--accent)' : '';
      el.style.fontWeight = active ? '600' : '';
    }
  }

  /** 文案变更（300ms 防抖：避免逐键重切卡/重建 chips） */
  let contentTimer = 0;
  contentInput.addEventListener('input', () => {
    window.clearTimeout(contentTimer);
    contentTimer = window.setTimeout(() => {
      opts.contentText = contentInput.value.slice(0, CONTENT_MAX);
      saveOptions(opts);
      invalidateDerived();
      if (pausedAt > totalDuration()) pausedAt = 0;
      rebuildCardChips();
      refreshSummary();
      syncPlayBtn();
      drawStaticFrame();
    }, 300);
  });

  // ──────────────── 设置面板 ────────────────
  /** 统一入口：任何选项变化 → 落库 + 失效缓存 + 刷新画布与摘要 */
  function updateOptions(mutate: () => void, rebuildChips = false): void {
    mutate();
    saveOptions(opts);
    invalidateDerived();
    if (pausedAt > totalDuration()) pausedAt = 0;
    applyAspectToCanvas();
    if (rebuildChips) rebuildCardChips();
    refreshSummary();
    drawStaticFrame();
  }

  function refreshSummary(): void {
    const tl = getTimeline();
    const { cards } = getCards();
    cardCountLabel.textContent =
      cards.length > 0 ? `${cards.length} 张卡 · 总时长 ${fmt(tl.total)}` : '暂无卡片';
    truncatedLabel.classList.toggle('hidden', !getCards().truncated);
    refreshBeatUi();
    updateGenerateState();
  }

  const aspectSeg = makeSegment<AspectId>(
    ASPECTS.map((a) => ({ id: a.id, label: a.label })),
    opts.aspect,
    (id) => {
      updateOptions(() => (opts.aspect = id), true); // 分页字符预算随比例变化
    },
  );

  const resolutionSel = h(
    'select',
    {
      class:
        'w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      'aria-label': '导出分辨率',
      onchange: (e) =>
        updateOptions(
          () => (opts.resolution = (e.target as HTMLSelectElement).value as ResolutionId),
        ),
    },
    RESOLUTIONS.map((r) =>
      h('option', { value: r.id, selected: r.id === opts.resolution }, [r.label]),
    ),
  ) as HTMLSelectElement;

  const paceSeg = makeSegment<PaceId>(
    PACES.map((p) => ({ id: p.id, label: p.label, hint: p.hint })),
    opts.pace,
    (id) => updateOptions(() => (opts.pace = id)),
  );

  const speedValueLabel = h('span', {
    class: 'font-mono text-xs text-[var(--fg-muted)]',
    textContent: `× ${opts.speed.toFixed(1)}`,
  });
  const speedSlider = h('input', {
    type: 'range',
    min: '0.6',
    max: '2',
    step: '0.1',
    value: String(opts.speed),
    class: 'w-full accent-[var(--accent)]',
    'aria-label': '全局速度倍率',
    oninput: (e) => {
      opts.speed = Number((e.target as HTMLInputElement).value);
      speedValueLabel.textContent = `× ${opts.speed.toFixed(1)}`;
      saveOptions(opts);
      invalidateDerived();
      if (pausedAt > totalDuration()) pausedAt = 0;
      refreshSummary();
      drawStaticFrame();
    },
  }) as HTMLInputElement;

  const beatStatus = h('p', {
    class: 'text-[11px] leading-relaxed text-[var(--fg-muted)]',
    textContent: '',
  });

  const syncSeg = makeSegment<SyncId>(
    SYNCS.map((s) => ({ id: s.id, label: s.label, hint: s.hint })),
    opts.sync,
    (id) => {
      updateOptions(() => (opts.sync = id));
      refreshBeatUi();
    },
  );

  const redetectBtn = h(
    'button',
    {
      type: 'button',
      class:
        'rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
      textContent: '重新识别节拍',
      title: '按当前 BGM 重新检测鼓点',
      onclick: () => detectBeatsFromBgm(),
    },
    [],
  ) as HTMLButtonElement;

  function refreshBeatUi(): void {
    const tl = getTimeline();
    if (!bgm) {
      beatStatus.textContent = '未加载 BGM：节拍对齐不可用，卡片按自动节奏切换。';
      redetectBtn.classList.add('hidden');
      return;
    }
    redetectBtn.classList.remove('hidden');
    const count = beats?.length ?? 0;
    if (opts.sync === 'beat') {
      beatStatus.textContent = tl.beatSynced
        ? `✓ 已识别 ${count} 个节拍点，卡片切换点已对齐鼓点。`
        : `⚠ 鼓点数量不足（${count} 个），当前已回退自动节奏；可换一首鼓点清晰的 BGM。`;
    } else {
      beatStatus.textContent = count > 0
        ? `已识别 ${count} 个节拍点——切到「跟随节拍」即可卡点。`
        : '未识别到明显鼓点，可换一首鼓点清晰的 BGM。';
    }
  }

  function detectBeatsFromBgm(): void {
    if (!bgm) {
      beats = null;
      invalidateDerived();
      refreshSummary();
      drawStaticFrame();
      return;
    }
    const mono = mixToMono(bgm.buffer);
    beats = detectBeatTimes(mono.samples, mono.rate);
    invalidateDerived();
    if (pausedAt > totalDuration()) pausedAt = 0;
    refreshSummary();
    rebuildCardChips();
    drawStaticFrame();
  }

  // —— 入场动效（内置 + 自定义 chips） ——
  const motionSeg = makeSegment<MotionSelection>(
    MOTIONS.map((m) => ({ id: m.id as MotionSelection, label: m.label, hint: m.hint })),
    opts.motion,
    (id) => {
      updateOptions(() => (opts.motion = id));
      paintMotionChips();
    },
  );

  const customMotionWrap = h('div', { class: 'flex flex-wrap gap-2' }, []);

  function paintMotionChips(): void {
    for (const b of customMotionWrap.querySelectorAll('button[data-viz-id]')) {
      const el = b as HTMLButtonElement;
      const active = el.dataset.vizId === opts.motion;
      el.className =
        'rounded-md border px-2.5 py-1.5 text-sm transition-colors ' +
        (active
          ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]'
          : 'border-[var(--border)] bg-[var(--bg)] text-[var(--fg-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]');
    }
  }

  function rebuildMotionChips(): void {
    customMotionWrap.replaceChildren();
    const items = loadCustomMotions();
    customMotionWrap.classList.toggle('hidden', items.length === 0);
    for (const item of items) {
      const btn = h(
        'button',
        {
          type: 'button',
          'data-viz-id': item.id,
          title: `自定义动效：${item.name}`,
          class: 'rounded-md border px-2.5 py-1.5 text-sm transition-colors',
          textContent: `⭐ ${item.name}`,
          onclick: () => {
            updateOptions(() => (opts.motion = item.id as MotionSelection));
            motionSeg.set(item.id as MotionSelection);
            paintMotionChips();
          },
        },
        [],
      );
      const del = h(
        'button',
        {
          type: 'button',
          'aria-label': `删除动效 ${item.name}`,
          title: '删除此动效',
          class:
            'absolute -right-1.5 -top-1.5 hidden h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500 text-[9px] leading-none text-white shadow group-hover:flex',
          textContent: '✕',
          onclick: (e) => {
            e.stopPropagation();
            void confirmDialog(`确定删除动效「${item.name}」吗？`, {
              title: '删除动效',
              danger: true,
              confirmText: '删除',
            }).then((ok) => {
              if (!ok) return;
              removeCustomMotion(item.id);
              invalidateMotionCache(item.id);
              if (opts.motion === item.id) {
                updateOptions(() => (opts.motion = 'pop'));
                motionSeg.set('pop');
              }
              rebuildMotionChips();
            });
          },
        },
        [],
      );
      customMotionWrap.append(h('div', { class: 'group relative' }, [btn, del]));
    }
    paintMotionChips();
  }

  // —— 强调样式 / 进度指示 ——
  const emphasisSeg = makeSegment<EmphasisId>(
    EMPHASES.map((e) => ({ id: e.id, label: e.label, hint: e.hint })),
    opts.emphasis,
    (id) => updateOptions(() => (opts.emphasis = id)),
  );

  const progressSeg = makeSegment<ProgressId>(
    PROGRESSES.map((p) => ({ id: p.id, label: p.label, hint: p.hint })),
    opts.progress,
    (id) => updateOptions(() => (opts.progress = id)),
  );

  // —— 主题墙：直接渲染真实画面缩略图，而非渐变色块 ——
  const themeWrap = h('div', { class: 'grid grid-cols-2 gap-2.5 sm:grid-cols-3' }, []);
  const paintTheme = (id: string): void => {
    for (const b of themeWrap.querySelectorAll('button[data-theme-id]')) {
      const el = b as HTMLElement;
      const active = el.dataset.themeId === id;
      el.style.borderColor = active ? 'var(--accent)' : '';
      el.style.boxShadow = active
        ? '0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent)'
        : '';
      el.setAttribute('aria-pressed', String(active));
    }
  };
  function selectTheme(id: string): void {
    updateOptions(() => (opts.theme = id));
    accentColorInput.value = resolveTheme(id).accent;
    paintTheme(id);
  }

  function makeThemeCard(th: Theme): HTMLElement {
    const cv = h('canvas', {
      width: 320,
      height: 180,
      class: 'block aspect-video w-full border-b border-black/5',
    }) as HTMLCanvasElement;
    const ctx = cv.getContext('2d');
    if (ctx) {
      drawSampleCard(ctx, 320, 180, th, { text: th.label, em: false, title: true }, null);
    }
    const layout = th.design.layout;
    const layoutLabel =
      { center: '正中大字', stack: '左对齐堆叠', band: '高亮色带', corner: '左下角标' }[layout] ??
      '完整主题';
    return h(
      'button',
      {
        type: 'button',
        'data-theme-id': th.id,
        title: `${th.label} · ${layoutLabel}`,
        'aria-label': `主题：${th.label}`,
        class:
          'w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)] text-left transition-all hover:-translate-y-0.5 hover:border-[var(--accent)]',
        onclick: () => selectTheme(th.id),
      },
      [
        cv,
        h('span', { class: 'block px-2.5 py-2' }, [
          h('span', {
            class: 'block truncate text-xs font-medium text-[var(--fg)]',
            textContent: th.label,
          }),
          h('span', {
            class: 'mt-0.5 block truncate text-[10px] text-[var(--fg-muted)]',
            textContent: layoutLabel,
          }),
        ]),
      ],
    );
  }

  function rebuildThemeButtons(): void {
    themeWrap.replaceChildren();
    for (const th of THEMES) themeWrap.append(makeThemeCard(th));
    for (const ct of loadCustomThemes()) {
      const btn = makeThemeCard(toRenderTheme(ct));
      const del = h(
        'button',
        {
          type: 'button',
          'aria-label': `删除主题 ${ct.name}`,
          title: '删除此主题',
          class:
            'absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] leading-none text-white shadow group-hover:flex',
          textContent: '✕',
          onclick: (e) => {
            e.stopPropagation();
            void confirmDialog(`确定删除自定义主题「${ct.name}」吗？`, {
              title: '删除主题',
              danger: true,
              confirmText: '删除',
            }).then((ok) => {
              if (!ok) return;
              removeCustomTheme(ct.id);
              if (opts.theme === ct.id) selectTheme(THEMES[0]!.id);
              rebuildThemeButtons();
            });
          },
        },
        [],
      );
      themeWrap.append(h('div', { class: 'group relative min-w-0' }, [btn, del]));
    }
    paintTheme(opts.theme);
  }
  rebuildThemeButtons();

  // —— 自定义主色 ——
  const accentColorInput = h('input', {
    type: 'color',
    value: opts.accentColor ?? resolveTheme(opts.theme).accent,
    class: 'h-8 w-10 cursor-pointer rounded border border-[var(--border)] bg-[var(--bg)] p-0.5',
    'aria-label': '自定义主色',
    oninput: (e) => updateOptions(() => (opts.accentColor = (e.target as HTMLInputElement).value)),
  }) as HTMLInputElement;
  const accentResetBtn = h(
    'button',
    {
      type: 'button',
      class:
        'rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--fg-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors',
      textContent: '跟随主题',
      onclick: () => {
        updateOptions(() => (opts.accentColor = null));
        accentColorInput.value = resolveTheme(opts.theme).accent;
      },
    },
    [],
  );

  // —— 字体 ——
  const fontSeg = makeSegment<FontId | 'theme'>(
    [{ id: 'theme', label: '跟随主题' }, ...FONTS.map((f) => ({ id: f.id, label: f.label }))],
    opts.font ?? 'theme',
    (id) => updateOptions(() => (opts.font = id === 'theme' ? null : id)),
  );

  // —— AI 风格方案 chips ——
  const schemeWrap = h('div', { class: 'flex flex-wrap gap-2' }, []);

  function applyParsedScheme(s: ParsedScheme): void {
    updateOptions(() => {
      const items = addCustomTheme(
        s.name,
        s.colors.bg1,
        s.colors.bg2,
        s.colors.fg,
        s.colors.accent,
        s.design ?? DEFAULT_THEME_DESIGN,
      );
      const saved = items.find((it) => it.name.trim() === s.name.trim());
      if (saved) {
        opts.theme = saved.id;
        opts.accentColor = null; // 方案主色即主题主色，清掉旧覆盖色
      }
      opts.font = null;
      Object.assign(
        opts,
        schemeOptionPatches({
          id: '',
          createdAt: 0,
          name: s.name,
          bg1: s.colors.bg1,
          bg2: s.colors.bg2,
          fg: s.colors.fg,
          accent: s.colors.accent,
          ...(s.design ? { design: s.design } : {}),
          ...(s.motion ? { motion: s.motion } : {}),
        }),
      );
    });
    // 同步各控件高亮与条件显隐（updateOptions 只重画画布，不刷控件）
    rebuildThemeButtons();
    motionSeg.set(opts.motion);
    fontSeg.set(opts.font ?? 'theme');
    accentColorInput.value = resolveTheme(opts.theme).accent;
    rebuildMotionChips();
    rebuildSchemeChips();
    refreshSummary();
    drawStaticFrame();
  }

  function applyStoredScheme(stored: CustomScheme): void {
    applyParsedScheme({
      name: stored.name,
      colors: { bg1: stored.bg1, bg2: stored.bg2, fg: stored.fg, accent: stored.accent },
      ...(stored.design ? { design: stored.design } : {}),
      ...(stored.motion ? { motion: stored.motion } : {}),
    });
  }

  function rebuildSchemeChips(): void {
    schemeWrap.replaceChildren();
    const items = loadCustomSchemes();
    schemeWrap.classList.toggle('hidden', items.length === 0);
    for (const item of items) {
      const btn = h(
        'button',
        {
          type: 'button',
          title: `应用风格方案：${item.name}（配色 + 版式整套；同名主题会被覆盖）`,
          class:
            'flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
          onclick: () => applyStoredScheme(item),
        },
        [
          h('span', {
            class: 'h-4 w-6 rounded border border-[var(--border)]',
            style: `background:linear-gradient(135deg,${item.bg1},${item.bg2})`,
          }),
          h('span', { textContent: item.name }),
        ],
      );
      const del = h(
        'button',
        {
          type: 'button',
          'aria-label': `删除风格方案 ${item.name}`,
          title: '删除此方案（同名自定义主题会保留在上方主题区）',
          class:
            'absolute -right-1.5 -top-1.5 hidden h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500 text-[9px] leading-none text-white shadow group-hover:flex',
          textContent: '✕',
          onclick: (e) => {
            e.stopPropagation();
            void confirmDialog(`确定删除风格方案「${item.name}」吗？（同名自定义主题保留）`, {
              title: '删除风格方案',
              danger: true,
              confirmText: '删除',
            }).then((ok) => {
              if (!ok) return;
              removeCustomScheme(item.id);
              rebuildSchemeChips();
            });
          },
        },
        [],
      );
      schemeWrap.append(h('div', { class: 'group relative' }, [btn, del]));
    }
  }

  const aiDialogs = createAiDialogs({
    getTheme: () => resolveTheme(opts.theme),
    getOptions: () => opts,
    onMotionApplied: (id) => {
      updateOptions(() => (opts.motion = id as MotionSelection));
      motionSeg.set(id as MotionSelection);
      rebuildMotionChips();
    },
    onSchemeApplied: applyParsedScheme,
  });

  rebuildMotionChips();
  rebuildSchemeChips();

  // ──────────────── 切卡音效（本地合成，可试听且进入导出音轨） ────────────────
  const soundPreviewBtn = h('button', {
    type: 'button',
    class:
      'shrink-0 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40',
    textContent: '▶ 试听',
    disabled: opts.soundEffect === 'none',
    onclick: () => {
      audition?.stop();
      void resumeAudioContext();
      audition = playSoundEffect({
        ctx: audioCtx,
        destination: audioCtx.destination,
        effect: opts.soundEffect,
        volume: opts.soundVolume,
      });
    },
  }) as HTMLButtonElement;
  const soundEffectSeg = makeSegment<SoundEffectId>(
    SOUND_EFFECTS.map((s) => ({ id: s.id, label: s.label, hint: s.hint })),
    opts.soundEffect,
    (id) => {
      const at = currentPreviewT();
      updateOptions(() => (opts.soundEffect = id));
      soundPreviewBtn.disabled = id === 'none';
      audition?.stop();
      if (playing) playFrom(at);
    },
  );
  const soundVolumeSlider = h('input', {
    type: 'range',
    min: '0',
    max: '100',
    value: String(opts.soundVolume),
    class: 'w-full accent-[var(--accent)]',
    'aria-label': '切卡音效音量',
  }) as HTMLInputElement;
  soundVolumeSlider.addEventListener('input', () => {
    opts.soundVolume = Number(soundVolumeSlider.value);
    previewSounds?.setVolume(opts.soundVolume);
    audition?.setVolume(opts.soundVolume);
    saveOptions(opts);
  });

  // ──────────────── 背景音乐 ────────────────
  const bgmPicker = makeFilePicker({
    label: '🎵 背景音乐（可选）',
    accept:
      '.mp3,.wav,.mpga,.mp2,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave,audio/vnd.wav',
    hint: 'MP3 / WAV；加载后自动识别鼓点',
    onFile: async (f) => {
      const loaded = await loadAudioFile(f);
      bgm = loaded;
      detectBeatsFromBgm();
      if (playing) playFrom(currentPreviewT()); // 热切换：从真实当前位置续播
    },
    onClear: () => {
      bgm = null;
      beats = null;
      releasePreviewSrc();
      invalidateDerived();
      if (pausedAt > totalDuration()) pausedAt = 0;
      refreshSummary();
      rebuildCardChips();
      drawStaticFrame();
    },
  });

  const volumeSlider = h('input', {
    type: 'range',
    min: '0',
    max: '100',
    value: String(opts.bgmVolume),
    class: 'w-full accent-[var(--accent)]',
    'aria-label': '背景音乐音量',
  }) as HTMLInputElement;
  volumeSlider.addEventListener('input', () => {
    opts.bgmVolume = Number(volumeSlider.value);
    previewGain.gain.value = opts.bgmVolume / 100;
    saveOptions(opts);
  });

  const bgmLoopCheckbox = h('input', {
    type: 'checkbox',
    class: 'h-3.5 w-3.5 accent-[var(--accent)]',
    checked: opts.bgmLoop,
    onchange: (e) => updateOptions(() => (opts.bgmLoop = (e.target as HTMLInputElement).checked)),
  }) as HTMLInputElement;

  // ──────────────── 生成区 ────────────────
  const generateBtn = h(
    'button',
    {
      type: 'button',
      class:
        'w-full rounded-md bg-[var(--accent)] px-4 py-2.5 font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
      textContent: '🎬 生成视频',
      onclick: () => void generate(),
    },
    [],
  ) as HTMLButtonElement;

  const progressBarFill = h('div', {
    class: 'h-full w-0 rounded-full bg-[var(--accent)] transition-[width] duration-150',
  });
  const progressBar = h('div', { class: 'flex-1' }, [
    h('div', { class: 'h-2 w-full overflow-hidden rounded-full bg-[var(--bg)]' }, [
      progressBarFill,
    ]),
  ]);
  const progressLabel = h('p', { class: 'text-xs text-[var(--fg-muted)]', textContent: '' });
  const cancelBtn = h(
    'button',
    {
      type: 'button',
      class:
        'shrink-0 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--fg-muted)] transition-colors hover:border-red-400 hover:text-red-500',
      textContent: '取消',
      onclick: () => handle?.cancel(),
    },
    [],
  ) as HTMLButtonElement;
  const progressWrap = h('div', { class: 'hidden space-y-2' }, [
    h('div', { class: 'flex items-center gap-3' }, [progressBar, cancelBtn]),
  ]);

  const downloadWrap = h('div', { class: 'hidden' }, []);
  let downloadUrl: string | null = null;
  const statusEl = h('p', { class: 'min-h-5 text-xs text-[var(--fg-muted)]' });

  function updateGenerateState(): void {
    generateBtn.disabled = !hasContent() || recording;
    generateBtn.title = hasContent() ? '' : '请先在「快闪文案」输入内容';
  }

  /** 导出文件名：取第一张卡的文本，否则「文字快闪视频」 */
  function exportFileName(): string {
    const first = getCards().cards[0];
    const base = sanitizeFilePart(first?.text || '文字快闪视频', 40);
    return base || '文字快闪视频';
  }

  async function generate(): Promise<void> {
    if (!hasContent() || recording) return;
    const total = totalDuration();
    const ok = await confirmDialog(
      `为保障视频质量，生成过程中请保持本页面在前台（切换标签页 / 最小化窗口会导致掉帧）。` +
        `生成期间将自动阻止屏幕保护、熄屏与休眠` +
        `${isWakeLockSupported() ? '' : '（当前浏览器不支持防休眠，请注意系统电源设置）'}。` +
        `实时渲染约需 ${Math.ceil(total)} 秒，是否开始？`,
      { title: '开始生成视频', confirmText: '开始生成' },
    );
    if (!ok) return;
    if (playing) stopPreview(false);
    audition?.stop();
    void resumeAudioContext();
    statusEl.textContent = '';
    downloadWrap.classList.add('hidden');
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      downloadUrl = null;
    }

    // 输出尺寸：短边 = 分辨率档位；对齐偶数（H.264 编码要求）
    const a = getAspect(opts.aspect);
    const res = getResolution(opts.resolution);
    const scale = res.shortSide / 1080;
    const W = Math.round((a.w * scale) / 2) * 2;
    const H = Math.round((a.h * scale) / 2) * 2;

    recording = true;
    updateGenerateState();
    syncPlayBtn();
    progressWrap.classList.remove('hidden');
    progressBarFill.style.width = '0%';
    progressLabel.textContent = `准备录制…（实时渲染约需 ${Math.ceil(total)} 秒，期间 BGM 不外放，请保持本页面在前台）`;

    handle = startRecording({
      buffer: bgm?.buffer ?? null,
      volume: opts.bgmVolume,
      loop: opts.bgmLoop,
      soundEffect: opts.soundEffect,
      soundVolume: opts.soundVolume,
      input: buildRenderInput(),
      W,
      H,
      fps: EXPORT_FPS,
      onProgress: (ratio, t, tot) => {
        progressBarFill.style.width = `${(ratio * 100).toFixed(1)}%`;
        progressLabel.textContent = `正在渲染 ${Math.round(ratio * 100)}%（${fmt(t)} / ${fmt(tot)}，预计剩余 ${fmt(tot - t)}）… 请保持页面在前台`;
      },
    });

    const result = await handle.result;
    handle = null;
    recording = false;
    progressWrap.classList.add('hidden');
    progressLabel.textContent = '';
    updateGenerateState();
    syncPlayBtn();
    drawStaticFrame();

    if (!result.ok) {
      if (result.reason !== 'cancelled') statusEl.textContent = `✕ ${result.reason}`;
      return;
    }

    const fname = `${exportFileName()}.${result.ext}`;
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(result.blob);
    const dl = h('a', {
      href: downloadUrl,
      download: fname,
      class:
        'inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500',
      textContent: `⬇ 下载视频（${(result.blob.size / 1024 / 1024).toFixed(1)} MB · ${result.ext.toUpperCase()}）`,
    });
    downloadWrap.replaceChildren(dl);
    downloadWrap.classList.remove('hidden');
    statusEl.textContent = '✓ 视频生成完成，点击按钮保存。';
  }

  // ──────────────── 组装布局 ────────────────
  // 预览列仅在 lg 及以上吸顶：单列布局下预览区高约 920px（>视口），
  // 若也吸顶会一直盖住下方设置项，手机端连文案输入框都点不到。
  const previewCol = h(
    'div',
    {
      class:
        'min-w-0 order-first lg:order-none lg:sticky lg:top-6 z-10 bg-[var(--bg)] py-2 space-y-3',
    },
    [
      h('div', { class: 'flex items-center justify-between gap-2' }, [
        fieldLabel('预览'),
        h('span', {
          class: 'text-xs text-[var(--fg-muted)]',
          textContent: '预览与成片效果一致',
        }),
      ]),
      canvasFrame,
      h('div', { class: 'flex items-center gap-2' }, [prevBtn, cardLabel, nextBtn]),
      h('div', { class: 'flex items-center gap-3' }, [playBtn, seekSlider, timeLabel]),
      h(
        'div',
        {
          class:
            'space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-sm',
        },
        [generateBtn, progressWrap, progressLabel, downloadWrap, statusEl],
      ),
    ],
  );

  const configHeading = (text: string): HTMLElement =>
    h('p', {
      class: 'pt-1 text-xs font-semibold tracking-wide text-[var(--fg)]',
      textContent: text,
    });

  const moreConfig = h(
    'details',
    {
      class: 'overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg)]',
    },
    [
      h(
        'summary',
        {
          class:
            'cursor-pointer select-none px-4 py-3.5 text-sm font-medium text-[var(--fg)] outline-none transition-colors hover:text-[var(--accent)]',
        },
        [
          '更多配置 ',
          h('span', {
            class: 'text-xs font-normal text-[var(--fg-muted)]',
            textContent: '强调样式、进度条、字体、主色与画质',
          }),
        ],
      ),
      h('div', { class: 'space-y-5 border-t border-[var(--border)] p-4' }, [
        h('div', { class: 'space-y-3' }, [
          configHeading('强调与进度'),
          row('强调卡样式', emphasisSeg.wrap),
          row('进度指示', progressSeg.wrap),
        ]),
        h('div', { class: 'space-y-3' }, [
          configHeading('字体与主色'),
          row('字体（默认跟随主题）', fontSeg.wrap),
          row(
            '自定义主色',
            h('div', { class: 'flex items-center gap-2' }, [accentColorInput, accentResetBtn]),
          ),
        ]),
        h('div', { class: 'space-y-3' }, [
          configHeading('音频细节'),
          row('切卡音效音量', soundVolumeSlider),
          row('背景音乐音量', volumeSlider),
          h(
            'label',
            { class: 'flex cursor-pointer items-center gap-2 text-xs text-[var(--fg-muted)]' },
            [bgmLoopCheckbox, '音乐短于视频时循环播放'],
          ),
        ]),
        h('div', { class: 'space-y-3' }, [
          configHeading('画质'),
          row('导出画质', resolutionSel),
        ]),
      ]),
    ],
  );

  const settingsCol = h('div', { class: 'min-w-0 space-y-5' }, [
    h(
      'div',
      {
        class:
          'space-y-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-sm sm:p-5',
      },
      [
        h('div', { class: 'space-y-2' }, [
          h('div', { class: 'flex items-center justify-between gap-2' }, [
            h('div', { class: 'flex items-center gap-1.5' }, [
              fieldLabel('快闪文案'),
              h('button', {
                type: 'button',
                class:
                  'inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border)] text-[11px] text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
                textContent: '?',
                title: '文案格式与 AI 改写提示词',
                'aria-label': '文案格式与 AI 改写提示词',
                onclick: openScriptHelp,
              }),
            ]),
            h('span', { class: 'flex items-center gap-2' }, [truncatedLabel, cardCountLabel]),
          ]),
          contentInput,
          h('p', {
            class: 'text-[11px] leading-relaxed text-[var(--fg-muted)]',
            textContent:
              '一行 = 一张卡 · 一行多句自动按句读拆开 · # 开头是标题卡 · **整句** 或【整句】是强调卡 · 空行与 --- 仅作分隔。点击 ? 可复制 AI 改写提示词。',
          }),
          cardChipsWrap,
        ]),
        h('div', { class: 'border-t border-[var(--border)]' }),
        h('div', { class: 'space-y-3' }, [
          h('div', { class: 'flex items-center justify-between gap-2' }, [
            fieldLabel('视觉主题'),
            h('button', {
              type: 'button',
              class:
                'rounded-md px-2 py-1 text-xs text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--accent)]',
              textContent: '✨ AI 自定义主题',
              onclick: () => aiDialogs.openSchemeDialog(),
            }),
          ]),
          themeWrap,
          schemeWrap,
        ]),
        h('div', { class: 'space-y-2' }, [
          h('div', { class: 'flex items-center justify-between gap-2' }, [
            fieldLabel('入场动效'),
            h('button', {
              type: 'button',
              class:
                'rounded-md px-2 py-1 text-xs text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg)] hover:text-[var(--accent)]',
              textContent: '✨ AI 自定义动效',
              onclick: () => aiDialogs.openMotionDialog(),
            }),
          ]),
          motionSeg.wrap,
          customMotionWrap,
        ]),
        h('div', { class: 'space-y-3' }, [
          row('节奏', paceSeg.wrap),
          row(
            '速度倍率',
            h('div', { class: 'space-y-1' }, [
              h('div', { class: 'flex items-center justify-between gap-2' }, [
                h('span', {
                  class: 'text-[11px] text-[var(--fg-muted)]',
                  textContent: '越大切得越快',
                }),
                speedValueLabel,
              ]),
              speedSlider,
            ]),
          ),
        ]),
        bgmPicker.wrap,
        h('div', { class: 'space-y-2' }, [
          h('div', { class: 'flex items-center justify-between gap-2' }, [
            fieldLabel('节拍对齐'),
            redetectBtn,
          ]),
          syncSeg.wrap,
          beatStatus,
        ]),
        h('div', { class: 'space-y-2' }, [
          h('div', { class: 'flex items-center justify-between gap-2' }, [
            fieldLabel('切卡音效'),
            soundPreviewBtn,
          ]),
          soundEffectSeg.wrap,
        ]),
        h('div', { class: 'space-y-3' }, [row('画面比例', aspectSeg.wrap)]),
        moreConfig,
      ],
    ),
  ]);

  const layout = h(
    'div',
    {
      class:
        'grid items-start gap-6 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]',
    },
    [settingsCol, previewCol],
  );

  content.append(
    layout,
    h('p', {
      class: 'pt-1 text-center text-xs text-[var(--fg-muted)]',
      textContent:
        '全部处理在本浏览器完成：文案与音频不会上传服务器；设置、文案与 AI 主题/动效记忆在本机（音乐文件不记忆）。只有你主动使用 AI 直连或向外部 AI 粘贴内容时，对应内容才会发送给所选服务。',
    }),
  );

  // 初始：应用画布比例 + 重建卡片导航 + 静态帧 + 按钮态 + 条件显隐
  applyAspectToCanvas();
  rebuildCardChips();
  refreshSummary();
  syncPlayBtn();
  syncTimeUI(0);
  drawStaticFrame();
  updateGenerateState();
}

render();
