import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { sanitizeFilePart } from '@/core/utils/download';

import {
  getSharedAudioContext,
  loadAudioFile,
  resumeAudioContext,
  type LoadedAudio,
} from './audio';
import { parseLyrics, type LyricLine } from './lyrics';
import {
  ASPECTS,
  INTRO_ANIMS,
  INTRO_DUR_CHOICES,
  LYRIC_MODES,
  OUTRO_ANIMS,
  OUTRO_DUR_CHOICES,
  PROGRESS_BARS,
  RESOLUTIONS,
  THEMES,
  VISUALIZERS,
  computeTimeline,
  getAspect,
  getResolution,
  getTheme,
  type AspectId,
  type LyricModeId,
  type ProgressBarId,
  type ResolutionId,
  type Timeline,
  type VisualizerId,
} from './options';
import { computeBands, drawFrame, resetListScroll, type ImageAsset, type RenderInput } from './renderer';
import { startRecording, type RecordHandle } from './recorder';
import { loadOptions, saveOptions } from './settings';

initTheme();

// 预览画布内部分辨率：短边 540（预览流畅；导出按分辨率档位另行放大）
const PREVIEW_SHORT = 540;
/** 导出帧率（实时录制，30fps 兼顾流畅与丢帧风险） */
const EXPORT_FPS = 30;
/** 频段数量（bars/mirror/circle 共用一组对数分桶数据，与 recorder 一致） */
const BAND_COUNT = 64;

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
  /** 一句话说明（支持格式/是否可选） */
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

  /** 统一更新文件名展示；有文件时显示清除按钮、文字变主色 */
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

  // 拖拽支持 + 点击空白区打开选择
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

/** 图片文件 → ImageAsset + objectURL（URL 由调用方持有并在替换时 revoke） */
function loadImageAsset(f: File): Promise<{ asset: ImageAsset; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () =>
      resolve({ asset: { img, w: img.naturalWidth, h: img.naturalHeight }, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败，请换一张试试'));
    };
    img.src = url;
  });
}

// ─────────────────────────── 页面 ───────────────────────────

