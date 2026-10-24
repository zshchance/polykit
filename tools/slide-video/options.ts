/**
 * 演示翻页视频 —— 选项类型、常量目录、时间轴与默认值。
 *
 * 所有可配置项集中在这里定义（类型 + 展示目录 + 默认值），
 * settings.ts 据此做 localStorage 记忆与逐字段校验，
 * renderer.ts 据此绘制、recorder.ts 据此录制。
 * 纯数据模块：不依赖 DOM，便于单测与复用。
 */

// ─────────────────────────── 宽高比 / 分辨率 ───────────────────────────

export type AspectId = '16:9' | '9:16' | '1:1' | '4:3';

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
  { id: '16:9', label: '16:9 横版', w: Math.round((SHORT * 16) / 9), h: SHORT },
  { id: '9:16', label: '9:16 竖版', w: SHORT, h: Math.round((SHORT * 16) / 9) },
  { id: '1:1', label: '1:1 正方', w: SHORT, h: SHORT },
  { id: '4:3', label: '4:3 传统', w: Math.round((SHORT * 4) / 3), h: SHORT },
];

const DEFAULT_ASPECT: Aspect = ASPECTS[0]!;

export function getAspect(id: string | undefined): Aspect {
  return ASPECTS.find((a) => a.id === id) ?? DEFAULT_ASPECT;
}

/** 导出分辨率档位：短边目标像素（1080 封顶：页快照内存随分辨率平方增长，LRU 容量 4） */
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

// ─────────────────────────── 主题设计 ───────────────────────────

export type ThemeId =
  | 'midnight'
  | 'mono'
  | 'sunset'
  | 'mint'
  | 'violet'
  | 'sakura'
  | 'latte'
  | 'forest'
  | 'autumn'
  | 'winter';

export type ThemeLayoutId =
  'classic' | 'editorial' | 'poster' | 'card' | 'focus' | 'notebook' | 'sidebar';
export type ThemeDecorationId =
  | 'none'
  | 'stars'
  | 'grid'
  | 'horizon'
  | 'blobs'
  | 'aurora'
  | 'petals'
  | 'paper'
  | 'forest'
  | 'autumn'
  | 'snow';
export type ThemeBackgroundId = 'linear' | 'radial' | 'paper' | 'aurora';
export type ThemeTypographyId =
  'classic' | 'modern' | 'editorial' | 'humanist' | 'handwritten' | 'mono';

/** 主题不仅换色：布局、背景、装饰和字体组合均由主题声明。 */
export interface ThemeDesign {
  layout: ThemeLayoutId;
  decoration: ThemeDecorationId;
  background: ThemeBackgroundId;
  typography: ThemeTypographyId;
}

export const DEFAULT_THEME_DESIGN: ThemeDesign = {
  layout: 'classic',
  decoration: 'none',
  background: 'linear',
  typography: 'classic',
};

export const THEME_LAYOUTS: { id: ThemeLayoutId; label: string; hint: string }[] = [
  { id: 'classic', label: '经典居中', hint: '标题居上、正文居中，平衡耐看' },
  { id: 'editorial', label: '编辑分栏', hint: '标题与正文分栏，像杂志跨页' },
  { id: 'poster', label: '发布海报', hint: '大标题与低位正文，强调视觉节奏' },
  { id: 'card', label: '留白卡片', hint: '柔和内容卡片与宽松留白' },
  { id: 'focus', label: '聚焦轴线', hint: '沿视觉中轴组织标题与正文' },
  { id: 'notebook', label: '手账笔记', hint: '纸张纹理、手写气质与自然留白' },
  { id: 'sidebar', label: '侧栏导读', hint: '侧栏标题配合宽阔正文区' },
];

