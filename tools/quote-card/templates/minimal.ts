import { h } from '@/core/components/element';
import type { CardTemplate } from './types';

/**
 * 模板 1：极简
 * 纯白底 + 左侧细强调色竖条 + 衬线大字名言 + 小字作者。
 * 大量留白，克制耐看。
 */
export const minimal: CardTemplate = {
  id: 'minimal',
  name: '极简',
  previewColor: '#0f172a',

  render(el, quote) {
    el.style.cssText =
      'background:#ffffff;color:#0f172a;font-family:Georgia,"Songti SC","Noto Serif SC",serif;display:flex;flex-direction:column;justify-content:center;padding:96px;box-sizing:border-box;position:relative;';

    el.replaceChildren(
      // 左侧强调竖条
      h('div', {
        style:
          'position:absolute;left:0;top:0;bottom:0;width:10px;background:#0f172a;',
      }),
      // 名言正文
      h('div', {
        style:
          'font-size:60px;line-height:1.45;font-weight:600;letter-spacing:0.5px;',
        textContent: quote.text,
      }),
      // 作者落款
      h('div', {
        style: 'margin-top:48px;font-size:30px;color:#64748b;font-style:italic;',
        textContent: `— ${quote.author}${quote.source ? ` · ${quote.source}` : ''}`,
      }),
    );
  },
};
