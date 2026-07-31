import type { CardTemplate, QuoteData } from './templates/types';

/**
 * 卡片渲染器。
 *
 * 修复缩放 bug 的关键：
 *   模板用 el.style.cssText 设置整段内联样式（背景/字体/颜色），会清掉
 *   surface 上的 width/height/transform-origin/transform。
 *   因此 renderCard 在模板渲染【之后】把布局相关样式重新写回 surface，
 *   保证尺寸与缩放稳定。transform 由 main.ts 的 fitCardToContainer 单独管理。
 *
 *   - 刷新后初始过小：曾因 width/height 被 cssText 清掉，surface 塌缩 → 现重写回。
 *   - 换名言后溢出：曾因 transform 被清掉、surface 以 1080 全尺寸渲染 → 现 fit 每次重渲染后重应用。
 *
 * 导出时 main.ts 临时把 transform 设为 none，按原始 1080×1080 截图。
 */

/** 卡片画板的逻辑尺寸（像素，导出分辨率基准） */
export const CARD_SIZE = 1080;

/**
 * 用指定模板把名言画进画板。
 * 模板直接渲染到 surface 上；渲染后重写布局样式。
 *
 * @param surface 画板（布局层 + 内容层合一）
 * @param quote 名言数据
 * @param template 选定的模板
 */
export function renderCard(
  surface: HTMLElement,
  quote: QuoteData,
  template: CardTemplate,
): void {
  template.render(surface, quote);
  // 模板的 cssText 已清掉布局样式，这里写回（保留模板设置的其余样式需模板自带）
  // 注意：直接覆盖 cssText 会再清掉模板样式，所以只设具体属性，不动 cssText
  surface.style.width = `${CARD_SIZE}px`;
  surface.style.height = `${CARD_SIZE}px`;
  surface.style.transformOrigin = 'top left';
  surface.style.boxSizing = 'border-box';
}
