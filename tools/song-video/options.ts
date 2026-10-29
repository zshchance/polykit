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
export type ResolutionId = '540' | '720' | '1080' | '1440';

export interface Resolution {
  id: ResolutionId;
  label: string;
  shortSide: number;
}

export const RESOLUTIONS: Resolution[] = [
  { id: '540', label: '540p 流畅（文件小）', shortSide: 540 },
  { id: '720', label: '720p 高清（推荐）', shortSide: 720 },
  { id: '1080', label: '1080p 全高清', shortSide: 1080 },
  { id: '1440', label: '1440p 2K（较慢）', shortSide: 1440 },
];

const DEFAULT_RESOLUTION: Resolution = RESOLUTIONS[1]!;

export function getResolution(id: string | undefined): Resolution {
  return RESOLUTIONS.find((r) => r.id === id) ?? DEFAULT_RESOLUTION;
}

// ─────────────────────────── 音频可视化 ───────────────────────────

export type VisualizerId = 'bars' | 'mirror' | 'circle' | 'wave';

/**
 * 可视化选择：内置样式 id，或自定义频谱样式 id（cviz: 前缀，本体存
 * custom-visualizers.ts；渲染时解析失败/被删除则回退条形频谱）。
 */
export type VisualizerSelection = VisualizerId | `cviz:${string}`;

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

/** 按 id 归一化：内置样式或 cviz: 自定义 id 放行，其余回退默认（自定义 id 的存在性由渲染层校验） */
export function normalizeVisualizer(id: unknown): VisualizerSelection {
  if (VISUALIZERS.some((v) => v.id === id)) return id as VisualizerId;
  if (typeof id === 'string' && isCustomVisualizerId(id)) return id;
  return DEFAULT_VISUALIZER;
}

