import '@/core/styles/main.css';
import './styles.css';

import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { confirmDialog } from '@/core/components/Dialog';
import { downloadText } from '@/core/utils/clipboard';
import { sanitizeFilePart } from '@/core/utils/download';
import { AudioPlayer } from './player';
import { loadAudioFile, stripExt, type LoadedAudio } from './audio';
import {
  linesInRange,
  parseLyrics,
  serializeLyrics,
  suggestLineRange,
  type LyricDocument,
  type LyricFormat,
  type LyricLine,
} from './lyrics';
import {
  computeSpectrogram,
  normalizeView,
  type SpectrogramData,
  type TimeRange,
} from './spectrogram';
import { Timeline, type TimelineMode } from './timeline';
import {
  clearDraft,
  loadDraft,
  loadOptions,
  saveDraft,
  saveOptions,
  type LyricDraft,
} from './settings';

initTheme();

const { content } = renderToolLayout(document.getElementById('app')!, '歌词校准');

const MIN_LINE_DURATION = 0.02;
const options = loadOptions();
const restoredDraft = loadDraft();
let lyricDoc: LyricDocument = restoredDraft?.document ?? {
  format: 'lrc',
  fileName: '歌词.lrc',
  metadata: {},
  lines: [],
};
let selectedId = restoredDraft?.selectedId ?? null;
let selection: TimeRange | null = restoredDraft?.selection ?? null;
let audioName = restoredDraft?.audioName ?? null;
let mode: TimelineMode = selectedId ? 'line' : 'range';
let audio: LoadedAudio | null = null;
let spectrum: SpectrogramData | null = null;
let spectrumReady = false;
let playhead = 0;
let loadToken = 0;
let currentPlayingId: string | null = null;

interface LyricRowRefs {
  /** 行容器（div role=button），行内操作按钮避免按钮嵌套 */
  row: HTMLDivElement;
  /** 歌词文本 span，双击编辑时与输入框互换 */
  text: HTMLSpanElement;
  time: HTMLSpanElement;
  play: HTMLButtonElement;
  index: number;
}
const rowMap = new Map<string, LyricRowRefs>();
/** 当前「正在发声」的行（is-playing 高亮 + 暂停图标只由它驱动）；null 表示无声。 */
let soundingRowId: string | null = null;
/** 句内试听的行：到达句尾自动暂停（循环选区开启时改为循环本句）。 */
let auditionLineId: string | null = null;
/** 点击行内播放后、音频真正启动前的乐观高亮行，让暂停形态即刻出现。 */
let pendingSoundId: string | null = null;
/** 正在进行的单句文字编辑；同一时间至多一处。 */
let activeEdit: { id: string; input: HTMLInputElement } | null = null;
let lineIdSeed = 0;
const PLACEHOLDER_TEXT = '（待填写）';

const player = new AudioPlayer({
  getLoopRange: () => (options.loop ? selection : null),
  getStopAt: () => {
    if (!auditionLineId) return null;
    const line = lyricDoc.lines.find((item) => item.id === auditionLineId);
    return line ? line.end : null;
  },
  onTick: (time, playing) => {
    playhead = time;
    // 先确定播放头所在行，再刷新按钮；否则启动瞬间会用到上一句或空值，撤掉刚亮起的暂停形态。
    updatePlayingLine(time);
    if (playing) pendingSoundId = null;
    updatePlaybackUI(playing);
    renderTimelines();
  },
});

