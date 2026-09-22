/**
 * 识谱琴房 —— 虚拟钢琴键盘组件（与和弦琴房同一套拟物几何）。
 *
 * 便携键盘视图（25/32 键可选），窗口起点由调用方控制（跟随演奏音区 /
 * 手动八度移位 / 选曲时自动居中到曲目音域）。
 *
 * 每枚琴键内部叠四层视觉元素（自下而上）：
 *   .sp-hint   全键引导染色（当前目标音 / 和弦目标音）
 *   .sp-top    按下时的上半截（命中绿 / 普通按压靛蓝）
 *   .sp-bottom 按下时的下半截（固定深靛）
 *   .sp-dots   顶部小圆点弱提示（和弦的其余把位）
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
  labelFor(midi: number): string | null;
}

export interface KeyboardView {
  el: HTMLElement;
  render(start: number, keyCount: 25 | 32): void;
  /** 按下：上半截颜色（null = 中性靛蓝），下半截固定深色 */
  press(midi: number, topColor: string | null): void;
  release(midi: number): void;
  /** 全键引导染色（null 清除） */
  setHint(midi: number, color: string | null): void;
  /** 引导加强（犹豫提示：呼吸脉冲动画） */
  setHintStrong(midi: number, strong: boolean): void;
  setDots(midi: number, colors: readonly string[]): void;
  clearGuide(): void;
  range(): [number, number];
  contains(midi: number): boolean;
}

export function createKeyboard(opts: KeyboardOptions): KeyboardView {
  const el = document.createElement('div');
  el.className = 'sp-keys';
  el.setAttribute('role', 'application');
  el.setAttribute('aria-label', '虚拟钢琴键盘');
  let keys = new Map<number, KeyRefs>();
  let lo = 48;
  let hi = 79;

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
    e.preventDefault();
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
    const hint = document.createElement('div');
    hint.className = 'sp-hint';
    const top = document.createElement('div');
    top.className = 'sp-top';
    const bottom = document.createElement('div');
    bottom.className = 'sp-bottom';
    const dots = document.createElement('div');
    dots.className = 'sp-dots';
    const label = opts.labelFor(midi);
    const pc = ((midi % 12) + 12) % 12;
    const root = document.createElement('div');
    root.className = black ? 'sp-key sp-blackk' : 'sp-key sp-whitek';
    root.dataset.midi = String(midi);
    root.setAttribute('aria-label', `琴键 ${midi}`);
    root.append(hint, top, bottom, dots);
    if (pc === 0) {
      const oct = document.createElement('span');
      oct.className = 'sp-oct';
      oct.textContent = `C${Math.floor(midi / 12) - 1}`;
      root.append(oct);
    }
    if (label) {
      const lab = document.createElement('span');
      lab.className = 'sp-klabel';
      lab.textContent = label;
      root.append(lab);
    }
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

      const whiteRow = document.createElement('div');
      whiteRow.className = 'sp-whiterow';
      whiteRow.append(...whites.map((k) => k.root));
      const whiteCount = whites.length;
      const blackLayer = document.createElement('div');
      blackLayer.className = 'sp-blacklayer';
      let wIdx = -1;
      for (let m = lo; m <= hi; m++) {
        if (!isBlack(m)) {
          wIdx++;
          continue;
        }
        const k = keys.get(m)!;
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
      k.root.classList.add('sp-down');
      k.top.style.background =
        topColor ?? 'linear-gradient(180deg, rgba(129,140,248,.85), rgba(99,102,241,.85))';
      k.bottom.style.background = 'linear-gradient(180deg,#4f46e5,#312e81)';
    },

    release(midi: number): void {
      const k = keys.get(midi);
      if (!k) return;
      k.root.classList.remove('sp-down');
      k.top.style.background = '';
      k.bottom.style.background = '';
    },

    setHint(midi: number, color: string | null): void {
      const k = keys.get(midi);
      if (!k) return;
      k.hint.style.background = color ?? '';
      k.root.classList.toggle('sp-hinted', !!color);
      if (!color) k.root.classList.remove('sp-hint-strong');
    },

    setHintStrong(midi: number, strong: boolean): void {
      const k = keys.get(midi);
      if (!k) return;
      k.root.classList.toggle('sp-hint-strong', strong);
    },

    setDots(midi: number, colors: readonly string[]): void {
      const k = keys.get(midi);
      if (!k) return;
      k.dots.replaceChildren(
        ...colors.map((c) => {
          const d = document.createElement('i');
          d.className = 'sp-dot';
          d.style.background = c;
          return d;
        }),
      );
    },

    clearGuide(): void {
      for (const k of keys.values()) {
        k.hint.style.background = '';
        k.root.classList.remove('sp-hinted', 'sp-hint-strong');
        k.dots.replaceChildren();
      }
    },

    range: () => [lo, hi],
    contains: (midi: number) => midi >= lo && midi <= hi,
  };
}
