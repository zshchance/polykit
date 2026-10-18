/**
 * 本工具页的极简 toast（右下角短暂浮现）。
 * 与 src/home/components/toast.ts 同款视觉；因首页 toast 属 home 层，
 * 工具页不跨层引用，就地保留一份轻量实现（后续有第三个使用方再提升到 core）。
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
  el.textContent = message;
  document.body.append(el);
  current = el;

  el.style.opacity = '0';
  el.style.transform = 'translateY(8px)';
  el.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
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
