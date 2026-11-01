/**
 * 文字快闪视频 —— 选项类型、常量目录、默认值与画面状态。
 *
 * 所有可配置项集中在这里定义（类型 + 展示目录 + 默认值），
 * settings.ts 据此做 localStorage 记忆与逐字段校验，
 * renderer.ts 据此绘制、recorder.ts 据此录制。
 * 纯数据模块：不依赖 DOM，便于单测与复用。
 */

// ─────────────────────────── 宽高比 / 分辨率 ───────────────────────────

export type AspectId = '9:16' | '16:9' | '1:1' | '4:3';

export interface Aspect {
  id: AspectId;
  label: string;
  /** 视频宽（px，短边基准换算） */
  w: number;
  /** 视频高（px） */
  h: number;
}

const SHORT = 1080;

export const ASPECTS: Aspect[] = [
  { id: '9:16', label: '9:16 竖版', w: SHORT, h: Math.round((SHORT * 16) / 9) },
  { id: '16:9', label: '16:9 横版', w: Math.round((SHORT * 16) / 9), h: SHORT },
  { id: '1:1', label: '1:1 正方', w: SHORT, h: SHORT },
  { id: '4:3', label: '4:3 传统', w: Math.round((SHORT * 4) / 3), h: SHORT },
];

const DEFAULT_ASPECT: Aspect = ASPECTS[0]!;

export function getAspect(id: string | undefined): Aspect {
  return ASPECTS.find((a) => a.id === id) ?? DEFAULT_ASPECT;
}

export type ResolutionId = '540' | '720' | '1080';

export interface Resolution {
  id: ResolutionId;
  label: string;
  shortSide: number;
}

export const RESOLUTIONS: Resolution[] = [
  { id: '540', label: '540p 流畅（文件小）', shortSide: 540 },
  { id: '720', label: '720p 高清（推荐）', shortSide: 720 },
  { id: '1080', label: '1080p 全高清', shortSide: 1080 },
];

const DEFAULT_RESOLUTION: Resolution = RESOLUTIONS[1]!;

export function getResolution(id: string | undefined): Resolution {
  return RESOLUTIONS.find((r) => r.id === id) ?? DEFAULT_RESOLUTION;
}

// ─────────────────────────── 字体 ───────────────────────────

export type FontId = 'sans' | 'serif' | 'kai' | 'mono' | 'heavy';

export interface FontChoice {
  id: FontId;
  label: string;
  /** canvas font 简写用的字体栈 */
  stack: string;
  /** 字重（快闪视频默认偏粗，强调冲击力） */
  weight: string;
}

export const FONTS: FontChoice[] = [
  {
    id: 'sans',
    label: '黑体',
    stack: `ui-sans-serif, system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif`,
    weight: '700',
  },
  {
    id: 'serif',
    label: '宋体',
    stack: `ui-serif, Georgia, 'Songti SC', 'SimSun', 'Noto Serif SC', serif`,
    weight: '700',
  },
  {
    id: 'kai',
    label: '楷体',
    stack: `'Kaiti SC', STKaiti, KaiTi, 'Noto Serif SC', serif`,
    weight: '700',
  },
  {
    id: 'mono',
    label: '等宽',
    stack: `ui-monospace, SFMono-Regular, Menlo, Consolas, 'Noto Sans Mono CJK SC', monospace`,
    weight: '700',
  },
  {
    id: 'heavy',
    label: '超粗黑',
    stack: `ui-sans-serif, system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif`,
    weight: '900',
  },
];

const DEFAULT_FONT: FontId = 'sans';

export function normalizeFont(id: unknown): FontId {
  return FONTS.some((f) => f.id === id) ? (id as FontId) : DEFAULT_FONT;
}

export function fontOf(font: FontId, size: number): string {
  const f = FONTS.find((x) => x.id === font) ?? FONTS[0]!;
  return `${f.weight} ${size}px ${f.stack}`;
}

export function weightOf(font: FontId): string {
  return (FONTS.find((x) => x.id === font) ?? FONTS[0]!).weight;
}

// ─────────────────────────── 卡片版式 / 背景 ───────────────────────────

export type LayoutId = 'center' | 'stack' | 'band' | 'corner';

