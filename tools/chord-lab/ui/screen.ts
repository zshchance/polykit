import { h } from '@/core/components/element';

/**
 * 和弦琴房 —— 拟物 LCD 屏幕里的卡片架。
 *
 * 卡片三种手势（指针级实现，鼠标/触控均可）：
 *   拖动  —— 调整优先级（从左到右 = 从高到低），拖动中在落点显示虚线框
 *   单击  —— 开关该卡片的引导（关闭的卡片变灰，LCD 上仍可再点开）
 *   双击  —— 在预设调色盘中循环切换引导色（手写 350ms 双击判定，
 *             撤销第一次点按的开关后换色，不依赖原生 dblclick）
 *
 * 组件只负责交互与视觉，卡片文案/颜色由调用方给，顺序变化通过回调提交。
 */

export interface RackItem {
  id: string;
  /** 引导色（CSS 颜色），同时驱动卡片描边/底色/角点 */
  color: string;
  /** 关闭引导的卡片置灰（仍占位、可再点开） */
  enabled: boolean;
  name: string;
  sub: string;
  /** aria/title 提示 */
  tip?: string;
}

export interface RackCallbacks {
  /** 拖拽结束：可见卡片的新顺序（id 数组） */
  onReorder(visibleIds: string[]): void;
  onToggle(id: string): void;
  onCycleColor(id: string): void;
}

export interface RackView {
  el: HTMLElement;
  render(items: readonly RackItem[]): void;
}

export function createRack(cb: RackCallbacks): RackView {
  const el = h('div', {
    class: 'flex items-center gap-2',
    style: 'min-height:66px',
    role: 'listbox',
    'aria-label': '引导卡片架：拖动排序，单击开关，双击换色',
  });

  let items: readonly RackItem[] = [];
  let drag: {
    pid: number;
    id: string;
    startX: number;
    active: boolean;
    insertIdx: number;
  } | null = null;

  function cardEls(): HTMLElement[] {
    return [...el.querySelectorAll<HTMLElement>('.cl-card')];
  }

  /** 指针横坐标 → 插入位（在可见卡片中的索引，0..len-1，相对非拖动卡） */
  function insertionIndex(x: number, dragId: string): number {
    const others = cardEls().filter((c) => c.dataset.cardId !== dragId);
    for (let i = 0; i < others.length; i++) {
      const r = others[i]!.getBoundingClientRect();
      if (x < r.left + r.width / 2) return i;
    }
    return others.length;
  }

  function clearGap(): void {
    for (const c of cardEls()) c.classList.remove('cl-card-gap');
  }

  function markGap(idx: number, dragId: string): void {
    clearGap();
    const others = cardEls().filter((c) => c.dataset.cardId !== dragId);
    const target = others[Math.min(idx, others.length - 1)];
    target?.classList.add('cl-card-gap');
  }

  function commitReorder(): void {
    if (!drag) return;
    const rest = items.map((it) => it.id).filter((id) => id !== drag!.id);
    const idx = Math.min(drag.insertIdx, rest.length);
    const next = [...rest.slice(0, idx), drag.id, ...rest.slice(idx)];
    cb.onReorder(next);
  }

  function onPointerDown(e: PointerEvent): void {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.cl-card');
    if (!card) return;
    e.preventDefault();
    card.setPointerCapture(e.pointerId);
    drag = {
      pid: e.pointerId,
      id: card.dataset.cardId!,
      startX: e.clientX,
      active: false,
      insertIdx: -1,
    };
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.startX;
    if (!drag.active && Math.abs(dx) > 6) drag.active = true;
    if (!drag.active) return;
    const card = cardEls().find((c) => c.dataset.cardId === drag!.id);
    if (card) card.classList.add('cl-card-drag');
    drag.insertIdx = insertionIndex(e.clientX, drag.id);
    markGap(drag.insertIdx, drag.id);
  }

  function onPointerUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pid) return;
    const card = cardEls().find((c) => c.dataset.cardId === drag!.id);
    const wasActive = drag.active;
    for (const c of cardEls()) c.classList.remove('cl-card-drag');
    clearGap();
    if (wasActive) {
      commitReorder();
    } else if (card) {
      handleTap(card.dataset.cardId!);
    }
    drag = null;
  }

  /**
   * 点按手势消歧（手写，不依赖原生 dblclick——部分运行时不发或行为不一）：
   * 350ms 内同卡第二次点按 = 双击：撤销第一次点按的开关（净效果不变），
   * 然后循环换色。这样单击仍然即时反馈，双击的净效果恰好只是换色。
   */
  let lastTap: { id: string; t: number } | null = null;

  function handleTap(id: string): void {
    const now = performance.now();
    if (lastTap && lastTap.id === id && now - lastTap.t < 350) {
      lastTap = null;
      cb.onToggle(id); // 抵消上一次点按的开关
      cb.onCycleColor(id);
      return;
    }
    lastTap = { id, t: now };
    cb.onToggle(id);
  }

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', () => (drag = null));

  return {
    el,

    render(next: readonly RackItem[]): void {
      items = next;
      el.replaceChildren(
        ...next.map((it) =>
          h(
            'div',
            {
              class: 'cl-card' + (it.enabled ? '' : ' cl-card-off'),
              'data-card-id': it.id,
              role: 'option',
              'aria-selected': String(it.enabled),
              title: it.tip ?? '拖动排序 · 单击开关引导 · 双击换引导色',
              style: `--cl-card-c:${it.color}`,
            },
            [
              h('span', { class: 'cl-card-dot' }),
              h('div', { class: 'cl-card-name', textContent: it.name }),
              h('div', { class: 'cl-card-sub', textContent: it.sub }),
            ],
          ),
        ),
      );
    },
  };
}
