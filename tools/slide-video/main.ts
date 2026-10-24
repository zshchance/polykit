import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { confirmDialog } from '@/core/components/Dialog';
import { sanitizeFilePart } from '@/core/utils/download';

import {
  getSharedAudioContext,
  loadAudioFile,
  resumeAudioContext,
  type LoadedAudio,
} from './audio';
import {
  addCustomTheme,
  loadCustomThemes,
  removeCustomTheme,
  toRenderTheme,
} from './custom-themes';
import { paginate, pageBudget, SAMPLE_TEXT, type Page } from './paginate';
import {
  ALIGNS,
  ASPECTS,
  COUNTDOWNS,
  COUNTDOWN_POS,
  DEFAULT_THEME_DESIGN,
  ENTERS,
  FLIPS,
  FLIP_DUR_CHOICES,
  FONTS,
  PAGE_DUR_CHOICES,
  RESOLUTIONS,
  THEMES,
  THEME_LAYOUTS,
  computeTimeline,
  getAspect,
  getResolution,
  getTheme,
  isCustomCountdownId,
  isCustomFlipId,
  type AlignId,
  type AspectId,
  type CountdownPosId,
  type CountdownSelection,
  type EnterId,
  type FlipSelection,
  type FontId,
  type ResolutionId,
  type SlideVideoOptions,
  type SoundEffectId,
  type Theme,
  type Timeline,
} from './options';
import { drawFrame, drawSamplePage, type RenderInput } from './renderer';
import { openContentHelp } from './content-help';
import {
  playSoundEffect,
  schedulePageSounds,
  SOUND_EFFECTS,
  type SoundPlayback,
} from './sound-effects';
import {
  getCustomFlipDraw,
  invalidateFlipCache,
  loadCustomFlips,
  removeCustomFlip,
} from './custom-transitions';
import {
  getCustomCountdownDraw,
  invalidateCountdownCache,
  loadCustomCountdowns,
  removeCustomCountdown,
} from './custom-countdowns';
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
/** 页导航 chips 超过该页数切换为紧凑样式（只显页码） */
const PAGE_CHIPS_COMPACT = 12;

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

