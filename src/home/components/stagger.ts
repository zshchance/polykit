/**
 * 卡片入场动画：逐项 fade-up（stagger）。
 *
 * 实现：卡片带 .stagger-item 且有 CSS 变量 --stagger-index，
 * 本模块给容器加 .stagger-ready 触发 CSS 动画（透明度+上移），
 * 动画延迟按 index 递增。尊重 prefers-reduced-motion（无动画）。
 *
 * 用 IntersectionObserver：仅当容器进入视口才触发，
 * 避免首屏外卡片提前播放动画。
 */

export function observeStagger(container: HTMLElement): void {
  // 尊重无障碍：用户偏好减少动画时直接就位，不播动画
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    container.classList.add('stagger-ready');
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('stagger-ready');
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.1 },
  );
  io.observe(container);
}