/** 判断是否自定义频谱样式 id（cviz: 前缀）；兼作 VisualizerSelection 的类型收窄 */
export function isCustomVisualizerId(id: string): id is `cviz:${string}` {
  return id.startsWith('cviz:');
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

// ─────────────────────────── 歌词列表行数 ───────────────────────────

/** 滚动列表模式：当前句上方/下方显示的行数（默认上 1 下 3，上少下多更符合歌词阅读重心） */
export const LYRIC_ABOVE_CHOICES = [0, 1, 2] as const;
export const LYRIC_BELOW_CHOICES = [1, 2, 3, 4] as const;

// ─────────────────────────── 主题配色 ───────────────────────────

export type ThemeId =
  | 'midnight'
  | 'sunset'
  | 'mint'
  | 'mono'
  | 'ocean'
  | 'sakura'
  | 'violet'
  | 'forest'
  | 'latte'
  | 'aurora';

export interface Theme {
  /** 内置主题为 ThemeId；自定义主题为 custom: 前缀 id */
  id: string;
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
  {
    id: 'ocean',
    label: '海雾青',
    swatch: 'linear-gradient(135deg,#04201e,#0f766e)',
    bg: ['#04201e', '#0f766e'],
    fg: '#ecfdf5',
    accent: '#2dd4bf',
    muted: 'rgba(236,253,245,0.55)',
    light: false,
  },
  {
    id: 'sakura',
    label: '樱花粉',
    swatch: 'linear-gradient(135deg,#fff1f2,#f9a8d4)',
    bg: ['#fff1f2', '#f9a8d4'],
    fg: '#9d174d',
    accent: '#db2777',
    muted: 'rgba(157,23,77,0.6)',
    light: true,
  },
  {
    id: 'violet',
    label: '幻夜紫',
    swatch: 'linear-gradient(135deg,#17082e,#6d28d9)',
    bg: ['#17082e', '#6d28d9'],
    fg: '#f5f3ff',
    accent: '#c084fc',
    muted: 'rgba(245,243,255,0.55)',
    light: false,
  },
  {
    id: 'forest',
    label: '森屿绿',
    swatch: 'linear-gradient(135deg,#0a1f12,#15803d)',
    bg: ['#0a1f12', '#15803d'],
    fg: '#f0fdf4',
    accent: '#4ade80',
    muted: 'rgba(240,253,244,0.55)',
    light: false,
  },
  {
    id: 'latte',
    label: '拿铁棕',
    swatch: 'linear-gradient(135deg,#fdf6ee,#d6b08c)',
    bg: ['#fdf6ee', '#d6b08c'],
    fg: '#5b3a1a',
    accent: '#b45309',
    muted: 'rgba(91,58,26,0.6)',
    light: true,
  },
  {
    id: 'aurora',
    label: '极光蓝绿',
    swatch: 'linear-gradient(135deg,#020617,#0369a1)',
    bg: ['#020617', '#0369a1'],
    fg: '#e0f2fe',
    accent: '#34d399',
    muted: 'rgba(224,242,254,0.55)',
    light: false,
  },
];

const DEFAULT_THEME: Theme = THEMES[0]!;

export function getTheme(id: string | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? DEFAULT_THEME;
}

/** 按 id 严格归一化主题 id，非法回退默认（自定义 custom: id 由 custom-themes 层解析） */
export function normalizeTheme(id: unknown): string {
  return THEMES.some((t) => t.id === id) ? (id as string) : DEFAULT_THEME.id;
}

// 让 TS 确保 THEMES 覆盖 ThemeId 全集（新增内置主题时漏改 ThemeId 会在此报错）
const _themeIdCheck: Record<ThemeId, true> = Object.fromEntries(
  THEMES.map((t) => [t.id, true as const]),
) as Record<ThemeId, true>;
void _themeIdCheck;

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

// ─────────────────────────── 角色进度条 ───────────────────────────

/**
 * 角色进度条：把「进度条」从封闭样式升级为可组合效果——
 * 载体（内置 SVG / 本地上传素材）+ 运动（滑行/滚动/飞行/奔跑/漂浮）+ 尾迹。
 * 进度 x 由歌曲时间决定；运动与尾迹由渲染层确定性生成（预览/导出逐帧一致）。
 */
export type ProgressMotionId = 'glide' | 'roll' | 'fly' | 'run' | 'float';

export const PROGRESS_MOTIONS: { id: ProgressMotionId; label: string; hint: string }[] = [
  { id: 'glide', label: '滑行', hint: '贴着轨道匀速前进，适合任何素材' },
  { id: 'roll', label: '滚动', hint: '按行进距离自转，适合足球/唱片等圆形素材' },
  { id: 'fly', label: '飞行', hint: '抬离轨道并轻微浮动，适合流星/地球/火箭' },
  { id: 'run', label: '奔跑', hint: '上下起伏 + 轻微摆动，适合人物/动物' },
  { id: 'float', label: '漂浮', hint: '悬浮在半空缓慢起伏' },
];

export type ProgressTrailId = 'none' | 'glow' | 'fire' | 'particles' | 'echo';

export const PROGRESS_TRAILS: { id: ProgressTrailId; label: string; hint: string }[] = [
  { id: 'none', label: '无尾迹', hint: '干净利落，不拖尾' },
  { id: 'glow', label: '光晕', hint: '一条渐隐的发光光带' },
  { id: 'fire', label: '火焰', hint: '长条火焰 + 闪烁火星，适合流星/火箭' },
  { id: 'particles', label: '粒子', hint: '散落的星尘粒子' },
  { id: 'echo', label: '残影', hint: '沿轨迹重复淡出的分身' },
];

/** 内置载体 id（对应 assets/sprites/<id>.svg；缺失时渲染层回退为发光圆点） */
export type BuiltinActorId =
  | 'football'
  | 'meteor'
  | 'earth'
  | 'rocket'
  | 'runner'
  | 'star'
  | 'heart'
  | 'note'
  | 'disc'
  | 'moon';

export interface BuiltinActor {
  id: BuiltinActorId;
  label: string;
  /** UI 兜底图标（SVG 未加载时显示） */
  emoji: string;
  /** 该载体的推荐运动（选中内置载体时自动套用） */
  defaultMotion: ProgressMotionId;
}

export const BUILTIN_ACTORS: BuiltinActor[] = [
  { id: 'football', label: '足球', emoji: '⚽', defaultMotion: 'roll' },
  { id: 'meteor', label: '流星', emoji: '☄️', defaultMotion: 'fly' },
  { id: 'earth', label: '地球', emoji: '🌍', defaultMotion: 'fly' },
  { id: 'rocket', label: '火箭', emoji: '🚀', defaultMotion: 'fly' },
  { id: 'runner', label: '人偶', emoji: '🏃', defaultMotion: 'run' },
  { id: 'star', label: '星星', emoji: '⭐', defaultMotion: 'float' },
  { id: 'heart', label: '爱心', emoji: '❤️', defaultMotion: 'float' },
  { id: 'note', label: '音符', emoji: '🎵', defaultMotion: 'float' },
  { id: 'disc', label: '唱片', emoji: '💿', defaultMotion: 'roll' },
  { id: 'moon', label: '月亮', emoji: '🌙', defaultMotion: 'glide' },
];

/** 载体来源：内置精灵，或本地上传素材（id 形如 sva:xxxx） */
export type ProgressActorRef =
  { kind: 'builtin'; id: BuiltinActorId } | { kind: 'asset'; id: string };

export type ProgressTint = 'original' | 'accent';

export interface ProgressEffect {
  /** 载体来源与 id */
  actor: ProgressActorRef;
  motion: ProgressMotionId;
  trail: ProgressTrailId;
  /** 尾迹长度 0.1-1（拖尾最多占轨道宽度的 45%） */
  trailLen: number;
  /** 载体高度（相对短边 S 的比例，0.06-0.18） */
  size: number;
  /** original=保留素材原色；accent=用主题主色染色 */
  tint: ProgressTint;
  /** 随音乐能量轻微律动（录制时用实时频段驱动） */
  tempoSync: boolean;
}

export const DEFAULT_PROGRESS_EFFECT: ProgressEffect = {
  actor: { kind: 'builtin', id: 'football' },
  motion: 'roll',
  trail: 'none',
  trailLen: 0.6,
  size: 0.1,
  tint: 'original',
  tempoSync: false,
};

/** 预设卡片：常见玩法一键套用（用户仍可在下方微调） */
export const PROGRESS_PRESETS: {
  id: string;
  label: string;
  hint: string;
  emoji: string;
  effect: ProgressEffect;
}[] = [
  {
    id: 'football',
    label: '足球滚动',
    hint: '贴地自转，最经典的跑条',
    emoji: '⚽',
    effect: {
      actor: { kind: 'builtin', id: 'football' },
      motion: 'roll',
      trail: 'none',
      trailLen: 0.5,
      size: 0.11,
      tint: 'original',
      tempoSync: false,
    },
  },
  {
    id: 'meteor',
    label: '流星火尾',
    hint: '飞行 + 长火焰尾迹',
    emoji: '☄️',
    effect: {
      actor: { kind: 'builtin', id: 'meteor' },
      motion: 'fly',
      trail: 'fire',
      trailLen: 0.85,
      size: 0.12,
      tint: 'original',
      tempoSync: true,
    },
  },
  {
    id: 'earth',
    label: '地球巡航',
    hint: '飞行 + 柔和光晕',
    emoji: '🌍',
    effect: {
      actor: { kind: 'builtin', id: 'earth' },
      motion: 'fly',
      trail: 'glow',
      trailLen: 0.75,
      size: 0.12,
      tint: 'original',
      tempoSync: false,
    },
  },
  {
    id: 'runner',
    label: '人偶奔跑',
    hint: '起伏摆动，沿轨道向前',
    emoji: '🏃',
    effect: {
      actor: { kind: 'builtin', id: 'runner' },
      motion: 'run',
      trail: 'none',
      trailLen: 0.5,
      size: 0.13,
      tint: 'original',
      tempoSync: true,
    },
  },
  {
    id: 'rocket',
    label: '火箭升空',
    hint: '飞行 + 火焰推进',
    emoji: '🚀',
    effect: {
      actor: { kind: 'builtin', id: 'rocket' },
      motion: 'fly',
      trail: 'fire',
      trailLen: 0.7,
      size: 0.13,
      tint: 'original',
      tempoSync: true,
    },
  },
  {
    id: 'star',
    label: '星星漂浮',
    hint: '轻盈浮动 + 星尘粒子',
    emoji: '⭐',
    effect: {
      actor: { kind: 'builtin', id: 'star' },
      motion: 'float',
      trail: 'particles',
      trailLen: 0.6,
      size: 0.09,
      tint: 'original',
      tempoSync: false,
    },
  },
];

const clampNum = (v: unknown, min: number, max: number, fallback: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
};

/**
 * 逐字段归一化角色效果：整体不是对象返回 null（关闭）；
 * 局部字段非法时回退默认值（不因一个坏字段丢掉整套效果）。
 */
export function normalizeProgressEffect(v: unknown): ProgressEffect | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const d = DEFAULT_PROGRESS_EFFECT;

  let actor: ProgressActorRef = { ...d.actor };
  const a = o.actor && typeof o.actor === 'object' ? (o.actor as Record<string, unknown>) : null;
  if (a) {
    if (
      a.kind === 'builtin' &&
      typeof a.id === 'string' &&
      BUILTIN_ACTORS.some((it) => it.id === a.id)
    ) {
      actor = { kind: 'builtin', id: a.id as BuiltinActorId };
    } else if (
      a.kind === 'asset' &&
      typeof a.id === 'string' &&
      /^sva:[a-z0-9]{4,32}$/.test(a.id)
    ) {
      actor = { kind: 'asset', id: a.id };
    }
  }

  return {
    actor,
    motion: PROGRESS_MOTIONS.some((m) => m.id === o.motion)
      ? (o.motion as ProgressMotionId)
      : d.motion,
    trail: PROGRESS_TRAILS.some((t) => t.id === o.trail) ? (o.trail as ProgressTrailId) : d.trail,
    trailLen: clampNum(o.trailLen, 0.1, 1, d.trailLen),
    size: clampNum(o.size, 0.06, 0.18, d.size),
    tint: o.tint === 'accent' ? 'accent' : 'original',
    tempoSync: typeof o.tempoSync === 'boolean' ? o.tempoSync : d.tempoSync,
  };
}

