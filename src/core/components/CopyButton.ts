import { h } from './element';
import { copyText } from '../utils/clipboard';

/**
 * "复制结果"按钮：点击复制指定内容，成功后短暂显示"已复制"再恢复。
 * copyGetter 是个函数，保证点击瞬间才取最新值（适用于实时生成的结果）。
 *
 * 用法：
 *   const btn = createCopyButton(() => outputEl.value);
 *   container.append(btn);
 */
export function createCopyButton(
  copyGetter: () => string,
  label = '复制',
  copiedLabel = '已复制 ✓',
): HTMLButtonElement {
  const btn = h('button', {
    type: 'button',
    class:
      'inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
    textContent: label,
    onclick: async () => {
      const ok = await copyText(copyGetter());
      const original = label;
      btn.textContent = ok ? copiedLabel : '复制失败';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 1500);
    },
  });
  return btn;
}
