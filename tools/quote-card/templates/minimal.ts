import { h } from '@/core/components/element';
import type { CardTemplate } from './types';
import { pickQuoteFontSize, isLongQuote, LONG_PADDING } from './types';

/**
 * 模板 1：极简
 * 纯白底 + 左侧细强调色竖条 + 衬线大字名言 + 小字作者。
 * 大量留白，克制耐看。
 */
export const minimal: CardTemplate = {
  id: 'minimal',
  name: '极简',
  preview: { background: '#ffffff', iconColor: '#0f172a' },

  render(el, quote) {
    const long = isLongQuote(quote.text);
    const padding = long ? LONG_PADDING : 96;
    const fontSize = pickQuoteFontSize(quote.text);
    el.style.cssText = `background:#ffffff;color:#0f172a;font-family:Georgia,"Songti SC","Noto Serif SC",serif;display:flex;flex-direction:column;justify-content:center;padding:${padding}px;box-sizing:border-box;position:relative;`;

    el.replaceChildren(
      // 左侧强调竖条
      h('div', {
        style:
          'position:absolute;left:0;top:0;bottom:0;width:10px;background:#0f172a;',
      }),
      // 名言正文（字号随长度自适应 + 断词安全网）
      h('div', {
        style: `font-size:${fontSize}px;line-height:1.45;font-weight:600;letter-spacing:0.5px;word-break:break-word;overflow-wrap:anywhere;`,
        textContent: quote.text,
      }),
      // 作者落款（长文本时收紧间距）
      h('div', {
        style: `margin-top:${long ? 28 : 48}px;font-size:30px;color:#64748b;font-style:italic;`,
        textContent: `— ${quote.author}${quote.source ? ` · ${quote.source}` : ''}`,
      }),
    );
  },
};
