import { h } from '@/core/components/element';
import type { CardTemplate } from './types';

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
    el.style.cssText =
      'background:radial-gradient(circle at 50% 30%, #1e293b 0%, #0f172a 100%);color:#e2e8f0;font-family:"PingFang SC","Helvetica Neue",Arial,sans-serif;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:96px;box-sizing:border-box;position:relative;text-align:center;';

    el.replaceChildren(
      // 顶部金色引号
      h('div', {
        style: 'font-size:120px;line-height:1;color:#d4af37;font-family:Georgia,serif;margin-bottom:24px;',
        textContent: '\u201C',
      }),
      // 名言
      h('div', {
        style: 'font-size:58px;line-height:1.5;font-weight:500;max-width:900px;',
        textContent: quote.text,
      }),
      // 金色分隔点
      h('div', {
        style: 'margin:48px 0 24px;font-size:32px;color:#d4af37;letter-spacing:12px;',
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
