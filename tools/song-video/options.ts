/**
 * 歌曲生成视频 —— 选项类型、常量目录与默认值。
 *
 * 所有可配置项集中在这里定义（类型 + 展示目录 + 默认值），
 * settings.ts 据此做 localStorage 记忆与逐字段校验，
 * renderer.ts 据此绘制、recorder.ts 据此录制。
 * 纯数据模块：不依赖 DOM，便于单测与复用。
 */

// ─────────────────────────── 宽高比 ───────────────────────────

export type AspectId = '16:9' | '9:16' | '1:1' | '4:3';

export interface Aspect {
  id: AspectId;
  label: string;
  /** 视频宽（px，短边基准换算） */
  w: number;
  /** 视频高（px） */
  h: number;
}

/**
 * 短边基准：与 quote-card 的画板基准一致（1080），
 * 实际导出尺寸 = 基准 × 分辨率档位缩放（见 RESOLUTIONS）。
 */
const SHORT = 1080;

export const ASPECTS: Aspect[] = [
  { id: '16:9', label: '16:9 横版', w: Math.round((SHORT * 16) / 9), h: SHORT },
  { id: '9:16', label: '9:16 竖版', w: SHORT, h: Math.round((SHORT * 16) / 9) },
  { id: '1:1', label: '1:1 正方', w: SHORT, h: SHORT },
  { id: '4:3', label: '4:3 传统', w: Math.round((SHORT * 4) / 3), h: SHORT },
];

const DEFAULT_ASPECT: Aspect = ASPECTS[0]!;

export function getAspect(id: string | undefined): Aspect {
  return ASPECTS.find((a) => a.id === id) ?? DEFAULT_ASPECT;
}

// ─────────────────────────── 分辨率 ───────────────────────────

/** 导出分辨率档位：短边目标像素（录制 canvas 按短边等比缩放） */
export type ResolutionId = '540' | '720' | '1080';

export interface Resolution {
  id: ResolutionId;
  label: string;
  shortSide: number;
}

export const RESOLUTIONS: Resolution[] = [
  { id: '540', label: '540p 流畅（文件小）', shortSide: 540 },
  { id: '720', label: '720p 高清（推荐）', shortSide: 720 },
  { id: '1080', label: '1080p 全高清（较慢）', shortSide: 1080 },
];

const DEFAULT_RESOLUTION: Resolution = RESOLUTIONS[1]!;

export function getResolution(id: string | undefined): Resolution {
  return RESOLUTIONS.find((r) => r.id === id) ?? DEFAULT_RESOLUTION;
}

// ─────────────────────────── 音频可视化 ───────────────────────────

export type VisualizerId = 'bars' | 'mirror' | 'circle' | 'wave';

export interface Visualizer {
  id: VisualizerId;
  label: string;
  hint: string;
}

export const VISUALIZERS: Visualizer[] = [
  { id: 'bars', label: '条形频谱', hint: '底部跳跃的频谱柱，经典播放器样式' },
  { id: 'mirror', label: '镜像频谱', hint: '中轴上下对称的频谱条' },
  { id: 'circle', label: '环形频谱', hint: '环绕专辑封面的放射状频谱' },
  { id: 'wave', label: '声波曲线', hint: '平滑起伏的实时波形线' },
];

const DEFAULT_VISUALIZER: VisualizerId = 'bars';

/** 按 id 取可视化样式，非法 id 回退默认 */
export function normalizeVisualizer(id: unknown): VisualizerId {
  return VISUALIZERS.some((v) => v.id === id) ? (id as VisualizerId) : DEFAULT_VISUALIZER;
}

// ─────────────────────────── 歌词滚动模式 ───────────────────────────

export type LyricModeId = 'none' | 'fade' | 'list';

export interface LyricMode {
  id: LyricModeId;
  label: string;
  hint: string;
}

export const LYRIC_MODES: LyricMode[] = [
  { id: 'none', label: '不显示', hint: '忽略歌词文件' },
  { id: 'fade', label: '单行淡入', hint: '当前句居中大字，淡入淡出' },
  { id: 'list', label: '滚动列表', hint: '多行上下滚动，当前句高亮（类音乐 App）' },
];

