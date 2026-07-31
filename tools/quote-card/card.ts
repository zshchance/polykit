import { h } from '@/core/components/element';
import type { CardTemplate, QuoteData } from './templates/types';

/**
 * 卡片渲染器。
 *
 * 结构：surface（外壳，承载布局尺寸+缩放）> content（内容层，模板渲染于此）。
 *
 * 为什么需要 content 包装层（两层而非一层）：
 *   1. 入场动画：content 带 .quote-card-content 类，CSS 动画作用于它，
 *      切换名言/模板时内容淡入。surface 是布局层，不动。
 *   2. 模板 cssText 隔离：模板在 content 上设 cssText（背景/字体/颜色），
 *      不会清掉 surface 的 width/height/transform。
 *
 * 缩放 bug 修复要点：
 *   - surface 的 width/height 在每次渲染后重写（防被清）。
 *   - transform 由 main.ts 的 fitCardToContainer 在每次 rerenderCard 后重新应用。
 *   - content 用普通流布局（width/height:100%），不用 position:absolute，
 *     保证 html-to-image 导出稳定。
 *
 * 导出时 main.ts 给 surface 加 .exporting 类，CSS 据此禁用动画（截静止帧）。
 */

/** 卡片画板的逻辑尺寸（像素，导出分辨率基准） */
export const CARD_SIZE = 1080;

/**
 * 用指定模板把名言画进画板。
 *
 * @param surface 已固定为 CARD_SIZE × CARD_SIZE 的外壳（布局层）
 * @param quote 名言数据
 * @param template 选定的模板
 */
export function renderCard(
  surface: HTMLElement,
  quote: QuoteData,
  template: CardTemplate,
): void {
  // content 层：模板渲染于此；带动画类，每次重渲染触发淡入
  const content = h('div', { class: 'quote-card-content' });
  surface.replaceChildren(content);
  template.render(content, quote);
  // 模板 cssText 可能不含尺寸，补齐撑满 surface（流布局，非 absolute）
  content.style.width = '100%';
  content.style.height = '100%';

  // 重写 surface 布局样式（防被任何操作清掉）
  surface.style.width = `${CARD_SIZE}px`;
  surface.style.height = `${CARD_SIZE}px`;
  surface.style.transformOrigin = 'top left';
  surface.style.boxSizing = 'border-box';
}
