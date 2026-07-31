import { h } from './element';

/**
 * 开发者联系方式（与 SEO 插件注入的 Organization JSON-LD 保持一致）。
 * 集中在此处一处声明，页脚 UI 直接引用。
 */
const CONTACT_EMAIL = '978107204@qq.com';
const GITHUB_URL = 'https://github.com/zshchance/polykit';

/**
 * 全站统一页脚：开发者署名 + 联系邮箱 + 开源项目链接。
 *
 * 设计意图：
 *  - 让访客在每个页面都能关联到作者（邮件）与开源仓库（GitHub）。
 *  - 信息与构建期注入的 Organization JSON-LD 同源，对外口径一致。
 *  - 样式克制（小字、细线、居中），不抢内容焦点，自动跟随亮/暗主题。
 */
export function createSiteFooter(): HTMLElement {
  const mailLink = h(
    'a',
    {
      href: `mailto:${CONTACT_EMAIL}`,
      class: 'text-[var(--fg-muted)] underline-offset-4 transition-colors hover:text-[var(--accent)] hover:underline',
    },
    [CONTACT_EMAIL],
  );

  const githubLink = h(
    'a',
    {
      href: GITHUB_URL,
      target: '_blank',
      rel: 'noopener noreferrer',
      class: 'text-[var(--fg-muted)] underline-offset-4 transition-colors hover:text-[var(--accent)] hover:underline',
    },
    ['GitHub 开源项目'],
  );

  return h('footer', { class: 'mt-16 border-t border-[var(--border)] pt-6 pb-2' }, [
    h('div', { class: 'flex flex-col items-center gap-2 text-center' }, [
      h(
        'p',
        { class: 'text-sm text-[var(--fg-muted)]' },
        ['由 欧亚成电子科技 开发维护 · 纯浏览器运行，数据不出本地'],
      ),
      h('nav', { class: 'flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm' }, [
        h('span', {}, ['联系与合作：', mailLink]),
        h('span', { class: 'text-[var(--border)]' }, ['·']),
        githubLink,
      ]),
    ]),
  ]);
}