export const THEME_DECORATIONS: { id: ThemeDecorationId; label: string; hint: string }[] = [
  { id: 'none', label: '无装饰', hint: '只保留排版与颜色' },
  { id: 'stars', label: '星轨光点', hint: '细小星点与克制的轨道线' },
  { id: 'grid', label: '编辑网格', hint: '细网格与大号页序' },
  { id: 'horizon', label: '落日光晕', hint: '圆形落日与地平细线' },
  { id: 'blobs', label: '柔形色块', hint: '低对比渐变圆形与弧面' },
  { id: 'aurora', label: '极光弧线', hint: '半透明光晕与流线' },
  { id: 'petals', label: '花瓣枝条', hint: '少量花瓣与纤细枝线' },
  { id: 'paper', label: '纸张纤维', hint: '暖纸颗粒与手写标记' },
  { id: 'forest', label: '植物剪影', hint: '叶片线稿与林间光影' },
  { id: 'autumn', label: '秋叶角饰', hint: '暖色落叶与细枝角饰' },
  { id: 'snow', label: '细雪冰晶', hint: '稀疏雪点与几何冰晶' },
];

export const THEME_BACKGROUNDS: { id: ThemeBackgroundId; label: string; hint: string }[] = [
  { id: 'linear', label: '柔和渐变', hint: '对角双色渐变' },
  { id: 'radial', label: '聚光渐变', hint: '中心光晕与四周暗角' },
  { id: 'paper', label: '细腻纸纹', hint: '浅色底与确定性细颗粒' },
  { id: 'aurora', label: '流光渐变', hint: '多层径向光晕交叠' },
];

export const THEME_TYPOGRAPHIES: { id: ThemeTypographyId; label: string; hint: string }[] = [
  { id: 'classic', label: '经典黑体', hint: '标题与正文使用清晰黑体' },
  { id: 'modern', label: '现代发布', hint: '大号紧凑标题配清爽正文' },
  { id: 'editorial', label: '书刊宋体', hint: '宋体大标题配舒适正文行距' },
  { id: 'humanist', label: '人文无衬线', hint: '温和字重与宽松行距' },
  { id: 'handwritten', label: '手书楷体', hint: '楷体标题与正文，适合手账' },
  { id: 'mono', label: '技术等宽', hint: '等宽标题配紧凑正文' },
];