export function normalizeLyricMode(id: unknown): LyricModeId {
  return LYRIC_MODES.some((m) => m.id === id) ? (id as LyricModeId) : 'fade';
}

// ─────────────────────────── 主题配色 ───────────────────────────

export type ThemeId = 'midnight' | 'sunset' | 'mint' | 'mono';

export interface Theme {
  id: ThemeId;
  label: string;
  /** 预览小色块（CSS 渐变，仅 UI 展示） */
  swatch: string;
  /** 背景渐变（canvas 用，[起, 止]） */
  bg: [string, string];
  /** 前景/文字色 */
  fg: string;
  /** 主强调色（频谱、进度条、高亮歌词） */
  accent: string;
  /** 次要文字/网格色 */
  muted: string;
  /** 背景是否偏亮（决定文字对比处理） */
  light: boolean;
}

export const THEMES: Theme[] = [
  {
    id: 'midnight',
    label: '深空蓝',
    swatch: 'linear-gradient(135deg,#0b1220,#1e3a8a)',
    bg: ['#0b1220', '#1e3a8a'],
    fg: '#f1f5f9',
    accent: '#38bdf8',
    muted: 'rgba(241,245,249,0.55)',
    light: false,
  },
  {
    id: 'sunset',
    label: '暖阳橙',
    swatch: 'linear-gradient(135deg,#1c1006,#c2410c)',
    bg: ['#1c1006', '#c2410c'],
    fg: '#fff7ed',
    accent: '#fbbf24',
    muted: 'rgba(255,247,237,0.55)',
    light: false,
  },
  {
    id: 'mint',
    label: '薄荷浅色',
    swatch: 'linear-gradient(135deg,#f0fdfa,#5eead4)',
    bg: ['#f0fdfa', '#5eead4'],
    fg: '#0f766e',
    accent: '#0d9488',
    muted: 'rgba(15,118,110,0.6)',
    light: true,
  },
  {
    id: 'mono',
    label: '极简黑白',
    swatch: 'linear-gradient(135deg,#0a0a0a,#404040)',
    bg: ['#0a0a0a', '#404040'],
    fg: '#fafafa',
    accent: '#e5e5e5',
    muted: 'rgba(250,250,250,0.5)',
    light: false,
  },
];

const DEFAULT_THEME: Theme = THEMES[0]!;

export function getTheme(id: string | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? DEFAULT_THEME;
}

/** 按 id 严格归一化主题 id，非法回退默认 */
export function normalizeTheme(id: unknown): ThemeId {
  return THEMES.some((t) => t.id === id) ? (id as ThemeId) : DEFAULT_THEME.id;
}

// ─────────────────────────── 开场 / 结尾动画 ───────────────────────────

export type IntroAnimId = 'fade' | 'zoom' | 'slide' | 'none';
export type OutroAnimId = 'fade' | 'zoom' | 'none';

export const INTRO_ANIMS: { id: IntroAnimId; label: string }[] = [
  { id: 'fade', label: '淡入浮现' },
  { id: 'zoom', label: '缩放入场' },
  { id: 'slide', label: '上滑入场' },
  { id: 'none', label: '无动画' },
];

export const OUTRO_ANIMS: { id: OutroAnimId; label: string }[] = [
  { id: 'fade', label: '淡出收尾' },
  { id: 'zoom', label: '缩小收尾' },
  { id: 'none', label: '无动画' },
];

export function normalizeIntroAnim(id: unknown): IntroAnimId {
  return INTRO_ANIMS.some((a) => a.id === id) ? (id as IntroAnimId) : 'fade';
}

export function normalizeOutroAnim(id: unknown): OutroAnimId {
  return OUTRO_ANIMS.some((a) => a.id === id) ? (id as OutroAnimId) : 'fade';
}

// ─────────────────────────── 进度条 ───────────────────────────

export type ProgressBarId = 'none' | 'line' | 'full';

