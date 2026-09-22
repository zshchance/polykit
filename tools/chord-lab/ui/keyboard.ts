import { h } from '@/core/components/element';

/**
 * 和弦琴房 —— 虚拟钢琴键盘组件。
 *
 * 便携键盘视图（25/32 键可选），不渲染全 88 键；窗口起点由调用方控制
 * （自动跟随演奏音区 / 手动八度移位）。
 *
 * 每枚琴键内部叠四层视觉元素（自下而上）：
 *   .cl-hint   全键引导染色（和弦模式的补全提示 / 走向模式的就近 voicing）
 *   .cl-top    按下时的上半截（最高优先级引导色）
 *   .cl-bottom 按下时的下半截（深绿，固定）
 *   .cl-dots   顶部小圆点（低优先级走向 / 其余八度的弱提示）
 *
 * 交互：pointer 事件支持多点触控与鼠标滑奏（glissando），
 * 组件只报 noteOn/noteOff，音色与判定逻辑都在 main.ts。
 */

const BLACK_PCS = new Set([1, 3, 6, 8, 10]);

export function isBlack(midi: number): boolean {
  return BLACK_PCS.has(((midi % 12) + 12) % 12);
}

interface KeyRefs {
  root: HTMLElement;
  hint: HTMLElement;
  top: HTMLElement;
  bottom: HTMLElement;
  dots: HTMLElement;
}

export interface KeyboardOptions {
  onNoteOn(midi: number): void;
  onNoteOff(midi: number): void;
  /** 琴键上的电脑键位标签（如 Z/S/X），由 main 按当前窗口计算 */
  labelFor(midi: number): string | null;
}

export interface KeyboardView {
  el: HTMLElement;
  /** 重建键盘（键数或窗口起点变化时调用） */
  render(start: number, keyCount: 25 | 32): void;
  /** 按下：上半截引导色（null = 中性色），下半截固定深绿 */
  press(midi: number, topColor: string | null): void;
  release(midi: number): void;
  /** 全键引导染色（null 清除） */
  setHint(midi: number, color: string | null): void;
  /** 顶部小圆点弱提示（空数组清除） */
  setDots(midi: number, colors: readonly string[]): void;
  /** 一键清除所有引导染色与圆点（不动按下态） */
  clearGuide(): void;
  /** 当前窗口范围 [start, end]（闭区间 MIDI） */
  range(): [number, number];
  contains(midi: number): boolean;
}