export function normalizeThemeDesign(value: unknown): ThemeDesign {
  const o = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const pick = <T extends string>(v: unknown, choices: readonly { id: T }[], fallback: T): T =>
    choices.some((c) => c.id === v) ? (v as T) : fallback;
  return {
    layout: pick(o.layout, THEME_LAYOUTS, DEFAULT_THEME_DESIGN.layout),
    decoration: pick(o.decoration, THEME_DECORATIONS, DEFAULT_THEME_DESIGN.decoration),
    background: pick(o.background, THEME_BACKGROUNDS, DEFAULT_THEME_DESIGN.background),
    typography: pick(o.typography, THEME_TYPOGRAPHIES, DEFAULT_THEME_DESIGN.typography),
  };
}

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
  /** 主强调色（倒计时/翻页装饰/标题点缀） */
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
    id: 'midnight',
    label: '深空蓝',
    swatch: 'linear-gradient(135deg,#07111f,#17365e)',
    bg: ['#07111f', '#17365e'],
    fg: '#f2f7fc',
    accent: '#78cbed',
    muted: 'rgba(226,238,248,0.62)',
    light: false,
    design: { layout: 'poster', decoration: 'stars', background: 'radial', typography: 'modern' },
  },
  {
    id: 'mono',
    label: '极简黑白',
    swatch: 'linear-gradient(135deg,#f5f4ef,#d8d7d1)',
    bg: ['#f5f4ef', '#dcdad4'],
    fg: '#1b1b19',
    accent: '#68665f',
    muted: 'rgba(27,27,25,0.54)',
    light: true,
    design: {
      layout: 'editorial',
      decoration: 'grid',
      background: 'paper',
      typography: 'editorial',
    },
  },
  {
    id: 'sunset',
    label: '暖阳橙',
    swatch: 'linear-gradient(135deg,#32170e,#c45d32)',
    bg: ['#32170e', '#b85430'],
    fg: '#fff4e8',
    accent: '#ffd08a',
    muted: 'rgba(255,244,232,0.64)',
    light: false,
    design: {
      layout: 'focus',
      decoration: 'horizon',
      background: 'radial',
      typography: 'editorial',
    },
  },
  {
    id: 'mint',
    label: '薄荷浅色',
    swatch: 'linear-gradient(135deg,#eef8f3,#a9d8c8)',
    bg: ['#eef8f3', '#c3e2d6'],
    fg: '#183f36',
    accent: '#327f6c',
    muted: 'rgba(24,63,54,0.58)',
    light: true,
    design: { layout: 'card', decoration: 'blobs', background: 'linear', typography: 'humanist' },
  },
  {
    id: 'violet',
    label: '幻夜紫',
    swatch: 'linear-gradient(135deg,#160f2b,#593a87)',
    bg: ['#160f2b', '#49316f'],
    fg: '#f5f0fb',
    accent: '#c7a4ef',
    muted: 'rgba(245,240,251,0.6)',
    light: false,
    design: { layout: 'poster', decoration: 'aurora', background: 'aurora', typography: 'mono' },
  },
  {
    id: 'sakura',
    label: '樱花粉',
    swatch: 'linear-gradient(135deg,#fff7f5,#edc6ce)',
    bg: ['#fff8f5', '#efd1d5'],
    fg: '#643b45',
    accent: '#b86d7d',
    muted: 'rgba(100,59,69,0.56)',
    light: true,
    design: {
      layout: 'classic',
      decoration: 'petals',
      background: 'paper',
      typography: 'editorial',
    },
  },
  {
    id: 'latte',
    label: '拿铁棕',
    swatch: 'linear-gradient(135deg,#f8f0e3,#d4b898)',
    bg: ['#f8f0e3', '#dfc8aa'],
    fg: '#513d2d',
    accent: '#9a6a43',
    muted: 'rgba(81,61,45,0.56)',
    light: true,
    design: {
      layout: 'notebook',
      decoration: 'paper',
      background: 'paper',
      typography: 'handwritten',
    },
  },
  {
    id: 'forest',
    label: '森屿绿',
    swatch: 'linear-gradient(135deg,#10271f,#315c48)',
    bg: ['#10271f', '#315c48'],
    fg: '#eef5eb',
    accent: '#a8c991',
    muted: 'rgba(238,245,235,0.6)',
    light: false,
    design: {
      layout: 'sidebar',
      decoration: 'forest',
      background: 'linear',
      typography: 'editorial',
    },
  },
  {
    id: 'autumn',
    label: '秋叶静美',
    swatch: 'linear-gradient(135deg,#f6ead8,#c88958)',
    bg: ['#f6ead8', '#dfb88e'],
    fg: '#563b2a',
    accent: '#a65f36',
    muted: 'rgba(86,59,42,0.57)',
    light: true,
    design: {
      layout: 'editorial',
      decoration: 'autumn',
      background: 'paper',
      typography: 'editorial',
    },
  },
  {
    id: 'winter',
    label: '冬雪清寂',
    swatch: 'linear-gradient(135deg,#edf4f7,#a9c4d2)',
    bg: ['#edf4f7', '#bdd1dc'],
    fg: '#263f50',
    accent: '#648da3',
    muted: 'rgba(38,63,80,0.55)',
    light: true,
    design: { layout: 'focus', decoration: 'snow', background: 'radial', typography: 'modern' },
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

// 让 TS 确保 THEMES 覆盖 ThemeId 全集（新增内置主题时漏改 ThemeId 会在此报错）
const _themeIdCheck: Record<ThemeId, true> = Object.fromEntries(
  THEMES.map((t) => [t.id, true as const]),
) as Record<ThemeId, true>;
void _themeIdCheck;

// ─────────────────────────── 翻页动画 ───────────────────────────

export type FlipId = 'fade' | 'slide' | 'cover' | 'reveal' | 'zoom' | 'flip' | 'blinds';

/**
 * 翻页动画选择：内置样式 id，或自定义翻页动画 id（cflip: 前缀，本体存
 * custom-transitions.ts；渲染时解析失败/被删除则回退淡入淡出）。
 */
export type FlipSelection = FlipId | `cflip:${string}`;

export interface Flip {
  id: FlipId;
  label: string;
  hint: string;
}

export const FLIPS: Flip[] = [
  { id: 'fade', label: '淡入淡出', hint: '新旧页交叉淡化，最稳妥的默认选择' },
  { id: 'slide', label: '同向滑动', hint: '两页像传送带一样一起向左滑动' },
  { id: 'cover', label: '覆盖推入', hint: '新页从右侧滑入盖住旧页' },
  { id: 'reveal', label: '揭开露底', hint: '旧页向左滑走，露出下方的新页' },
  { id: 'zoom', label: '缩放切换', hint: '旧页缩小淡出，新页放大浮现' },
  { id: 'flip', label: '拟物翻页', hint: '从右下角掀起纸张，带曲面、页背与自然回弹' },
  { id: 'blinds', label: '百叶窗', hint: '竖条百叶窗逐条翻开新页' },
];

const DEFAULT_FLIP: FlipId = 'fade';

export function normalizeFlip(id: unknown): FlipSelection {
  if (FLIPS.some((f) => f.id === id)) return id as FlipId;
  if (typeof id === 'string' && isCustomFlipId(id)) return id;
  return DEFAULT_FLIP;
}

/** 判断是否自定义翻页动画 id（cflip: 前缀）；兼作 FlipSelection 的类型收窄 */
export function isCustomFlipId(id: string): id is `cflip:${string}` {
  return id.startsWith('cflip:');
}

// ─────────────────────────── 文字入场 ───────────────────────────

export type EnterId = 'none' | 'fade' | 'rise';

export const ENTERS: { id: EnterId; label: string; hint: string }[] = [
  { id: 'none', label: '无', hint: '翻页完成后文字直接呈现' },
  { id: 'fade', label: '逐行淡入', hint: '标题与正文逐行浮现' },
  { id: 'rise', label: '逐行上浮', hint: '逐行自下而上滑入浮现' },
];

export function normalizeEnter(id: unknown): EnterId {
  return ENTERS.some((e) => e.id === id) ? (id as EnterId) : 'fade';
}

/** 文字入场动画基准时长（秒，按页内行数内部分摊） */
export const ENTER_BASE_DUR = 0.5;

// ─────────────────────────── 翻页倒计时 ───────────────────────────

export type CountdownId = 'none' | 'number' | 'bar' | 'ring';

/**
 * 倒计时选择：内置样式 id，或自定义倒计时样式 id（ccd: 前缀，本体存
 * custom-countdowns.ts；渲染时解析失败/被删除则隐藏倒计时）。
 */
export type CountdownSelection = CountdownId | `ccd:${string}`;

export const COUNTDOWNS: { id: CountdownId; label: string; hint: string }[] = [
  { id: 'none', label: '不显示', hint: '画面只保留正文' },
  { id: 'number', label: '数字', hint: '角落大数字倒数本页剩余秒数' },
  { id: 'bar', label: '进度条', hint: '底部细进度条随时间流逝缩短' },
  { id: 'ring', label: '圆环', hint: '角落圆环 + 中心数字倒数' },
];

export function normalizeCountdown(id: unknown): CountdownSelection {
  if (COUNTDOWNS.some((c) => c.id === id)) return id as CountdownId;
  if (typeof id === 'string' && isCustomCountdownId(id)) return id;
  return 'none';
}

/** 判断是否自定义倒计时样式 id（ccd: 前缀）；兼作 CountdownSelection 的类型收窄 */
export function isCustomCountdownId(id: string): id is `ccd:${string}` {
  return id.startsWith('ccd:');
}

/** 倒计时显示位置（内置样式的四角；自定义样式自行决定位置） */
export type CountdownPosId = 'br' | 'bl' | 'tr' | 'tl';

export const COUNTDOWN_POS: { id: CountdownPosId; label: string }[] = [
  { id: 'br', label: '右下' },
  { id: 'bl', label: '左下' },
  { id: 'tr', label: '右上' },
  { id: 'tl', label: '左上' },
];

export function normalizeCountdownPos(id: unknown): CountdownPosId {
  return COUNTDOWN_POS.some((p) => p.id === id) ? (id as CountdownPosId) : 'br';
}

// ─────────────────────────── 字体 / 对齐 ───────────────────────────

export type FontId = 'sans' | 'serif' | 'kai' | 'mono';

export interface FontChoice {
  id: FontId;
  label: string;
  /** canvas font 简写用的字体栈 */
  stack: string;
}

export const FONTS: FontChoice[] = [
  {
    id: 'sans',
    label: '黑体',
    stack: `ui-sans-serif, system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif`,
  },
  {
    id: 'serif',
    label: '宋体',
    stack: `ui-serif, Georgia, 'Songti SC', 'SimSun', 'Noto Serif SC', serif`,
  },
  { id: 'kai', label: '楷体', stack: `'Kaiti SC', STKaiti, KaiTi, 'Noto Serif SC', serif` },
  {
    id: 'mono',
    label: '等宽',
    stack: `ui-monospace, SFMono-Regular, Menlo, Consolas, 'Noto Sans Mono CJK SC', monospace`,
  },
];

export function normalizeFont(id: unknown): FontId {
  return FONTS.some((f) => f.id === id) ? (id as FontId) : 'sans';
}

/** canvas font 简写（含字体栈；size 单位 px） */
export function fontOf(font: FontId, weight: string, size: number): string {
  const f = FONTS.find((x) => x.id === font) ?? FONTS[0]!;
  return `${weight} ${size}px ${f.stack}`;
}

export type AlignId = 'left' | 'center';

export const ALIGNS: { id: AlignId; label: string }[] = [
  { id: 'center', label: '居中' },
  { id: 'left', label: '左对齐' },
];

export function normalizeAlign(id: unknown): AlignId {
  return ALIGNS.some((a) => a.id === id) ? (id as AlignId) : 'center';
}

// ─────────────────────────── 时长档位 ───────────────────────────

/** 每页停留时长档位（秒） */
export const PAGE_DUR_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15] as const;
/** 翻页动画时长档位（秒） */
export const FLIP_DUR_CHOICES = [0.2, 0.35, 0.5, 0.6, 0.8, 1.0, 1.2] as const;

