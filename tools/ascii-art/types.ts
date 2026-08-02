/**
 * 终端字符画 —— 类型定义。
 *
 * 核心模型：把任意输入（图片 / 文字）统一渲染成「字符 + 前景色 + 背景色」的二维网格，
 * 四种导出（纯文本 / 彩色 HTML / PNG / 视频）各写一个序列化器作为下游消费者，
 * 上游「半块模式 / 彩色 / 字符集」只影响像素→Cell 的映射，与导出解耦。
 */

/** 一个字符位置：字符 + 可选前景色（字符色/上半像素色）+ 可选背景色（下半像素色）。 */
export interface Cell {
  ch: string;
  /** 前景色：半块模式=上半像素色；纯字符模式=字符色；缺省=继承终端 fg */
  fg?: string;
  /** 背景色：半块模式=下半像素色；缺省=透明（透出终端背景） */
  bg?: string;
}

/** 渲染结果：行 × 列 的 Cell 网格。 */
export type Rendered = Cell[][];

/** 输入玩法（MVP 只有两个，Banner 二期再加）。 */
export type InputMode = 'image' | 'text';

/** 终端外框类型（影响标题栏圆点位置 / 配色 / 边框）。 */
export type TerminalType = 'macos' | 'iterm2' | 'cmd' | 'bash';

/** 光标样式。 */
export type CursorStyle = 'none' | '▋' | '_' | '█';

/**
 * 完整风格配置。预设风格是它的完整实例；用户调任一字段即派生。
 *
 * 重要联动（见 settings.loadCfg 钳制）：
 *   colorMode === false 时 halfBlock 强制为 false。
 *   原因：半块的卖点是用 fg/bg 表示两个像素，单色下两者相同 → 死图，无意义。
 */
export interface StyleConfig {
  // —— 字符画参数（仅图片模式相关）——
  /** 灰度字符集，按「暗→亮」排列（如 ' .:-=+*#%@'）。 */
  charset: string;
  /** 字符宽度（列数）：60 / 80 / 100 / 120 / 160。仅图片模式有意义。 */
  width: number;
  /** 半块高细节模式（默认 true）。colorMode 关时强制 false。 */
  halfBlock: boolean;
  /** 彩色模式（默认 true）：保留像素真实颜色；关 → 单色（用 fg）。关时 halfBlock 联动关。 */
  colorMode: boolean;
  /**
   * 宽高比系数：由目标字符宽 W 反推采样高 H = round(W × imgH/imgW × aspectRatio)。
   * 语义=「每字符（垂直方向）对应原图的行数比例」。
   * 半块默认 1.0（1 字符表达 2 像素行）/ 纯字符默认 0.55（等宽字体字符格高/宽≈2）。
   * 切换 halfBlock 时用各自默认值替换，不做乘除（1.0/0.55≈1.82≠2，乘除会漂移）。
   * 系数基于 line-height=1；用户调行高会失真（可接受）。
   */
  aspectRatio: number;
  /** 对比度 -100~100，默认 0。像素阶段对 RGB 应用，半块真彩也吃。 */
  contrast: number;
  /** 亮度 -100~100，默认 0。像素阶段对 RGB 应用。 */
  brightness: number;
  /** 反转明暗。像素阶段应用。 */
  invert: boolean;

  // —— 终端外观 ——
  /** 终端背景色（也是透明像素的降级目标）。 */
  bg: string;
  /** 单色 / 降级文字色。 */
  fg: string;
  /** 终端类型。 */
  terminal: TerminalType;
  /** 标题栏文字（如 'zsh@matrix:~$'）。 */
  title: string;
  /** 是否显示终端外框。 */
  showFrame: boolean;
  /** CRT 扫描线。 */
  crtScanlines: boolean;
  /** CRT 辉光（text-shadow）。 */
  crtGlow: boolean;
  /** CRT 屏幕弧度（仅预览用 transform，导出切 .exporting 复位为静态 CSS）。 */
  crtCurve: boolean;
  /** 光标样式。 */
  cursor: CursorStyle;
  /** 内边距 px。 */
  padding: number;
}