// ─────────────────────────── 片头封面页 ───────────────────────────

export type CoverStyleId = 'bold' | 'sticker' | 'center' | 'left' | 'band' | 'minimal';

export const COVER_STYLES: { id: CoverStyleId; label: string; hint: string }[] = [
  { id: 'bold', label: '描边大字', hint: '渐变大字 + 粗描边，短视频爆款封面风' },
  { id: 'sticker', label: '高亮贴纸', hint: '倾斜主色贴纸块承载标题，吸睛' },
  { id: 'center', label: '居中海报', hint: '居中构图，配专辑封面' },
  { id: 'left', label: '左对齐', hint: '左侧文字 + 右侧封面，杂志风' },
  { id: 'band', label: '主色横幅', hint: '主色横幅承载标题' },
  { id: 'minimal', label: '极简', hint: '仅标题与细线' },
];

export function normalizeCoverStyle(id: unknown): CoverStyleId {
  return COVER_STYLES.some((s) => s.id === id) ? (id as CoverStyleId) : 'center';
}

/** 片头封面时长档位（秒，静态画面） */
export const COVER_DUR_CHOICES = [2, 3, 5, 8] as const;

// ─────────────────────────── 完整选项 ───────────────────────────

/** 开场 / 结尾动画时长档位（秒） */
export const INTRO_DUR_CHOICES = [0, 1.5, 2.5, 4] as const;
export const OUTRO_DUR_CHOICES = [0, 1.5, 2.5, 4] as const;

