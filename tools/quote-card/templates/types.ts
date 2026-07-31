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

export interface CardTemplate {
  /** 模板唯一 id（如 'minimal'） */
  id: string;
  /** 展示名（如 '极简'） */
  name: string;
  /** 选择器缩略图主色（hex），用于未渲染时的预览块 */
  previewColor: string;
  /** 把名言画进容器（容器已固定尺寸，模板填内部） */
  render(el: HTMLElement, quote: QuoteData): void;
}
