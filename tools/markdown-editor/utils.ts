/**
 * 尾沿防抖：等待窗口内多次调用只执行最后一次；支持 cancel。
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number,
): ((...args: A) => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, wait);
  };
  wrapped.cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return wrapped;
}

/**
 * Typora 风格字数统计：CJK（汉/假名/谚文）每字计一，其余按词计数。
 */
const CJK = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/gu;

export function countWords(text: string): number {
  const cjkCount = [...text.matchAll(CJK)].length;
  const latinPart = text.replace(CJK, ' ');
  const latinCount = (latinPart.match(/[A-Za-z0-9][A-Za-z0-9'’_-]*/g) ?? []).length;
  return cjkCount + latinCount;
}

/** 字符数（不含空白），用于状态栏 */
export function countChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

/**
 * 分栏滚动同步：把源滚动位置按比例映射到目标容器。
 * @param srcTop  源容器 scrollTop
 * @param srcMax  源容器可滚动距离（scrollHeight - clientHeight）
 * @param dstMax  目标容器可滚动距离
 */
export function computeSyncedScrollTop(srcTop: number, srcMax: number, dstMax: number): number {
  if (srcMax <= 0) return 0;
  const ratio = srcTop / srcMax;
  return Math.min(Math.max(ratio * dstMax, 0), dstMax);
}