export interface SongVideoOptions {
  /** 画布宽高比 */
  aspect: AspectId;
  /** 导出分辨率（短边像素档位） */
  resolution: ResolutionId;
  /** 音频可视化样式（内置 id 或 cviz: 自定义频谱样式 id） */
  visualizer: VisualizerSelection;
  /** 歌词滚动模式（无歌词文件时自动等效 none） */
  lyricMode: LyricModeId;
  /** 滚动列表模式：当前句上方行数（0-2） */
  lyricAbove: number;
  /** 滚动列表模式：当前句下方行数（1-4，默认大于上方行数） */
  lyricBelow: number;
  /** 单行淡入模式下，在当前句上方显示前一句（滚动列表模式天然多行，不生效） */
  showPrevLyric: boolean;
  /** 单行淡入模式下，在当前句下方显示后一句 */
  showNextLyric: boolean;
  /** 主题配色：内置 ThemeId，或自定义主题 id（custom: 前缀，主题本体存 custom-themes.ts） */
  theme: string;
  /** 自定义主色（覆盖主题 accent；null=跟随主题） */
  accentColor: string | null;
  /** 是否显示标题 */
  showTitle: boolean;
  /** 标题内容（默认取歌曲文件名去扩展名） */
  titleText: string;
  /** 进度条样式（progressEffect 非空时不生效） */
  progressBar: ProgressBarId;
  /** 角色进度条（自定义载体 + 运动 + 尾迹；null=使用 progressBar 样式） */
  progressEffect: ProgressEffect | null;
  /** 开场动画样式 */
  introAnim: IntroAnimId;
  /** 开场动画时长（秒，0=无开场段） */
  introDur: number;
  /** 结尾动画样式 */
  outroAnim: OutroAnimId;
  /** 结尾定格时长（秒，片尾滚动字幕在此基础上延长） */
  outroDur: number;
  /** 是否显示片头封面页（歌曲播放前的静态画面） */
  coverPageEnabled: boolean;
  /** 封面页标题（空 = 跟随歌曲标题） */
  coverTitle: string;
  /** 封面页副标题 */
  coverSubtitle: string;
  /** 封面页简介（每行一条） */
  coverDesc: string;
  /** 封面页样式 */
  coverStyle: CoverStyleId;
  /** 封面页时长（秒） */
  coverDur: number;
  /** 专辑封面是否旋转（唱片效果） */
  coverSpin: boolean;
  /** 发行者署名（显示在画面角落；空=不显示） */
  publisher: string;
  /** 是否在片尾显示字幕 */
  endRollEnabled: boolean;
  /** 片尾字幕显示方式：滚动 / 淡入淡出 / 无动画（直接分屏切换） */
  endRollMode: EndRollModeId;
  /** 滚动模式专用：滚动到屏幕正中央即停止（内容超过一屏时自动退化为贯穿滚动） */
  endRollStopCenter: boolean;
  /**
   * 结束定格在字幕：视频最后一帧保持显示最终字幕状态（滚动停在中央 / 最后一屏不再淡出）。
   * 关闭时字幕在结尾段结束前约 0.35s 消失（滚出/淡出后以空白收尾）。
   * 仅滚动+不停止（贯穿滚出）组合无定格意义，该组合下此开关不生效。
   */
  endFreeze: boolean;
  /** 片尾字幕内容（每行一条） */
  endRollText: string;
}