// ─────────────────────────── 完整选项 ───────────────────────────

export type SoundEffectId = 'none' | 'paper' | 'soft' | 'crisp';

export interface SlideVideoOptions {
  /** 演示文稿原文（分页规则见 paginate.ts；本工具的核心内容，随设置一并记忆） */
  contentText: string;
  /** 画布宽高比 */
  aspect: AspectId;
  /** 导出分辨率（短边像素档位） */
  resolution: ResolutionId;
  /** 每页停留时长（秒） */
  pageDur: number;
  /** 翻页动画时长（秒；实际值受「2×翻页 + 入场 ≤ 每页时长」约束收窄） */
  flipDur: number;
  /** 翻页动画（内置 id 或 cflip: 自定义 id） */
  flip: FlipSelection;
  /** 首页是否从空白翻入并播放对应音效；false 时首页直接呈现 */
  firstPageFlip: boolean;
  /** 文字入场动画 */
  enter: EnterId;
  /** 翻页倒计时（内置 id 或 ccd: 自定义 id） */
  countdown: CountdownSelection;
  /** 倒计时显示位置（内置样式生效） */
  countdownPos: CountdownPosId;
  /** 是否显示页码（页面底部 i / n） */
  showPageNo: boolean;
  /** 主题配色：内置 ThemeId 或自定义主题 id（custom: 前缀） */
  theme: string;
  /** 自定义主色（覆盖主题 accent；null=跟随主题） */
  accentColor: string | null;
  /** 字体覆盖（null = 跟随主题字体组合） */
  font: FontId | null;
  /** 对齐覆盖（null = 跟随主题版式） */
  align: AlignId | null;
  /** 翻页音效（默认无音效） */
  soundEffect: SoundEffectId;
  /** 翻页音效音量 0-100 */
  soundVolume: number;
  /** 背景音乐音量（0-100，仅预览外放与导出音轨） */
  bgmVolume: number;
  /** BGM 短于总时长时是否循环 */
  bgmLoop: boolean;
}