function render(): void {
  const { content } = renderToolLayout(document.getElementById('app')!, '歌曲生成视频');

  // —— 业务状态 ——
  const opts = loadOptions();
  let audio: LoadedAudio | null = null;
  let rawLyricText: string | null = null;
  let bgAsset: ImageAsset | null = null;
  let coverAsset: ImageAsset | null = null;
  let bgUrl: string | null = null;
  let coverUrl: string | null = null;
  /** 用户是否手动编辑过标题（未编辑时选新歌自动跟随文件名） */
  let titleEdited = false;

  // —— 派生数据缓存（预览每帧调用 buildRenderInput，歌词解析/时间轴不能每帧重算） ——
  let lyricsCache: LyricLine[] | null | undefined; // undefined = 需要重算
  let timelineCache: Timeline | null = null;

  function invalidateDerived(): void {
    lyricsCache = undefined;
    timelineCache = null;
  }

  function getLyrics(): LyricLine[] | null {
    if (lyricsCache === undefined) {
      if (!rawLyricText) {
        lyricsCache = null;
      } else {
        try {
          // 无音频时先按 1h 占位补齐末行，选好音频后 invalidateDerived 重算
          lyricsCache = parseLyrics(rawLyricText, audio?.duration ?? 3600);
        } catch {
          lyricsCache = null;
        }
      }
    }
    return lyricsCache;
  }

  function getTimeline(): Timeline {
    if (!timelineCache) timelineCache = computeTimeline(opts, audio?.duration ?? 0);
    return timelineCache;
  }

  function buildRenderInput(): RenderInput {
    const theme = getTheme(opts.theme);
    return {
      opts,
      theme: opts.accentColor ? { ...theme, accent: opts.accentColor } : theme,
      aspect: getAspect(opts.aspect),
      timeline: getTimeline(),
      lyrics: opts.lyricMode === 'none' ? null : getLyrics(),
      title: opts.titleText.trim() || audio?.name || '未命名歌曲',
      bgImage: bgAsset,
      coverImage: coverAsset,
    };
  }

  // ──────────────── 预览画布与播放器 ────────────────
  const previewCanvas = h('canvas', { class: 'block h-full w-full' }) as HTMLCanvasElement;
  const canvasFrame = h(
    'div',
    { class: 'mx-auto overflow-hidden rounded-xl border border-[var(--border)] bg-black shadow-lg' },
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
    // 自适应视口：宽度取「列宽 100%」与「按可用视口高换算的等比宽度」中较小者，
    // 保证任何比例（含 9:16 竖版）在窗口缩小/放大时预览都完整显示、不被裁切。
    // 14rem ≈ 页头 + 预览工具栏 + 播放控制行 + 卡片内边距的预留高度。
    canvasFrame.style.width = `min(100%, calc((100dvh - 14rem) * ${w} / ${hgt}))`;
  }

  // 预览音频链路：BufferSource → Analyser → 扬声器（录制用独立链路，互不影响）
  const audioCtx = getSharedAudioContext();
  const previewAnalyser = audioCtx.createAnalyser();
  previewAnalyser.fftSize = 2048;
  previewAnalyser.smoothingTimeConstant = 0.82;
  previewAnalyser.connect(audioCtx.destination);

  let previewSrc: AudioBufferSourceNode | null = null;
  let playing = false;
  let pausedAt = 0;
  let playStartCtxTime = 0;
  let previewRaf = 0;
  let lastFrameTime = 0;

  const freqRaw = new Uint8Array(previewAnalyser.frequencyBinCount);
  const waveRaw = new Uint8Array(previewAnalyser.fftSize);
  const bandsBuf = new Uint8Array(BAND_COUNT);

  function totalDuration(): number {
    return getTimeline().total;
  }

  function currentPreviewT(): number {
    return playing ? audioCtx.currentTime - playStartCtxTime + pausedAt : pausedAt;
  }

  /** 画一帧（播放中读 analyser 出频谱；暂停/静态时按静音画） */
  function drawPreview(t: number): void {
    const ctx = previewCanvas.getContext('2d');
    if (!ctx) return;
    let bands: Uint8Array | null = null;
    let wave: Uint8Array | null = null;
    if (playing && previewSrc) {
      previewAnalyser.getByteFrequencyData(freqRaw);
      previewAnalyser.getByteTimeDomainData(waveRaw);
      bands = computeBands(freqRaw, BAND_COUNT, bandsBuf);
      wave = waveRaw;
    }
    const now = performance.now();
    const dt = lastFrameTime > 0 ? Math.min(0.05, (now - lastFrameTime) / 1000) : 0.016;
    drawFrame(ctx, previewCanvas.width, previewCanvas.height, buildRenderInput(), t, dt, bands, wave);
    lastFrameTime = now;
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

  function syncPlayBtn(): void {
    playBtn.textContent = playing ? '⏸' : '▶';
    playBtn.disabled = !audio || recording;
    seekSlider.disabled = !audio;
  }

  function stopPreview(resetToStart: boolean): void {
    releasePreviewSrc();
    playing = false;
    cancelAnimationFrame(previewRaf);
    if (resetToStart) pausedAt = 0;
    drawPreview(pausedAt);
    syncTimeUI(pausedAt);
    syncPlayBtn();
  }

  function playFrom(offset: number): void {
    if (!audio) return;
    releasePreviewSrc();
    void resumeAudioContext();
    const src = audioCtx.createBufferSource();
    src.buffer = audio.buffer;
    src.connect(previewAnalyser);
    const ctxNow = audioCtx.currentTime;
    if (offset < opts.introDur) {
      // 开场段：音频调度到 intro 时刻才进入
      src.start(ctxNow + (opts.introDur - offset), 0);
    } else {
      src.start(0, Math.min(offset - opts.introDur, audio.duration));
    }
    previewSrc = src;
    pausedAt = offset;
    playStartCtxTime = ctxNow;
    playing = true;
    lastFrameTime = 0;
    resetListScroll();
    syncPlayBtn();
    previewRaf = requestAnimationFrame(previewLoop);
  }

  function previewLoop(): void {
    if (!playing) return;
    const t = currentPreviewT();
    if (t >= totalDuration()) {
      stopPreview(true); // 播完整段（含片尾）回到起点
      return;
    }
    drawPreview(t);
    syncTimeUI(t);
    previewRaf = requestAnimationFrame(previewLoop);
  }

  function togglePlay(): void {
    if (!audio || recording) return;
    if (playing) {
      pausedAt = currentPreviewT();
      stopPreview(false);
    } else {
      const from = pausedAt >= totalDuration() - 0.05 ? 0 : pausedAt;
      playFrom(from);
    }
  }

  // —— 播放控制 UI（先声明，供上面的函数引用） ——
  const playBtn = h(
    'button',
    {
      type: 'button',
      class:
        'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-lg text-[var(--accent-fg)] hover:opacity-90 transition-opacity disabled:opacity-40',
      textContent: '▶',
      title: '预览播放（含开场/片尾，与成片一致）',
      onclick: togglePlay,
    },
    [],
  ) as HTMLButtonElement;

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
  // 拖动中：暂停态直接重绘预览；播放态等松手再重启音频（避免连续重建 source）
  seekSlider.addEventListener('input', () => {
    const v = (Number(seekSlider.value) / 1000) * totalDuration();
    if (!playing) {
      pausedAt = v;
      drawPreview(v);
      syncTimeUI(v);
    }
  });
  seekSlider.addEventListener('change', () => {
    const v = (Number(seekSlider.value) / 1000) * totalDuration();
    if (playing) {
      playFrom(v);
    } else {
      pausedAt = v;
      drawPreview(v);
      syncTimeUI(v);
    }
  });

  /**
   * 静态示意帧：暂停位置原样绘制；初始位置（t=0）落在开场动画起点（内容全透明），
   * 改画开场结束帧，保证未播放时构图完整可见。
   */
  function drawStaticFrame(): void {
    const t = pausedAt <= 0.01 ? Math.max(opts.introDur, 0.01) : pausedAt;
    drawPreview(audio ? t : Math.max(opts.introDur, 0.01));
  }

  // ──────────────── 文件选择 ────────────────
  const audioPicker = makeFilePicker({
    label: '🎵 音乐文件（必需）',
    accept: '.mp3,.wav,audio/mpeg,audio/wav',
    hint: 'MP3 / WAV',
    onFile: async (f) => {
      const loaded = await loadAudioFile(f);
      audio = loaded;
      invalidateDerived();
      if (!titleEdited) {
        // 标题默认跟随歌曲文件名（用户改过则尊重用户输入）
        opts.titleText = loaded.name;
        titleInput.value = loaded.name;
      }
      resetListScroll();
      pausedAt = 0;
      syncPlayBtn();
      syncTimeUI(0);
      updateGenerateState();
      drawStaticFrame();
      saveOptions(opts);
    },
    onClear: () => {
      audio = null;
      invalidateDerived();
      stopPreview(true);
      updateGenerateState();
    },
  });

  const lyricPicker = makeFilePicker({
    label: '歌词 / 字幕（可选）',
    accept: '.lrc,.srt,text/plain',
    hint: 'LRC / SRT',
    onFile: async (f) => {
      const text = await f.text();
      try {
        parseLyrics(text, audio?.duration ?? 3600); // 先校验，失败则不入状态
      } catch {
        // parseLyrics 只抛 LyricParseError：这里统一为面向用户的提示
        throw new Error('歌词解析失败：请确认为有效的 LRC / SRT 格式，且包含时间轴');
      }
      rawLyricText = text;
      invalidateDerived();
      if (opts.lyricMode === 'none') {
        updateOptions(() => (opts.lyricMode = 'fade' as LyricModeId));
        lyricSeg.set('fade');
      }
      resetListScroll();
      drawStaticFrame();
    },
    onClear: () => {
      rawLyricText = null;
      invalidateDerived();
      drawStaticFrame();
    },
  });

  const bgPicker = makeFilePicker({
    label: '背景图（可选）',
    accept: 'image/*',
    hint: 'JPG / PNG / WebP',
    onFile: async (f) => {
      const { asset, url } = await loadImageAsset(f);
      if (bgUrl) URL.revokeObjectURL(bgUrl);
      bgAsset = asset;
      bgUrl = url;
      drawStaticFrame();
    },
    onClear: () => {
      if (bgUrl) URL.revokeObjectURL(bgUrl);
      bgUrl = null;
      bgAsset = null;
      drawStaticFrame();
    },
  });

  const coverPicker = makeFilePicker({
    label: '专辑封面（可选）',
    accept: 'image/*',
    hint: '建议方形图',
    onFile: async (f) => {
      const { asset, url } = await loadImageAsset(f);
      if (coverUrl) URL.revokeObjectURL(coverUrl);
      coverAsset = asset;
      coverUrl = url;
      drawStaticFrame();
    },
    onClear: () => {
      if (coverUrl) URL.revokeObjectURL(coverUrl);
      coverUrl = null;
      coverAsset = null;
      drawStaticFrame();
    },
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
    (id) => updateOptions(() => (opts.aspect = id)),
  );

  const resolutionSel = h(
    'select',
    {
      class:
        'w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      'aria-label': '导出分辨率',
      onchange: (e) =>
        updateOptions(() => (opts.resolution = (e.target as HTMLSelectElement).value as ResolutionId)),
    },
    RESOLUTIONS.map((r) =>
      h('option', { value: r.id, selected: r.id === opts.resolution }, [r.label]),
    ),
  ) as HTMLSelectElement;

  const visualizerSeg = makeSegment<VisualizerId>(
    VISUALIZERS.map((v) => ({ id: v.id, label: v.label, hint: v.hint })),
    opts.visualizer,
    (id) => updateOptions(() => (opts.visualizer = id)),
  );

  const lyricSeg = makeSegment<LyricModeId>(
    LYRIC_MODES.map((m) => ({ id: m.id, label: m.label, hint: m.hint })),
    opts.lyricMode,
    (id) => updateOptions(() => (opts.lyricMode = id)),
  );

  // 歌词上下句（仅单行淡入模式生效；滚动列表本身多行可见）
  const prevLyricCheckbox = h('input', {
    type: 'checkbox',
    class: 'h-3.5 w-3.5 accent-[var(--accent)]',
    checked: opts.showPrevLyric,
    onchange: (e) =>
      updateOptions(() => (opts.showPrevLyric = (e.target as HTMLInputElement).checked)),
  }) as HTMLInputElement;
  const nextLyricCheckbox = h('input', {
    type: 'checkbox',
    class: 'h-3.5 w-3.5 accent-[var(--accent)]',
    checked: opts.showNextLyric,
    onchange: (e) =>
      updateOptions(() => (opts.showNextLyric = (e.target as HTMLInputElement).checked)),
  }) as HTMLInputElement;

  // 主题：色块按钮
  const themeBtns: HTMLButtonElement[] = [];
  const paintTheme = (id: string): void => {
    for (const b of themeBtns) {
      const active = b.dataset.themeId === id;
      b.style.outline = active ? '2px solid var(--accent)' : 'none';
      b.style.outlineOffset = '2px';
    }
  };
  const themeWrap = h('div', { class: 'flex flex-wrap gap-3' }, []);
  for (const th of THEMES) {
    const btn = h(
      'button',
      {
        type: 'button',
        'data-theme-id': th.id,
        title: th.label,
        'aria-label': `主题：${th.label}`,
        class: 'h-9 w-14 rounded-lg border border-[var(--border)] transition-transform hover:scale-105',
        style: `background:${th.swatch}`,
        onclick: () => {
          updateOptions(() => (opts.theme = th.id));
          paintTheme(th.id);
        },
      },
      [],
    ) as HTMLButtonElement;
    themeBtns.push(btn);
    themeWrap.append(btn);
  }
  paintTheme(opts.theme);

  const progressSeg = makeSegment<ProgressBarId>(
    PROGRESS_BARS.map((p) => ({ id: p.id, label: p.label })),
    opts.progressBar,
    (id) => updateOptions(() => (opts.progressBar = id)),
  );

  // 标题
  const titleCheckbox = h('input', {
    type: 'checkbox',
    class: 'h-4 w-4 accent-[var(--accent)]',
    checked: opts.showTitle,
    onchange: (e) => {
      updateOptions(() => (opts.showTitle = (e.target as HTMLInputElement).checked));
      titleInput.disabled = !opts.showTitle;
    },
  }) as HTMLInputElement;

  const titleInput = h('input', {
    type: 'text',
    value: opts.titleText,
    placeholder: '默认取歌曲文件名',
    class:
      'w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)] disabled:opacity-40',
    disabled: !opts.showTitle,
    oninput: (e) => {
      titleEdited = true;
      updateOptions(() => (opts.titleText = (e.target as HTMLInputElement).value));
    },
  }) as HTMLInputElement;

  // —— 高级选项（默认折叠） ——
  const introSeg = makeSegment(
    INTRO_ANIMS.map((a) => ({ id: a.id, label: a.label })),
    opts.introAnim,
    (id) => updateOptions(() => (opts.introAnim = id)),
  );
  const introDurSel = makeDurSelect(INTRO_DUR_CHOICES, opts.introDur, (v) =>
    updateOptions(() => (opts.introDur = v)),
  );
  const outroSeg = makeSegment(
    OUTRO_ANIMS.map((a) => ({ id: a.id, label: a.label })),
    opts.outroAnim,
    (id) => updateOptions(() => (opts.outroAnim = id)),
  );
  const outroDurSel = makeDurSelect(OUTRO_DUR_CHOICES, opts.outroDur, (v) =>
    updateOptions(() => (opts.outroDur = v)),
  );

  const coverSpinInput = h('input', {
    type: 'checkbox',
    class: 'h-4 w-4 accent-[var(--accent)]',
    checked: opts.coverSpin,
    onchange: (e) =>
      updateOptions(() => (opts.coverSpin = (e.target as HTMLInputElement).checked)),
  }) as HTMLInputElement;

  const accentColorInput = h('input', {
    type: 'color',
    value: opts.accentColor ?? '#38bdf8',
    class: 'h-8 w-10 cursor-pointer rounded border border-[var(--border)] bg-[var(--bg)] p-0.5',
    'aria-label': '自定义主色',
    oninput: (e) =>
      updateOptions(() => (opts.accentColor = (e.target as HTMLInputElement).value)),
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
        accentColorInput.value = getTheme(opts.theme).accent;
      },
    },
    [],
  );

  const publisherInput = h('input', {
    type: 'text',
    value: opts.publisher,
    placeholder: '如 @我的音乐电台（留空不显示）',
    class:
      'w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
    oninput: (e) =>
      updateOptions(() => (opts.publisher = (e.target as HTMLInputElement).value)),
  }) as HTMLInputElement;

  const endRollInput = h('input', {
    type: 'checkbox',
    class: 'h-4 w-4 accent-[var(--accent)]',
    checked: opts.endRollEnabled,
    onchange: (e) => {
      updateOptions(() => (opts.endRollEnabled = (e.target as HTMLInputElement).checked));
      endRollText.disabled = !opts.endRollEnabled;
    },
  }) as HTMLInputElement;

  const endRollText = h('textarea', {
    class:
      'w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)] disabled:opacity-40',
    rows: 4,
    placeholder: '每行一条，例如：\n作词 / 作曲：某某\n封面图片：某某\n感谢收听',
    value: opts.endRollText,
    disabled: !opts.endRollEnabled,
    oninput: (e) =>
      updateOptions(() => (opts.endRollText = (e.target as HTMLTextAreaElement).value)),
  }) as HTMLTextAreaElement;

  const advancedToggleLabel = '高级选项（动画 / 颜色 / 署名 / 片尾字幕）';
  const advancedPanel = h('div', { class: 'hidden space-y-4 pt-1' }, [
    row('开场动画', h('div', { class: 'space-y-2' }, [introSeg.wrap, introDurSel.wrap])),
    row('结尾动画', h('div', { class: 'space-y-2' }, [outroSeg.wrap, outroDurSel.wrap])),
    h('label', { class: 'flex items-center gap-2 text-sm cursor-pointer' }, [
      coverSpinInput,
      '专辑封面旋转（唱片效果）',
    ]),
    row('自定义主色', h('div', { class: 'flex items-center gap-2' }, [accentColorInput, accentResetBtn])),
    row('发行者署名', publisherInput),
    h('div', { class: 'space-y-2' }, [
      h('label', { class: 'flex items-center gap-2 text-sm cursor-pointer' }, [
        endRollInput,
        '片尾滚动字幕',
      ]),
      endRollText,
    ]),
  ]);
  const advancedToggle = h(
    'button',
    {
      type: 'button',
      class:
        'flex w-full items-center gap-2 rounded-md px-1 py-1 text-sm font-medium text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors',
      'aria-expanded': 'false',
      onclick: () => {
        const open = advancedPanel.classList.toggle('hidden') === false;
        advancedToggle.setAttribute('aria-expanded', String(open));
        advancedToggle.textContent = `${open ? '▼' : '▶'} ${advancedToggleLabel}`;
      },
    },
    [`▶ ${advancedToggleLabel}`],
  );

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
    h('div', { class: 'h-2 w-full overflow-hidden rounded-full bg-[var(--bg)]' }, [progressBarFill]),
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
    generateBtn.disabled = !audio || recording;
    generateBtn.title = audio ? '' : '请先选择音乐文件';
  }

  async function generate(): Promise<void> {
    if (!audio || recording) return;
    if (playing) stopPreview(false);
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
    progressLabel.textContent = `准备录制…（实时渲染约需 ${Math.ceil(totalDuration())} 秒，期间会静音，请保持本页面在前台）`;

    const input = buildRenderInput();
    handle = startRecording({
      buffer: audio.buffer,
      input,
      W,
      H,
      fps: EXPORT_FPS,
      onProgress: (ratio, t, total) => {
        progressBarFill.style.width = `${(ratio * 100).toFixed(1)}%`;
        progressLabel.textContent = `正在渲染 ${Math.round(ratio * 100)}%（${fmt(t)} / ${fmt(total)}）… 请保持页面在前台`;
      },
    });

    const result = await handle.result;
    handle = null;
    recording = false;
    progressWrap.classList.add('hidden');
    updateGenerateState();
    syncPlayBtn();
    resetListScroll();
    drawStaticFrame();

    if (!result.ok) {
      if (result.reason !== 'cancelled') statusEl.textContent = `✕ ${result.reason}`;
      return;
    }

    // 完成：挂下载按钮（默认文件名 = 歌曲名）
    const fname =
      `${sanitizeFilePart(opts.titleText.trim() || audio.name, 60) || 'song-video'}.${result.ext}`;
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
  // 布局对齐 ascii-art：左控制 + 右预览；预览列 sticky 吸顶
  //（大屏 lg:top-6 悬浮、小屏顶部吸顶 order-first），滚动参数区时预览始终可见。
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
          textContent: '预览与成片效果一致（含开场 / 片尾）',
        }),
      ]),
      canvasFrame,
      h('div', { class: 'flex items-center gap-3' }, [playBtn, seekSlider, timeLabel]),
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
        h('div', { class: 'space-y-3' }, [
          audioPicker.wrap,
          lyricPicker.wrap,
          bgPicker.wrap,
          coverPicker.wrap,
        ]),
        h('div', { class: 'border-t border-[var(--border)]' }, []),
        row('画面比例', aspectSeg.wrap),
        row('导出画质', resolutionSel),
        row('音频可视化', visualizerSeg.wrap),
        h('div', { class: 'space-y-2' }, [
          fieldLabel('歌词显示'),
          lyricSeg.wrap,
          h('div', { class: 'flex flex-wrap gap-x-5 gap-y-1.5 pt-0.5' }, [
            h('label', { class: 'flex items-center gap-2 text-xs cursor-pointer text-[var(--fg-muted)]' }, [
              prevLyricCheckbox,
              '显示前一句（单行淡入模式）',
            ]),
            h('label', { class: 'flex items-center gap-2 text-xs cursor-pointer text-[var(--fg-muted)]' }, [
              nextLyricCheckbox,
              '显示后一句（单行淡入模式）',
            ]),
          ]),
        ]),
        row('配色主题', themeWrap),
        row('进度条', progressSeg.wrap),
        h('div', { class: 'space-y-1.5' }, [
          h('label', { class: 'flex items-center gap-2 text-sm cursor-pointer' }, [
            titleCheckbox,
            '显示标题',
          ]),
          titleInput,
        ]),
        h('div', { class: 'border-t border-[var(--border)]' }, []),
        advancedToggle,
        advancedPanel,
      ],
    ),
    h(
      'div',
      {
        class:
          'space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-sm sm:p-5',
      },
      [generateBtn, progressWrap, progressLabel, downloadWrap, statusEl],
    ),
  ]);

  const layout = h(
    'div',
    {
      class: 'grid items-start gap-6 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]',
    },
    [settingsCol, previewCol],
  );

  content.append(
    layout,
    h('p', {
      class: 'pt-1 text-center text-xs text-[var(--fg-muted)]',
      textContent:
        '全部处理在本浏览器完成：音乐 / 图片不会上传服务器；设置会记忆在本机（文件不记忆，下次需重新选择）。渲染期间请保持本页面在前台。',
    }),
  );

  // 初始：应用画布比例 + 无音频画一帧静态示意 + 按钮态对齐
  applyAspectToCanvas();
  syncPlayBtn();
  syncTimeUI(0);
  drawStaticFrame();
  updateGenerateState();
}

/** 时长档位下拉 */
function makeDurSelect(
  choices: readonly number[],
  current: number,
  onChange: (v: number) => void,
): { wrap: HTMLElement } {
  const sel = h(
    'select',
    {
      class:
        'w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      'aria-label': '时长',
      onchange: (e) => onChange(Number((e.target as HTMLSelectElement).value)),
    },
    choices.map((c) =>
      h('option', { value: String(c), selected: Math.abs(c - current) < 1e-6 }, [
        c === 0 ? '无（跳过）' : `${c} 秒`,
      ]),
    ),
  ) as HTMLSelectElement;
  return { wrap: sel };
}

render();