// ─────────────────────────── 片尾字幕 ───────────────────────────

export type EndRollModeId = 'roll' | 'fade' | 'cut';

export const END_ROLL_MODES: { id: EndRollModeId; label: string; hint: string }[] = [
  { id: 'roll', label: '滚动', hint: '字幕从下往上滚动' },
  { id: 'fade', label: '淡入淡出', hint: '内容多时自动分屏，每屏淡入停留后淡出' },
  { id: 'cut', label: '无动画', hint: '内容多时自动分屏，直接切换' },
];

export function normalizeEndRollMode(id: unknown): EndRollModeId {
  return END_ROLL_MODES.some((m) => m.id === id) ? (id as EndRollModeId) : 'roll';
}

export const DEFAULT_OPTIONS: SongVideoOptions = {
  aspect: '16:9',
  resolution: '720',
  visualizer: 'bars',
  lyricMode: 'fade',
  lyricAbove: 1,
  lyricBelow: 3,
  showPrevLyric: false,
  showNextLyric: false,
  theme: 'midnight',
  accentColor: null,
  showTitle: true,
  titleText: '',
  progressBar: 'line',
  progressEffect: null,
  introAnim: 'fade',
  introDur: 2.5,
  outroAnim: 'fade',
  outroDur: 2.5,
  coverPageEnabled: false,
  coverTitle: '',
  coverSubtitle: '',
  coverDesc: '',
  coverStyle: 'center',
  coverDur: 3,
  coverSpin: true,
  publisher: '',
  endRollEnabled: false,
  endRollMode: 'roll',
  endRollStopCenter: true,
  endFreeze: true,
  endRollText: '',
};