export const LAYOUTS: { id: LayoutId; label: string; hint: string }[] = [
  { id: 'center', label: '正中大字', hint: '文字居中，冲击力最强，适合短句' },
  { id: 'stack', label: '左对齐堆叠', hint: '左侧对齐，适合多行短语与清单' },
  {
    id: 'band',
    label: '高亮色带',
    hint: '文字压在整块主色带子上，对比强烈、便于远看',
  },
  { id: 'corner', label: '左下角标', hint: '文字贴左下，配一道主色竖线，留出大片呼吸感' },
];

export type BackgroundId = 'linear' | 'radial' | 'aurora' | 'grid' | 'grain';

export const BACKGROUNDS: { id: BackgroundId; label: string; hint: string }[] = [
  { id: 'linear', label: '柔光渐变', hint: '对角双色渐变，最稳妥的底色' },
  { id: 'radial', label: '聚光渐变', hint: '中心提亮、四周压暗，聚焦文字' },
  { id: 'aurora', label: '流光极光', hint: '多层径向光晕交叠，适合暗色霓虹主题' },
  { id: 'grid', label: '编辑网格', hint: '细网格线与微弱暗角，理性、排版感强' },
  { id: 'grain', label: '胶片颗粒', hint: '确定性细噪点，带一点复古质感' },
];

export interface ThemeDesign {
  layout: LayoutId;
  background: BackgroundId;
  font: FontId;
}

export const DEFAULT_THEME_DESIGN: ThemeDesign = {
  layout: 'center',
  background: 'linear',
  font: 'sans',
};

export function normalizeThemeDesign(value: unknown): ThemeDesign {
  const o = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const pick = <T extends string>(v: unknown, choices: readonly { id: T }[], fallback: T): T =>
    choices.some((c) => c.id === v) ? (v as T) : fallback;
  return {
    layout: pick(o.layout, LAYOUTS, DEFAULT_THEME_DESIGN.layout),
    background: pick(o.background, BACKGROUNDS, DEFAULT_THEME_DESIGN.background),
    font: pick(o.font, FONTS, DEFAULT_THEME_DESIGN.font),
  };
}

// ─────────────────────────── 主题 ───────────────────────────

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
  /** 主强调色（强调卡/色带/进度条） */
  accent: string;
  /** 次要文字色 */
  muted: string;
  /** 背景是否偏亮（决定文字对比处理） */
  light: boolean;
  /** 主题的完整视觉设计，而非只有色板 */
  design: ThemeDesign;
}

export const THEMES: Theme[] = [
  {
    id: 'neon',
    label: '深空霓虹',
    swatch: 'linear-gradient(135deg,#061019,#173a5c)',
    bg: ['#061019', '#12324f'],
    fg: '#f2f8ff',
    accent: '#38e8ff',
    muted: 'rgba(226,238,248,0.6)',
    light: false,
    design: { layout: 'center', background: 'aurora', font: 'heavy' },
  },
  {
    id: 'mono',
    label: '墨白电波',
    swatch: 'linear-gradient(135deg,#f6f5f0,#dedcd4)',
    bg: ['#f6f5f0', '#dedcd4'],
    fg: '#161614',
    accent: '#e63b2e',
    muted: 'rgba(22,22,20,0.55)',
    light: true,
    design: { layout: 'stack', background: 'grid', font: 'heavy' },
  },
  {
    id: 'sunset',
    label: '落日胶片',
    swatch: 'linear-gradient(135deg,#2a120b,#a83f22)',
    bg: ['#2a120b', '#a83f22'],
    fg: '#fff3e6',
    accent: '#ffcb6b',
    muted: 'rgba(255,243,230,0.62)',
    light: false,
    design: { layout: 'band', background: 'radial', font: 'serif' },
  },
  {
    id: 'mint',
    label: '薄荷呼吸',
    swatch: 'linear-gradient(135deg,#eefaf3,#bfe6d6)',
    bg: ['#eefaf3', '#bfe6d6'],
    fg: '#0e3d31',
    accent: '#0f9e78',
    muted: 'rgba(14,61,49,0.56)',
    light: true,
    design: { layout: 'corner', background: 'linear', font: 'sans' },
  },
  {
    id: 'cyber',
    label: '赛博紫电',
    swatch: 'linear-gradient(135deg,#120724,#3d1d6e)',
    bg: ['#120724', '#3d1d6e'],
    fg: '#f6eeff',
    accent: '#c77dff',
    muted: 'rgba(246,238,255,0.6)',
    light: false,
    design: { layout: 'center', background: 'grid', font: 'mono' },
  },
  {
    id: 'sakura',
    label: '樱花噪点',
    swatch: 'linear-gradient(135deg,#fff6f4,#f0ccd4)',
    bg: ['#fff6f4', '#f0ccd4'],
    fg: '#5c2b36',
    accent: '#d1506b',
    muted: 'rgba(92,43,54,0.56)',
    light: true,
    design: { layout: 'band', background: 'grain', font: 'kai' },
  },
];

