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
 * 分栏滚动同步（回退用）：把源滚动位置按比例映射到目标容器。
 * 表格/图示会让预览与源码的高度分布不均，比例映射会随篇幅累积错位，
 * 正常路径走锚点插值（见 SyncAnchor），仅在锚点不可用时回退到这里。
 * @param srcTop  源容器 scrollTop
 * @param srcMax  源容器可滚动距离（scrollHeight - clientHeight）
 * @param dstMax  目标容器可滚动距离
 */
export function computeSyncedScrollTop(srcTop: number, srcMax: number, dstMax: number): number {
  if (srcMax <= 0) return 0;
  const ratio = srcTop / srcMax;
  return Math.min(Math.max(ratio * dstMax, 0), dstMax);
}

/* ───────────────────────── 分栏滚动同步（锚点插值） ───────────────────────── */

/**
 * 同步锚点：预览区某块级元素（标题/段落/表格…，渲染时带 data-source-line 戳）
 * 的「0 基源码行号 ↔ 预览内容坐标里的像素顶」。
 * 滚动同步在相邻锚点间分段线性插值，块边界严格对齐，块内按行数分摊。
 */
export interface SyncAnchor {
  line: number;
  top: number;
}

/**
 * 源码行（0 基，可带小数）→ 预览侧像素位置：锚点间分段线性插值。
 * anchors 须按 line/top 双调不减，首锚为 {0,0}、末锚为文档终点虚拟锚；
 * 结果钳制到 [0, previewMax]。
 */
export function previewTopForLine(line: number, anchors: SyncAnchor[], previewMax: number): number {
  if (anchors.length === 0) return 0;
  const last = anchors[anchors.length - 1]!;
  const query = Math.min(Math.max(line, 0), last.line);
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    if (query >= a.line && query <= b.line) {
      const lineSpan = b.line - a.line;
      if (lineSpan <= 0) return a.top;
      const p = (query - a.line) / lineSpan;
      return Math.min(Math.max(a.top + p * (b.top - a.top), 0), previewMax);
    }
  }
  return Math.min(Math.max(last.top, 0), previewMax);
}

/**
 * 预览侧像素位置 → 源码行（0 基，带小数）：锚点间分段线性插值。
 * 小数部分表示「块内进度」，供编辑器侧恢复行内偏移，保证双向滚动连续。
 */
export function lineForPreviewTop(top: number, anchors: SyncAnchor[]): number {
  if (anchors.length === 0) return 0;
  const last = anchors[anchors.length - 1]!;
  const query = Math.min(Math.max(top, 0), last.top);
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    if (query >= a.top && query <= b.top) {
      const topSpan = b.top - a.top;
      if (topSpan <= 0) return a.line;
      const p = (query - a.top) / topSpan;
      return a.line + p * (b.line - a.line);
    }
  }
  return last.line;
}
