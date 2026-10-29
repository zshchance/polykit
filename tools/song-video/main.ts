import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { createDialog, confirmDialog } from '@/core/components/Dialog';
import { sanitizeFilePart } from '@/core/utils/download';
import { readJSON, writeJSON } from '@/core/utils/storage';

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
import { parseLyrics, type LyricLine } from './lyrics';
import {
  ASPECTS,
  BUILTIN_ACTORS,
  COVER_DUR_CHOICES,
  COVER_STYLES,
  DEFAULT_PROGRESS_EFFECT,
  END_ROLL_MODES,
  INTRO_ANIMS,
  INTRO_DUR_CHOICES,
  LYRIC_ABOVE_CHOICES,
  LYRIC_BELOW_CHOICES,
  LYRIC_MODES,
  OUTRO_ANIMS,
  OUTRO_DUR_CHOICES,
  PROGRESS_BARS,
  PROGRESS_MOTIONS,
  PROGRESS_PRESETS,
  PROGRESS_TRAILS,
  RESOLUTIONS,
  THEMES,
  VISUALIZERS,
  computeTimeline,
  getAspect,
  getResolution,
  getTheme,
  isCustomVisualizerId,
  type AspectId,
  type CoverStyleId,
  type EndRollModeId,
  type LyricModeId,
  type ProgressBarId,
  type ProgressEffect,
  type ProgressMotionId,
  type ProgressTrailId,
  type ResolutionId,
  type Theme,
  type Timeline,
  type VisualizerSelection,
} from './options';
import {
  getCustomVisualizerDraw,
  invalidateVisualizerCache,
  loadCustomVisualizers,
  removeCustomVisualizer,
} from './custom-visualizers';
import {
  loadCustomStyles,
  removeCustomStyle,
  styleOptionPatches,
  type CustomStyle,
  type ParsedStyle,
} from './custom-styles';
import { createAiDialogs } from './ai-dialogs';
import {
  getCustomActorDraw,
  getCustomEffectMode,
  invalidateCustomActorCache,
  loadCustomActors,
  removeCustomActor,
  type CustomProgressActor,
} from './custom-progress-actors';
import {
  builtinActorSpriteUrl,
  cleanAssetName,
  deleteProgressAsset,
  invalidateActorAssetCache,
  listProgressAssets,
  loadBuiltinActor,
  loadUploadedActor,
  prepareGifAsset,
  prepareImageAsset,
  prepareSvgAsset,
  primeGifActor,
  saveProgressAsset,
  tintActorAnimation,
  tintActorAsset,
  type ProcessedActorAsset,
  type ProcessedGifAsset,
  type ProgressAssetRecord,
} from './progress-assets';
import {
  computeBands,
  drawFrame,
  resetListScroll,
  type ActorAnimation,
  type ImageAsset,
  type RenderInput,
} from './renderer';
import { startRecording, isWakeLockSupported, type RecordHandle } from './recorder';
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
    img.onload = () => resolve({ asset: { img, w: img.naturalWidth, h: img.naturalHeight }, url });
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
  /** 角色进度条已解析的载体（内置/上传素材）；每帧读取，不能异步解析 */
  let actorAsset: ImageAsset | null = null;
  /** GIF 动图帧序列（有值时优先于 actorAsset 播放） */
  let actorAnimation: ActorAnimation | null = null;
  /** 防止快速切换载体时旧素材后到覆盖新素材 */
  let actorAssetToken = 0;
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
    if (!timelineCache) {
      timelineCache = computeTimeline(opts, audio?.duration ?? 0, getAspect(opts.aspect));
    }
    return timelineCache;
  }

  /** 按 id 解析主题：内置 10 套，或 localStorage 里的自定义主题（未知 id 回退默认） */
  function resolveTheme(id: string): Theme {
    const builtin = THEMES.find((t) => t.id === id);
    if (builtin) return builtin;
    const custom = loadCustomThemes().find((c) => c.id === id);
    if (custom) return toRenderTheme(custom);
    return getTheme(undefined);
  }

  function buildRenderInput(): RenderInput {
    const theme = resolveTheme(opts.theme);
    const codeId = opts.progressEffect?.actor.kind === 'code' ? opts.progressEffect.actor.id : null;
    return {
      opts,
      theme: opts.accentColor ? { ...theme, accent: opts.accentColor } : theme,
      aspect: getAspect(opts.aspect),
      timeline: getTimeline(),
      lyrics: opts.lyricMode === 'none' ? null : getLyrics(),
      title: opts.titleText.trim() || audio?.name || '未命名歌曲',
      bgImage: bgAsset,
      coverImage: coverAsset,
      actorImage: actorAsset,
      actorFrames: actorAnimation,
      customActor: codeId ? getCustomActorDraw(codeId) : null,
      customActorFull: codeId ? getCustomEffectMode(codeId) === 'full' : false,
      // 自定义频谱：id → 编译产物走模块级缓存（本函数每帧执行，不能重复编译）
      customVisualizer:
        typeof opts.visualizer === 'string' && isCustomVisualizerId(opts.visualizer)
          ? getCustomVisualizerDraw(opts.visualizer)
          : null,
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
    drawFrame(
      ctx,
      previewCanvas.width,
      previewCanvas.height,
      buildRenderInput(),
      t,
      dt,
      bands,
      wave,
    );
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

  /** 复制一份角色效果（避免直接改 DEFAULT_PROGRESS_EFFECT / 预设常量） */
  function cloneProgressEffect(e: ProgressEffect): ProgressEffect {
    return { ...e, actor: { ...e.actor } };
  }

  /** 载体失效时回退内置足球（保留其他效果参数） */
  function fallbackProgressActor(message: string): void {
    const cur = opts.progressEffect;
    if (!cur) return;
    opts.progressEffect = {
      ...cur,
      actor: { kind: 'builtin', id: 'football' },
      motion: 'roll',
    };
    saveOptions(opts);
    syncEffectUI();
    setEffectStatus(message, 'warn');
  }

  /**
   * 解析当前角色效果对应的载体：
   *   内置精灵 / 上传静态图 / 上传 GIF / AI 效果代码 → actorAsset / actorAnimation。
   * 素材被删除、换了浏览器、GIF 解码失败或代码失效时回退内置足球，避免画面空白。
   */
  async function refreshActorAsset(): Promise<void> {
    const token = ++actorAssetToken;
    const eff = opts.progressEffect;
    if (!eff) {
      actorAsset = null;
      actorAnimation = null;
      drawStaticFrame();
      return;
    }

    let image: ImageAsset | null = null;
    let animation: ActorAnimation | null = null;
    let cacheKey: string;

    if (eff.actor.kind === 'code') {
      if (!getCustomActorDraw(eff.actor.id)) {
        fallbackProgressActor('AI 效果代码已失效，已回退为内置足球。');
        image = await loadBuiltinActor('football');
        cacheKey = 'builtin:football';
      } else {
        // AI 效果载体：只加载素材，不自动绘制；img/frame 交给 AI 代码决定显隐与变换
        const base = eff.codeBase ?? null;
        if (base?.kind === 'builtin') {
          image = await loadBuiltinActor(base.id);
        } else if (base?.kind === 'asset') {
          const loaded = await loadUploadedActor(base.id);
          if (loaded?.kind === 'image') {
            image = loaded.image;
          } else if (loaded?.kind === 'gif') {
            animation = loaded.animation;
          } else {
            opts.progressEffect = { ...eff, codeBase: null };
            saveOptions(opts);
            syncEffectUI();
            setEffectStatus('AI 效果载体素材已不存在，已改为无载体。', 'warn');
          }
        }
        if (token !== actorAssetToken) return;
        // AI 效果不启用主题染色，载体保持原色
        actorAsset = image;
        actorAnimation = animation;
        drawStaticFrame();
        return;
      }
    } else if (eff.actor.kind === 'builtin') {
      image = await loadBuiltinActor(eff.actor.id);
      cacheKey = `builtin:${eff.actor.id}`;
    } else {
      cacheKey = `asset:${eff.actor.id}`;
      const loaded = await loadUploadedActor(eff.actor.id);
      if (loaded?.kind === 'image') {
        image = loaded.image;
      } else if (loaded?.kind === 'gif') {
        animation = loaded.animation;
      } else {
        fallbackProgressActor('素材已不存在或无法解码，已回退为内置足球。');
        image = await loadBuiltinActor('football');
        cacheKey = 'builtin:football';
      }
    }

    if (token !== actorAssetToken) return; // 已有更新的切换请求，丢弃本次结果
    if (opts.progressEffect?.tint === 'accent') {
      const accent = opts.accentColor ?? resolveTheme(opts.theme).accent;
      if (image) image = tintActorAsset(cacheKey, image, accent);
      if (animation) animation = tintActorAnimation(cacheKey, animation, accent);
    }
    actorAsset = image;
    actorAnimation = animation;
    drawStaticFrame();
  }

  // ──────────────── 文件选择 ────────────────
  const audioPicker = makeFilePicker({
    label: '🎵 音乐文件（必需）',
    // 扩展名 + 各平台常见 MIME 全量列出：部分系统文件框只认其中一种写法，
    // 只写 audio/mpeg,audio/wav 时会出现 mp3 灰色不可选的情况
    accept:
      '.mp3,.wav,.mpga,.mp2,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave,audio/vnd.wav',
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
        updateOptions(
          () => (opts.resolution = (e.target as HTMLSelectElement).value as ResolutionId),
        ),
    },
    RESOLUTIONS.map((r) =>
      h('option', { value: r.id, selected: r.id === opts.resolution }, [r.label]),
    ),
  ) as HTMLSelectElement;

  // 泛型放宽到 VisualizerSelection：选中自定义频谱（cviz:）时四个内置按钮自然全不高亮，
  // 选中态由下方自定义 chips 行表达
  const visualizerSeg = makeSegment<VisualizerSelection>(
    VISUALIZERS.map((v) => ({ id: v.id as VisualizerSelection, label: v.label, hint: v.hint })),
    opts.visualizer,
    (id) => {
      updateOptions(() => (opts.visualizer = id));
      paintVizChips();
    },
  );

  const lyricSeg = makeSegment<LyricModeId>(
    LYRIC_MODES.map((m) => ({ id: m.id, label: m.label, hint: m.hint })),
    opts.lyricMode,
    (id) => {
      updateOptions(() => (opts.lyricMode = id));
      refreshLyricVisibility();
    },
  );

  /** 条件显隐：单行淡入 → 显示前/后一句开关；滚动列表 → 显示上/下行数；不显示 → 都收起 */
  function refreshLyricVisibility(): void {
    lyricFadeRow.classList.toggle('hidden', opts.lyricMode !== 'fade');
    lyricListRow.classList.toggle('hidden', opts.lyricMode !== 'list');
  }

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
  const lyricFadeRow = h('div', { class: 'flex flex-wrap gap-x-5 gap-y-1.5 pt-0.5' }, [
    h('label', { class: 'flex items-center gap-2 text-xs cursor-pointer text-[var(--fg-muted)]' }, [
      prevLyricCheckbox,
      '显示前一句',
    ]),
    h('label', { class: 'flex items-center gap-2 text-xs cursor-pointer text-[var(--fg-muted)]' }, [
      nextLyricCheckbox,
      '显示后一句',
    ]),
  ]);

  // 滚动列表模式：当前句上方/下方行数（上方默认小于下方；空间不足时自动少显）
  const selCls =
    'rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 text-xs text-[var(--fg)] outline-none focus:border-[var(--accent)]';
  const lyricAboveSel = h(
    'select',
    {
      class: selCls,
      'aria-label': '歌词列表上方行数',
      onchange: (e) =>
        updateOptions(() => (opts.lyricAbove = Number((e.target as HTMLSelectElement).value))),
    },
    LYRIC_ABOVE_CHOICES.map((c) =>
      h('option', { value: String(c), selected: c === opts.lyricAbove }, [
        c === 0 ? '不显示' : `上 ${c} 行`,
      ]),
    ),
  ) as HTMLSelectElement;
  const lyricBelowSel = h(
    'select',
    {
      class: selCls,
      'aria-label': '歌词列表下方行数',
      onchange: (e) =>
        updateOptions(() => (opts.lyricBelow = Number((e.target as HTMLSelectElement).value))),
    },
    LYRIC_BELOW_CHOICES.map((c) =>
      h('option', { value: String(c), selected: c === opts.lyricBelow }, [`下 ${c} 行`]),
    ),
  ) as HTMLSelectElement;
  const lyricListRow = h('div', { class: 'flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-0.5' }, [
    h('label', { class: 'flex items-center gap-1.5 text-xs text-[var(--fg-muted)]' }, [
      h('span', { textContent: '列表上方' }),
      lyricAboveSel,
    ]),
    h('label', { class: 'flex items-center gap-1.5 text-xs text-[var(--fg-muted)]' }, [
      h('span', { textContent: '列表下方' }),
      lyricBelowSel,
    ]),
    h('span', { class: 'text-[11px] text-[var(--fg-muted)]', textContent: '空间不足时自动少显' }),
  ]);

  // 主题：内置 10 套 + 用户自定义（存储参考名言卡片自定义模板：localStorage items 列表）
  const themeWrap = h('div', { class: 'flex flex-wrap items-center gap-3' }, []);
  const paintTheme = (id: string): void => {
    for (const b of themeWrap.querySelectorAll('button[data-theme-id]')) {
      const el = b as HTMLElement;
      const active = el.dataset.themeId === id;
      el.style.outline = active ? '2px solid var(--accent)' : 'none';
      el.style.outlineOffset = '2px';
    }
  };
  function selectTheme(id: string): void {
    updateOptions(() => (opts.theme = id));
    paintTheme(id);
    void refreshActorAsset(); // 主色变化时刷新染色素材
  }

  /** 主题编辑对话框：基于当前主题预填，四个色板 + 实时渐变预览 */
  function openThemeEditor(): void {
    const base = resolveTheme(opts.theme);
    const dlg = createDialog({
      panelClass: 'max-w-md',
      label: '新建自定义主题',
      closeOnBackdrop: false,
    });
    const inputCls =
      'w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]';
    const nameInput = h('input', {
      type: 'text',
      value: `我的主题 ${loadCustomThemes().length + 1}`,
      class: inputCls,
      'aria-label': '主题名称',
      maxlength: '12',
    }) as HTMLInputElement;
    const colorCls =
      'h-8 w-12 cursor-pointer rounded border border-[var(--border)] bg-[var(--bg)] p-0.5';
    const bg1 = h('input', {
      type: 'color',
      value: base.bg[0],
      class: colorCls,
      'aria-label': '背景起色',
    }) as HTMLInputElement;
    const bg2 = h('input', {
      type: 'color',
      value: base.bg[1],
      class: colorCls,
      'aria-label': '背景止色',
    }) as HTMLInputElement;
    const fg = h('input', {
      type: 'color',
      value: base.fg,
      class: colorCls,
      'aria-label': '文字颜色',
    }) as HTMLInputElement;
    const accentC = h('input', {
      type: 'color',
      value: base.accent,
      class: colorCls,
      'aria-label': '主强调色',
    }) as HTMLInputElement;
    const swatch = h('div', {
      class: 'h-12 w-full rounded-lg border border-[var(--border)]',
      style: `background:linear-gradient(135deg,${base.bg[0]},${base.bg[1]})`,
    });
    const syncSwatch = (): void => {
      swatch.style.background = `linear-gradient(135deg,${bg1.value},${bg2.value})`;
    };
    bg1.addEventListener('input', syncSwatch);
    bg2.addEventListener('input', syncSwatch);

    const colorRow = (label: string, input: HTMLElement): HTMLElement =>
      h('div', { class: 'flex items-center justify-between gap-3' }, [
        h('span', { class: 'text-sm text-[var(--fg-muted)]', textContent: label }),
        input,
      ]);
    const cancelBtn = h(
      'button',
      {
        type: 'button',
        class:
          'rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--fg-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors',
        textContent: '取消',
        onclick: () => dlg.close(),
      },
      [],
    );
    const saveBtn = h(
      'button',
      {
        type: 'button',
        class:
          'rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm font-medium text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
        textContent: '保存主题',
        onclick: () => {
          const items = addCustomTheme(
            nameInput.value.trim() || `我的主题 ${loadCustomThemes().length + 1}`,
            bg1.value,
            bg2.value,
            fg.value,
            accentC.value,
          );
          const last = items[items.length - 1];
          dlg.close();
          rebuildThemeButtons();
          if (last) selectTheme(last.id);
        },
      },
      [],
    );
    dlg.body.append(
      h('h3', { class: 'text-base font-semibold text-[var(--fg)]', textContent: '新建自定义主题' }),
      h('div', { class: 'mt-3 space-y-3' }, [
        colorRow('主题名称', nameInput),
        swatch,
        colorRow('背景色（起）', bg1),
        colorRow('背景色（止）', bg2),
        colorRow('文字颜色', fg),
        colorRow('主强调色', accentC),
        h('p', {
          class: 'text-xs leading-relaxed text-[var(--fg-muted)]',
          textContent:
            '浅色/深色按背景亮度自动判断；主色用于频谱、进度条与高亮歌词。自定义主题保存在本浏览器，可在主题按钮悬停角标删除。',
        }),
      ]),
      h('div', { class: 'mt-4 flex justify-end gap-2' }, [cancelBtn, saveBtn]),
    );
    dlg.open();
  }

  function rebuildThemeButtons(): void {
    themeWrap.replaceChildren();
    // 内置主题
    for (const th of THEMES) {
      themeWrap.append(
        h(
          'button',
          {
            type: 'button',
            'data-theme-id': th.id,
            title: th.label,
            'aria-label': `主题：${th.label}`,
            class:
              'h-9 w-14 rounded-lg border border-[var(--border)] transition-transform hover:scale-105',
            style: `background:${th.swatch}`,
            onclick: () => selectTheme(th.id),
          },
          [],
        ),
      );
    }
    // 自定义主题（悬停显示删除角标）
    for (const ct of loadCustomThemes()) {
      const btn = h(
        'button',
        {
          type: 'button',
          'data-theme-id': ct.id,
          title: `自定义主题：${ct.name}`,
          'aria-label': `自定义主题：${ct.name}`,
          class:
            'h-9 w-14 rounded-lg border border-[var(--border)] transition-transform hover:scale-105',
          style: `background:linear-gradient(135deg,${ct.bg1},${ct.bg2})`,
          onclick: () => selectTheme(ct.id),
        },
        [],
      );
      const del = h(
        'button',
        {
          type: 'button',
          'aria-label': `删除主题 ${ct.name}`,
          title: '删除此主题',
          class:
            'absolute -right-1.5 -top-1.5 hidden h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500 text-[9px] leading-none text-white shadow group-hover:flex',
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
      themeWrap.append(h('div', { class: 'group relative' }, [btn, del]));
    }
    // 新建入口
    themeWrap.append(
      h(
        'button',
        {
          type: 'button',
          title: '新建自定义主题',
          'aria-label': '新建自定义主题',
          class:
            'h-9 w-14 rounded-lg border border-dashed border-[var(--border)] text-lg text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
          textContent: '+',
          onclick: () => openThemeEditor(),
        },
        [],
      ),
    );
    paintTheme(opts.theme);
  }
  rebuildThemeButtons();

  const progressSeg = makeSegment<ProgressBarId>(
    PROGRESS_BARS.map((p) => ({ id: p.id, label: p.label })),
    opts.progressBar,
    (id) => updateOptions(() => (opts.progressBar = id)),
  );

  // ──────────────── 角色进度条（内置素材 + 上传素材 + 运动/尾迹） ────────────────
  const progressStyleRow = row('进度条', progressSeg.wrap);

  const effectStatus = h('p', { class: 'hidden text-xs leading-relaxed' });
  /** AI 向导入口（aiDialogs 创建较晚，用 ref 规避声明顺序） */
  let openEffectDialogRef: (() => void) | null = null;
  function setEffectStatus(msg: string, tone: 'ok' | 'warn' | 'err' = 'err'): void {
    effectStatus.classList.toggle('hidden', !msg);
    effectStatus.textContent = msg;
    effectStatus.style.color =
      tone === 'ok' ? '#22c55e' : tone === 'warn' ? '#d97706' : 'var(--holiday-legal)';
  }

  const effectToggle = h('input', {
    type: 'checkbox',
    class: 'h-4 w-4 accent-[var(--accent)]',
    checked: !!opts.progressEffect,
    onchange: (e) => {
      const on = (e.target as HTMLInputElement).checked;
      updateOptions(() => {
        opts.progressEffect = on
          ? cloneProgressEffect(opts.progressEffect ?? DEFAULT_PROGRESS_EFFECT)
          : null;
      });
      if (on && effectCollapsed) setEffectCollapsed(false); // 启用时自动展开，避免“打开了却看不到设置”
      syncEffectUI();
      void refreshActorAsset();
      setEffectStatus(on ? '' : '已关闭角色效果，恢复上方进度条样式。', 'ok');
    },
  }) as HTMLInputElement;

  /** 预设卡片按钮（高亮用） */
  const presetButtons: HTMLButtonElement[] = [];
  const presetWrap = h('div', { class: 'grid grid-cols-2 gap-2' }, []);
  for (const preset of PROGRESS_PRESETS) {
    const btn = h(
      'button',
      {
        type: 'button',
        'data-preset-id': preset.id,
        class:
          'flex items-start gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-left transition-colors hover:border-[var(--accent)]',
        onclick: () => {
          const prevBase = opts.progressEffect?.codeBase ?? null;
          updateOptions(() => {
            opts.progressEffect = {
              ...cloneProgressEffect(preset.effect),
              // 普通预设也记住当前载体，之后切回 AI 效果时可直接复用
              codeBase:
                preset.effect.actor.kind === 'builtin'
                  ? { kind: 'builtin', id: preset.effect.actor.id }
                  : prevBase,
            };
          });
          syncEffectUI();
          void refreshActorAsset();
          setEffectStatus('');
        },
      },
      [
        h('span', { class: 'text-base leading-none', textContent: preset.emoji }),
        h('span', { class: 'min-w-0' }, [
          h('span', {
            class: 'block text-xs font-medium text-[var(--fg)]',
            textContent: preset.label,
          }),
          h('span', {
            class: 'block truncate text-[10px] text-[var(--fg-muted)]',
            textContent: preset.hint,
          }),
        ]),
      ],
    ) as HTMLButtonElement;
    presetButtons.push(btn);
    presetWrap.append(btn);
  }

  /** 内置载体按钮（高亮用） */
  const builtinButtons = new Map<string, HTMLButtonElement>();
  const builtinWrap = h('div', { class: 'flex flex-wrap gap-1.5' }, []);
  for (const actor of BUILTIN_ACTORS) {
    const spriteUrl = builtinActorSpriteUrl(actor.id);
    const thumb = spriteUrl
      ? h('img', { src: spriteUrl, alt: '', class: 'h-6 w-6 object-contain' })
      : h('span', { class: 'text-base leading-none', textContent: actor.emoji });
    const motionLabel =
      PROGRESS_MOTIONS.find((m) => m.id === actor.defaultMotion)?.label ?? actor.defaultMotion;
    const btn = h(
      'button',
      {
        type: 'button',
        'data-actor-id': actor.id,
        title: `选择${actor.label}（AI 效果模式下作为载体；推荐运动：${motionLabel}）`,
        class:
          'flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-[11px] text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
        onclick: () => {
          const cur = opts.progressEffect;
          if (!cur) return;
          const full = isFullEffect(cur);
          updateOptions(() => {
            opts.progressEffect = full
              ? { ...cur, codeBase: { kind: 'builtin', id: actor.id } }
              : {
                  ...cur,
                  actor: { kind: 'builtin', id: actor.id },
                  // 记住当前载体，切到 AI 效果时可直接复用
                  codeBase: { kind: 'builtin', id: actor.id },
                  motion: actor.defaultMotion,
                };
          });
          syncEffectUI();
          void refreshActorAsset();
          setEffectStatus('');
        },
      },
      [thumb, h('span', { textContent: actor.label })],
    ) as HTMLButtonElement;
    builtinButtons.set(actor.id, btn);
    builtinWrap.append(btn);
  }

  // —— 上传 / 粘贴 ——
  const effectMiniBtnCls =
    'rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[11px] text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]';

  const assetInput = h('input', {
    type: 'file',
    accept:
      '.png,.jpg,.jpeg,.webp,.svg,.gif,image/png,image/jpeg,image/webp,image/svg+xml,image/gif',
    class: 'hidden',
  }) as HTMLInputElement;
  assetInput.addEventListener('change', () => {
    const file = assetInput.files?.[0];
    assetInput.value = '';
    if (file) void importActorFile(file);
  });

  const uploadBtn = h('button', {
    type: 'button',
    class: effectMiniBtnCls,
    textContent: '⬆ 上传素材',
    title: '支持 PNG / JPG / WebP / SVG / GIF 动图',
    onclick: () => assetInput.click(),
  });
  const pasteImgBtn = h('button', {
    type: 'button',
    class: effectMiniBtnCls,
    textContent: '📋 粘贴图片',
    title: '从剪贴板读取截图/图片（需浏览器授权）',
    onclick: () => void importClipboardImage(),
  });
  const pasteSvgBtn = h('button', {
    type: 'button',
    class: effectMiniBtnCls,
    textContent: '📋 粘贴 SVG',
    title: '在 iconfont 图标页复制 SVG 源码后点此粘贴（自动跟随主题色）',
    onclick: () => void importClipboardSvg(),
  });
  const uploadZone = h(
    'div',
    {
      class:
        'flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg)] p-2 transition-colors',
    },
    [uploadBtn, pasteImgBtn, pasteSvgBtn, assetInput],
  );
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.style.borderColor = 'var(--accent)';
  });
  uploadZone.addEventListener('dragleave', () => {
    uploadZone.style.borderColor = '';
  });
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.style.borderColor = '';
    const file = (e as DragEvent).dataTransfer?.files?.[0];
    if (file) void importActorFile(file);
  });

  /** 已上传素材 chips（高亮用） */
  let assetButtons = new Map<string, HTMLButtonElement>();
  const assetWrap = h('div', { class: 'hidden flex flex-wrap gap-1.5' }, []);
  let assetThumbUrls: string[] = [];

  // —— 运动 / 尾迹 / 尺寸 / 着色 ——
  const motionSeg = makeSegment<ProgressMotionId>(
    PROGRESS_MOTIONS.map((m) => ({ id: m.id, label: m.label, hint: m.hint })),
    opts.progressEffect?.motion ?? DEFAULT_PROGRESS_EFFECT.motion,
    (id) => {
      const cur = opts.progressEffect;
      if (!cur) return;
      updateOptions(() => {
        opts.progressEffect = { ...cur, motion: id };
      });
      syncEffectUI();
    },
  );

  const trailSeg = makeSegment<ProgressTrailId>(
    PROGRESS_TRAILS.map((t) => ({ id: t.id, label: t.label, hint: t.hint })),
    opts.progressEffect?.trail ?? DEFAULT_PROGRESS_EFFECT.trail,
    (id) => {
      const cur = opts.progressEffect;
      if (!cur) return;
      updateOptions(() => {
        opts.progressEffect = { ...cur, trail: id };
      });
      syncEffectUI();
    },
  );

  const trailLenValue = h('span', {
    class: 'font-mono text-[11px] text-[var(--fg-muted)]',
    textContent: '60%',
  });
  const trailLenInput = h('input', {
    type: 'range',
    min: '10',
    max: '100',
    step: '5',
    value: String(Math.round((opts.progressEffect?.trailLen ?? 0.6) * 100)),
    class: 'w-full accent-[var(--accent)]',
    'aria-label': '尾迹长度',
    oninput: (e) => {
      const cur = opts.progressEffect;
      if (!cur) return;
      const v = Number((e.target as HTMLInputElement).value);
      updateOptions(() => {
        opts.progressEffect = { ...cur, trailLen: v / 100 };
      });
      trailLenValue.textContent = `${v}%`;
    },
  }) as HTMLInputElement;
  const trailLenRow = h('div', { class: 'space-y-1' }, [
    h('div', { class: 'flex items-center justify-between' }, [
      h('span', { class: 'text-xs text-[var(--fg-muted)]', textContent: '尾迹长度' }),
      trailLenValue,
    ]),
    trailLenInput,
  ]);

  const sizeValue = h('span', {
    class: 'font-mono text-[11px] text-[var(--fg-muted)]',
    textContent: '10%',
  });
  const sizeInput = h('input', {
    type: 'range',
    min: '6',
    max: '18',
    step: '1',
    value: String(Math.round((opts.progressEffect?.size ?? 0.1) * 100)),
    class: 'w-full accent-[var(--accent)]',
    'aria-label': '载体尺寸',
    oninput: (e) => {
      const cur = opts.progressEffect;
      if (!cur) return;
      const v = Number((e.target as HTMLInputElement).value);
      updateOptions(() => {
        opts.progressEffect = { ...cur, size: v / 100 };
      });
      sizeValue.textContent = `${v}%`;
    },
  }) as HTMLInputElement;
  const sizeRow = h('div', { class: 'space-y-1' }, [
    h('div', { class: 'flex items-center justify-between' }, [
      h('span', { class: 'text-xs text-[var(--fg-muted)]', textContent: '载体尺寸（短边占比）' }),
      sizeValue,
    ]),
    sizeInput,
  ]);

  // —— 旋转速度 / 外围光晕 / 垂直偏移 ——
  const spinValue = h('span', {
    class: 'font-mono text-[11px] text-[var(--fg-muted)]',
    textContent: `${(opts.progressEffect?.spin ?? 1).toFixed(1)}×`,
  });
  const spinInput = h('input', {
    type: 'range',
    min: '0',
    max: '300',
    step: '10',
    value: String(Math.round((opts.progressEffect?.spin ?? 1) * 100)),
    class: 'w-full accent-[var(--accent)]',
    'aria-label': '旋转速度',
    oninput: (e) => {
      const cur = opts.progressEffect;
      if (!cur) return;
      const v = Number((e.target as HTMLInputElement).value);
      updateOptions(() => {
        opts.progressEffect = { ...cur, spin: v / 100 };
      });
      spinValue.textContent = `${(v / 100).toFixed(1)}×`;
    },
  }) as HTMLInputElement;
  const spinRow = h('div', { class: 'space-y-1' }, [
    h('div', { class: 'flex items-center justify-between' }, [
      h('span', {
        class: 'text-xs text-[var(--fg-muted)]',
        textContent: '旋转速度（滚动 / 自转倍数）',
      }),
      spinValue,
    ]),
    spinInput,
  ]);

  const haloValue = h('span', {
    class: 'font-mono text-[11px] text-[var(--fg-muted)]',
    textContent: `${Math.round((opts.progressEffect?.halo ?? 0) * 100)}%`,
  });
  const haloInput = h('input', {
    type: 'range',
    min: '0',
    max: '100',
    step: '5',
    value: String(Math.round((opts.progressEffect?.halo ?? 0) * 100)),
    class: 'w-full accent-[var(--accent)]',
    'aria-label': '外围光晕强度',
    oninput: (e) => {
      const cur = opts.progressEffect;
      if (!cur) return;
      const v = Number((e.target as HTMLInputElement).value);
      updateOptions(() => {
        opts.progressEffect = { ...cur, halo: v / 100 };
      });
      haloValue.textContent = `${v}%`;
    },
  }) as HTMLInputElement;
  const haloRow = h('div', { class: 'space-y-1' }, [
    h('div', { class: 'flex items-center justify-between' }, [
      h('span', { class: 'text-xs text-[var(--fg-muted)]', textContent: '外围光晕' }),
      haloValue,
    ]),
    haloInput,
  ]);

  const offsetValue = h('span', {
    class: 'font-mono text-[11px] text-[var(--fg-muted)]',
    textContent: `${Math.round((opts.progressEffect?.offsetY ?? 0) * 100)}%`,
  });
  const offsetInput = h('input', {
    type: 'range',
    min: '-20',
    max: '20',
    step: '1',
    value: String(Math.round((opts.progressEffect?.offsetY ?? 0) * 100)),
    class: 'w-full accent-[var(--accent)]',
    'aria-label': '垂直偏移',
    oninput: (e) => {
      const cur = opts.progressEffect;
      if (!cur) return;
      const v = Number((e.target as HTMLInputElement).value);
      updateOptions(() => {
        opts.progressEffect = { ...cur, offsetY: v / 100 };
      });
      offsetValue.textContent = `${v > 0 ? '+' : ''}${v}%`;
    },
  }) as HTMLInputElement;
  const offsetCenterBtn = h('button', {
    type: 'button',
    class:
      'rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
    textContent: '中心对齐',
    title: '按当前运动补偿升降，把载体中心线移到轨道上（可继续微调）',
    onclick: () => {
      const cur = opts.progressEffect;
      if (!cur) return;
      const liftFactor =
        cur.motion === 'fly'
          ? 0.55
          : cur.motion === 'float'
            ? 0.5
            : cur.motion === 'run'
              ? 0.05
              : 0;
      const v = Math.round(cur.size * (liftFactor + 0.5) * 100);
      updateOptions(() => {
        opts.progressEffect = { ...cur, offsetY: v / 100 };
      });
      offsetInput.value = String(v);
      offsetValue.textContent = `+${v}%`;
    },
  });
  const offsetRow = h('div', { class: 'space-y-1' }, [
    h('div', { class: 'flex items-center justify-between gap-2' }, [
      h('span', {
        class: 'text-xs text-[var(--fg-muted)]',
        textContent: '垂直偏移（正数下移）',
      }),
      h('div', { class: 'flex items-center gap-2' }, [offsetValue, offsetCenterBtn]),
    ]),
    offsetInput,
  ]);

  const tintInput = h('input', {
    type: 'checkbox',
    class: 'h-3.5 w-3.5 accent-[var(--accent)]',
    checked: opts.progressEffect?.tint === 'accent',
    onchange: (e) => {
      const cur = opts.progressEffect;
      if (!cur) return;
      const checked = (e.target as HTMLInputElement).checked;
      updateOptions(() => {
        opts.progressEffect = { ...cur, tint: checked ? 'accent' : 'original' };
      });
      syncEffectUI();
      void refreshActorAsset();
    },
  }) as HTMLInputElement;
  const tempoInput = h('input', {
    type: 'checkbox',
    class: 'h-3.5 w-3.5 accent-[var(--accent)]',
    checked: opts.progressEffect?.tempoSync ?? false,
    onchange: (e) => {
      const cur = opts.progressEffect;
      if (!cur) return;
      const checked = (e.target as HTMLInputElement).checked;
      updateOptions(() => {
        opts.progressEffect = { ...cur, tempoSync: checked };
      });
    },
  }) as HTMLInputElement;

  /** AI 效果方案 chips（高亮用） */
  const customActorWrap = h('div', { class: 'hidden flex flex-wrap gap-1.5' }, []);
  let actorChipButtons = new Map<string, HTMLButtonElement>();

  /** 通用参数（full 模式 AI 效果下隐藏，由代码自行控制） */
  const legacyControls = h('div', { class: 'space-y-3' }, [
    h('div', { class: 'space-y-1.5' }, [fieldLabel('运动'), motionSeg.wrap]),
    h('div', { class: 'space-y-1.5' }, [fieldLabel('尾迹'), trailSeg.wrap, trailLenRow]),
    sizeRow,
    spinRow,
    haloRow,
    offsetRow,
    h('div', { class: 'flex flex-wrap gap-x-4 gap-y-1.5 pt-0.5' }, [
      h(
        'label',
        { class: 'flex items-center gap-1.5 text-xs text-[var(--fg-muted)] cursor-pointer' },
        [tintInput, '跟随主题主色'],
      ),
      h(
        'label',
        { class: 'flex items-center gap-1.5 text-xs text-[var(--fg-muted)] cursor-pointer' },
        [tempoInput, '随音乐律动'],
      ),
    ]),
  ]);

  const effectPanel = h('div', { class: 'hidden space-y-3' }, [
    h('div', { class: 'space-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2' }, [
      h('div', { class: 'flex items-baseline justify-between gap-2' }, [
        fieldLabel('AI 效果'),
        h('button', {
          type: 'button',
          class:
            'rounded-md border border-[var(--accent)] bg-[var(--bg)] px-1.5 py-0.5 text-[10px] text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-fg)]',
          textContent: '💡 生成效果',
          title: '描述一句话，让 AI 生成整条进度条的绘制代码',
          onclick: () => openEffectDialogRef?.(),
        }),
      ]),
      customActorWrap,
      h('p', {
        class: 'text-[10px] leading-relaxed text-[var(--fg-muted)]',
        textContent:
          '生成并保存后即为 AI 效果方案，点击可切换、悬停可删除。选择下方载体后，AI 代码直接控制轨道、时间、载体与尾迹。',
      }),
    ]),
    h('div', { class: 'space-y-1.5' }, [
      h('p', { class: 'text-[11px] text-[var(--fg-muted)]', textContent: '预设玩法' }),
      presetWrap,
    ]),
    h('div', { class: 'space-y-1.5' }, [fieldLabel('载体（内置）'), builtinWrap]),
    h('div', { class: 'space-y-1.5' }, [
      h('div', { class: 'flex items-baseline justify-between gap-2' }, [
        fieldLabel('载体（我的素材 / 上传）'),
        h('span', {
          class: 'text-[10px] text-[var(--fg-muted)]',
          textContent: 'PNG / SVG / GIF · 透明底更佳',
        }),
      ]),
      uploadZone,
      assetWrap,
      h('p', {
        class: 'text-[10px] leading-relaxed text-[var(--fg-muted)]',
        textContent:
          'GIF 动图会按歌曲时间循环播放。iconfont：下载 SVG 后上传，或复制图标页的 SVG 源码再点「粘贴 SVG」。素材只保存在本机，不会上传服务器。',
      }),
    ]),
    legacyControls,
    effectStatus,
  ]);

  /** 角色进度条折叠状态（UI 记忆，独立于视频选项） */
  const COLLAPSE_KEY = 'song-video:progress-collapsed';
  let effectCollapsed = readJSON(COLLAPSE_KEY)?.collapsed === true;
  const effectDesc = h('p', {
    class: 'text-[11px] leading-relaxed text-[var(--fg-muted)]',
    textContent:
      '让足球、流星、地球、你上传的图标或 AI 生成的效果沿进度条前进；AI 效果可直接接管轨道、时间与尾迹。',
  });
  const collapseBtn = h('button', {
    type: 'button',
    class:
      'shrink-0 rounded-md px-1.5 py-0.5 text-sm leading-none text-[var(--fg-muted)] transition-colors hover:text-[var(--accent)]',
    textContent: '▾',
    'aria-label': '折叠角色进度条设置',
    title: '折叠/展开角色进度条设置（会记忆状态）',
    onclick: () => setEffectCollapsed(!effectCollapsed),
  });

  /** 折叠按钮图标、描述显隐与持久化 */
  function paintCollapseState(): void {
    collapseBtn.textContent = effectCollapsed ? '▸' : '▾';
    collapseBtn.setAttribute(
      'aria-label',
      effectCollapsed ? '展开角色进度条设置' : '折叠角色进度条设置',
    );
    collapseBtn.title = effectCollapsed
      ? '展开角色进度条设置（会记忆状态）'
      : '折叠角色进度条设置（会记忆状态）';
    effectDesc.classList.toggle('hidden', effectCollapsed);
  }

  function setEffectCollapsed(collapsed: boolean): void {
    effectCollapsed = collapsed;
    writeJSON(COLLAPSE_KEY, { version: 1, collapsed });
    paintCollapseState();
    syncEffectUI();
  }

  const effectSection = h(
    'div',
    {
      class: 'space-y-2 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3',
    },
    [
      h('div', { class: 'flex items-center justify-between gap-2' }, [
        h(
          'label',
          {
            class:
              'flex items-center gap-2 text-sm font-medium text-[var(--fg-muted)] cursor-pointer',
          },
          [effectToggle, '角色进度条'],
        ),
        h('div', { class: 'flex items-center gap-1.5' }, [
          h('span', {
            class:
              'rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)]',
            textContent: '新',
          }),
          collapseBtn,
        ]),
      ]),
      effectDesc,
      effectPanel,
    ],
  );

  /** 预设高亮只看「载体 + 运动 + 尾迹」，微调尺寸/长度不取消预设选中态 */
  function effectCoreSignature(e: ProgressEffect): string {
    return [e.actor.kind, e.actor.id, e.motion, e.trail].join('|');
  }

  function paintEffectActive(): void {
    const eff = opts.progressEffect;
    const sig = eff ? effectCoreSignature(eff) : '';
    const full = isFullEffect(eff);
    const activeBuiltin = full
      ? eff?.codeBase?.kind === 'builtin'
        ? eff.codeBase.id
        : null
      : eff?.actor.kind === 'builtin'
        ? eff.actor.id
        : null;
    const activeAsset = full
      ? eff?.codeBase?.kind === 'asset'
        ? eff.codeBase.id
        : null
      : eff?.actor.kind === 'asset'
        ? eff.actor.id
        : null;
    for (const btn of presetButtons) {
      const preset = PROGRESS_PRESETS.find((p) => p.id === btn.dataset.presetId);
      const active = !!(preset && sig === effectCoreSignature(preset.effect));
      btn.style.outline = active ? '2px solid var(--accent)' : 'none';
      btn.style.outlineOffset = '2px';
    }
    for (const [id, btn] of builtinButtons) {
      const active = id === activeBuiltin;
      btn.style.outline = active ? '2px solid var(--accent)' : 'none';
      btn.style.outlineOffset = '2px';
    }
    for (const [id, btn] of assetButtons) {
      const active = id === activeAsset;
      btn.style.outline = active ? '2px solid var(--accent)' : 'none';
      btn.style.outlineOffset = '2px';
    }
    for (const [id, btn] of actorChipButtons) {
      const active = !!eff && eff.actor.kind === 'code' && eff.actor.id === id;
      btn.style.outline = active ? '2px solid var(--accent)' : 'none';
      btn.style.outlineOffset = '2px';
    }
  }

  /** 当前是否为 full 模式 AI 效果（代码绘制整条进度条） */
  function isFullEffect(eff: ProgressEffect | null): boolean {
    return !!eff && eff.actor.kind === 'code' && getCustomEffectMode(eff.actor.id) === 'full';
  }

  /** 选项 → 控件回填（开关、显隐、高亮、滑杆数值） */
  function syncEffectUI(): void {
    const eff = opts.progressEffect;
    effectToggle.checked = !!eff;
    paintCollapseState();
    effectPanel.classList.toggle('hidden', !eff || effectCollapsed);
    progressStyleRow.classList.toggle('hidden', !!eff);
    if (!eff) {
      tintInput.disabled = false;
      legacyControls.classList.remove('hidden');
      paintEffectActive();
      return;
    }
    motionSeg.set(eff.motion);
    trailSeg.set(eff.trail);
    trailLenRow.classList.toggle('hidden', eff.trail === 'none');
    trailLenInput.value = String(Math.round(eff.trailLen * 100));
    trailLenValue.textContent = `${Math.round(eff.trailLen * 100)}%`;
    sizeInput.value = String(Math.round(eff.size * 100));
    sizeValue.textContent = `${Math.round(eff.size * 100)}%`;
    spinInput.value = String(Math.round(eff.spin * 100));
    spinValue.textContent = `${eff.spin.toFixed(1)}×`;
    haloInput.value = String(Math.round(eff.halo * 100));
    haloValue.textContent = `${Math.round(eff.halo * 100)}%`;
    offsetInput.value = String(Math.round(eff.offsetY * 100));
    offsetValue.textContent = `${eff.offsetY > 0 ? '+' : ''}${Math.round(eff.offsetY * 100)}%`;
    tintInput.checked = eff.tint === 'accent';
    tintInput.disabled = eff.actor.kind === 'code';
    tempoInput.checked = eff.tempoSync;
    legacyControls.classList.toggle('hidden', isFullEffect(eff));
    paintEffectActive();
  }

  /** 选中新导入素材；若当前是 AI 效果则作为「效果载体」，否则替换载体。返回是否用作效果载体 */
  async function applyImportedActor(record: ProgressAssetRecord, isSvg: boolean): Promise<boolean> {
    const cur = opts.progressEffect;
    const asCodeBase = cur?.actor.kind === 'code';
    updateOptions(() => {
      if (asCodeBase && cur) {
        opts.progressEffect = {
          ...cur,
          codeBase: { kind: 'asset', id: record.id },
        };
      } else {
        opts.progressEffect = {
          ...(cur ?? cloneProgressEffect(DEFAULT_PROGRESS_EFFECT)),
          actor: { kind: 'asset', id: record.id },
          tint: isSvg ? 'accent' : 'original',
          // 记住当前载体，切到 AI 效果时可直接复用
          codeBase: { kind: 'asset', id: record.id },
        };
      }
    });
    syncEffectUI();
    await rebuildAssetChips();
    await refreshActorAsset();
    return asCodeBase;
  }

  /** 读取并保存一条静态素材，随后选中它 */
  async function persistImportedAsset(
    processed: ProcessedActorAsset,
    name: string,
    isSvg: boolean,
  ): Promise<void> {
    const record = await saveProgressAsset({
      name,
      blob: processed.blob,
      width: processed.width,
      height: processed.height,
    });
    if (!record) {
      throw new Error('本地素材库不可用（可能处于隐私模式或浏览器不支持 IndexedDB）');
    }
    const asBase = await applyImportedActor(record, isSvg);
    setEffectStatus(
      `已导入「${record.name}」${asBase ? '（已作为 AI 效果载体）' : isSvg ? '（已自动跟随主题色）' : ''}`,
      'ok',
    );
  }

  /** 保存 GIF（原始文件入库、解码结果预填缓存），随后选中它 */
  async function persistGifAsset(processed: ProcessedGifAsset, name: string): Promise<void> {
    const record = await saveProgressAsset({
      name,
      blob: processed.blob,
      width: processed.width,
      height: processed.height,
      kind: 'gif',
      frameCount: processed.frameCount,
      durationMs: processed.durationMs,
    });
    if (!record) {
      throw new Error('本地素材库不可用（可能处于隐私模式或浏览器不支持 IndexedDB）');
    }
    primeGifActor(record.id, processed.animation);
    const asBase = await applyImportedActor(record, false);
    setEffectStatus(
      asBase
        ? `GIF 已作为 AI 效果载体（${processed.frameCount} 帧，${(processed.durationMs / 1000).toFixed(1)} 秒循环）`
        : `已导入 GIF「${record.name}」（${processed.frameCount} 帧，${(processed.durationMs / 1000).toFixed(1)} 秒循环）`,
      'ok',
    );
  }

  async function importActorFile(file: File): Promise<void> {
    try {
      const isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name);
      if (isGif) {
        setEffectStatus('正在解码 GIF…', 'warn');
        const processed = await prepareGifAsset(file);
        await persistGifAsset(processed, cleanAssetName(file.name));
        return;
      }
      setEffectStatus('正在处理素材…', 'warn');
      const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
      const processed = isSvg
        ? await prepareSvgAsset(await file.text())
        : await prepareImageAsset(file);
      await persistImportedAsset(processed, cleanAssetName(file.name), isSvg);
    } catch (e) {
      setEffectStatus(e instanceof Error ? e.message : '素材导入失败', 'err');
    }
  }

  async function importClipboardImage(): Promise<void> {
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
        throw new Error('当前浏览器不支持读取剪贴板图片，请改用「上传素材」。');
      }
      setEffectStatus('正在读取剪贴板…', 'warn');
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (!type) continue;
        const blob = await item.getType(type);
        if (type === 'image/gif') {
          await importActorFile(new File([blob], 'clipboard.gif', { type: 'image/gif' }));
          return;
        }
        const processed = await prepareImageAsset(new File([blob], 'clipboard.png', { type }));
        await persistImportedAsset(processed, '剪贴板图片', false);
        return;
      }
      throw new Error('剪贴板里没有图片。');
    } catch (e) {
      setEffectStatus(e instanceof Error ? e.message : '读取剪贴板失败', 'err');
    }
  }

  async function importClipboardSvg(): Promise<void> {
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
        throw new Error('当前浏览器不支持读取剪贴板文本，请改用「上传素材」。');
      }
      setEffectStatus('正在读取 SVG…', 'warn');
      const text = await navigator.clipboard.readText();
      if (!/<svg[\s>]/i.test(text)) {
        throw new Error('剪贴板里没有 SVG 代码——请在 iconfont 图标页复制 SVG 源码。');
      }
      const processed = await prepareSvgAsset(text);
      await persistImportedAsset(processed, 'iconfont 图标', true);
    } catch (e) {
      setEffectStatus(e instanceof Error ? e.message : 'SVG 导入失败', 'err');
    }
  }

  /** 刷新「我的素材」chips（缩略图 blob URL 在重建时统一回收） */
  async function rebuildAssetChips(): Promise<void> {
    for (const url of assetThumbUrls) URL.revokeObjectURL(url);
    assetThumbUrls = [];
    const records: ProgressAssetRecord[] = await listProgressAssets();
    assetWrap.replaceChildren();
    assetWrap.classList.toggle('hidden', records.length === 0);
    assetButtons = new Map();
    for (const record of records) {
      const url = URL.createObjectURL(record.blob);
      assetThumbUrls.push(url);
      const btn = h(
        'button',
        {
          type: 'button',
          'data-asset-id': record.id,
          title:
            record.kind === 'gif' && record.frameCount
              ? `使用 GIF「${record.name}」（${record.frameCount} 帧）`
              : `使用素材「${record.name}」`,
          class:
            'flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-[11px] text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)]',
          onclick: () => {
            const cur = opts.progressEffect;
            if (!cur) return;
            const full = isFullEffect(cur);
            updateOptions(() => {
              opts.progressEffect = full
                ? { ...cur, codeBase: { kind: 'asset', id: record.id } }
                : {
                    ...cur,
                    actor: { kind: 'asset', id: record.id },
                    // 记住当前载体，切到 AI 效果时可直接复用
                    codeBase: { kind: 'asset', id: record.id },
                    ...(record.kind === 'gif' ? { tint: 'original' as const } : {}),
                  };
            });
            syncEffectUI();
            void refreshActorAsset();
            setEffectStatus('');
          },
        },
        [
          h('img', { src: url, alt: '', class: 'h-6 w-6 rounded object-contain' }),
          h('span', { class: 'max-w-[4.5rem] truncate', textContent: record.name }),
          ...(record.kind === 'gif'
            ? [
                h('span', {
                  class:
                    'rounded bg-[var(--accent)] px-1 text-[9px] leading-4 text-[var(--accent-fg)]',
                  textContent: 'GIF',
                }),
              ]
            : []),
        ],
      ) as HTMLButtonElement;
      assetButtons.set(record.id, btn);
      const del = h(
        'button',
        {
          type: 'button',
          'aria-label': `删除素材 ${record.name}`,
          title: '删除此素材（仅本机）',
          class:
            'absolute -right-1.5 -top-1.5 hidden h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500 text-[9px] leading-none text-white shadow group-hover:flex',
          textContent: '✕',
          onclick: (e) => {
            e.stopPropagation();
            void confirmDialog(`确定删除素材「${record.name}」吗？`, {
              title: '删除素材',
              danger: true,
              confirmText: '删除',
            }).then(async (ok) => {
              if (!ok) return;
              await deleteProgressAsset(record.id);
              invalidateActorAssetCache(record.id);
              const cur = opts.progressEffect;
              if (cur?.actor.kind === 'asset' && cur.actor.id === record.id) {
                updateOptions(() => {
                  opts.progressEffect = {
                    ...cur,
                    actor: { kind: 'builtin', id: 'football' },
                    motion: 'roll',
                  };
                });
              } else if (
                cur &&
                isFullEffect(cur) &&
                cur.codeBase?.kind === 'asset' &&
                cur.codeBase.id === record.id
              ) {
                updateOptions(() => {
                  opts.progressEffect = { ...cur, codeBase: null };
                });
              }
              syncEffectUI();
              await rebuildAssetChips();
              await refreshActorAsset();
              setEffectStatus(`已删除素材「${record.name}」。`, 'ok');
            });
          },
        },
        [],
      );
      assetWrap.append(h('div', { class: 'group relative' }, [btn, del]));
    }
    paintEffectActive();
  }

  /** 选择一个 AI 效果代码方案 */
  function selectCustomActor(id: string): void {
    const cur = opts.progressEffect;
    updateOptions(() => {
      opts.progressEffect = {
        ...(cur ?? cloneProgressEffect(DEFAULT_PROGRESS_EFFECT)),
        actor: { kind: 'code', id },
        motion: cur?.motion ?? 'run',
        tint: 'original',
      };
    });
    syncEffectUI();
    void refreshActorAsset();
    setEffectStatus('');
  }

  /** 刷新「AI 效果」chips（删除当前方案时回退内置足球） */
  function rebuildActorChips(): void {
    const items: CustomProgressActor[] = loadCustomActors();
    customActorWrap.replaceChildren();
    customActorWrap.classList.toggle('hidden', items.length === 0);
    actorChipButtons = new Map();
    for (const item of items) {
      const btn = h(
        'button',
        {
          type: 'button',
          'data-actor-code-id': item.id,
          title: `使用 AI 效果「${item.name}」`,
          class:
            'flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-[11px] text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)]',
          onclick: () => selectCustomActor(item.id),
        },
        [
          h('span', {
            class: 'text-[10px] leading-none text-[var(--accent)]',
            textContent: '✨',
          }),
          h('span', { class: 'max-w-[4.5rem] truncate', textContent: item.name }),
        ],
      ) as HTMLButtonElement;
      actorChipButtons.set(item.id, btn);
      const del = h(
        'button',
        {
          type: 'button',
          'aria-label': `删除 AI 效果 ${item.name}`,
          title: '删除此 AI 效果方案',
          class:
            'absolute -right-1.5 -top-1.5 hidden h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500 text-[9px] leading-none text-white shadow group-hover:flex',
          textContent: '✕',
          onclick: (e) => {
            e.stopPropagation();
            void confirmDialog(`确定删除 AI 效果「${item.name}」吗？`, {
              title: '删除 AI 效果',
              danger: true,
              confirmText: '删除',
            }).then(async (ok) => {
              if (!ok) return;
              removeCustomActor(item.id);
              invalidateCustomActorCache(item.id);
              const cur = opts.progressEffect;
              if (cur?.actor.kind === 'code' && cur.actor.id === item.id) {
                fallbackProgressActor('AI 效果已删除，已回退为内置足球。');
              }
              rebuildActorChips();
              await refreshActorAsset();
            });
          },
        },
        [],
      );
      customActorWrap.append(h('div', { class: 'group relative' }, [btn, del]));
    }
    paintEffectActive();
  }

  /** AI 效果代码保存后：选中并刷新 chips */
  function applyActorCode(id: string): void {
    selectCustomActor(id);
    rebuildActorChips();
  }

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

  // —— 片头封面页（歌曲播放前的静态画面；默认不含封面） ——
  const textInputCls =
    'w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]';
  const coverTitleInput = h('input', {
    type: 'text',
    value: opts.coverTitle,
    placeholder: '封面标题（默认取歌曲标题）',
    class: textInputCls,
    oninput: (e) => drawCoverFields(() => (opts.coverTitle = (e.target as HTMLInputElement).value)),
  }) as HTMLInputElement;
  const coverSubtitleInput = h('input', {
    type: 'text',
    value: opts.coverSubtitle,
    placeholder: '副标题，如：2026 单曲 / 歌手名',
    class: textInputCls,
    oninput: (e) =>
      drawCoverFields(() => (opts.coverSubtitle = (e.target as HTMLInputElement).value)),
  }) as HTMLInputElement;
  const coverDescInput = h('textarea', {
    class:
      'w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]',
    rows: 3,
    placeholder: '简介，每行一条，如：\n编曲 / 混音：某某\n出品：某某工作室',
    value: opts.coverDesc,
    oninput: (e) =>
      drawCoverFields(() => (opts.coverDesc = (e.target as HTMLTextAreaElement).value)),
  }) as HTMLTextAreaElement;
  const coverStyleSeg = makeSegment<CoverStyleId>(
    COVER_STYLES.map((s) => ({ id: s.id, label: s.label, hint: s.hint })),
    opts.coverStyle,
    (id) => drawCoverFields(() => (opts.coverStyle = id)),
  );
  const coverDurSel = makeDurSelect(COVER_DUR_CHOICES, opts.coverDur, (v) =>
    updateOptions(() => (opts.coverDur = v)),
  );

  const coverPageInput = h('input', {
    type: 'checkbox',
    class: 'h-4 w-4 accent-[var(--accent)]',
    checked: opts.coverPageEnabled,
    onchange: (e) => {
      updateOptions(() => (opts.coverPageEnabled = (e.target as HTMLInputElement).checked));
      refreshCoverVisibility();
      // 勾选后画一帧封面页给用户即时反馈（取消则回到常规静态帧）
      if (opts.coverPageEnabled) drawPreview(getTimeline().cover / 2);
      else drawStaticFrame();
    },
  }) as HTMLInputElement;
  /** 条件显隐：勾选「片头封面页」才展开标题/副标题/简介/样式/时长 */
  function refreshCoverVisibility(): void {
    coverFields.classList.toggle('hidden', !opts.coverPageEnabled);
  }
  /** 封面字段专用更新：改完直接画封面页（而不是常规静态帧），所见即所得 */
  function drawCoverFields(mutate: () => void): void {
    updateOptions(mutate);
    if (opts.coverPageEnabled) drawPreview(getTimeline().cover / 2);
  }
  const coverFields = h('div', { class: 'hidden space-y-3 pt-1' }, [
    h('div', { class: 'space-y-1.5' }, [fieldLabel('封面标题'), coverTitleInput]),
    h('div', { class: 'space-y-1.5' }, [fieldLabel('副标题'), coverSubtitleInput]),
    h('div', { class: 'space-y-1.5' }, [fieldLabel('简介（每行一条）'), coverDescInput]),
    h('div', { class: 'space-y-2' }, [fieldLabel('封面样式'), coverStyleSeg.wrap]),
    h('div', { class: 'space-y-2' }, [fieldLabel('封面时长'), coverDurSel.wrap]),
  ]);

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
    onchange: (e) => updateOptions(() => (opts.coverSpin = (e.target as HTMLInputElement).checked)),
  }) as HTMLInputElement;

  const accentColorInput = h('input', {
    type: 'color',
    value: opts.accentColor ?? resolveTheme(opts.theme).accent,
    class: 'h-8 w-10 cursor-pointer rounded border border-[var(--border)] bg-[var(--bg)] p-0.5',
    'aria-label': '自定义主色',
    oninput: (e) => {
      updateOptions(() => (opts.accentColor = (e.target as HTMLInputElement).value));
      void refreshActorAsset(); // 染色素材跟随主色
    },
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
        void refreshActorAsset();
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
    oninput: (e) => updateOptions(() => (opts.publisher = (e.target as HTMLInputElement).value)),
  }) as HTMLInputElement;

  const endRollInput = h('input', {
    type: 'checkbox',
    class: 'h-4 w-4 accent-[var(--accent)]',
    checked: opts.endRollEnabled,
    onchange: (e) => {
      updateOptions(() => (opts.endRollEnabled = (e.target as HTMLInputElement).checked));
      endRollText.disabled = !opts.endRollEnabled;
      refreshEndRollVisibility();
      // 勾选/取消会改变总时长（取消时缩短）：校正预览位置并刷新时间显示
      const total = totalDuration();
      if (pausedAt > total) pausedAt = Math.max(0, total - 0.01);
      if (!playing) drawPreview(pausedAt);
      syncTimeUI(pausedAt);
    },
  }) as HTMLInputElement;

  // 片尾字幕显示方式 + 滚动终止位置 + 结束定格
  const endRollModeSeg = makeSegment<EndRollModeId>(
    END_ROLL_MODES.map((m) => ({ id: m.id, label: m.label, hint: m.hint })),
    opts.endRollMode,
    (id) => {
      updateOptions(() => (opts.endRollMode = id));
      refreshEndRollVisibility();
    },
  );
  const endRollStopLabel = h('label', {
    class: 'flex items-center gap-2 text-xs cursor-pointer text-[var(--fg-muted)]',
  });
  const endRollStopInput = h('input', {
    type: 'checkbox',
    class: 'h-3.5 w-3.5 accent-[var(--accent)]',
    checked: opts.endRollStopCenter,
    onchange: (e) => {
      updateOptions(() => (opts.endRollStopCenter = (e.target as HTMLInputElement).checked));
      refreshEndRollVisibility();
    },
  }) as HTMLInputElement;
  endRollStopLabel.append(endRollStopInput, document.createTextNode('滚动至屏幕正中央停止'));
  const endFreezeLabel = h('label', {
    class: 'flex items-center gap-2 text-xs cursor-pointer text-[var(--fg-muted)]',
    title: '视频最后一帧保持显示最终字幕',
  });
  const endFreezeInput = h('input', {
    type: 'checkbox',
    class: 'h-3.5 w-3.5 accent-[var(--accent)]',
    checked: opts.endFreeze,
    onchange: (e) => updateOptions(() => (opts.endFreeze = (e.target as HTMLInputElement).checked)),
  }) as HTMLInputElement;
  endFreezeLabel.append(endFreezeInput, document.createTextNode('结束定格在字幕'));

  /**
   * 片尾子选项条件显隐：
   *   未勾选片尾字幕 → 子选项全部收起；勾选 → 按显示方式展开：
   *   滚动 → 「滚至中央停止」+「结束定格」（贯穿滚出时定格隐藏）；
   *   淡入淡出 / 无动画 → 只显示「结束定格」。
   */
  function refreshEndRollVisibility(): void {
    const on = opts.endRollEnabled;
    endRollModeWrap.classList.toggle('hidden', !on);
    endRollText.classList.toggle('hidden', !on);
    endRollStopLabel.classList.toggle('hidden', !on || opts.endRollMode !== 'roll');
    const meaningless = opts.endRollMode === 'roll' && !opts.endRollStopCenter;
    endFreezeLabel.classList.toggle('hidden', !on || meaningless);
    endFreezeInput.disabled = meaningless;
  }
  const endRollModeWrap = h('div', { class: 'space-y-2' }, [
    endRollModeSeg.wrap,
    endRollStopLabel,
    endFreezeLabel,
  ]);

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
    h('div', { class: 'space-y-2' }, [
      row('结尾动画', h('div', { class: 'space-y-2' }, [outroSeg.wrap, outroDurSel.wrap])),
      h('p', {
        class: 'text-[11px] leading-relaxed text-[var(--fg-muted)]',
        textContent:
          '未勾选片尾字幕时，音乐结束即视频结束（结尾段不占时长）；勾选后按字幕展示需要自动延长。',
      }),
    ]),
    h('label', { class: 'flex items-center gap-2 text-sm cursor-pointer' }, [
      coverSpinInput,
      '专辑封面旋转（唱片效果）',
    ]),
    row(
      '自定义主色',
      h('div', { class: 'flex items-center gap-2' }, [accentColorInput, accentResetBtn]),
    ),
    row('发行者署名', publisherInput),
    h('div', { class: 'space-y-2' }, [
      h('label', { class: 'flex items-center gap-2 text-sm cursor-pointer' }, [
        endRollInput,
        '片尾字幕',
      ]),
      endRollModeWrap,
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

  // ──────────────── AI 生成：自定义频谱 chips + 风格方案 chips ────────────────
  // 💡 向导产出的两类资产：频谱样式（代码执行，⭐ chips）与风格方案（纯 JSON，
  // 渐变色 chips = 配色 + 版式整套应用；主题墙只管配色，二者语义在 UI 上刻意区分）。

  const customVizWrap = h('div', { class: 'flex flex-wrap gap-2' }, []);

  /** 自定义频谱 chips 高亮（选中 cviz: id 或选回内置样式时重画） */
  function paintVizChips(): void {
    for (const b of customVizWrap.querySelectorAll('button[data-viz-id]')) {
      const el = b as HTMLButtonElement;
      const active = el.dataset.vizId === opts.visualizer;
      el.className =
        'rounded-md border px-2.5 py-1.5 text-sm transition-colors ' +
        (active
          ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]'
          : 'border-[var(--border)] bg-[var(--bg)] text-[var(--fg-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]');
    }
  }

  function rebuildVisualizerChips(): void {
    customVizWrap.replaceChildren();
    const items = loadCustomVisualizers();
    customVizWrap.classList.toggle('hidden', items.length === 0);
    for (const item of items) {
      const btn = h(
        'button',
        {
          type: 'button',
          'data-viz-id': item.id,
          title: `自定义频谱样式：${item.name}`,
          class: 'rounded-md border px-2.5 py-1.5 text-sm transition-colors',
          textContent: `⭐ ${item.name}`,
          onclick: () => {
            updateOptions(() => (opts.visualizer = item.id as VisualizerSelection));
            visualizerSeg.set(item.id as VisualizerSelection); // 内置按钮全部取消高亮
            paintVizChips();
          },
        },
        [],
      );
      const del = h(
        'button',
        {
          type: 'button',
          'aria-label': `删除频谱样式 ${item.name}`,
          title: '删除此样式',
          class:
            'absolute -right-1.5 -top-1.5 hidden h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500 text-[9px] leading-none text-white shadow group-hover:flex',
          textContent: '✕',
          onclick: (e) => {
            e.stopPropagation();
            void confirmDialog(`确定删除频谱样式「${item.name}」吗？`, {
              title: '删除频谱样式',
              danger: true,
              confirmText: '删除',
            }).then((ok) => {
              if (!ok) return;
              removeCustomVisualizer(item.id);
              invalidateVisualizerCache(item.id);
              if (opts.visualizer === item.id) {
                updateOptions(() => (opts.visualizer = 'bars'));
                visualizerSeg.set('bars');
              }
              rebuildVisualizerChips();
            });
          },
        },
        [],
      );
      customVizWrap.append(h('div', { class: 'group relative' }, [btn, del]));
    }
    paintVizChips();
  }

  const styleWrap = h('div', { class: 'flex flex-wrap gap-2' }, []);

  /** 应用一份风格方案：按方案配色创建/覆盖同名自定义主题 + 合并版式选项 + 全量刷新控件 */
  function applyParsedStyle(s: ParsedStyle): void {
    updateOptions(() => {
      const items = addCustomTheme(
        s.name,
        s.colors.bg1,
        s.colors.bg2,
        s.colors.fg,
        s.colors.accent,
      );
      const saved = items.find((it) => it.name.trim() === s.name.trim());
      if (saved) {
        opts.theme = saved.id;
        opts.accentColor = null; // 方案主色即主题主色，清掉旧覆盖色
      }
      Object.assign(opts, styleOptionPatches({ id: '', createdAt: 0, ...s, ...s.colors }));
    });
    // 同步各控件高亮与条件显隐（updateOptions 只重画布，不刷控件）
    rebuildThemeButtons();
    visualizerSeg.set(opts.visualizer);
    lyricSeg.set(opts.lyricMode);
    progressSeg.set(opts.progressBar);
    introSeg.set(opts.introAnim);
    outroSeg.set(opts.outroAnim);
    coverStyleSeg.set(opts.coverStyle);
    refreshLyricVisibility();
    accentColorInput.value = resolveTheme(opts.theme).accent;
    rebuildVisualizerChips();
    rebuildStyleChips();
    void refreshActorAsset();
  }

  /** 存储态方案 → ParsedStyle 后走统一应用路径 */
  function applyStoredStyle(stored: CustomStyle): void {
    applyParsedStyle({
      name: stored.name,
      colors: { bg1: stored.bg1, bg2: stored.bg2, fg: stored.fg, accent: stored.accent },
      ...(stored.visualizer !== undefined ? { visualizer: stored.visualizer } : {}),
      ...(stored.lyricMode !== undefined ? { lyricMode: stored.lyricMode } : {}),
      ...(stored.progressBar !== undefined ? { progressBar: stored.progressBar } : {}),
      ...(stored.introAnim !== undefined ? { introAnim: stored.introAnim } : {}),
      ...(stored.outroAnim !== undefined ? { outroAnim: stored.outroAnim } : {}),
      ...(stored.coverStyle !== undefined ? { coverStyle: stored.coverStyle } : {}),
    });
  }

  function rebuildStyleChips(): void {
    styleWrap.replaceChildren();
    const items = loadCustomStyles();
    styleWrap.classList.toggle('hidden', items.length === 0);
    for (const item of items) {
      const btn = h(
        'button',
        {
          type: 'button',
          title: `应用风格方案：${item.name}（配色 + 版式整套；同名主题会被覆盖）`,
          class:
            'flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
          onclick: () => applyStoredStyle(item),
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
              removeCustomStyle(item.id);
              rebuildStyleChips();
            });
          },
        },
        [],
      );
      styleWrap.append(h('div', { class: 'group relative' }, [btn, del]));
    }
  }

  const aiDialogs = createAiDialogs({
    getTheme: () => resolveTheme(opts.theme),
    onVisualizerApplied: (id) => {
      updateOptions(() => (opts.visualizer = id as VisualizerSelection));
      visualizerSeg.set(id as VisualizerSelection);
      rebuildVisualizerChips();
    },
    onStyleApplied: applyParsedStyle,
    onEffectApplied: (id) => applyActorCode(id),
  });
  openEffectDialogRef = () => aiDialogs.openEffectDialog();

  const aiVizBtn = h(
    'button',
    {
      type: 'button',
      class:
        'rounded-md px-1 text-base leading-none text-[var(--fg-muted)] transition-colors hover:text-[var(--accent)]',
      title: '用 AI 生成自定义频谱样式：描述效果 → 生成提示词 → 粘贴代码 → 合成频谱演播后保存',
      'aria-label': '用 AI 生成自定义频谱样式',
      textContent: '💡',
      onclick: () => aiDialogs.openVisualizerDialog(),
    },
    [],
  );
  const aiStyleBtn = h(
    'button',
    {
      type: 'button',
      class:
        'rounded-md px-1 text-base leading-none text-[var(--fg-muted)] transition-colors hover:text-[var(--accent)]',
      title: '用 AI 生成整套风格方案：配色主题 + 版式选项一次配齐',
      'aria-label': '用 AI 生成整套风格方案',
      textContent: '💡',
      onclick: () => aiDialogs.openStyleDialog(),
    },
    [],
  );
  rebuildVisualizerChips();
  rebuildStyleChips();

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
    generateBtn.disabled = !audio || recording;
    generateBtn.title = audio ? '' : '请先选择音乐文件';
  }

  async function generate(): Promise<void> {
    if (!audio || recording) return;
    // 生成前确认：实时渲染期间必须保持本页面前台，明确提醒避免成片掉帧
    const ok = await confirmDialog(
      `为保障视频质量，生成过程中请保持本页面在前台（切换标签页 / 最小化窗口会导致掉帧）。` +
        `生成期间将自动阻止屏幕保护、熄屏与休眠` +
        `${isWakeLockSupported() ? '' : '（当前浏览器不支持防休眠，请注意系统电源设置）'}。` +
        `实时渲染约需 ${Math.ceil(totalDuration())} 秒，是否开始？`,
      { title: '开始生成视频', confirmText: '开始生成' },
    );
    if (!ok) return;
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
    const fname = `${sanitizeFilePart(opts.titleText.trim() || audio.name, 60) || 'song-video'}.${result.ext}`;
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
        h('div', { class: 'space-y-2' }, [
          h('div', { class: 'flex items-center justify-between gap-2' }, [
            fieldLabel('音频可视化'),
            aiVizBtn,
          ]),
          visualizerSeg.wrap,
          customVizWrap,
        ]),
        h('div', { class: 'space-y-3' }, [
          fieldLabel('歌词显示'),
          lyricSeg.wrap,
          lyricFadeRow,
          lyricListRow,
        ]),
        row('配色主题', themeWrap),
        h('div', { class: 'space-y-2' }, [
          h('div', { class: 'flex items-center justify-between gap-2' }, [
            fieldLabel('AI 风格方案'),
            aiStyleBtn,
          ]),
          styleWrap,
          h('p', {
            class: 'text-[11px] leading-relaxed text-[var(--fg-muted)]',
            textContent:
              '点击应用整套「配色 + 版式」；方案会以同名存入上方自定义主题（仅配色），删除方案不影响主题。',
          }),
        ]),
        progressStyleRow,
        effectSection,
        h('div', { class: 'space-y-1.5' }, [
          h('label', { class: 'flex items-center gap-2 text-sm cursor-pointer' }, [
            titleCheckbox,
            '显示标题',
          ]),
          titleInput,
        ]),
        h('div', { class: 'space-y-2' }, [
          h('label', { class: 'flex items-center gap-2 text-sm cursor-pointer' }, [
            coverPageInput,
            '片头封面页',
          ]),
          h('p', {
            class: 'text-[11px] text-[var(--fg-muted)]',
            textContent: '歌曲播放前的静态画面（片头）',
          }),
          coverFields,
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
        '全部处理在本浏览器完成：音乐 / 图片不会上传服务器；设置会记忆在本机（文件不记忆，下次需重新选择）。渲染期间请保持本页面在前台。',
    }),
  );

  // 初始：应用画布比例 + 无音频画一帧静态示意 + 按钮态对齐 + 条件显隐初态
  applyAspectToCanvas();
  syncPlayBtn();
  syncTimeUI(0);
  drawStaticFrame();
  updateGenerateState();
  refreshLyricVisibility();
  refreshEndRollVisibility();
  refreshCoverVisibility();
  syncEffectUI();
  rebuildActorChips();
  void rebuildAssetChips();
  void refreshActorAsset(); // 内置精灵/上传素材异步载入后补画一帧
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