/** 数值档位下拉（时长等） */
function makeNumSelect(
  label: string,
  choices: readonly number[],
  current: number,
  format: (v: number) => string,
  onChange: (v: number) => void,
): { wrap: HTMLElement } {
  const sel = h(
    'select',
    {
      class:
        'w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      'aria-label': label,
      onchange: (e) => onChange(Number((e.target as HTMLSelectElement).value)),
    },
    choices.map((c) =>
      h('option', { value: String(c), selected: Math.abs(c - current) < 1e-6 }, [format(c)]),
    ),
  ) as HTMLSelectElement;
  return { wrap: sel };
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
  const { content } = renderToolLayout(document.getElementById('app')!, '演示翻页视频');

  // —— 业务状态 ——
  const opts: SlideVideoOptions = loadOptions();
  // 首次打开预填示例文稿（可编辑、随设置记忆），首屏即有效果
  if (!opts.contentText.trim()) {
    opts.contentText = SAMPLE_TEXT;
    saveOptions(opts);
  }
  let bgm: LoadedAudio | null = null;

  // —— 派生数据缓存（预览每帧调用 buildRenderInput，分页/时间轴不能每帧重算） ——
  let pagesResult: { key: string; pages: Page[]; truncated: boolean } | null = null;
  let timelineCache: Timeline | null = null;
  /** 渲染世代号：任何影响页面外观的变化 +1（renderer 据此清快照缓存） */
  let renderEpoch = 0;

  function invalidateDerived(): void {
    pagesResult = null;
    timelineCache = null;
    renderEpoch++;
  }

  function getPages(): { pages: Page[]; truncated: boolean } {
    const key = `${opts.aspect}|${opts.contentText.length}|${opts.contentText.slice(0, 64)}|${opts.contentText.slice(-32)}`;
    if (!pagesResult || pagesResult.key !== key) {
      const r = paginate(opts.contentText, pageBudget(opts.aspect));
      pagesResult = { key, pages: r.pages, truncated: r.truncated };
    }
    return pagesResult;
  }

  function getTimeline(): Timeline {
    if (!timelineCache) {
      timelineCache = computeTimeline(opts, getPages().pages.length);
    }
    return timelineCache;
  }

  /** 按 id 解析主题：内置 8 套，或 localStorage 里的自定义主题（未知 id 回退默认） */
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
      pages: getPages().pages,
      timeline: getTimeline(),
      // 自定义动画/倒计时：id → 编译产物走模块级缓存（本函数每帧执行，不能重复编译）
      customFlip:
        typeof opts.flip === 'string' && isCustomFlipId(opts.flip)
          ? getCustomFlipDraw(opts.flip)
          : null,
      customCountdown:
        typeof opts.countdown === 'string' && isCustomCountdownId(opts.countdown)
          ? getCustomCountdownDraw(opts.countdown)
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
    const w = Math.round((a.w * scale) / 2) * 2;
    const hgt = Math.round((a.h * scale) / 2) * 2;
    previewCanvas.width = w;
    previewCanvas.height = hgt;
    canvasFrame.style.aspectRatio = `${w} / ${hgt}`;
    canvasFrame.style.width = `min(100%, calc((100dvh - 16rem) * ${w} / ${hgt}))`;
  }

  // 预览音频链路：BufferSource → Gain → 扬声器（录制用独立链路，互不影响）。
  // 无 BGM 时仍用同一 AudioContext 的时钟驱动预览（与导出保持单一时钟源）。
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

  function totalDuration(): number {
    return getTimeline().total;
  }

  function currentPreviewT(): number {
    return playing ? audioCtx.currentTime - playStartCtxTime + pausedAt : pausedAt;
  }

  function hasContent(): boolean {
    return getPages().pages.length > 0;
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

  /** 当前页索引（用于页码指示与导航按钮） */
  function currentPageIndex(): number {
    const tl = getTimeline();
    if (tl.pages < 1) return 0;
    const t = Math.min(Math.max(currentPreviewT(), 0), tl.total - 0.001);
    return Math.min(tl.pages - 1, Math.floor(t / tl.pageDur));
  }

  function syncPageLabel(): void {
    const tl = getTimeline();
    pageLabel.textContent = tl.pages > 0 ? `${currentPageIndex() + 1} / ${tl.pages}` : '0 / 0';
    paintPageChips();
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
      syncPageLabel();
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
    previewSounds = schedulePageSounds({
      ctx: audioCtx,
      destination: audioCtx.destination,
      timeline: getTimeline(),
      effect: opts.soundEffect,
      volume: opts.soundVolume,
      when: playStartCtxTime,
      offset,
      includeIntro: opts.firstPageFlip,
    });
    playing = true;
    syncPlayBtn();
    previewRaf = requestAnimationFrame(previewLoop);
  }

  function previewLoop(): void {
    if (!playing) return;
    const t = currentPreviewT();
    if (t >= totalDuration()) {
      stopPreview(true); // 播完回到首页完整静态帧，不展示第 0 秒空白翻入画面
      return;
    }
    drawPreview(t);
    syncTimeUI(t);
    syncPageLabel();
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

  /** 跳到某页：落在该页翻页完成之后（避免跳进过渡中段看不到正文） */
  function jumpToPage(i: number): void {
    const tl = getTimeline();
    if (tl.pages < 1) return;
    const idx = Math.min(tl.pages - 1, Math.max(0, i));
    const t = Math.min(idx * tl.pageDur + tl.flipDur + 0.02, Math.max(0, tl.total - 0.01));
    if (playing) playFrom(t);
    else {
      pausedAt = t;
      drawPreview(t);
      syncTimeUI(t);
      syncPageLabel();
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
      title: '上一页',
      'aria-label': '上一页',
      onclick: () => jumpToPage(currentPageIndex() - 1),
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
      title: '下一页',
      'aria-label': '下一页',
      onclick: () => jumpToPage(currentPageIndex() + 1),
    },
    [],
  ) as HTMLButtonElement;
  const pageLabel = h('span', {
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
      syncPageLabel();
    }
  });
  seekSlider.addEventListener('change', () => {
    const v = (Number(seekSlider.value) / 1000) * totalDuration();
    if (playing) playFrom(v);
    else {
      pausedAt = v;
      drawPreview(v);
      syncTimeUI(v);
      syncPageLabel();
    }
  });

  /**
   * 静态示意帧：暂停位置原样绘制；初始位置（t=0）落在首页翻入起点（空白），
   * 改画「翻页完成 + 入场完成」时刻，保证未播放时构图完整可见。
   */
  function drawStaticFrame(): void {
    if (pausedAt > 0.01) {
      drawPreview(pausedAt);
      return;
    }
    const tl = getTimeline();
    const t = Math.min(tl.flipDur + tl.enterDur + 0.05, Math.max(0, tl.total - 0.01));
    drawPreview(hasContent() ? t : 0);
    syncTimeUI(hasContent() ? t : 0);
    syncPageLabel();
  }

  // ──────────────── 演示文稿输入 ────────────────
  const contentInput = h('textarea', {
    class:
      'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)] font-mono',
    rows: 9,
    'aria-label': '演示文稿（批量文本）',
    placeholder:
      '把文稿整段粘贴进来…\n\n空一行 = 下一页；# 开头 = 页标题；--- 单独一行 = 强制分页；超长段落自动拆句分页。',
  }) as HTMLTextAreaElement;
  contentInput.value = opts.contentText;

  const pageCountLabel = h('span', { class: 'text-xs text-[var(--fg-muted)]' });
  const truncatedLabel = h('span', {
    class: 'hidden text-xs text-[var(--holiday-legal)]',
    textContent: '已达 60 页上限，超出部分被截断',
  });

  /** 页导航 chips（点击跳转预览；>12 页切紧凑样式） */
  const pageChipsWrap = h('div', { class: 'flex flex-wrap gap-1.5' }, []);

  function rebuildPageChips(): void {
    const { pages } = getPages();
    pageChipsWrap.replaceChildren();
    pageChipsWrap.classList.toggle('hidden', pages.length === 0);
    const compact = pages.length > PAGE_CHIPS_COMPACT;
    pages.forEach((p, i) => {
      const label = compact
        ? String(i + 1)
        : p.title
          ? `${i + 1}·${p.title.slice(0, 6)}`
          : String(i + 1);
      pageChipsWrap.append(
        h(
          'button',
          {
            type: 'button',
            'data-page-idx': String(i),
            title: `第 ${i + 1} 页：${p.title ? p.title + ' ' : ''}${p.body.slice(0, 40)}`,
            class: compact
              ? 'min-w-6 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 text-xs text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]'
              : 'rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
            textContent: label,
            onclick: () => jumpToPage(i),
          },
          [],
        ),
      );
    });
    pageCountLabel.textContent = `共 ${pages.length} 页 · 总时长 ${fmt(getTimeline().total)}`;
    truncatedLabel.classList.toggle('hidden', !getPages().truncated);
    paintPageChips();
  }

  function paintPageChips(): void {
    const cur = currentPageIndex();
    for (const b of pageChipsWrap.querySelectorAll('button[data-page-idx]')) {
      const el = b as HTMLButtonElement;
      const active = Number(el.dataset.pageIdx) === cur;
      el.style.borderColor = active ? 'var(--accent)' : '';
      el.style.color = active ? 'var(--accent)' : '';
      el.style.fontWeight = active ? '600' : '';
    }
  }

  /** 文稿变更（300ms 防抖：避免逐键重分页/重建 chips） */
  let contentTimer = 0;
  contentInput.addEventListener('input', () => {
    window.clearTimeout(contentTimer);
    contentTimer = window.setTimeout(() => {
      opts.contentText = contentInput.value.slice(0, CONTENT_MAX);
      saveOptions(opts);
      invalidateDerived();
      if (pausedAt > totalDuration()) pausedAt = 0;
      rebuildPageChips();
      syncPlayBtn();
      drawStaticFrame();
    }, 300);
  });

  // ──────────────── 设置面板 ────────────────
  /** 统一入口：任何选项变化 → 落库 + 失效缓存 + 刷新画布 */
  function updateOptions(mutate: () => void): void {
    mutate();
    saveOptions(opts);
    invalidateDerived();
    applyAspectToCanvas();
    drawStaticFrame();
  }

  const aspectSeg = makeSegment<AspectId>(
    ASPECTS.map((a) => ({ id: a.id, label: a.label })),
    opts.aspect,
    (id) => {
      updateOptions(() => (opts.aspect = id));
      rebuildPageChips(); // 分页字符预算随比例变化
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

  const pageDurSel = makeNumSelect(
    '每页时长',
    PAGE_DUR_CHOICES,
    opts.pageDur,
    (v) => `${v} 秒`,
    (v) => {
      updateOptions(() => (opts.pageDur = v));
      rebuildPageChips();
    },
  );
  const flipDurSel = makeNumSelect(
    '翻页时长',
    FLIP_DUR_CHOICES,
    opts.flipDur,
    (v) => `${v} 秒`,
    (v) => updateOptions(() => (opts.flipDur = v)),
  );

  const enterSeg = makeSegment<EnterId>(
    ENTERS.map((e) => ({ id: e.id, label: e.label, hint: e.hint })),
    opts.enter,
    (id) => updateOptions(() => (opts.enter = id)),
  );

  // 泛型放宽到 FlipSelection：选中自定义动画（cflip:）时内置按钮自然全不高亮，
  // 选中态由下方自定义 chips 行表达
  const flipSeg = makeSegment<FlipSelection>(
    FLIPS.map((f) => ({ id: f.id as FlipSelection, label: f.label, hint: f.hint })),
    opts.flip,
    (id) => {
      updateOptions(() => (opts.flip = id));
      paintFlipChips();
    },
  );

  const countdownSeg = makeSegment<CountdownSelection>(
    COUNTDOWNS.map((c) => ({ id: c.id as CountdownSelection, label: c.label, hint: c.hint })),
    opts.countdown,
    (id) => {
      updateOptions(() => (opts.countdown = id));
      refreshCountdownVisibility();
      paintCountdownChips();
    },
  );

  const countdownPosSeg = makeSegment<CountdownPosId>(
    COUNTDOWN_POS.map((p) => ({ id: p.id, label: p.label })),
    opts.countdownPos,
    (id) => updateOptions(() => (opts.countdownPos = id)),
  );

  /** 倒计时位置仅在选中内置样式（number/ring）时展示；bar 固定在底部 */
  function refreshCountdownVisibility(): void {
    countdownPosWrap.classList.toggle(
      'hidden',
      opts.countdown !== 'number' && opts.countdown !== 'ring',
    );
  }
  const countdownPosWrap = row('倒计时位置', countdownPosSeg.wrap);

  const pageNoCheckbox = h('input', {
    type: 'checkbox',
    class: 'h-3.5 w-3.5 accent-[var(--accent)]',
    checked: opts.showPageNo,
    onchange: (e) =>
      updateOptions(() => (opts.showPageNo = (e.target as HTMLInputElement).checked)),
  }) as HTMLInputElement;

  const fontSeg = makeSegment<FontId | 'theme'>(
    [{ id: 'theme', label: '跟随主题' }, ...FONTS.map((f) => ({ id: f.id, label: f.label }))],
    opts.font ?? 'theme',
    (id) => updateOptions(() => (opts.font = id === 'theme' ? null : id)),
  );

  const alignSeg = makeSegment<AlignId | 'theme'>(
    [{ id: 'theme', label: '跟随主题' }, ...ALIGNS.map((a) => ({ id: a.id, label: a.label }))],
    opts.align ?? 'theme',
    (id) => updateOptions(() => (opts.align = id === 'theme' ? null : id)),
  );

  // —— 主题墙：直接渲染真实页面缩略图，而非渐变色块 ——
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
      drawSamplePage(
        ctx,
        320,
        180,
        th,
        null,
        null,
        {
          title: th.label,
          body: '让版式、字体与装饰，\n一起表达内容的气质。',
        },
        1,
      );
    }
    const layout = THEME_LAYOUTS.find((l) => l.id === th.design.layout)?.label ?? '完整主题';
    return h(
      'button',
      {
        type: 'button',
        'data-theme-id': th.id,
        title: `${th.label} · ${layout}`,
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
            textContent: layout,
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

  // ──────────────── AI 生成：翻页动画 chips + 倒计时 chips + 风格方案 chips ────────────────
  const customFlipWrap = h('div', { class: 'flex flex-wrap gap-2' }, []);

  function paintFlipChips(): void {
    for (const b of customFlipWrap.querySelectorAll('button[data-viz-id]')) {
      const el = b as HTMLButtonElement;
      const active = el.dataset.vizId === opts.flip;
      el.className =
        'rounded-md border px-2.5 py-1.5 text-sm transition-colors ' +
        (active
          ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]'
          : 'border-[var(--border)] bg-[var(--bg)] text-[var(--fg-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]');
    }
  }

  function rebuildFlipChips(): void {
    customFlipWrap.replaceChildren();
    const items = loadCustomFlips();
    customFlipWrap.classList.toggle('hidden', items.length === 0);
    for (const item of items) {
      const btn = h(
        'button',
        {
          type: 'button',
          'data-viz-id': item.id,
          title: `自定义翻页动画：${item.name}`,
          class: 'rounded-md border px-2.5 py-1.5 text-sm transition-colors',
          textContent: `⭐ ${item.name}`,
          onclick: () => {
            updateOptions(() => (opts.flip = item.id as FlipSelection));
            flipSeg.set(item.id as FlipSelection);
            paintFlipChips();
          },
        },
        [],
      );
      const del = h(
        'button',
        {
          type: 'button',
          'aria-label': `删除翻页动画 ${item.name}`,
          title: '删除此动画',
          class:
            'absolute -right-1.5 -top-1.5 hidden h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500 text-[9px] leading-none text-white shadow group-hover:flex',
          textContent: '✕',
          onclick: (e) => {
            e.stopPropagation();
            void confirmDialog(`确定删除翻页动画「${item.name}」吗？`, {
              title: '删除翻页动画',
              danger: true,
              confirmText: '删除',
            }).then((ok) => {
              if (!ok) return;
              removeCustomFlip(item.id);
              invalidateFlipCache(item.id);
              if (opts.flip === item.id) {
                updateOptions(() => (opts.flip = 'fade'));
                flipSeg.set('fade');
              }
              rebuildFlipChips();
            });
          },
        },
        [],
      );
      customFlipWrap.append(h('div', { class: 'group relative' }, [btn, del]));
    }
    paintFlipChips();
  }

  const customCountdownWrap = h('div', { class: 'flex flex-wrap gap-2' }, []);

  function paintCountdownChips(): void {
    for (const b of customCountdownWrap.querySelectorAll('button[data-viz-id]')) {
      const el = b as HTMLButtonElement;
      const active = el.dataset.vizId === opts.countdown;
      el.className =
        'rounded-md border px-2.5 py-1.5 text-sm transition-colors ' +
        (active
          ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]'
          : 'border-[var(--border)] bg-[var(--bg)] text-[var(--fg-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]');
    }
  }

  function rebuildCountdownChips(): void {
    customCountdownWrap.replaceChildren();
    const items = loadCustomCountdowns();
    customCountdownWrap.classList.toggle('hidden', items.length === 0);
    for (const item of items) {
      const btn = h(
        'button',
        {
          type: 'button',
          'data-viz-id': item.id,
          title: `自定义倒计时样式：${item.name}`,
          class: 'rounded-md border px-2.5 py-1.5 text-sm transition-colors',
          textContent: `⭐ ${item.name}`,
          onclick: () => {
            updateOptions(() => (opts.countdown = item.id as CountdownSelection));
            countdownSeg.set(item.id as CountdownSelection);
            refreshCountdownVisibility();
            paintCountdownChips();
          },
        },
        [],
      );
      const del = h(
        'button',
        {
          type: 'button',
          'aria-label': `删除倒计时样式 ${item.name}`,
          title: '删除此样式',
          class:
            'absolute -right-1.5 -top-1.5 hidden h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500 text-[9px] leading-none text-white shadow group-hover:flex',
          textContent: '✕',
          onclick: (e) => {
            e.stopPropagation();
            void confirmDialog(`确定删除倒计时样式「${item.name}」吗？`, {
              title: '删除倒计时样式',
              danger: true,
              confirmText: '删除',
            }).then((ok) => {
              if (!ok) return;
              removeCustomCountdown(item.id);
              invalidateCountdownCache(item.id);
              if (opts.countdown === item.id) {
                updateOptions(() => (opts.countdown = 'none'));
                countdownSeg.set('none');
                refreshCountdownVisibility();
              }
              rebuildCountdownChips();
            });
          },
        },
        [],
      );
      customCountdownWrap.append(h('div', { class: 'group relative' }, [btn, del]));
    }
    paintCountdownChips();
  }

  // —— AI 风格方案 chips（快照语义：应用 = 建同名主题 + 合并版式；删除不动主题） ——
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
      opts.align = null;
      Object.assign(opts, schemeOptionPatches({ id: '', createdAt: 0, ...s, ...s.colors }));
    });
    // 同步各控件高亮与条件显隐（updateOptions 只重画布，不刷控件）
    rebuildThemeButtons();
    flipSeg.set(opts.flip);
    countdownSeg.set(opts.countdown);
    fontSeg.set(opts.font ?? 'theme');
    alignSeg.set(opts.align ?? 'theme');
    refreshCountdownVisibility();
    accentColorInput.value = resolveTheme(opts.theme).accent;
    rebuildFlipChips();
    rebuildCountdownChips();
    rebuildSchemeChips();
  }

  function applyStoredScheme(stored: CustomScheme): void {
    applyParsedScheme({
      name: stored.name,
      colors: { bg1: stored.bg1, bg2: stored.bg2, fg: stored.fg, accent: stored.accent },
      ...(stored.design ? { design: stored.design } : {}),
      ...(stored.flip !== undefined ? { flip: stored.flip } : {}),
      ...(stored.countdown !== undefined ? { countdown: stored.countdown } : {}),
      ...(stored.font !== undefined ? { font: stored.font } : {}),
      ...(stored.align !== undefined ? { align: stored.align } : {}),
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
    getFont: () => opts.font,
    getAlign: () => opts.align,
    onFlipApplied: (id) => {
      updateOptions(() => (opts.flip = id as FlipSelection));
      flipSeg.set(id as FlipSelection);
      rebuildFlipChips();
    },
    onCountdownApplied: (id) => {
      updateOptions(() => (opts.countdown = id as CountdownSelection));
      countdownSeg.set(id as CountdownSelection);
      refreshCountdownVisibility();
      rebuildCountdownChips();
    },
    onSchemeApplied: applyParsedScheme,
  });

  rebuildFlipChips();
  rebuildCountdownChips();
  rebuildSchemeChips();

  // ──────────────── 翻页音效（本地合成，可试听且进入导出音轨） ────────────────
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
  const firstPageFlipCheckbox = h('input', {
    type: 'checkbox',
    class: 'h-3.5 w-3.5 accent-[var(--accent)]',
    checked: opts.firstPageFlip,
    onchange: (e) => {
      const at = currentPreviewT();
      updateOptions(() => (opts.firstPageFlip = (e.target as HTMLInputElement).checked));
      if (playing) playFrom(at);
    },
  }) as HTMLInputElement;
  const soundVolumeSlider = h('input', {
    type: 'range',
    min: '0',
    max: '100',
    value: String(opts.soundVolume),
    class: 'w-full accent-[var(--accent)]',
    'aria-label': '翻页音效音量',
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
    hint: 'MP3 / WAV；短于视频自动循环',
    onFile: async (f) => {
      const loaded = await loadAudioFile(f);
      bgm = loaded;
      if (playing) playFrom(currentPreviewT()); // 热切换：从真实当前位置续播
    },
    onClear: () => {
      bgm = null;
      releasePreviewSrc();
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

  let handle: RecordHandle | null = null;
  let recording = false;

  function updateGenerateState(): void {
    generateBtn.disabled = !hasContent() || recording;
    generateBtn.title = hasContent() ? '' : '请先在「演示文稿」输入内容';
  }

  /** 导出文件名：取第一页标题，否则「演示翻页视频」 */
  function exportFileName(): string {
    const first = getPages().pages[0];
    const base = sanitizeFilePart(
      first?.title?.trim() || first?.body.slice(0, 12) || '演示翻页视频',
      40,
    );
    return base || '演示翻页视频';
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
  // 布局对齐 song-video：左控制 + 右预览；预览列 sticky 吸顶（演示区始终在屏）。
  const previewCol = h(
    'div',
    {
      class:
        'min-w-0 order-first lg:order-none sticky top-0 lg:top-6 z-10 bg-[var(--bg)] py-2 space-y-3',
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
      h('div', { class: 'flex items-center gap-2' }, [prevBtn, pageLabel, nextBtn]),
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
            textContent: '时长、字体、倒计时、画质与 AI 动效',
          }),
        ],
      ),
      h('div', { class: 'space-y-5 border-t border-[var(--border)] p-4' }, [
        h('div', { class: 'space-y-3' }, [
          configHeading('播放与文字'),
          h('div', { class: 'grid grid-cols-2 gap-3' }, [
            row('翻页动画时长', flipDurSel.wrap),
            row('导出画质', resolutionSel),
          ]),
          row('文字入场', enterSeg.wrap),
        ]),
        h('div', { class: 'space-y-3' }, [
          configHeading('字体与色彩覆盖'),
          row('字体（默认跟随主题）', fontSeg.wrap),
          row('文字对齐（默认跟随版式）', alignSeg.wrap),
          row(
            '自定义主色',
            h('div', { class: 'flex items-center gap-2' }, [accentColorInput, accentResetBtn]),
          ),
        ]),
        h('div', { class: 'space-y-3' }, [
          configHeading('辅助信息'),
          row('翻页倒计时', countdownSeg.wrap),
          customCountdownWrap,
          countdownPosWrap,
          h(
            'label',
            { class: 'flex cursor-pointer items-center gap-2 text-xs text-[var(--fg-muted)]' },
            [pageNoCheckbox, '显示页码'],
          ),
        ]),
        h('div', { class: 'space-y-3' }, [
          configHeading('音频细节'),
          row('翻页音效音量', soundVolumeSlider),
          row('背景音乐音量', volumeSlider),
          h(
            'label',
            { class: 'flex cursor-pointer items-center gap-2 text-xs text-[var(--fg-muted)]' },
            [bgmLoopCheckbox, '音乐短于视频时循环播放'],
          ),
        ]),
        h('div', { class: 'space-y-3' }, [
          configHeading('AI 自定义动效'),
          h('div', { class: 'grid gap-2 sm:grid-cols-2' }, [
            h('button', {
              type: 'button',
              class:
                'rounded-lg border border-[var(--border)] px-3 py-2.5 text-left text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
              textContent: '✨ 自定义翻页动画',
              onclick: () => aiDialogs.openFlipDialog(),
            }),
            h('button', {
              type: 'button',
              class:
                'rounded-lg border border-[var(--border)] px-3 py-2.5 text-left text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
              textContent: '✨ 自定义倒计时',
              onclick: () => aiDialogs.openCountdownDialog(),
            }),
          ]),
          customFlipWrap,
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
              fieldLabel('演示文稿'),
              h('button', {
                type: 'button',
                class:
                  'inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border)] text-[11px] text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
                textContent: '?',
                title: '文稿格式与 AI 整理提示词',
                'aria-label': '文稿格式与 AI 整理提示词',
                onclick: () => openContentHelp(() => contentInput.value),
              }),
            ]),
            h('span', { class: 'flex items-center gap-2' }, [truncatedLabel, pageCountLabel]),
          ]),
          contentInput,
          h('p', {
            class: 'text-[11px] leading-relaxed text-[var(--fg-muted)]',
            textContent: '空行分页 · # 开头作页标题 · --- 强制分页。点击 ? 可复制 AI 整理提示词。',
          }),
          pageChipsWrap,
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
        h('div', { class: 'space-y-2' }, [fieldLabel('翻页效果'), flipSeg.wrap]),
        h('div', { class: 'space-y-2' }, [
          h('div', { class: 'flex items-center justify-between gap-2' }, [
            fieldLabel('翻页音效'),
            soundPreviewBtn,
          ]),
          soundEffectSeg.wrap,
          h(
            'label',
            {
              class: 'flex cursor-pointer items-center gap-2 pt-1 text-xs text-[var(--fg-muted)]',
              title: '关闭后首页直接显示，从第二页开始翻页和播放音效；文字入场设置不受影响',
            },
            [firstPageFlipCheckbox, '首页翻入动画与音效'],
          ),
        ]),
        h('div', { class: 'space-y-3' }, [
          row('每页时长', pageDurSel.wrap),
          row('画面比例', aspectSeg.wrap),
        ]),
        bgmPicker.wrap,
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
        '全部处理在本浏览器完成：文稿与音频不会上传服务器；设置、文稿与 AI 主题记忆在本机（音乐文件不记忆）。只有你主动使用 AI 直连或向外部 AI 粘贴内容时，对应内容才会发送给所选服务。',
    }),
  );

  // 初始：应用画布比例 + 重建页导航 + 静态帧 + 按钮态 + 条件显隐
  applyAspectToCanvas();
  rebuildPageChips();
  syncPlayBtn();
  syncTimeUI(0);
  drawStaticFrame();
  updateGenerateState();
  refreshCountdownVisibility();
}

render();
