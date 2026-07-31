/**
 * 极简 toast：右下角短暂浮现，用于备份/恢复等反馈（替代 alert）。
 *
 * 单例：同时只显示一条，后到的覆盖先到的；自动消失（默认 2.4s）。
 * 复用站点视觉语言（圆角、毛玻璃、主题色变量）。
 */

let timer: ReturnType<typeof setTimeout> | undefined;
let current: HTMLElement | null = null;

export function showToast(message: string, durationMs = 2400): void {
  if (current) {
    current.remove();
    clearTimeout(timer);
  }

  const el = document.createElement('div');
  el.className =
    'fixed bottom-5 right-5 z-[2000] max-w-[80vw] rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2.5 text-sm text-[var(--fg)] shadow-lg';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.style.opacity = '0';
  el.style.transform = 'translateY(8px)';
  el.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
  el.textContent = message;
  document.body.append(el);
  current = el;

  // 入场
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  });

  timer = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => {
      el.remove();
      if (current === el) current = null;
    }, 200);
  }, durationMs);
}