export const DEFAULT_OPTIONS: SlideVideoOptions = {
  contentText: '',
  aspect: '16:9',
  resolution: '720',
  pageDur: 4,
  flipDur: 0.8,
  flip: 'flip',
  firstPageFlip: true,
  enter: 'fade',
  countdown: 'none',
  countdownPos: 'br',
  showPageNo: true,
  theme: 'midnight',
  accentColor: null,
  font: null,
  align: null,
  soundEffect: 'none',
  soundVolume: 55,
  bgmVolume: 70,
  bgmLoop: true,
};

// ─────────────────────────── 时间轴 ───────────────────────────

/**
 * 时间轴（秒）。每页占据一个等长 slot：[i×D, (i+1)×D)。
 *   slot 开头 flipDur   翻入段（第 0 页可选择从空白翻入；上一页 → 本页）
 *   其后                 停留段（文字入场 enterDur + 静置）
 *   最后一页             一直停留到总时长结束，不额外插入空白页
 *
 * 时长收窄沿用原有节奏约束，避免升级后改变已有文稿的播放速度：
 *   2×flipDur + enterDur ≤ pageDur —— 越界时在本函数内防御性收窄，
 *   而不是与用户设置打架（pageDur=1s 的极限档也能安全渲染）。
 */
export interface Timeline {
  /** 总页数（0 = 无内容） */
  pages: number;
  /** 每页时长（秒） */
  pageDur: number;
  /** 实际翻页动画时长（秒，已收窄） */
  flipDur: number;
  /** 实际文字入场时长（秒，已收窄；无入场 = 0） */
  enterDur: number;
  /** 总时长（秒）= pages × pageDur */
  total: number;
}

