/**
 * 对比预览器 —— 鼠标滑动查看压缩前后效果。
 *
 * 三种模式（默认 compare）：
 *   - original：只显原图
 *   - compare ：原图在底（全显）+ 输出图叠在上（clip-path 仅露右侧）。
 *               鼠标在预览区移动 → 分割线跟随光标，左半看原图、右半看输出图。
 *   - output  ：只显输出图
 *
 * 实现要点：
 *   - 两张 <img> 绝对定位同框重叠（object-fit: contain，图过大时等比缩放显示）。
 *   - compare 模式下，输出图设 clip-path: inset(0 0 0 split%) 只保留右侧 split%~100%。
 *   - 分割线是一条 1px 竖线 + 一个圆形把手，随光标 left 移动。
 *   - pointermove 计算 split%（0-100），同时支持鼠标与触屏（pointer 事件统一）。
 *   - 容器最小高度，避免未上传时空洞；上传后按图片比例自适应。
 *
 * 透明背景用棋盘格底纹（PNG/ICO 透明区可被看清）。
 */

import { h } from '@/core/components/element';
import type { CompareMode } from './types';

export interface CompareViewer {
  /** 预览器根元素，挂到页面 */
  el: HTMLElement;
  /** 设置两张图的源（原图 URL、输出 URL）；输出可为空（仅原图） */
  setImages: (originalUrl: string | null, outputUrl: string | null) => void;
  /** 切换模式 */
  setMode: (mode: CompareMode) => void;
  /** 直接设置分割位置（0-100） */
  setSplit: (pct: number) => void;
}

/** 棋盘格背景（透明区可视化）。用内联 data-URI 避免外部依赖 */
const CHECKER_BG =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><rect width='24' height='24' fill='%23ffffff'/><rect width='12' height='12' fill='%23e2e8f0'/><rect x='12' y='12' width='12' height='12' fill='%23e2e8f0'/></svg>\")";

export function createCompareViewer(): CompareViewer {
  // 两张图层（绝对定位重叠）
  const originalImg = h('img', {
    class: 'icv-layer icv-original',
    alt: '原图',
    draggable: false,
  }) as HTMLImageElement;
  const outputImg = h('img', {
    class: 'icv-layer icv-output',
    alt: '输出图',
    draggable: false,
  }) as HTMLImageElement;

  // 分割线 + 把手（仅 compare 模式可见）
  const handle = h('div', {
    class: 'icv-handle',
    'aria-hidden': 'true',
  });
  const divider = h('div', { class: 'icv-divider', 'aria-hidden': 'true' }, [handle]);

  // 左右角标，便于辨认哪边是原图/输出
  const labelL = h('div', { class: 'icv-tag icv-tag-left', textContent: '原图' });
  const labelR = h('div', { class: 'icv-tag icv-tag-right', textContent: '输出' });

  const stage = h('div', { class: 'icv-stage' }, [
    originalImg,
    outputImg,
    divider,
    labelL,
    labelR,
  ]);

  const el = h('div', { class: 'icv-root' }, [stage]);

  let mode: CompareMode = 'compare';
  let split = 50; // 分割位置百分比

  function applySplit(): void {
    // 输出层只露右侧 split% ~ 100%
    outputImg.style.clipPath = `inset(0 0 0 ${split}%)`;
    divider.style.left = `${split}%`;
    divider.style.display = mode === 'compare' ? 'flex' : 'none';
  }

  function applyMode(): void {
    // compare：两层都显（输出靠 clip-path）；original：只显原图；output：只显输出
    originalImg.style.display = mode === 'output' ? 'none' : '';
    outputImg.style.display = mode === 'original' ? 'none' : '';
    labelL.style.display = mode === 'compare' ? '' : 'none';
    labelR.style.display = mode === 'compare' ? '' : 'none';
    applySplit();
  }

  // 鼠标 / 触屏：更新分割位置
  function updateFromClientX(clientX: number): void {
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    split = Math.max(0, Math.min(100, pct));
    applySplit();
  }

  // pointer 事件统一处理鼠标 + 触屏拖动
  let dragging = false;
  stage.addEventListener('pointerdown', (e) => {
    if (mode !== 'compare') return;
    dragging = true;
    stage.setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  });
  stage.addEventListener('pointermove', (e) => {
    if (mode !== 'compare') return;
    // 鼠标悬停（未按下）也跟随，提供「滑动预览」体验；触屏只在按下时移动
    if (e.pointerType === 'mouse' || dragging) {
      updateFromClientX(e.clientX);
    }
  });
  stage.addEventListener('pointerup', (e) => {
    dragging = false;
    try {
      stage.releasePointerCapture(e.pointerId);
    } catch {
      // 忽略
    }
  });
  stage.addEventListener('pointerleave', () => {
    dragging = false;
  });

  // 注入样式（只注入一次）。预览器视觉与全局主题变量联动。
  injectStyles();

  return {
    el,
    setImages(originalUrl, outputUrl) {
      originalImg.src = originalUrl ?? '';
      outputImg.src = outputUrl ?? '';
    },
    setMode(m) {
      mode = m;
      applyMode();
    },
    setSplit(pct) {
      split = Math.max(0, Math.min(100, pct));
      applySplit();
    },
  };
}

let styleInjected = false;
function injectStyles(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = `
.icv-root { width: 100%; }
.icv-stage {
  position: relative;
  width: 100%;
  min-height: 280px;
  aspect-ratio: 4 / 3;
  background-color: var(--bg-elevated);
  background-image: ${CHECKER_BG};
  border: 1px solid var(--border);
  border-radius: 0.75rem;
  overflow: hidden;
  cursor: ew-resize;
  touch-action: none;
  user-select: none;
}
.icv-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
}
.icv-divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.icv-divider::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -1px;
  width: 2px;
  background: var(--accent);
  box-shadow: 0 0 0 1px rgba(255,255,255,0.6);
}
.icv-handle {
  position: absolute;
  width: 36px;
  height: 36px;
  border-radius: 9999px;
  background: var(--accent);
  color: var(--accent-fg);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  border: 2px solid #fff;
}
.icv-handle::before {
  content: '⇆';
  font-size: 18px;
  line-height: 1;
  color: #fff;
}
.icv-tag {
  position: absolute;
  top: 10px;
  padding: 2px 10px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: rgba(15,23,42,0.7);
  border-radius: 9999px;
  pointer-events: none;
  backdrop-filter: blur(4px);
}
.icv-tag-left { left: 10px; }
.icv-tag-right { right: 10px; }
`;
  const style = document.createElement('style');
  style.setAttribute('data-icv', '');
  style.textContent = css;
  document.head.append(style);
}
