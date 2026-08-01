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
};