export function createKeyboard(opts: KeyboardOptions): KeyboardView {
  const el = h('div', { class: 'cl-keys', role: 'application', 'aria-label': '虚拟钢琴键盘' });
  let keys = new Map<number, KeyRefs>();
  let lo = 48;
  let hi = 72;

  // 指针跟踪：支持多点触控 + 鼠标按住滑奏
  const pointerNotes = new Map<number, number>();

  function keyFromEvent(e: PointerEvent): HTMLElement | null {
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    return hit ? (hit as HTMLElement).closest<HTMLElement>('[data-midi]') : null;
  }

  function pointerNoteOn(pid: number, midi: number): void {
    const prev = pointerNotes.get(pid);
    if (prev === midi) return;
    if (prev !== undefined) opts.onNoteOff(prev);
    pointerNotes.set(pid, midi);
    opts.onNoteOn(midi);
  }

  function pointerNoteOff(pid: number): void {
    const prev = pointerNotes.get(pid);
    if (prev !== undefined) {
      pointerNotes.delete(pid);
      opts.onNoteOff(prev);
    }
  }

  el.addEventListener('pointerdown', (e) => {
    const keyEl = (e.target as HTMLElement).closest<HTMLElement>('[data-midi]');
    if (!keyEl) return;
    e.preventDefault(); // 阻止触摸滚动/双击缩放，琴键独占手势
    pointerNoteOn(e.pointerId, Number(keyEl.dataset.midi));
  });
  el.addEventListener('pointermove', (e) => {
    if (!pointerNotes.has(e.pointerId)) return;
    const keyEl = keyFromEvent(e);
    if (keyEl) pointerNoteOn(e.pointerId, Number(keyEl.dataset.midi));
  });
  const up = (e: PointerEvent) => pointerNoteOff(e.pointerId);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  function makeKey(midi: number): KeyRefs {
    const black = isBlack(midi);
    const hint = h('div', { class: 'cl-hint' });
    const top = h('div', { class: 'cl-top' });
    const bottom = h('div', { class: 'cl-bottom' });
    const dots = h('div', { class: 'cl-dots' });
    const label = opts.labelFor(midi);
    const pc = ((midi % 12) + 12) % 12;
    const root = h(
      'div',
      {
        class: black ? 'cl-key cl-blackk' : 'cl-key cl-whitek',
        'data-midi': String(midi),
        'aria-label': `琴键 ${midi}`,
      },
      [
        hint,
        top,
        bottom,
        dots,
        ...(pc === 0
          ? [h('span', { class: 'cl-oct', textContent: `C${Math.floor(midi / 12) - 1}` })]
          : []),
        ...(label ? [h('span', { class: 'cl-klabel', textContent: label })] : []),
      ],
    );
    return { root, hint, top, bottom, dots };
  }

  return {
    el,

    render(start: number, keyCount: 25 | 32): void {
      lo = start;
      hi = start + keyCount - 1;
      keys = new Map();
      el.replaceChildren();

      const whites: KeyRefs[] = [];
      const blacks: KeyRefs[] = [];
      for (let m = lo; m <= hi; m++) {
        const k = makeKey(m);
        keys.set(m, k);
        (isBlack(m) ? blacks : whites).push(k);
      }

      // 白键：flex 均分；黑键：按白键边界绝对定位叠加
      const whiteRow = h(
        'div',
        { class: 'cl-whiterow' },
        whites.map((k) => k.root),
      );
      const whiteCount = whites.length;
      const blackLayer = h('div', { class: 'cl-blacklayer' });
      let wIdx = -1;
      for (let m = lo; m <= hi; m++) {
        if (!isBlack(m)) {
          wIdx++;
          continue;
        }
        const k = keys.get(m)!;
        // 黑键骑在它左侧白键与右侧白键的边界上
        const boundary = wIdx + 1;
        k.root.style.left = `${(boundary / whiteCount) * 100}%`;
        k.root.style.width = `${(1 / whiteCount) * 62}%`;
        blackLayer.append(k.root);
      }
      el.append(whiteRow, blackLayer);
    },

    press(midi: number, topColor: string | null): void {
      const k = keys.get(midi);
      if (!k) return;
      k.root.classList.add('cl-down');
      k.top.style.background = topColor ?? 'color-mix(in srgb, #64748b 55%, transparent)';
      k.bottom.style.background = 'linear-gradient(180deg,#16a34a,#14532d)';
    },

    release(midi: number): void {
      const k = keys.get(midi);
      if (!k) return;
      k.root.classList.remove('cl-down');
      k.top.style.background = '';
      k.bottom.style.background = '';
    },

    setHint(midi: number, color: string | null): void {
      const k = keys.get(midi);
      if (!k) return;
      k.hint.style.background = color ?? '';
      k.root.classList.toggle('cl-hinted', !!color);
    },

    setDots(midi: number, colors: readonly string[]): void {
      const k = keys.get(midi);
      if (!k) return;
      k.dots.replaceChildren(
        ...colors.map((c) => h('i', { class: 'cl-dot', style: `background:${c}` })),
      );
    },

    clearGuide(): void {
      for (const k of keys.values()) {
        k.hint.style.background = '';
        k.root.classList.remove('cl-hinted');
        k.dots.replaceChildren();
      }
    },

    range: () => [lo, hi],
    contains: (midi: number) => midi >= lo && midi <= hi,
  };
}
