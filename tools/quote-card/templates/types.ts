/**
 * 卡片模板统一契约。
 *
 * 每个模板是一个 render(el, quote) 函数：把名言数据画进给定容器。
 * 容器尺寸由调用方（card.ts）固定为 1080×1080（社交平台方形图通用尺寸），
 * 模板只负责内部布局与配色，不自定义外框尺寸。
 *
 * 设计要点：模板内部样式必须"自包含"（不依赖页面 CSS 变量 / 暗色模式），
 * 这样导出的截图在任何主题下都一致。
 */

/** 模板渲染所需的名言数据（从 QuoteRecord 或用户输入归一化而来） */
export interface QuoteData {
  text: string;
  author: string;
  source?: string;
}

/**
 * 选择器缩略图预览信息。
 * background 直接用作缩略色块的背景（CSS 值，可为纯色或渐变），
 * 让用户在选择模板时就能准确预览实际卡片风格，避免色块与成品不符的误解。
 */
export interface TemplatePreview {
  /** 缩略图背景（纯色 hex 或 CSS 渐变字符串），须与模板实际背景一致 */
  background: string;
  /** 缩略图上小引号图标的颜色（用于在背景上可见） */
  iconColor: string;
}

export interface CardTemplate {
  /** 模板唯一 id（如 'minimal'） */
  id: string;
  /** 展示名（如 '极简'） */
  name: string;
  /** 选择器缩略图预览（背景 + 图标色，须反映模板真实风格） */
  preview: TemplatePreview;
  /** 把名言画进容器（容器已固定尺寸，模板填内部） */
  render(el: HTMLElement, quote: QuoteData): void;
}

/**
 * 按名言长度分档选择正文字号，避免长文本撑破 1080×1080 画板被裁切。
 *
 * 画板恒为 1080×1080，模板用固定 px 字号时，长名言会让 flex 列总高超过 1080，
 * 被 overflow:hidden 裁掉上下。这里按字符数给一档更小的字号，
 * 让长文本也能完整容纳（短文仍保持大字美观）。
 *
 * 返回值单位 px。各档在 96px padding、约 888px 可用宽下实测可完整显示。
 */
export function pickQuoteFontSize(text: string): number {
  const len = text.length;
  if (len <= 24) return 60;
  if (len <= 60) return 46;
  if (len <= 120) return 36;
  if (len <= 200) return 28;
  return 22;
}

/**
 * 判断是否为"长文本"，供模板据此收窄 padding/margin 腾出垂直空间。
 * 阈值与 pickQuoteFontSize 的中段对齐（>60 字视为长）。
 */
export function isLongQuote(text: string): boolean {
  return text.length > 60;
}

/** 长文本时建议的内边距（小于默认 96px，给正文更多高度） */
export const LONG_PADDING = 64;