const DEFAULT_THEME: Theme = THEMES[0]!;

export function getTheme(id: string | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? DEFAULT_THEME;
}

/** 按 id 严格归一化内置主题 id，非法回退默认（自定义 custom: id 由 custom-themes 层解析） */
export function normalizeTheme(id: unknown): string {
  return THEMES.some((t) => t.id === id) ? (id as string) : DEFAULT_THEME.id;
}

// ─────────────────────────── 入场动效 ───────────────────────────

export type MotionId = 'none' | 'pop' | 'slideUp' | 'zoom' | 'typewriter' | 'shake' | 'flip' | 'wipe';

/**
 * 动效选择：内置样式 id，或自定义动效 id（cmot: 前缀，本体存
 * custom-motions.ts；渲染时解析失败/被删除则回退内置「弹入」）。
 */
export type MotionSelection = MotionId | `cmot:${string}`;

export interface Motion {
  id: MotionId;
  label: string;
  hint: string;
}

export const MOTIONS: Motion[] = [
  { id: 'pop', label: '弹入', hint: '从小到大带一点回弹，最百搭的快闪入场' },
  { id: 'slideUp', label: '上滑', hint: '自下而上滑入，轻快利落' },
  { id: 'zoom', label: '缩放淡入', hint: '轻微放大并浮现，克制耐看' },
  { id: 'typewriter', label: '打字机', hint: '逐字敲出，适合金句与口播节奏' },
  { id: 'shake', label: '抖动冲击', hint: '落地后快速衰减的横向抖动，强调「重音」' },
  { id: 'flip', label: '翻转', hint: '纵向翻转入场，像翻牌' },
  { id: 'wipe', label: '擦除揭示', hint: '从左到右擦出文字，节奏感强' },
  { id: 'none', label: '无动效', hint: '硬切切换，纯靠节奏与排版' },
];

const DEFAULT_MOTION: MotionId = 'pop';

export function normalizeMotion(id: unknown): MotionSelection {
  if (MOTIONS.some((m) => m.id === id)) return id as MotionId;
  if (typeof id === 'string' && isCustomMotionId(id)) return id;
  return DEFAULT_MOTION;
}

/** 判断是否自定义动效 id（cmot: 前缀）；兼作 MotionSelection 的类型收窄 */
export function isCustomMotionId(id: string): id is `cmot:${string}` {
  return id.startsWith('cmot:');
}

// ─────────────────────────── 强调 / 进度 ───────────────────────────

export type EmphasisId = 'accent' | 'block' | 'underline';

export const EMPHASES: { id: EmphasisId; label: string; hint: string }[] = [
  { id: 'accent', label: '主色文字', hint: '强调卡的文字整体换成主色' },
  { id: 'block', label: '色块反白', hint: '文字后面垫一块主色，白字反显' },
  { id: 'underline', label: '主色下划线', hint: '在强调卡最后一行下方加一道粗线' },
];

export function normalizeEmphasis(id: unknown): EmphasisId {
  return EMPHASES.some((e) => e.id === id) ? (id as EmphasisId) : 'accent';
}

export type ProgressId = 'none' | 'bar' | 'dots';