/** 行内播放是句内试听：换到其它播放入口（主键/选区/频谱定位/选句）即恢复连续播放。 */
function clearAudition(): void {
  auditionLineId = null;
  pendingSoundId = null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatTime(value: number, milliseconds = true): string {
  const total = Math.round(Math.max(0, Number.isFinite(value) ? value : 0) * 1000);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor(total / 1000) % 60;
  const ms = total % 1000;
  const base = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return milliseconds ? `${base}.${String(ms).padStart(3, '0')}` : base;
}

function parseTimeInput(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes >= 60 || seconds >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function selectedLine(): LyricLine | null {
  return lyricDoc.lines.find((line) => line.id === selectedId) ?? null;
}

function activeDuration(): number {
  return audio?.duration ?? Number.MAX_SAFE_INTEGER;
}

function setStatus(message: string, kind: 'normal' | 'error' | 'success' = 'normal'): void {
  statusText.textContent = message;
  statusText.classList.toggle('ls-status-error', kind === 'error');
  statusText.classList.toggle('ls-status-success', kind === 'success');
}

function detailWindow(): TimeRange | null {
  if (!audio) return null;
  if (!selection) {
    const half = Math.min(6, Math.max(2, audio.duration / 8));
    return normalizeView(playhead - half, playhead + half, audio.duration);
  }
  const length = selection.end - selection.start;
  const padding = Math.max(0.65, length * 0.35);
  return normalizeView(selection.start - padding, selection.end + padding, audio.duration);
}

/** 频谱就绪状态：概览画布常显，局部画布需同时满足精确辅助开启。 */
function setSpectrumReady(ready: boolean): void {
  spectrumReady = ready;
  overview.el.classList.toggle('hidden', !ready);
  detail.el.classList.toggle('hidden', !(ready && options.precise));
}

/**
 * 依据精确辅助重排频谱区：
 * 开启 → 概览面板（随页滚动）+ 吸附面板（局部频谱 + 播放条，滚动时吸顶）；
 * 关闭 → 仅吸附面板（全曲频谱 + 播放条，滚动时吸顶）。
 */
function applyPreciseLayout(): void {
  const precise = options.precise;
  overviewPanel.classList.toggle('hidden', !precise);
  detail.el.classList.toggle('hidden', !(spectrumReady && precise));
  overview.el.classList.toggle('hidden', !spectrumReady);
  dockTitle.textContent = precise ? '局部精细频谱' : '全曲频谱';
  dockHint.textContent = precise
    ? '同一选区 · 更高时间密度 · ← / → 键微移'
    : '拖动创建选区 · 拖动中部移动 · 两端手柄调起止';
  detailWindowBadge.classList.toggle('hidden', !precise);
  if (precise) {
    overviewBody.append(overviewSlot);
    dockBody.replaceChildren(detail.el);
    overviewHead.append(spectrumHeadStatus);
  } else {
    dockBody.replaceChildren(overviewSlot);
    dockHeadLeft.append(spectrumHeadStatus);
  }
}

function draftSnapshot(): LyricDraft {
  return {
    document: lyricDoc,
    selectedId,
    selection: selection ? { ...selection } : null,
    audioName,
    savedAt: Date.now(),
  };
}

function persistDraft(): void {
  if (lyricDoc.lines.length === 0) return;
  const ok = saveDraft(draftSnapshot());
  saveStatus.textContent = ok
    ? `已自动保存 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : '自动保存失败，请立即导出歌词备份';
  saveStatus.classList.toggle('ls-status-error', !ok);
}

function makeDropzone(
  kind: 'audio' | 'lyrics',
  onFile: (file: File) => void,
): {
  el: HTMLButtonElement;
  input: HTMLInputElement;
  title: HTMLSpanElement;
  subtitle: HTMLSpanElement;
} {
  const title = h('span', {
    class: 'block truncate text-sm font-medium text-[var(--fg)]',
    textContent: kind === 'audio' ? '选择或拖入歌曲' : '选择或拖入歌词',
  });
  const subtitle = h('span', {
    class: 'mt-1 block text-xs leading-relaxed text-[var(--fg-muted)]',
    textContent: kind === 'audio' ? 'MP3 / WAV / M4A / OGG' : 'LRC / SRT · 句级时间轴',
  });
  const input = h('input', {
    type: 'file',
    class: 'hidden',
    accept: kind === 'audio' ? '.mp3,.wav,.m4a,.ogg,.flac,audio/*' : '.lrc,.srt,text/plain',
    'aria-hidden': 'true',
  }) as HTMLInputElement;
  const el = h(
    'button',
    {
      type: 'button',
      class: 'ls-dropzone',
      'aria-label': kind === 'audio' ? '载入歌曲' : '载入 LRC 或 SRT 歌词',
      onclick: () => input.click(),
    },
    [
      h('span', { class: 'ls-file-icon', textContent: kind === 'audio' ? '🎵' : '💬' }),
      h('span', { class: 'min-w-0 flex-1' }, [title, subtitle]),
      h('span', { class: 'shrink-0 text-sm text-[var(--accent)]', textContent: '浏览 →' }),
    ],
  );
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) onFile(file);
  });
  el.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    el.classList.add('is-dragover');
  });
  el.addEventListener('dragleave', () => el.classList.remove('is-dragover'));
  el.addEventListener('drop', (event) => {
    event.preventDefault();
    el.classList.remove('is-dragover');
    const file = event.dataTransfer?.files[0];
    if (file) onFile(file);
  });
  return { el, input, title, subtitle };
}

const audioPicker = makeDropzone('audio', (file) => void handleAudio(file));
const lyricPicker = makeDropzone('lyrics', (file) => void handleLyrics(file));

const playButton = h('button', {
  type: 'button',
  class: 'ls-transport-btn ls-transport-play',
  textContent: '▶',
  'aria-label': '播放',
  title: '播放 / 暂停（空格键）',
  onclick: () => void togglePlayback(),
});
const previousButton = h('button', {
  type: 'button',
  class: 'ls-transport-btn',
  textContent: '⏮',
  'aria-label': '上一句',
  title: '上一句',
  onclick: () => stepLine(-1),
});
const nextButton = h('button', {
  type: 'button',
  class: 'ls-transport-btn',
  textContent: '⏭',
  'aria-label': '下一句',
  title: '下一句',
  onclick: () => stepLine(1),
});
const auditionButton = h('button', {
  type: 'button',
  class: 'ls-chip',
  textContent: '▶ 试听选区',
  title: '从当前选区开头开始播放',
  onclick: () => void playSelection(),
});
const loopButton = h('button', {
  type: 'button',
  class: 'ls-chip',
  textContent: '🔁 循环选区',
  'aria-pressed': String(options.loop),
  title: '播放到选区结尾后自动循环',
  onclick: () => {
    options.loop = !options.loop;
    loopButton.setAttribute('aria-pressed', String(options.loop));
    loopButton.classList.toggle('is-on', options.loop);
    if (!saveOptions(options)) setStatus('循环设置无法保存，但本次仍可继续使用', 'error');
  },
});
loopButton.classList.toggle('is-on', options.loop);
const timeDisplay = h('span', {
  class: 'ls-transport-time font-mono text-xs text-slate-300 tabular-nums',
  textContent: '00:00.000 / 00:00.000',
});
const preciseInput = h('input', {
  type: 'checkbox',
  class: 'h-4 w-4 accent-[var(--accent)]',
  checked: options.precise,
  onchange: () => {
    options.precise = preciseInput.checked;
    applyPreciseLayout();
    if (!saveOptions(options)) setStatus('精确辅助设置无法保存', 'error');
    renderTimelines();
  },
}) as HTMLInputElement;

const rangeModeButton = h('button', {
  type: 'button',
  class: 'ls-mode-btn',
  textContent: '范围选择',
  'aria-pressed': 'true',
  onclick: () => switchMode('range'),
});
const lineModeButton = h('button', {
  type: 'button',
  class: 'ls-mode-btn',
  textContent: '单句校准',
  'aria-pressed': 'false',
  onclick: () => switchMode('line'),
});

const spectrumProgress = h('div', { class: 'ls-progress-track mt-2 hidden' });
const spectrumProgressBar = h('div', { class: 'ls-progress-bar', style: 'width:0%' });
spectrumProgress.append(spectrumProgressBar);
const spectrumHeadStatus = h('span', {
  class: 'ml-2 text-xs text-slate-400',
  textContent: '等待载入歌曲',
});
const detailWindowBadge = h('span', {
  class:
    'hidden rounded-full border border-indigo-400/30 bg-indigo-400/10 px-2 py-0.5 text-[11px] text-indigo-200',
  textContent: '局部窗口已联动',
});
const spectrumEmpty = h('div', { class: 'px-5 py-12 text-center' }, [
  h('div', { class: 'text-3xl', textContent: '〰️' }),
  h('p', {
    class: 'mt-3 text-sm font-medium text-slate-200',
    textContent: restoredDraft ? '歌词编辑现场已恢复' : '载入歌曲后，在这里查看全曲频谱',
  }),
  h('p', {
    class: 'mx-auto mt-2 max-w-lg text-xs leading-relaxed text-slate-400',
    textContent: restoredDraft
      ? `已保留 ${lyricDoc.lines.length} 句歌词的时间标记。重新载入${audioName ? `「${audioName}」` : '原歌曲'}即可继续频谱校准；也可以直接导出当前歌词。`
      : '歌曲只在本地解码。频谱生成后即可拖选范围、定位播放和逐句校准。',
  }),
]);

const overview = new Timeline('overview', {
  onSeek: (time) => {
    clearAudition();
    player.seek(time);
  },
  onSelectionChange: applySelection,
});
const detail = new Timeline('detail', {
  onSeek: (time) => {
    clearAudition();
    player.seek(time);
  },
  onSelectionChange: applySelection,
});

// 频谱区拆成两块面板：概览面板只在精确辅助开启时出现（随页面滚动），
// 吸附面板（ls-dock）常驻并吸顶——精确辅助开时承载局部频谱，关时承载全曲频谱，
// 播放控制条始终位于吸附面板底部，即频谱正下方。
const overviewSlot = h('div', {}, [
  h('div', { class: 'px-4 pt-3' }, [spectrumProgress]),
  spectrumEmpty,
  overview.el,
]);
const overviewHead = h('div', { class: 'ls-spectrum-head' }, [
  h('div', { class: 'flex items-center gap-2' }, [
    h('span', { class: 'text-xs font-medium text-slate-200', textContent: '全曲频谱' }),
    detailWindowBadge,
  ]),
]);
const overviewBody = h('div', {});
const overviewPanel = h('section', { class: 'ls-spectrum-panel hidden' }, [
  overviewHead,
  overviewBody,
]);

const dockTitle = h('span', { class: 'text-xs font-medium text-slate-200' });
const dockHint = h('span', { class: 'ml-2 text-[11px] text-slate-500' });
const dockHeadLeft = h('div', { class: 'flex min-w-0 flex-wrap items-center' }, [
  dockTitle,
  dockHint,
]);
const transportBar = h('div', { class: 'ls-transport' }, [
  h('div', { class: 'flex items-center gap-1.5' }, [previousButton, playButton, nextButton]),
  timeDisplay,
  h('div', { class: 'ms-auto flex flex-wrap items-center gap-1.5' }, [auditionButton, loopButton]),
]);
const dockBody = h('div', {});
const dockPanel = h('section', { class: 'ls-spectrum-panel ls-dock' }, [
  h('div', { class: 'ls-spectrum-head' }, [
    dockHeadLeft,
    h('div', { class: 'flex flex-wrap items-center gap-2' }, [
      h('div', { class: 'flex rounded-lg bg-slate-800/70 p-1' }, [rangeModeButton, lineModeButton]),
      h('label', { class: 'flex cursor-pointer items-center gap-2 text-xs text-slate-300' }, [
        preciseInput,
        '精确选择辅助',
      ]),
    ]),
  ]),
  dockBody,
  transportBar,
]);

const lyricCount = h('span', {
  class: 'rounded-full bg-[var(--bg)] px-2.5 py-1 text-xs text-[var(--fg-muted)]',
  textContent: '0 句',
});
const rangeCount = h('span', {
  class: 'text-xs text-[var(--fg-muted)]',
  textContent: '尚未选择范围',
});
const saveStatus = h('span', {
  class: 'text-xs text-[var(--fg-muted)]',
  textContent: restoredDraft ? '已恢复上次编辑现场' : '编辑后自动保存',
});
const lyricsList = h('div', { class: 'ls-lyrics-scroll p-2' });
const headerAddButton = h('button', {
  type: 'button',
  class: 'ls-btn min-h-8 px-2.5 py-1 text-xs',
  textContent: '＋ 新增一句',
  title: '在末尾新增一句；还没有歌词时用于创建第一句',
  onclick: () => addLineAfter(null),
});
const lyricsEmpty = h('div', { class: 'px-5 py-12 text-center' }, [
  h('div', { class: 'text-3xl', textContent: '🎤' }),
  h('p', { class: 'mt-3 text-sm font-medium', textContent: '载入 LRC / SRT，或逐句手动创建' }),
  h('p', {
    class: 'mt-2 text-xs leading-relaxed text-[var(--fg-muted)]',
    textContent:
      '没有歌词文件也没关系：载入歌曲后从播放头位置逐句新增，双击填写文字，最后导出即可。',
  }),
  h('div', { class: 'mt-4 flex justify-center' }, [
    h('button', {
      type: 'button',
      class: 'ls-btn',
      textContent: '＋ 手动新增第一句',
      onclick: () => addLineAfter(null),
    }),
  ]),
]);

const inspectorText = h('p', {
  class:
    'min-h-12 rounded-lg bg-[var(--bg)] px-3 py-2.5 text-sm leading-relaxed text-[var(--fg-muted)]',
  textContent: '从歌词列表选择一句开始校准',
});
const startInput = h('input', {
  type: 'text',
  class: 'ls-time-input',
  value: '00:00.000',
  'aria-label': '当前句开始时间',
  inputmode: 'decimal',
}) as HTMLInputElement;
const endInput = h('input', {
  type: 'text',
  class: 'ls-time-input',
  value: '00:00.000',
  'aria-label': '当前句结束时间',
  inputmode: 'decimal',
}) as HTMLInputElement;
const lineDurationLabel = h('p', {
  class: 'text-xs text-[var(--fg-muted)]',
  textContent: '选区时长 —',
});
const nudgeButtons: HTMLButtonElement[] = [];

function makeTimeEditor(
  label: string,
  input: HTMLInputElement,
  edge: 'start' | 'end',
): HTMLElement {
  const commit = (): void => commitTimeInput(input, edge);
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      // 主动提交，不依赖个别浏览器在程序化编辑后是否补发 change。
      commit();
      input.blur();
    } else if (event.key === 'Escape') {
      updateInspector();
      input.blur();
    }
  });
  const minus = h('button', {
    type: 'button',
    class: 'ls-btn min-h-8 px-2 py-1 text-xs',
    textContent: '−10ms',
    'aria-label': `${label}提前 10 毫秒`,
    onclick: () => nudgeLine(edge, -0.01),
  });
  const plus = h('button', {
    type: 'button',
    class: 'ls-btn min-h-8 px-2 py-1 text-xs',
    textContent: '+10ms',
    'aria-label': `${label}延后 10 毫秒`,
    onclick: () => nudgeLine(edge, 0.01),
  });
  nudgeButtons.push(minus, plus);
  return h('div', {}, [
    h('label', {
      class: 'mb-1.5 block text-xs font-medium text-[var(--fg-muted)]',
      textContent: label,
    }),
    h('div', { class: 'flex items-center gap-2' }, [input]),
    h('div', { class: 'mt-2 flex gap-1.5' }, [minus, plus]),
  ]);
}

const exportFormat = h(
  'select',
  {
    class:
      'min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
    'aria-label': '导出歌词格式',
  },
  [
    h('option', { value: 'lrc', textContent: 'LRC 歌词' }),
    h('option', { value: 'srt', textContent: 'SRT 字幕' }),
  ],
) as HTMLSelectElement;
const exportButton = h('button', {
  type: 'button',
  class: 'ls-btn ls-btn-primary',
  textContent: '↓ 导出',
  onclick: exportLyrics,
});
const clearButton = h('button', {
  type: 'button',
  class: 'ls-btn w-full text-xs hover:!border-red-400 hover:!text-red-500',
  textContent: '清空当前歌词与草稿',
  onclick: () => void clearWorkspace(),
});
const statusText = h('p', {
  class: 'min-h-5 text-xs leading-relaxed text-[var(--fg-muted)]',
  role: 'status',
  textContent: '文件仅在浏览器本地处理，不会上传。',
});

const fileCard = h('section', { class: 'ls-card p-4 sm:p-5' }, [
  h('div', { class: 'mb-4 flex flex-wrap items-center justify-between gap-2' }, [
    h('div', {}, [
      h('h2', { class: 'text-sm font-semibold', textContent: '准备素材' }),
      h('p', {
        class: 'mt-1 text-xs text-[var(--fg-muted)]',
        textContent: '歌曲与歌词可分别载入，顺序不限',
      }),
    ]),
    h('span', { class: 'text-xs text-[var(--fg-muted)]', textContent: '🔒 本地处理 · 不上传' }),
  ]),
  h('div', { class: 'grid gap-3 md:grid-cols-2' }, [
    audioPicker.el,
    audioPicker.input,
    lyricPicker.el,
    lyricPicker.input,
  ]),
]);

const lyricsCard = h('section', { class: 'ls-card min-w-0 overflow-hidden' }, [
  h('div', { class: 'border-b border-[var(--border)] px-4 py-4' }, [
    h('div', { class: 'flex flex-wrap items-center justify-between gap-2' }, [
      h('div', { class: 'flex items-center gap-2' }, [
        h('h2', { class: 'text-sm font-semibold', textContent: '歌词时间轴' }),
        lyricCount,
        headerAddButton,
      ]),
      saveStatus,
    ]),
    h('div', { class: 'mt-2' }, [rangeCount]),
  ]),
  lyricsEmpty,
  lyricsList,
]);

const inspectorCard = h('aside', { class: 'ls-card h-fit p-4 lg:sticky lg:top-5' }, [
  h('h2', { class: 'text-sm font-semibold', textContent: '当前句校准' }),
  h('div', { class: 'mt-3' }, [inspectorText]),
  h('div', { class: 'mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2' }, [
    makeTimeEditor('开始时间', startInput, 'start'),
    makeTimeEditor('结束时间', endInput, 'end'),
  ]),
  h('div', { class: 'mt-3' }, [lineDurationLabel]),
  h('div', { class: 'my-5 border-t border-[var(--border)]' }),
  h('h3', { class: 'text-sm font-semibold', textContent: '导出校准结果' }),
  h('p', {
    class: 'mt-1 text-xs leading-relaxed text-[var(--fg-muted)]',
    textContent: '默认沿用原格式，也可相互转换。SRT 会保留独立结束时间。',
  }),
  h('div', { class: 'mt-3 flex gap-2' }, [exportFormat, exportButton]),
  h('div', { class: 'mt-4' }, [clearButton]),
]);

content.append(
  h('div', { class: 'space-y-5' }, [
    h('p', {
      class: '-mt-3 text-sm leading-relaxed text-[var(--fg-muted)]',
      textContent: '对照真实声谱，把每一句歌词放回它准确的时间位置。',
    }),
    fileCard,
    // 吸顶的参照容器：频谱面板与歌词区同处一个纵向区块，滚动歌词时吸附面板保持可见。
    h('div', { class: 'space-y-5' }, [
      overviewPanel,
      dockPanel,
      h('div', { class: 'grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]' }, [
        lyricsCard,
        inspectorCard,
      ]),
    ]),
    h('div', { class: 'px-1' }, [statusText]),
  ]),
);

async function handleAudio(file: File): Promise<void> {
  const token = ++loadToken;
  player.setBuffer(null);
  audio = null;
  spectrum = null;
  playhead = 0;
  overview.setData(null);
  detail.setData(null);
  setSpectrumReady(false);
  spectrumEmpty.classList.remove('hidden');
  spectrumHeadStatus.textContent = '正在解码音频…';
  spectrumProgress.classList.remove('hidden');
  spectrumProgressBar.style.width = '2%';
  setStatus(`正在读取「${file.name}」…`);
  updateFileUI();
  updatePlaybackUI(false);

  try {
    const loaded = await loadAudioFile(file);
    if (token !== loadToken) return;
    audio = loaded;
    audioName = loaded.fileName;
    player.setBuffer(loaded.buffer);
    setStatus(`已载入「${loaded.name}」，正在生成频谱…`);
    updateFileUI();
    persistDraft();
    const data = await computeSpectrogram(
      loaded.buffer,
      (progress) => {
        if (token !== loadToken) return;
        spectrumProgressBar.style.width = `${Math.round(progress * 100)}%`;
        spectrumHeadStatus.textContent = `正在生成频谱 · ${Math.round(progress * 100)}%`;
      },
      () => token !== loadToken,
    );
    if (token !== loadToken) return;
    spectrum = data;
    overview.setData(data);
    detail.setData(data);
    spectrumProgress.classList.add('hidden');
    spectrumEmpty.classList.add('hidden');
    setSpectrumReady(true);
    spectrumHeadStatus.textContent = `${formatTime(loaded.duration, false)} · ${data.columns} 帧`;
    setStatus('频谱已就绪。拖动选择范围，或点击歌词开始逐句校准。', 'success');
    renderTimelines();
    updateButtons();
  } catch (error) {
    if (token !== loadToken) return;
    spectrumProgress.classList.add('hidden');
    spectrumHeadStatus.textContent = audio ? '频谱生成失败' : '等待载入歌曲';
    setStatus(error instanceof Error ? error.message : '音频处理失败，请重试', 'error');
    updateFileUI();
    updateButtons();
  }
}

async function handleLyrics(file: File): Promise<void> {
  try {
    const raw = await file.text();
    const next = parseLyrics(raw, file.name, audio?.duration);
    if (lyricDoc.lines.length > 0) {
      const replace = await confirmDialog(
        '导入新歌词会替换当前歌词与校准结果。建议先导出备份，确定继续吗？',
        {
          title: '替换当前歌词',
          confirmText: '替换',
          danger: true,
        },
      );
      if (!replace) return;
    }
    lyricDoc = next;
    selectedId = next.lines[0]?.id ?? null;
    const first = next.lines[0];
    selection = first ? { start: first.start, end: first.end } : null;
    mode = 'line';
    exportFormat.value = next.format;
    buildLyricList();
    setStatus(`已解析 ${next.lines.length} 句歌词，点击任意句即可校准。`, 'success');
    persistDraft();
    renderAll();
    if (audio && first) player.seek(first.start);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '歌词读取失败，请检查文件', 'error');
  }
}

function applySelection(range: TimeRange, final: boolean): void {
  selection = { start: range.start, end: range.end };
  if (mode === 'line' && selectedId) {
    const line = selectedLine();
    if (line) {
      line.start = range.start;
      line.end = range.end;
      const row = rowMap.get(line.id);
      if (row) {
        row.time.textContent = `${formatTime(line.start)} → ${formatTime(line.end)}`;
        const index = lyricDoc.lines.indexOf(line);
        row.row.setAttribute(
          'aria-label',
          `第 ${index + 1} 句，${line.text}，${formatTime(line.start)}`,
        );
      }
    }
  } else {
    selectedId = null;
  }
  saveStatus.textContent = final ? saveStatus.textContent : '正在编辑…';
  refreshLyricSelection();
  updateInspector();
  renderTimelines();
  if (final) persistDraft();
}

function switchMode(next: TimelineMode): void {
  mode = next;
  if (mode === 'range') {
    selectedId = null;
  } else {
    const line =
      selectedLine() ??
      lyricDoc.lines.find((item) => playhead >= item.start && playhead < item.end) ??
      lyricDoc.lines[0];
    if (line) {
      selectedId = line.id;
      selection = { start: line.start, end: line.end };
      if (audio) {
        clearAudition();
        player.seek(line.start);
      }
    }
  }
  refreshLyricSelection();
  updateModeUI();
  updateInspector();
  renderTimelines();
  persistDraft();
}

function selectLine(id: string, seek = true): void {
  const line = lyricDoc.lines.find((item) => item.id === id);
  if (!line) return;
  mode = 'line';
  selectedId = id;
  selection = { start: line.start, end: line.end };
  if (audio && seek) {
    clearAudition();
    player.seek(line.start);
  }
  updateModeUI();
  refreshLyricSelection();
  updateInspector();
  renderTimelines();
  persistDraft();
  rowMap.get(id)?.row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function stepLine(direction: -1 | 1): void {
  if (lyricDoc.lines.length === 0) return;
  const current = lyricDoc.lines.findIndex((line) => line.id === selectedId);
  const fallback = lyricDoc.lines.findIndex((line) => line.start > playhead);
  const base = current >= 0 ? current : fallback >= 0 ? fallback - 1 : lyricDoc.lines.length - 1;
  const index = clamp(base + direction, 0, lyricDoc.lines.length - 1);
  const line = lyricDoc.lines[index];
  if (line) selectLine(line.id);
}

function commitTimeInput(input: HTMLInputElement, edge: 'start' | 'end'): void {
  const line = selectedLine();
  if (!line || mode !== 'line') {
    updateInspector();
    return;
  }
  const value = parseTimeInput(input.value);
  if (value === null || !Number.isFinite(value)) {
    setStatus('时间格式无效，请输入如 01:23.450 或秒数 83.45', 'error');
    updateInspector();
    return;
  }
  const duration = activeDuration();
  const next = { start: line.start, end: line.end };
  if (edge === 'start')
    next.start = clamp(value, 0, Math.min(line.end - MIN_LINE_DURATION, duration));
  else next.end = clamp(value, line.start + MIN_LINE_DURATION, duration);
  applySelection(next, true);
  setStatus('已更新当前句时间', 'success');
}

function nudgeLine(edge: 'start' | 'end', delta: number): void {
  const line = selectedLine();
  if (!line || mode !== 'line') return;
  const next = { start: line.start, end: line.end };
  if (edge === 'start')
    next.start = clamp(
      next.start + delta,
      0,
      Math.min(next.end - MIN_LINE_DURATION, activeDuration()),
    );
  else next.end = clamp(next.end + delta, next.start + MIN_LINE_DURATION, activeDuration());
  applySelection(next, true);
}

async function togglePlayback(): Promise<void> {
  if (!audio) {
    setStatus('请先载入歌曲', 'error');
    return;
  }
  try {
    clearAudition();
    if (player.isPlaying) player.pause();
    else await player.play(playhead >= audio.duration - 0.01 ? 0 : playhead);
  } catch {
    setStatus('浏览器暂时无法播放，请再次点击播放按钮', 'error');
  }
}

async function playSelection(): Promise<void> {
  if (!audio || !selection) return;
  try {
    clearAudition();
    await player.play(selection.start);
  } catch {
    setStatus('选区播放失败，请重试', 'error');
  }
}

function renderTimelines(): void {
  if (!audio || !spectrum) return;
  const detailRange = options.precise ? detailWindow() : null;
  const base = {
    duration: audio.duration,
    selection,
    playhead,
    detailWindow: detailRange,
    mode,
  };
  overview.update({ ...base, view: { start: 0, end: audio.duration } });
  if (options.precise && detailRange) detail.update({ ...base, view: detailRange });
}

function buildLyricList(): void {
  if (activeEdit) activeEdit.input.blur();
  rowMap.clear();
  currentPlayingId = null;
  soundingRowId = null;
  lyricsList.replaceChildren();
  for (const [index, line] of lyricDoc.lines.entries()) {
    const time = h('span', {
      class: 'ls-lyric-time',
      textContent: `${formatTime(line.start)} → ${formatTime(line.end)}`,
    });
    const text = h('span', {
      class: 'ls-lyric-text min-w-0 whitespace-pre-line break-words text-sm leading-relaxed',
      textContent: line.text,
    });
    // 悬停浮现的行内操作组：播放/暂停、句后新增、删除。
    const play = h(
      'button',
      {
        type: 'button',
        class: 'ls-line-act ls-line-play',
        'aria-label': `播放第 ${index + 1} 句`,
        title: '试听这一句（到句尾自动停）',
        onclick: (event) => {
          event.stopPropagation();
          toggleLinePlayback(line.id);
        },
      },
      [
        h('span', { class: 'ls-icon-play', textContent: '▶' }),
        h('span', { class: 'ls-icon-pause', textContent: '⏸' }),
      ],
    );
    const add = h('button', {
      type: 'button',
      class: 'ls-line-act ls-line-add',
      textContent: '＋',
      'aria-label': `在第 ${index + 1} 句后新增一句`,
      title: '在此句后新增一句',
      onclick: (event) => {
        event.stopPropagation();
        addLineAfter(line.id);
      },
    });
    const del = h('button', {
      type: 'button',
      class: 'ls-line-act ls-line-del',
      textContent: '✕',
      'aria-label': `删除第 ${index + 1} 句`,
      title: '删除这一句',
      onclick: (event) => {
        event.stopPropagation();
        removeLine(line.id);
      },
    });
    const row = h(
      'div',
      {
        class: 'ls-lyric-row',
        role: 'button',
        tabindex: '0',
        'data-line-id': line.id,
        'aria-label': `第 ${index + 1} 句，${line.text}，${formatTime(line.start)}`,
        onclick: () => selectLine(line.id),
        ondblclick: (event) => {
          if ((event.target as HTMLElement).closest('button, input')) return;
          beginLineEdit(line.id);
        },
        onkeydown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            selectLine(line.id);
          }
        },
      },
      [
        h('span', { class: 'ls-lyric-index', textContent: String(index + 1).padStart(2, '0') }),
        text,
        time,
        h('span', { class: 'ls-line-actions' }, [play, add, del]),
      ],
    );
    rowMap.set(line.id, { row, text, time, play, index: index + 1 });
    lyricsList.append(row);
  }
  lyricsEmpty.classList.toggle('hidden', lyricDoc.lines.length > 0);
  lyricsList.classList.toggle('hidden', lyricDoc.lines.length === 0);
  lyricCount.textContent = `${lyricDoc.lines.length} 句`;
  syncSoundingRow();
}

function refreshLyricSelection(): void {
  const matched = selection
    ? new Set(linesInRange(lyricDoc.lines, selection.start, selection.end))
    : new Set<string>();
  for (const line of lyricDoc.lines) {
    const row = rowMap.get(line.id)?.row;
    if (!row) continue;
    row.classList.toggle('is-active', line.id === selectedId);
    row.classList.toggle('is-in-range', matched.has(line.id));
    row.setAttribute('aria-pressed', String(line.id === selectedId));
  }
  rangeCount.textContent = selection
    ? mode === 'line'
      ? `正在校准：${selectedLine()?.text ?? '当前句'}`
      : `选中 ${matched.size} 句 · ${formatTime(selection.start)} — ${formatTime(selection.end)}`
    : '尚未选择范围';
}

function updatePlayingLine(time: number): void {
  const line = lyricDoc.lines.find((item) => time >= item.start && time < item.end);
  const nextId = line?.id ?? null;
  if (nextId === currentPlayingId) return;
  currentPlayingId = nextId;
  syncSoundingRow();
}

/**
 * 行高亮与行尾播放/暂停图标只由同一份「正在发声」状态驱动：
 * 仅在播放器真正出声且播放头落在某句内时，该行才有 is-playing（暂停形态）；
 * 暂停或播放结束后立即恢复播放形态，避免高亮与图标不一致。
 */
function syncSoundingRow(): void {
  // 句内试听期间以被点击的行为准，避免音频启动交接时受旧播放头影响；连续播放仍跟随播放头。
  const id = player.isPlaying ? (auditionLineId ?? currentPlayingId) : pendingSoundId;
  if (id === soundingRowId) return;
  const previous = soundingRowId ? rowMap.get(soundingRowId) : undefined;
  previous?.row.classList.remove('is-playing');
  if (previous) setPlayButtonState(previous, false);
  soundingRowId = id;
  const current = id ? rowMap.get(id) : undefined;
  current?.row.classList.add('is-playing');
  if (current) setPlayButtonState(current, true);
}

function setPlayButtonState(refs: LyricRowRefs, sounding: boolean): void {
  refs.play.setAttribute(
    'aria-label',
    sounding ? `暂停第 ${refs.index} 句` : `播放第 ${refs.index} 句`,
  );
  refs.play.title = sounding ? '暂停这一句' : '试听这一句';
}

/** 点击歌词行悬浮按钮：选中该句并联动频谱选区，从句首试听这一句；再次点击暂停。 */
function toggleLinePlayback(id: string): void {
  if (!audio) {
    setStatus('请先载入歌曲，再试听这句歌词', 'error');
    return;
  }
  if (player.isPlaying && (currentPlayingId === id || auditionLineId === id)) {
    clearAudition();
    player.pause();
    return;
  }
  clearAudition();
  selectLine(id, false);
  const line = selectedLine();
  if (!line) return;
  // 句内试听：只播这一句，到句尾自动停（循环选区开启时循环本句）；
  // 先乐观点亮暂停形态，音频真正启动后由 onTick 接管同一状态。
  auditionLineId = id;
  pendingSoundId = id;
  syncSoundingRow();
  player.play(line.start).catch(() => {
    if (auditionLineId === id || pendingSoundId === id) clearAudition();
    syncSoundingRow();
    setStatus('浏览器暂时无法播放，请重试', 'error');
  });
}

/** 双击进入单句文字编辑：Enter 或失焦提交，Esc 还原，清空则保留占位文本。 */
function beginLineEdit(id: string): void {
  const line = lyricDoc.lines.find((item) => item.id === id);
  const refs = rowMap.get(id);
  if (!line || !refs) return;
  if (activeEdit) activeEdit.input.blur();
  const span = refs.text;
  const input = h('input', {
    type: 'text',
    class: 'ls-lyric-edit',
    value: line.text,
    'aria-label': `编辑第 ${refs.index} 句歌词`,
  }) as HTMLInputElement;
  let closed = false;
  const close = (apply: boolean): void => {
    if (closed) return;
    closed = true;
    if (activeEdit?.input === input) activeEdit = null;
    if (apply) {
      const next = input.value.trim();
      line.text = next.length > 0 ? next : PLACEHOLDER_TEXT;
    }
    span.textContent = line.text;
    refs.row.setAttribute(
      'aria-label',
      `第 ${refs.index} 句，${line.text}，${formatTime(line.start)}`,
    );
    input.replaceWith(span);
    if (selectedId === id) updateInspector();
    persistDraft();
  };
  input.addEventListener('blur', () => close(true));
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('dblclick', (event) => event.stopPropagation());
  input.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(false);
      input.blur();
    }
  });
  span.replaceWith(input);
  activeEdit = { id, input };
  input.focus();
  input.select();
}

/** 在 afterId 句之后插入占位新句（null 表示末尾追加或创建首句），并直接进入文字编辑。 */
function addLineAfter(afterId: string | null): void {
  if (activeEdit) activeEdit.input.blur();
  const lines = lyricDoc.lines;
  const at = afterId ? lines.findIndex((item) => item.id === afterId) : lines.length - 1;
  const range = suggestLineRange(lines, at, playhead, activeDuration());
  const line: LyricLine = {
    id: `lyric-x${++lineIdSeed}`,
    start: range.start,
    end: range.end,
    text: PLACEHOLDER_TEXT,
  };
  lines.splice(at + 1, 0, line);
  mode = 'line';
  selectedId = line.id;
  selection = { start: line.start, end: line.end };
  buildLyricList();
  refreshLyricSelection();
  updateModeUI();
  updateInspector();
  updateButtons();
  renderTimelines();
  persistDraft();
  rowMap.get(line.id)?.row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  beginLineEdit(line.id);
  setStatus('已插入新句，输入文字后回车保存；双击任意句可再次修改', 'success');
}

/** 删除一句；若删除的是当前句，选区顺延到下一句（或上一句）。 */
function removeLine(id: string): void {
  if (activeEdit) activeEdit.input.blur();
  const lines = lyricDoc.lines;
  const index = lines.findIndex((item) => item.id === id);
  if (index < 0) return;
  lines.splice(index, 1);
  if (currentPlayingId === id) currentPlayingId = null;
  if (selectedId === id) {
    const neighbor = lines[index] ?? lines[index - 1] ?? null;
    selectedId = neighbor?.id ?? null;
    selection = neighbor ? { start: neighbor.start, end: neighbor.end } : null;
  }
  buildLyricList();
  refreshLyricSelection();
  updateInspector();
  updateButtons();
  renderTimelines();
  if (lines.length === 0) {
    clearDraft();
    saveStatus.textContent = '编辑后自动保存';
    setStatus('已删除最后一句，可继续手动新增或导入歌词');
  } else {
    persistDraft();
    setStatus('已删除一句歌词');
  }
}

function updateInspector(): void {
  const line = mode === 'line' ? selectedLine() : null;
  inspectorText.textContent =
    line?.text ??
    (mode === 'range'
      ? '范围选择模式：切换到「单句校准」或点击一句歌词'
      : '从歌词列表选择一句开始校准');
  inspectorText.classList.toggle('text-[var(--fg-muted)]', !line);
  inspectorText.classList.toggle('text-[var(--fg)]', Boolean(line));
  for (const input of [startInput, endInput]) {
    input.disabled = !line;
    if (document.activeElement !== input)
      input.value = line ? formatTime(edgeValue(line, input)) : '00:00.000';
  }
  for (const button of nudgeButtons) button.disabled = !line;
  lineDurationLabel.textContent = line
    ? `选区时长 ${(Math.max(0, line.end - line.start) * 1000).toFixed(0)}ms`
    : '选区时长 —';
}

function edgeValue(line: LyricLine, input: HTMLInputElement): number {
  return input === startInput ? line.start : line.end;
}

function updateModeUI(): void {
  rangeModeButton.classList.toggle('is-active', mode === 'range');
  lineModeButton.classList.toggle('is-active', mode === 'line');
  rangeModeButton.setAttribute('aria-pressed', String(mode === 'range'));
  lineModeButton.setAttribute('aria-pressed', String(mode === 'line'));
}

function updatePlaybackUI(playing: boolean): void {
  playButton.textContent = playing ? '⏸' : '▶';
  playButton.setAttribute('aria-label', playing ? '暂停' : '播放');
  timeDisplay.textContent = `${formatTime(playhead)} / ${formatTime(audio?.duration ?? 0)}`;
  syncSoundingRow();
}

function updateFileUI(): void {
  audioPicker.title.textContent = audio?.fileName ?? audioName ?? '选择或拖入歌曲';
  audioPicker.subtitle.textContent = audio
    ? `${formatTime(audio.duration, false)} · 点击可更换歌曲`
    : audioName
      ? '草稿已保留 · 重新载入此歌曲恢复频谱'
      : 'MP3 / WAV / M4A / OGG';
  lyricPicker.title.textContent = lyricDoc.lines.length > 0 ? lyricDoc.fileName : '选择或拖入歌词';
  lyricPicker.subtitle.textContent =
    lyricDoc.lines.length > 0
      ? `${lyricDoc.format.toUpperCase()} · ${lyricDoc.lines.length} 句 · 点击可更换`
      : 'LRC / SRT · 句级时间轴';
}

function updateButtons(): void {
  playButton.disabled = !audio;
  auditionButton.disabled = !audio || !selection;
  previousButton.disabled = lyricDoc.lines.length === 0;
  nextButton.disabled = lyricDoc.lines.length === 0;
  exportButton.disabled = lyricDoc.lines.length === 0;
  exportFormat.disabled = lyricDoc.lines.length === 0;
  clearButton.disabled = lyricDoc.lines.length === 0 && !audioName;
}

function renderAll(): void {
  updateFileUI();
  updatePlaybackUI(player.isPlaying);
  updateModeUI();
  refreshLyricSelection();
  updateInspector();
  updateButtons();
  renderTimelines();
}

function exportLyrics(): void {
  if (lyricDoc.lines.length === 0) return;
  try {
    const format = exportFormat.value as LyricFormat;
    const text = serializeLyrics(lyricDoc, format);
    const base = sanitizeFilePart(stripExt(lyricDoc.fileName)) || '歌词';
    downloadText(
      text,
      `${base}-校准.${format}`,
      format === 'srt' ? 'application/x-subrip' : 'text/plain',
    );
    setStatus(`已导出 ${lyricDoc.lines.length} 句 ${format.toUpperCase()} 歌词`, 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '导出失败，请重试', 'error');
  }
}

async function clearWorkspace(): Promise<void> {
  const ok = await confirmDialog(
    '将清空当前歌词、选区和已保存草稿。歌曲也需要重新载入；建议先导出备份。',
    {
      title: '清空编辑现场',
      confirmText: '清空',
      danger: true,
    },
  );
  if (!ok) return;
  loadToken++;
  player.setBuffer(null);
  audio = null;
  spectrum = null;
  audioName = null;
  selectedId = null;
  selection = null;
  playhead = 0;
  lyricDoc = { format: 'lrc', fileName: '歌词.lrc', metadata: {}, lines: [] };
  exportFormat.value = 'lrc';
  clearDraft();
  buildLyricList();
  overview.setData(null);
  detail.setData(null);
  setSpectrumReady(false);
  spectrumEmpty.classList.remove('hidden');
  spectrumProgress.classList.add('hidden');
  spectrumHeadStatus.textContent = '等待载入歌曲';
  setStatus('编辑现场已清空');
  saveStatus.textContent = '编辑后自动保存';
  renderAll();
}

document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
  event.preventDefault();
  void togglePlayback();
});

window.addEventListener('pagehide', persistDraft);

if (selectedId && !selection) {
  const line = selectedLine();
  if (line) selection = { start: line.start, end: line.end };
}
buildLyricList();
exportFormat.value = lyricDoc.format;
applyPreciseLayout();
renderAll();
