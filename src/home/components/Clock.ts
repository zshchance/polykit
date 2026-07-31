import { h } from '@/core/components/element';

/**
 * 首页侧栏数字时钟（精致极简）。
 *
 * 与日历卡片同款圆角边框样式，自动跟随亮/暗主题（颜色用 CSS 变量）。
 * 显示大号 HH:MM:SS（秒也跳动）+ 小字"YYYY年M月D日 · 周X"。
 * 每秒更新一次，并对齐到下一秒边界起步，避免漂移。
 */
const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const PAD = (n: number): string => String(n).padStart(2, '0');

/** 格式化时间文本 */
function formatTime(d: Date): string {
  return `${PAD(d.getHours())}:${PAD(d.getMinutes())}:${PAD(d.getSeconds())}`;
}

/** 格式化日期文本 */
function formatDate(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · ${WEEK_LABELS[d.getDay()]}`;
}

export function createClock(): HTMLElement {
  const timeEl = h('div', {
    class:
      'text-3xl sm:text-4xl font-semibold tabular-nums tracking-tight text-[var(--fg)]',
    textContent: formatTime(new Date()),
    'aria-label': '当前时间',
  });
  const dateEl = h('div', {
    class: 'mt-1 text-sm text-[var(--fg-muted)]',
    textContent: formatDate(new Date()),
  });

  const card = h(
    'section',
    {
      class: 'rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 text-center',
      'aria-label': '数字时钟',
    },
    [timeEl, dateEl],
  );

  // 对齐到下一秒边界再开始每秒更新，避免显示秒数与实际秒错位漂移
  let intervalId = 0;
  function tick(): void {
    const now = new Date();
    timeEl.textContent = formatTime(now);
    dateEl.textContent = formatDate(now);
  }
  // 先立即更新一次，再在下一个整秒启动固定 1s 间隔
  tick();
  const msToNextSecond = 1000 - (Date.now() % 1000);
  window.setTimeout(() => {
    tick();
    intervalId = window.setInterval(tick, 1000);
  }, msToNextSecond);

  // 页面卸载时清理（首页为单页常驻，此处仅作良好实践）
  window.addEventListener('pagehide', () => {
    if (intervalId) clearInterval(intervalId);
  });

  return card;
}