export const PROGRESS_BARS: { id: ProgressBarId; label: string }[] = [
  { id: 'none', label: '不显示' },
  { id: 'line', label: '底部细线' },
  { id: 'full', label: '胶囊+时间' },
];

export function normalizeProgressBar(id: unknown): ProgressBarId {
  return PROGRESS_BARS.some((p) => p.id === id) ? (id as ProgressBarId) : 'line';
}

// ─────────────────────────── 完整选项 ───────────────────────────

/** 开场 / 结尾动画时长档位（秒） */
export const INTRO_DUR_CHOICES = [0, 1.5, 2.5, 4] as const;
export const OUTRO_DUR_CHOICES = [0, 1.5, 2.5, 4] as const;

export interface SongVideoOptions {
  /** 画布宽高比 */
  aspect: AspectId;
  /** 导出分辨率（短边像素档位） */
  resolution: ResolutionId;
  /** 音频可视化样式 */
  visualizer: VisualizerId;
  /** 歌词滚动模式（无歌词文件时自动等效 none） */
  lyricMode: LyricModeId;
  /** 主题配色 */
  theme: ThemeId;
  /** 自定义主色（覆盖主题 accent；null=跟随主题） */
  accentColor: string | null;
  /** 是否显示标题 */
  showTitle: boolean;
  /** 标题内容（默认取歌曲文件名去扩展名） */
  titleText: string;
  /** 进度条样式 */
  progressBar: ProgressBarId;
  /** 开场动画样式 */
  introAnim: IntroAnimId;
  /** 开场动画时长（秒，0=无开场段） */
  introDur: number;
  /** 结尾动画样式 */
  outroAnim: OutroAnimId;
  /** 结尾定格时长（秒，片尾滚动字幕在此基础上延长） */
  outroDur: number;
  /** 专辑封面是否旋转（唱片效果） */
  coverSpin: boolean;
  /** 发行者署名（显示在画面角落；空=不显示） */
  publisher: string;
  /** 是否在片尾滚动显示字幕 */
  endRollEnabled: boolean;
  /** 片尾滚动字幕内容（每行一条） */
  endRollText: string;
}

export const DEFAULT_OPTIONS: SongVideoOptions = {
  aspect: '16:9',
  resolution: '720',
  visualizer: 'bars',
  lyricMode: 'fade',
  theme: 'midnight',
  accentColor: null,
  showTitle: true,
  titleText: '',
  progressBar: 'line',
  introAnim: 'fade',
  introDur: 2.5,
  outroAnim: 'fade',
  outroDur: 2.5,
  coverSpin: true,
  publisher: '',
  endRollEnabled: false,
  endRollText: '',
};

/**
 * 计算视频时间轴（秒）：
 *   [0, intro)                    开场段（无音频，动画 + 标题）
 *   [intro, intro + audio)        主段（音频播放，可视化/歌词/进度条）
 *   [intro + audio, total)        结尾段（音频已结束，淡出 + 片尾滚动字幕）
 *
 * 片尾滚动字幕开启时，结尾段时长自动延长到「动画时长」与「滚动所需时长」的较大值。
 */
export interface Timeline {
  intro: number;
  /** 音频时长（秒） */
  audio: number;
  /** 结尾段时长（秒） */
  outro: number;
  /** 总时长（秒） */
  total: number;
}

/** 片尾字幕每行滚动耗时（秒）：滚过一屏的节奏基准 */
const ROLL_SEC_PER_LINE = 0.55;
/** 片尾滚动字幕区高度（占画面高比例） */
export const ROLL_VIEW_RATIO = 0.55;

export function computeTimeline(opts: SongVideoOptions, audioDur: number): Timeline {
  const intro = opts.introDur;
  const lines = opts.endRollEnabled ? opts.endRollText.split('\n').filter((l) => l.trim()) : [];
  // 滚动时长 = 行数 × 每行耗时 + 进出缓冲
  const rollNeed = lines.length > 0 ? lines.length * ROLL_SEC_PER_LINE + 1.6 : 0;
  const outro = Math.max(opts.outroDur, rollNeed);
  return { intro, audio: audioDur, outro, total: intro + audioDur + outro };
}
