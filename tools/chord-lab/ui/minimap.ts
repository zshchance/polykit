import { h } from '@/core/components/element';
import { pcOf, pcName } from '../theory';
import { PIANO_MIN, PIANO_MAX } from '../settings';
import { isBlack } from './keyboard';

/**
 * 和弦琴房 —— 88 键位置指示条（minimap）。
 *
 * 琴身上方的一条微型键盘剪影，标示当前 25/32 键窗口
 * 在标准 88 键（A0–C8）里的实际位置；绿色视窗框随窗口滑动，
 * 点击 / 拖动指示条可直接把窗口跳到对应音区。
 *
 * 视窗框按白键几何定位（与剪影的迷你琴键严格对齐），
 * 组件只报「希望窗口起点移到哪」，钳制与重渲染由 main 处理。
 */

/** [lo, hiExclusive) 内的白键数（视窗框定位用） */
function whitesIn(lo: number, hiExclusive: number): number {
  let n = 0;
  for (let m = lo; m < hiExclusive; m++) if (!isBlack(m)) n++;
  return n;
}

const WHITE_TOTAL = whitesIn(PIANO_MIN, PIANO_MAX + 1); // 52

function midiName(midi: number): string {
  return `${pcName(pcOf(midi))}${Math.floor(midi / 12) - 1}`;
}

export interface MinimapOptions {
  /** 拖动跳转时需要知道当前键数来居中窗口 */
  keyCount(): number;
  /** 期望的窗口起点（未钳制），由调用方 clamp 后生效 */
  onJump(start: number): void;
}

export interface MinimapView {
  el: HTMLElement;
  /** 窗口起点或键数变化时移动视窗框（剪影只建一次） */
  render(start: number, keyCount: 25 | 32): void;
}

export function createMinimap(opts: MinimapOptions): MinimapView {
  // 迷你琴键剪影：白键 flex 均分，黑键骑边界（与主键盘同一套几何）
  const whiteRow = h('div', { class: 'cl-mm-whites' });
  for (let m = PIANO_MIN; m <= PIANO_MAX; m++) {
    if (!isBlack(m)) whiteRow.append(h('i', { class: 'cl-mm-w' }));
  }
  const blackLayer = h('div', { class: 'cl-mm-blacks' });
  let wIdx = -1;
  for (let m = PIANO_MIN; m <= PIANO_MAX; m++) {
    if (!isBlack(m)) {
      wIdx++;
      continue;
    }
    blackLayer.append(
      h('i', {
        class: 'cl-mm-b',
        style: `left:${((wIdx + 1) / WHITE_TOTAL) * 100}%;width:${(1 / WHITE_TOTAL) * 62}%`,
      }),
    );
  }

  const rangeLabel = h('span', { class: 'cl-mm-range' });
  const view = h('div', { class: 'cl-mm-view' }, [rangeLabel]);
  const track = h('div', { class: 'cl-mm-track' }, [whiteRow, blackLayer, view]);
  const el = h(
    'div',
    { class: 'cl-minimap', title: '当前窗口在 88 键中的位置 · 点击 / 拖动跳转音区' },
    [
      h('span', { class: 'cl-mm-end', textContent: 'A0' }),
      track,
      h('span', { class: 'cl-mm-end', textContent: 'C8' }),
    ],
  );

  // 点击 / 拖动跳转：指针位置 → 期望窗口中心
  let jumping = false;
  function jumpFromEvent(e: PointerEvent): void {
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const center = PIANO_MIN + frac * (PIANO_MAX - PIANO_MIN);
    opts.onJump(Math.round(center - opts.keyCount() / 2));
  }
  track.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    track.setPointerCapture(e.pointerId);
    jumping = true;
    jumpFromEvent(e);
  });
  track.addEventListener('pointermove', (e) => {
    if (jumping) jumpFromEvent(e);
  });
  const stop = () => (jumping = false);
  track.addEventListener('pointerup', stop);
  track.addEventListener('pointercancel', stop);

  return {
    el,

    render(start: number, keyCount: 25 | 32): void {
      const end = start + keyCount - 1;
      view.style.left = `${(whitesIn(PIANO_MIN, start) / WHITE_TOTAL) * 100}%`;
      view.style.width = `${(whitesIn(start, end + 1) / WHITE_TOTAL) * 100}%`;
      rangeLabel.textContent = `${midiName(start)}–${midiName(end)}`;
    },
  };
}
