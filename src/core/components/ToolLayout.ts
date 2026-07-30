import { h } from './element';
import { createThemeToggle } from './ThemeToggle';

/**
 * 工具页统一外壳：顶部栏（返回首页 + 工具名 + 主题切换）。
 * 各工具页只负责自身功能区域，避免每页重复写头部。
 *
 * 用法（在工具的 main.ts 中）：
 *   renderToolLayout(document.body, '密码生成器');
 *   // 然后把功能 DOM 挂到 layout 的 main 区域
 */
export interface ToolLayout {
  /** 工具功能应挂载到这里的容器 */
  content: HTMLElement;
}

export function renderToolLayout(parent: HTMLElement, title: string): ToolLayout {
  const backLink = h('a', {
    href: getHomeUrl(),
    class: 'inline-flex items-center gap-1 text-sm text-[var(--fg-muted)] hover:text-[var(--accent)] transition-colors',
    textContent: '← 首页',
  });

  const header = h('header', { class: 'flex items-center justify-between gap-4 border-b pb-4 mb-8' }, [
    h('div', { class: 'flex items-center gap-3' }, [backLink, h('h1', { class: 'text-xl font-semibold', textContent: title })]),
    createThemeToggle(),
  ]);

  const content = h('main', { class: 'flex-1' }, []);

  parent.append(header, content);
  return { content };
}

/**
 * 计算返回首页的链接，自动跟随 Vite 的 base 配置。
 * Cloudflare Pages 根路径部署时返回 '/'；若改子路径会自动跟随。
 */
function getHomeUrl(): string {
  // vite 注入：import.meta.env.BASE_URL，TS 里直接用
  const base = import.meta.env.BASE_URL || '/';
  return base;
}
