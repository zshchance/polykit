import { h } from '@/core/components/element';
import type { CardTemplate } from './types';
import { pickQuoteFontSize, isLongQuote, LONG_PADDING } from './types';

/**
 * 模板 4：暗夜
 * 深色底 + 金色强调（引号 + 作者）+ 浅色正文。
 * 高级沉稳，适合质感文案。
 */
export const dark: CardTemplate = {
  id: 'dark',
  name: '暗夜',
  preview: { background: 'radial-gradient(circle at 50% 30%,#1e293b,#0f172a)', iconColor: '#d4af37' },

  render(el, quote) {
    const long = isLongQuote(quote.text);
    const padding = long ? LONG_PADDING : 96;
    const fontSize = pickQuoteFontSize(quote.text);
    el.style.cssText = `background:radial-gradient(circle at 50% 30%, #1e293b 0%, #0f172a 100%);color:#e2e8f0;font-family:"PingFang SC","Helvetica Neue",Arial,sans-serif;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:${padding}px;box-sizing:border-box;position:relative;text-align:center;`;

    el.replaceChildren(
      // 顶部金色引号（长文本时缩小，避免压正文空间）
      h('div', {
        style: `font-size:${long ? 80 : 120}px;line-height:1;color:#d4af37;font-family:Georgia,serif;margin-bottom:${long ? 16 : 24}px;`,
        textContent: '\u201C',
      }),
      // 名言（字号随长度自适应 + 断词安全网）
      h('div', {
        style: `font-size:${fontSize}px;line-height:1.5;font-weight:500;max-width:900px;word-break:break-word;overflow-wrap:anywhere;`,
        textContent: quote.text,
      }),
      // 金色分隔点（长文本时收紧间距）
      h('div', {
        style: `margin:${long ? '24px 0 16px' : '48px 0 24px'};font-size:32px;color:#d4af37;letter-spacing:12px;`,
        textContent: '• • •',
      }),
      // 作者
      h('div', {
        style: 'font-size:32px;color:#d4af37;font-weight:600;',
        textContent: quote.author,
      }),
      ...(quote.source
        ? [h('div', {
            style: 'margin-top:12px;font-size:24px;color:#94a3b8;',
            textContent: quote.source,
          })]
        : []),
    );
  },
};