/**
 * 计算视频时间轴（秒）：
 *   [0, intro)                    开场段（无音频，动画 + 标题）
 *   [intro, intro + audio)        主段（音频播放，可视化/歌词/进度条）
 *   [intro + audio, total)        结尾段（音频已结束，淡出 + 片尾字幕）
 *
 * 结尾段时长：
 *   未启用片尾字幕 → 0：音乐结束即视频结束，总时长贴合歌曲长度（开场段仍按设置保留）；
 *   启用片尾字幕 → max(结尾定格时长, 字幕展示所需时长)，即「按字幕能够展示的时间追加」：
 *     滚动      行数 × 0.55s + 缓冲（滚至中央停止时行程减半，仍按贯穿预留，保证充裕）
 *     淡入淡出  页数 × 2.5s（每屏淡入 + 停留 + 淡出）
 *     无动画    页数 × 2.0s（每屏停留）
 */
export interface Timeline {
  /** 片头封面段时长（秒，0=无封面页） */
  cover: number;
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
/** 片尾字幕淡入淡出每屏耗时（秒） */
const END_ROLL_PAGE_SEC = { fade: 2.5, cut: 2.0 } as const;

/**
 * 片尾字幕区域每屏可容纳的行数。
 * 区域 = [0.15H, 0.88H]（与 renderer.drawEndRoll 一致），行高 = 0.045×短边。
 * aspect 缺省时按 16:9 估算（仅影响时长预留的精度，不影响正确性）。
 */
export function endRollLinesPerScreen(aspect?: { w: number; h: number }): number {
  if (!aspect) return 14;
  const H = aspect.h; // 画面高（aspect 即画布宽高）
  const S = Math.min(aspect.w, aspect.h);
  return Math.max(3, Math.floor((H * 0.73) / (S * 0.045)));
}

export function computeTimeline(
  opts: SongVideoOptions,
  audioDur: number,
  aspect?: { w: number; h: number },
): Timeline {
  const intro = opts.introDur;
  let rollNeed = 0;
  if (opts.endRollEnabled) {
    const lines = opts.endRollText.split('\n').filter((l) => l.trim());
    if (opts.endRollMode === 'fade' || opts.endRollMode === 'cut') {
      const pages = Math.max(1, Math.ceil(lines.length / endRollLinesPerScreen(aspect)));
      rollNeed = lines.length > 0 ? pages * END_ROLL_PAGE_SEC[opts.endRollMode] : 0;
    } else {
      rollNeed = lines.length * ROLL_SEC_PER_LINE + 1.6;
    }
  }
  // 未启用片尾字幕：不追加结尾段（音乐结束即结束）；启用：按字幕展示时间追加
  const outro = opts.endRollEnabled ? Math.max(opts.outroDur, rollNeed) : 0;
  const cover = opts.coverPageEnabled ? opts.coverDur : 0;
  return { cover, intro, audio: audioDur, outro, total: cover + intro + audioDur + outro };
}
