/**
 * 预览缩放 + 拖拽 + 预览工具栏。
 *
 * 职责：frameWrap 上的视觉层 transform 缩放/平移（不影响导出：导出取 frame 本体）、
 * 放大态拖拽（mousedown/mousemove/mouseup），以及「预览」标题行工具栏
 * （放大/缩小/100% 按钮 + 当前百分比文本）。
 *
 * 依赖方向：仅依赖 core 的 h；由 main.ts 装配时以 frameWrap 为参数创建工厂，
 * 缩放状态全部收在工厂闭包内（原为 render() 闭包内变量，语义不变）。
 */

import { h } from '@/core/components/element';

export interface PreviewZoom {
  setZoom(next: number): void;
  /** 构建预览工具栏（标题 + 缩放按钮 + 当前百分比），同时接管百分比文本引用。 */
  buildPreviewToolbar(): HTMLElement;
}

export function createPreviewZoom(frameWrap: HTMLElement): PreviewZoom {
  // —— 预览缩放 + 拖动（仅视觉层，transform 在 frameWrap 上，不影响导出：导出取 frame 本体）——
  // zoom 1=100%，范围 0.5~5，步进 1.25；panX/panY 为 translate 偏移（px）。
  // 仅 zoom>1 可拖（zoom=1 居中无偏移，避免误拖）；鼠标优先，触摸后续。
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let zoomLabel: HTMLElement | null = null; // 工具栏百分比文本引用（buildPreviewToolbar 赋值）

  function applyZoomTransform(): void {
    frameWrap.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    frameWrap.style.transformOrigin = 'center center';
    frameWrap.style.cursor = zoom > 1 ? 'grab' : 'default';
    if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }
  function setZoom(next: number): void {
    zoom = Math.max(0.5, Math.min(5, next));
    // 缩回 1 时复位偏移
    if (zoom <= 1) {
      panX = 0;
      panY = 0;
    }
    applyZoomTransform();
  }
  // 拖动：mousedown 记起点，document mousemove 更新偏移，mouseup 结束
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartPanX = 0;
  let dragStartPanY = 0;
  frameWrap.addEventListener('mousedown', (e: MouseEvent) => {
    if (zoom <= 1) return; // 仅放大态可拖
    e.preventDefault();
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartPanX = panX;
    dragStartPanY = panY;
    document.body.style.userSelect = 'none';
    frameWrap.style.cursor = 'grabbing';
  });
  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!dragging) return;
    // 除 zoom 让拖动手感在不同缩放下一致
    panX = dragStartPanX + (e.clientX - dragStartX) / zoom;
    panY = dragStartPanY + (e.clientY - dragStartY) / zoom;
    applyZoomTransform();
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    frameWrap.style.cursor = zoom > 1 ? 'grab' : 'default';
  });

  // —— 预览工具栏：标题 + 缩放按钮（放大/缩小/100%）+ 当前百分比 ——
  function buildPreviewToolbar(): HTMLElement {
    zoomLabel = h('span', {
      class: 'text-xs tabular-nums text-[var(--fg-muted)] w-9 text-center',
      textContent: '100%',
    });
    const btnBase =
      'inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] w-7 h-7 text-xs text-[var(--fg-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors';
    const zoomInBtn = h('button', {
      type: 'button',
      title: '放大（拖动查看细节）',
      'aria-label': '放大预览',
      class: btnBase,
      textContent: '➕',
      onclick: () => setZoom(zoom * 1.25),
    });
    const zoomOutBtn = h('button', {
      type: 'button',
      title: '缩小',
      'aria-label': '缩小预览',
      class: btnBase,
      textContent: '➖',
      onclick: () => setZoom(zoom / 1.25),
    });
    const resetBtn = h('button', {
      type: 'button',
      title: '恢复 100%',
      'aria-label': '恢复 100%',
      class: btnBase,
      textContent: '🎯',
      onclick: () => {
        setZoom(1);
      },
    });
    return h('div', { class: 'flex items-center justify-between' }, [
      h('span', { class: 'text-sm font-medium text-[var(--fg)]', textContent: '预览' }),
      h('div', { class: 'flex items-center gap-1' }, [zoomOutBtn, zoomLabel, zoomInBtn, resetBtn]),
    ]);
  }

  return { setZoom, buildPreviewToolbar };
}