export const PROGRESSES: { id: ProgressId; label: string; hint: string }[] = [
  { id: 'none', label: '不显示', hint: '画面只保留文字与背景' },
  { id: 'bar', label: '底部进度条', hint: '底部细线随时间推进，交代整条视频进度' },
  { id: 'dots', label: '卡片圆点', hint: '底部一排圆点标记当前卡片（超过 24 张时退化为进度条）' },
];

export function normalizeProgress(id: unknown): ProgressId {
  return PROGRESSES.some((p) => p.id === id) ? (id as ProgressId) : 'bar';
}

// ─────────────────────────── 节奏 ───────────────────────────

export type PaceId = 'chill' | 'normal' | 'fast' | 'hyper';

export interface Pace {
  id: PaceId;
  label: string;
  hint: string;
  /** 每张卡的基础时长（秒） */
  baseDur: number;
  /** 每个字符追加的时长（秒） */
  charDur: number;
  minDur: number;
  maxDur: number;
}

export const PACES: Pace[] = [
  {
    id: 'chill',
    label: '舒缓',
    hint: '每张卡停留更久，适合叙事型口播',
    baseDur: 0.85,
    charDur: 0.115,
    minDur: 0.5,
    maxDur: 3,
  },
  {
    id: 'normal',
    label: '标准',
    hint: '常规快闪节奏，长短句自然拉开差距',
    baseDur: 0.55,
    charDur: 0.095,
    minDur: 0.34,
    maxDur: 2,
  },
  {
    id: 'fast',
    label: '快闪',
    hint: '卡片切得很快，适合短句密集型文案',
    baseDur: 0.4,
    charDur: 0.075,
    minDur: 0.24,
    maxDur: 1.35,
  },
  {
    id: 'hyper',
    label: '狂暴',
    hint: '接近逐词闪现，必须配短句使用',
    baseDur: 0.3,
    charDur: 0.055,
    minDur: 0.16,
    maxDur: 0.95,
  },
];

const DEFAULT_PACE: PaceId = 'normal';

export function normalizePace(id: unknown): PaceId {
  return PACES.some((p) => p.id === id) ? (id as PaceId) : DEFAULT_PACE;
}

// ─────────────────────────── 音效 ───────────────────────────

export type SoundEffectId = 'none' | 'click' | 'pop' | 'whoosh';

export interface SoundEffectChoice {
  id: SoundEffectId;
  label: string;
  hint: string;
}

export const SOUND_EFFECTS: SoundEffectChoice[] = [
  { id: 'none', label: '无音效', hint: '只保留背景音乐' },
  { id: 'click', label: '机械咔哒', hint: '短促的电子按键声，科技感强' },
  { id: 'pop', label: '气泡弹入', hint: '轻微的低频弹响，轻松俏皮' },
  { id: 'whoosh', label: '气流掠过', hint: '短促风声扫过，适合快速切卡' },
];

export function normalizeSoundEffect(id: unknown): SoundEffectId {
  return SOUND_EFFECTS.some((s) => s.id === id) ? (id as SoundEffectId) : 'none';
}

// ─────────────────────────── 节拍对齐 ───────────────────────────

export type SyncId = 'auto' | 'beat';

export const SYNCS: { id: SyncId; label: string; hint: string }[] = [
  { id: 'auto', label: '自动节奏', hint: '按卡片字数计算时长' },
  { id: 'beat', label: '跟随节拍', hint: '卡片切换点对齐 BGM 的鼓点（需先加载音乐）' },
];

export function normalizeSync(id: unknown): SyncId {
  return SYNCS.some((s) => s.id === id) ? (id as SyncId) : 'auto';
}

// ─────────────────────────── AI 动效的绘制契约 ───────────────────────────

/** 渲染端算好的卡片排版（AI 动效直接据此绘制文字） */
export interface CardLayout {
  /** 已折行的文本（显式换行已保留） */
  lines: string[];
  /** 最终字号（px） */
  size: number;
  /** 行高倍数（相对字号） */
  lineHeight: number;
  /** 文字锚点 x（按 align 解释） */
  x: number;
  align: 'left' | 'center';
  /** 文本块垂直中心 y */
  centerY: number;
  /** 已绑定字号的 canvas font 简写（AI 代码直接 ctx.font = layout.font） */
  font: string;
}

/** 卡片内容（供 AI 动效判断强调与标题） */
export interface CardMotionInput {
  text: string;
  em: boolean;
  title: boolean;
}