export function computeTimeline(
  opts: Pick<SlideVideoOptions, 'pageDur' | 'flipDur' | 'enter'>,
  pageCount: number,
): Timeline {
  const pages = Math.max(0, Math.floor(pageCount));
  const D = Math.max(0.5, opts.pageDur);
  const flipDur = Math.max(0.1, Math.min(opts.flipDur, (D - 0.3) / 2));
  const enterDur =
    opts.enter === 'none' ? 0 : Math.max(0, Math.min(ENTER_BASE_DUR, D - 2 * flipDur - 0.1));
  return { pages, pageDur: D, flipDur, enterDur, total: pages * D };
}

/**
 * t 时刻的画面状态（drawFrame 的唯一决策依据，纯函数可单测）。
 * from/to 为页索引，-1 表示空白页；mode 描述两态：
 *   flip-in  翻入段（上一页/空白 → 本页），p 为 0→1 线性进度
 *   hold     停留段（enterP 0→1 为文字入场进度，1 = 完成；末页保持到结束）
 */
export interface FrameState {
  mode: 'flip-in' | 'hold';
  /** 当前页索引 */
  page: number;
  /** 翻页进度（flip-in 有效，0..1 线性） */
  p: number;
  /** 翻入来源页：-1 = 从空白翻入（仅 flip-in 有意义） */
  fromPage: number;
  /** 文字入场进度（hold 有效，0..1；无入场恒为 1） */
  enterP: number;
  /** 本页剩余秒数（倒计时用；始终相对当前页 slot 结束点） */
  remain: number;
}

/** 计算 t 时刻的画面状态；无页面时返回 null */
export function pageAt(t: number, tl: Timeline, firstPageFlip = true): FrameState | null {
  if (tl.pages < 1) return null;
  const tc = Math.min(Math.max(t, 0), tl.total);
  const D = tl.pageDur;
  const idx = Math.min(tl.pages - 1, Math.floor(tc / D));
  const tIn = tc - idx * D; // 页内时间
  const slotEnd = (idx + 1) * D;
  const remain = Math.max(0, slotEnd - tc);

  const skipIntroFlip = idx === 0 && !firstPageFlip;

  // 翻入段：slot 开头 flipDur（第 0 页可选择直接呈现，不参与翻入）
  if (!skipIntroFlip && tIn < tl.flipDur) {
    return {
      mode: 'flip-in',
      page: idx,
      p: tIn / tl.flipDur,
      fromPage: idx - 1,
      enterP: 0,
      remain,
    };
  }

  // 停留段：翻页完成后入场，其余时间静置
  const enterStart = skipIntroFlip ? 0 : tl.flipDur;
  const enterP = tl.enterDur <= 0 ? 1 : Math.min(1, Math.max(0, (tIn - enterStart) / tl.enterDur));
  return { mode: 'hold', page: idx, p: 1, fromPage: idx - 1, enterP, remain };
}
