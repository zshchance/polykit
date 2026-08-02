import { h } from '@/core/components/element';
import type { CardTemplate } from './types';
import { pickQuoteFontSize, isLongQuote, LONG_PADDING } from './types';

/**
 * 模板 2：渐变
 * 彩色对角渐变背景 + 白色无衬线大字 + 半透明作者胶囊。
 * 现代活泼，适合励志/科技类内容。
 */
export const gradient: CardTemplate = {
  id: 'gradient',
  name: '渐变',
  preview: { background: 'linear-gradient(135deg,#6366f1,#8b5cf6,#ec4899)', iconColor: '#ffffff' },

  render(el, quote) {
    const long = isLongQuote(quote.text);
    const padding = long ? LONG_PADDING : 96;
    const fontSize = pickQuoteFontSize(quote.text);
    el.style.cssText = `background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 50%,#ec4899 100%);color:#ffffff;font-family:"PingFang SC","Helvetica Neue",Arial,sans-serif;display:flex;flex-direction:column;justify-content:center;padding:${padding}px;box-sizing:border-box;position:relative;overflow:hidden;`;

    el.replaceChildren(
      // 装饰光斑
      h('div', {
        style:
          'position:absolute;right:-80px;top:-80px;width:360px;height:360px;border-radius:50%;background:rgba(255,255,255,0.12);',
      }),
      h('div', {
        style:
          'position:absolute;left:-60px;bottom:-60px;width:240px;height:240px;border-radius:50%;background:rgba(255,255,255,0.08);',
      }),
      // 名言（字号随长度自适应 + 断词安全网）
      h('div', {
        style: `font-size:${fontSize}px;line-height:1.4;font-weight:700;letter-spacing:1px;position:relative;text-shadow:0 2px 12px rgba(0,0,0,0.15);word-break:break-word;overflow-wrap:anywhere;`,
        textContent: quote.text,
      }),
      // 作者胶囊（用半透明背景模拟毛玻璃，避免 backdrop-filter 导致导出极慢/失败）。
      // 出处 source 一并拼进胶囊——和极简模板一样不漏出处。
      h('div', {
        style: `margin-top:${long ? 28 : 48}px;display:inline-block;align-self:flex-start;background:rgba(255,255,255,0.28);padding:14px 28px;border-radius:999px;font-size:28px;font-weight:500;position:relative;border:1px solid rgba(255,255,255,0.35);`,
        textContent: quote.source ? `${quote.author} · ${quote.source}` : quote.author,
      }),
    );
  },
};