/** 自定义动效的一帧入参 */
export interface MotionFrame {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  /** 短边（所有尺寸按 S 的比例表达，适配各比例） */
  S: number;
  /** 卡片内进度 0→1（覆盖整张卡片的停留区间，不只是入场段） */
  p: number;
  card: CardMotionInput;
  layout: CardLayout;
  theme: Theme;
}

/** 自定义动效：绘制整张卡片视觉；返回 false = 守卫放弃（回退内置动效） */
export type MotionDraw = (frame: MotionFrame) => boolean;

// ─────────────────────────── 完整选项 ───────────────────────────

export interface FlashOptions {
  /** 文案原文（切卡规则见 script.ts；本工具的核心内容，随设置一并记忆） */
  contentText: string;
  /** 画布宽高比 */
  aspect: AspectId;
  /** 导出分辨率（短边像素档位） */
  resolution: ResolutionId;
  /** 节奏档位 */
  pace: PaceId;
  /** 全局速度倍率（0.6-2；数值越大切得越快） */
  speed: number;
  /** 节奏模式：自动 / 跟随节拍 */
  sync: SyncId;
  /** 入场动效（内置 id 或 cmot: 自定义 id） */
  motion: MotionSelection;
  /** 主题配色：内置 ThemeId 或自定义主题 id（custom: 前缀） */
  theme: string;
  /** 自定义主色（覆盖主题 accent；null=跟随主题） */
  accentColor: string | null;
  /** 字体覆盖（null = 跟随主题字体） */
  font: FontId | null;
  /** 强调卡样式 */
  emphasis: EmphasisId;
  /** 进度指示样式 */
  progress: ProgressId;
  /** 切卡音效 */
  soundEffect: SoundEffectId;
  /** 音效音量 0-100 */
  soundVolume: number;
  /** 背景音乐音量（0-100） */
  bgmVolume: number;
  /** BGM 短于总时长时是否循环 */
  bgmLoop: boolean;
}

export const DEFAULT_OPTIONS: FlashOptions = {
  contentText: '',
  aspect: '9:16',
  resolution: '720',
  pace: 'normal',
  speed: 1,
  sync: 'auto',
  motion: 'pop',
  theme: 'neon',
  accentColor: null,
  font: null,
  emphasis: 'accent',
  progress: 'bar',
  soundEffect: 'none',
  soundVolume: 55,
  bgmVolume: 70,
  bgmLoop: true,
};

// ─────────────────────────── 时间轴与画面状态 ───────────────────────────

/** 时间轴（秒）：每张卡片一个变长 slot，starts[i] 为第 i 张的开始时刻 */
export interface Timeline {
  /** 卡片数（0 = 无内容） */
  cards: number;
  /** 每张卡的时长（秒） */
  durations: number[];
  /** 每张卡的开始时刻（秒） */
  starts: number[];
  /** 总时长（秒） */
  total: number;
  /** 是否真正按 BGM 节拍对齐（false 时即使选了 beat 也已回退自动节奏） */
  beatSynced: boolean;
}

export interface CardFrameState {
  /** 当前卡片索引 */
  index: number;
  /** 卡片内进度 0..1 */
  p: number;
  /** 卡片内已过时间（秒） */
  tIn: number;
  /** 本卡时长（秒） */
  dur: number;
  /** 本卡剩余秒数 */
  remain: number;
}

/** 计算 t 时刻的卡片状态；无卡片时返回 null */
export function cardAt(t: number, tl: Timeline): CardFrameState | null {
  if (tl.cards < 1) return null;
  const tc = Math.min(Math.max(t, 0), tl.total);
  // 二分查找最后一个 starts <= tc
  let lo = 0;
  let hi = tl.cards - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tl.starts[mid]! <= tc) lo = mid;
    else hi = mid - 1;
  }
  const index = lo;
  const start = tl.starts[index]!;
  const dur = tl.durations[index]!;
  const tIn = Math.max(0, tc - start);
  return {
    index,
    p: Math.min(1, tIn / Math.max(0.01, dur)),
    tIn,
    dur,
    remain: Math.max(0, dur - tIn),
  };
}
