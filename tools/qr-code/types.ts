/**
 * 二维码生成器 —— 共享类型定义。
 *
 * 把"形状/纠错/配色/Logo"等正交的用户偏好集中在此，供 render / settings / main 复用。
 * 新增形状或风格只需在对应数组追加，选择器会自动渲染。
 */

/** 码点（模块）形状 */
export type DotShape = 'square' | 'dot' | 'rounded';
// 眼角（定位图案）的形状，与码点解耦：很多美化会把三个角的"眼"单独换风格
export type EyeShape = 'square' | 'rounded' | 'circle';

/** 纠错等级：越高容错越多（码更大但即使被遮挡/Logo 覆盖也能识别） */
export type ErrorLevel = 'L' | 'M' | 'Q' | 'H';

/** Logo 裁剪形状 */
export type LogoFit = 'square' | 'rounded';

/**
 * 一套美化"预设模板"：把码点/眼/配色/Logo 形状打包成可一键套用的组合。
 * 用户选预设即覆盖对应字段；预设不绑死，套用后仍可继续微调。
 */
export interface QrPreset {
  id: string;
  /** 展示名 */
  name: string;
  /** 预览用的色条（前→背，给选择器看一眼风格） */
  swatch: [string, string];
  /** 套用时覆盖这些字段（未列出的字段保持不变） */
  apply: Partial<Omit<QrConfig, 'text' | 'errorLevel' | 'withLogo' | 'logoRatio'>>;
}

/** 完整生成配置（编码 + 外观） */
export interface QrConfig {
  /** 编码文本/URL */
  text: string;
  /** 纠错等级 */
  errorLevel: ErrorLevel;
  /** 码点形状 */
  dotShape: DotShape;
  /** 定位点形状 */
  eyeShape: EyeShape;
  /** 前景色（码点颜色） */
  fgColor: string;
  /** 背景色（留空串=透明） */
  bgColor: string;
  /** 是否嵌入中心 Logo */
  withLogo: boolean;
  /** Logo 占比（相对于整码边长，0-1），默认 0.22 */
  logoRatio: number;
  /** Logo 裁剪形状（圆角避免和码点衔接生硬） */
  logoFit: LogoFit;
  /** 当前激活的风格预设 id（内置 PRESETS 的 id、custom:xxx 自定义风格、或 null）。
   *  仅用于重进时恢复高亮与（若是 AI 风格）码点效果钩子；不参与渲染参数，渲染读 cfg 的其它字段。 */
  activeStyleId: string | null;
}

export const DOT_SHAPES: { id: DotShape; name: string }[] = [
  { id: 'square', name: '方块' },
  { id: 'dot', name: '圆点' },
  { id: 'rounded', name: '圆角' },
];

export const EYE_SHAPES: { id: EyeShape; name: string }[] = [
  { id: 'square', name: '方块' },
  { id: 'rounded', name: '圆角' },
  { id: 'circle', name: '圆形' },
];

export const ERROR_LEVELS: { id: ErrorLevel; name: string; desc: string }[] = [
  { id: 'L', name: 'L 低', desc: '约 7% 容错' },
  { id: 'M', name: 'M 中', desc: '约 15% 容错' },
  { id: 'Q', name: 'Q 高', desc: '约 25% 容错' },
  { id: 'H', name: 'H 最高', desc: '约 30% 容错（嵌 Logo 建议）' },
];

export const DEFAULT_CONFIG: QrConfig = {
  text: 'https://zshchance.github.io/polykit/',
  errorLevel: 'M',
  dotShape: 'square',
  eyeShape: 'square',
  fgColor: '#0f172a',
  bgColor: '#ffffff',
  withLogo: false,
  logoRatio: 0.22,
  logoFit: 'rounded',
  activeStyleId: null,
};

/**
 * 预设模板库。每套是一个"风格组合"，套用时覆盖对应字段。
 * 覆盖原则：只改外观（码点/眼/颜色/Logo 形状），不动内容与纠错（用户业务的两个关键项）。
 * 新增模板：在此数组追加即可被选择器自动渲染。
 */
export const PRESETS: QrPreset[] = [
  {
    id: 'classic',
    name: '经典黑白',
    swatch: ['#0f172a', '#ffffff'],
    apply: { dotShape: 'square', eyeShape: 'square', fgColor: '#0f172a', bgColor: '#ffffff', logoFit: 'rounded' },
  },
  {
    id: 'mint-dot',
    name: '薄荷圆点',
    swatch: ['#0d9488', '#f0fdfa'],
    apply: { dotShape: 'dot', eyeShape: 'circle', fgColor: '#0d9488', bgColor: '#f0fdfa', logoFit: 'rounded' },
  },
  {
    id: 'sunset-rounded',
    name: '日落圆角',
    swatch: ['#c2410c', '#fff7ed'],
    apply: { dotShape: 'rounded', eyeShape: 'rounded', fgColor: '#c2410c', bgColor: '#fff7ed', logoFit: 'rounded' },
  },
  {
    id: 'midnight',
    name: '午夜霓虹',
    swatch: ['#22d3ee', '#0a0118'],
    apply: { dotShape: 'dot', eyeShape: 'circle', fgColor: '#22d3ee', bgColor: '#0a0118', logoFit: 'rounded' },
  },
  {
    id: 'sakura',
    name: '樱花粉',
    swatch: ['#db2777', '#fff5f7'],
    apply: { dotShape: 'rounded', eyeShape: 'rounded', fgColor: '#db2777', bgColor: '#fff5f7', logoFit: 'rounded' },
  },
  {
    id: 'forest',
    name: '森林墨绿',
    swatch: ['#166534', '#f7fee7'],
    apply: { dotShape: 'rounded', eyeShape: 'circle', fgColor: '#166534', bgColor: '#f7fee7', logoFit: 'rounded' },
  },
  {
    id: 'ink-amber',
    name: '墨黑琥珀',
    swatch: ['#1c1917', '#fef3c7'],
    apply: { dotShape: 'square', eyeShape: 'rounded', fgColor: '#1c1917', bgColor: '#fef3c7', logoFit: 'rounded' },
  },
];
