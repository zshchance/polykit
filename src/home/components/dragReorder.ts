/**
 * 全平台拖拽排序（鼠标 + 触屏）—— 不依赖第三方库。
 *
 * 设计：
 *   - 每个卡片外层包一个 wrapper（relative 容器），wrapper 上有拖拽手柄 .tool-card-handle。
 *   - 手柄 pointerdown → 进入拖拽：克隆被拖卡片为 .tool-card-drag-ghost 跟随指针，
 *     原卡片加 .tool-card-dragging 半透明占位。
 *   - pointermove → 用 elementsFromPoint 计算指针下最近的 wrapper，
 *     给目标加 .tool-card-drop-target 高亮，并记录目标索引。
 *   - pointerup → 若目标索引有效，按新顺序重排 DOM 触发 onReorder(newSlugs)；
 *     清理克隆体与所有临时类。
 *   - 触屏：手柄 touch-action:none 阻止页面滚动；阈值（移动 > 4px）才进入拖拽，
 *     避免与点击/按钮误判。
 *
 * 仅在「无搜索 + 全部分类」时启用（调用方决定是否挂载）。
 */

import { h } from '@/core/components/element';

/** 一个卡片 wrapper（relative 容器，含手柄） */
export interface CardWrapper extends HTMLElement {
  _slug?: string;
  _index?: number;
}

interface DragState {
  active: boolean;
  started: boolean;
  source: CardWrapper;
  ghost: HTMLElement | null;
  targetIndex: number;
  pointerId: number;
  startX: number;
  startY: number;
  /** move 监听器，用于 pointerup 时解绑 */
  onMove: (e: PointerEvent) => void;
  onUp: (e: PointerEvent) => void;
}

/** 拖拽移动阈值（px）：超过才真正进入拖拽，避免误触 */
const DRAG_THRESHOLD = 4;

/**
 * 为一个已渲染好的网格启用拖拽。
 *
 * @param grid 网格容器（其直接子元素为 CardWrapper）
 * @param slugs 当前可见顺序的 slug 数组（与 DOM 顺序一致）
 * @param onReorder 拖拽完成，传入新的 slug 顺序
 */
export function enableDragReorder(
  grid: HTMLElement,
  slugs: string[],
  onReorder: (newSlugs: string[]) => void,
): void {
  grid.classList.add('tool-grid-can-drag');
  const wrappers = Array.from(grid.children) as CardWrapper[];
  wrappers.forEach((w, i) => {
    w._slug = slugs[i];
    w._index = i;
    attachHandle(w, grid, onReorder);
  });
}

/** 给 wrapper 注入手柄并绑定 pointerdown */
function attachHandle(
  wrapper: CardWrapper,
  grid: HTMLElement,
  onReorder: (newSlugs: string[]) => void,
): void {
  const handle = h('div', {
    class: 'tool-card-handle',
    'aria-label': '拖动排序',
    title: '拖动排序',
    textContent: '⠿',
  });
  wrapper.classList.add('relative');
  wrapper.style.position = 'relative';
  // 手柄置于 wrapper 最前（DOM 顺序），确保浮在卡片之上
  wrapper.prepend(handle);

  let state: DragState | null = null;

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return; // 仅左键
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;

    state = {
      active: false,
      started: false,
      source: wrapper,
      ghost: null,
      targetIndex: wrapper._index ?? 0,
      pointerId: e.pointerId,
      startX,
      startY,
      onMove: () => {},
      onUp: () => {},
    };

    const onMove = (ev: PointerEvent) => {
      if (!state) return;
      // 首次移动过阈值才真正进入拖拽
      if (!state.started) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        state.started = true;
        state.active = true;
        startDrag(state);
      }
      if (state.active) {
        ev.preventDefault();
        updateDrag(state, ev);
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (state && state.active) {
        finishDrag(state, grid, onReorder);
      }
      state = null;
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

/** 真正进入拖拽：创建克隆体、隐藏原卡片 */
function startDrag(state: DragState): void {
  const src = state.source;
  const rect = src.getBoundingClientRect();
  // 克隆卡片本身（wrapper 的第一个非手柄子节点 = 卡片 <a>）
  const card = Array.from(src.children).find((c) => !c.classList.contains('tool-card-handle'));
  const ghost =
    card instanceof HTMLElement
      ? (card.cloneNode(true) as HTMLElement)
      : (src.cloneNode(true) as HTMLElement);
  ghost.classList.add('tool-card-drag-ghost');
  ghost.style.setProperty('--ghost-w', `${rect.width}px`);
  // 让克隆体中心对齐指针起点
  ghost.style.left = `${state.startX - rect.width / 2}px`;
  ghost.style.top = `${state.startY - rect.height / 2}px`;
  document.body.append(ghost);
  state.ghost = ghost;
  src.classList.add('tool-card-dragging');
}

/** 移动：跟随指针 + 计算落点 */
function updateDrag(state: DragState, e: PointerEvent): void {
  if (!state.ghost) return;
  const rect = state.ghost.getBoundingClientRect();
  state.ghost.style.left = `${e.clientX - rect.width / 2}px`;
  state.ghost.style.top = `${e.clientY - rect.height / 2}px`;

  // 找指针下的 wrapper（临时隐藏 ghost 以免命中）
  state.ghost.style.display = 'none';
  const under = document
    .elementsFromPoint(e.clientX, e.clientY)
    .find((el) => (el as CardWrapper)._slug !== undefined) as CardWrapper | undefined;
  state.ghost.style.display = '';

  // 清除旧高亮
  state.source.parentElement
    ?.querySelectorAll('.tool-card-drop-target')
    .forEach((el) => el.classList.remove('tool-card-drop-target'));

  if (under && under !== state.source) {
    under.classList.add('tool-card-drop-target');
    state.targetIndex = under._index ?? state.targetIndex;
  } else {
    state.targetIndex = state.source._index ?? state.targetIndex;
  }
}

/** 结束：落库新顺序 + 清理 */
function finishDrag(
  state: DragState,
  grid: HTMLElement,
  onReorder: (newSlugs: string[]) => void,
): void {
  state.source.classList.remove('tool-card-dragging');
  state.ghost?.remove();
  grid.querySelectorAll('.tool-card-drop-target').forEach((el) => el.classList.remove('tool-card-drop-target'));

  const fromIndex = state.source._index ?? 0;
  const toIndex = state.targetIndex;
  if (fromIndex === toIndex) return;

  // 基于 DOM 顺序生成新 slug 数组（DOM 拖拽期间未移动，顺序即拖拽前顺序）
  const wrappers = Array.from(grid.children).filter(
    (c) => (c as CardWrapper)._slug !== undefined,
  ) as CardWrapper[];
  const newSlugs = wrappers.map((w) => w._slug as string);
  onReorder(computeReorder(newSlugs, fromIndex, toIndex));
}

/**
 * 纯函数：把 fromIndex 的元素移动到 toIndex，返回新数组（不改入参）。
 * 抽出便于单元测试重排计算的正确性。
 */
export function computeReorder(slugs: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex === toIndex) return [...slugs];
  const next = [...slugs];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}
