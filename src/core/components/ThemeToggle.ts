import { h } from './element';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'static-toolkit-theme';

/** 取已持久化的主题；无则跟随系统偏好 */
function getStoredTheme(): Theme {
  let saved: string | null = null;
  try {
    // 「阻止所有 Cookie」等策略下访问 localStorage 本身就可能抛错
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // 存储不可用：保持 null，跟随系统偏好
  }
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 把主题应用到 <html>，并持久化 */
function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 存储被禁用时主题本次会话仍生效，只是不持久化；
    // 这里绝不能让异常冒泡——initTheme 在模块顶层执行，挂了整页白屏。
  }
}

/**
 * 在页面尽早执行（head 内联脚本或 main.ts 顶部）以避免首屏闪烁。
 * 这里导出供入口脚本调用。
 */
export function initTheme(): void {
  applyTheme(getStoredTheme());
}

/**
 * 创建主题切换按钮。点击在亮/暗之间切换并持久化。
 */
export function createThemeToggle(): HTMLButtonElement {
  const isDark = () => document.documentElement.classList.contains('dark');
  const btn = h('button', {
    type: 'button',
    class:
      'inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--fg)] hover:bg-[var(--bg-elevated)] transition-colors text-lg',
    textContent: isDark() ? '☀️' : '🌙',
    title: '切换主题',
    onclick: () => {
      const next: Theme = isDark() ? 'light' : 'dark';
      applyTheme(next);
      btn.textContent = next === 'dark' ? '☀️' : '🌙';
    },
  });
  return btn;
}
