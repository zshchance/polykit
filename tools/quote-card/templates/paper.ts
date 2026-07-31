import { h } from '@/core/components/element';
import type { CardTemplate } from './types';
import { pickQuoteFontSize, isLongQuote, LONG_PADDING } from './types';

/**
 * 模板 3：纸质
 * 米色纹理底 + 巨大引号装饰 + 引文 + 落款分隔线。
 * 文艺手账感，适合文学/哲理类内容。
 */
export const paper: CardTemplate = {
  id: 'paper',
  name: '纸质',
  preview: { background: '#f5ecd9', iconColor: '#c9a96a' },

  render(el, quote) {
    const long = isLongQuote(quote.text);
    const padding = long ? LONG_PADDING : 96;
    const fontSize = pickQuoteFontSize(quote.text);
    el.style.cssText = `background:#f5ecd9;color:#3d2f1f;font-family:Georgia,"Songti SC","Noto Serif SC",serif;display:flex;flex-direction:column;justify-content:center;padding:${padding}px;box-sizing:border-box;position:relative;`;

    // 用径向渐变模拟纸张纹理/做旧感
    el.style.backgroundImage =
      'radial-gradient(circle at 20% 30%, rgba(180,140,80,0.08) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(180,140,80,0.06) 0%, transparent 50%)';

    el.replaceChildren(
      // 巨大引号装饰（长文本时缩小，避免压正文空间）
      h('div', {
        style: `position:absolute;left:${padding}px;top:${long ? 16 : 40}px;font-size:${long ? 150 : 220}px;line-height:1;color:#c9a96a;font-family:Georgia,serif;opacity:0.5;`,
        textContent: '\u201C',
      }),
      // 名言（字号随长度自适应 + 断词安全网）
      h('div', {
        style: `font-size:${fontSize}px;line-height:1.55;font-weight:500;position:relative;z-index:1;font-style:italic;word-break:break-word;overflow-wrap:anywhere;`,
        textContent: quote.text,
      }),
      // 分隔线（长文本时收紧间距）
      h('div', {
        style: `margin-top:${long ? 32 : 56}px;width:80px;height:3px;background:#c9a96a;position:relative;z-index:1;`,
      }),
      // 落款
      h('div', {
        style: `margin-top:${long ? 16 : 24}px;font-size:32px;color:#7a5c34;position:relative;z-index:1;`,
        textContent: quote.author,
      }),
      ...(quote.source
        ? [h('div', {
            style: 'margin-top:8px;font-size:24px;color:#a08866;position:relative;z-index:1;',
            textContent: `《${quote.source}》`,
          })]
        : []),
    );
  },
};
