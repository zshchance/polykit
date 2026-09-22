/**
 * 识谱琴房 —— 88 键位置指示条（minimap，与和弦琴房同一套几何）。
 *
 * 琴身上方的微型键盘剪影：标示当前 25/32 键窗口在标准 88 键里的位置；
 * 点击 / 拖动可直接跳转音区。组件只报「期望窗口起点」，钳制与重渲染在 main。
 */

import { pcName, pcOf } from '../theory';
import { PIANO_MIN, PIANO_MAX } from '../settings';
import { isBlack } from './keyboard';

function whitesIn(lo: number, hiExclusive: number): number {
  let n = 0;
  for (let m = lo; m < hiExclusive; m++) if (!isBlack(m)) n++;
  return n;
}

const WHITE_TOTAL = whitesIn(PIANO_MIN, PIANO_MAX + 1);

function midiName(midi: number): string {
  return `${pcName(pcOf(midi))}${Math.floor(midi / 12) - 1}`;
}

export interface MinimapOptions {
  keyCount(): number;
  onJump(start: number): void;
}

export interface MinimapView {
  el: HTMLElement;
  render(start: number, keyCount: 25 | 32): void;
}

export function createMinimap(opts: MinimapOptions): MinimapView {
  const whiteRow = document.createElement('div');
  whiteRow.className = 'sp-mm-whites';
  for (let m = PIANO_MIN; m <= PIANO_MAX; m++) {
    if (!isBlack(m)) {
      const w = document.createElement('i');
      w.className = 'sp-mm-w';
      whiteRow.append(w);
    }
  }
  const blackLayer = document.createElement('div');
  blackLayer.className = 'sp-mm-blacks';
  let wIdx = -1;
  for (let m = PIANO_MIN; m <= PIANO_MAX; m++) {
    if (!isBlack(m)) {
      wIdx++;
      continue;
    }
    const b = document.createElement('i');
    b.className = 'sp-mm-b';
    b.style.left = `${((wIdx + 1) / WHITE_TOTAL) * 100}%`;
    b.style.width = `${(1 / WHITE_TOTAL) * 62}%`;
    blackLayer.append(b);
  }

  const rangeLabel = document.createElement('span');
  rangeLabel.className = 'sp-mm-range';
  const view = document.createElement('div');
  view.className = 'sp-mm-view';
  view.append(rangeLabel);
  const track = document.createElement('div');
  track.className = 'sp-mm-track';
  track.append(whiteRow, blackLayer, view);
  const el = document.createElement('div');
  el.className = 'sp-minimap';
  el.title = '当前窗口在 88 键中的位置 · 点击 / 拖动跳转音区';
  const a0 = document.createElement('span');
  a0.className = 'sp-mm-end';
  a0.textContent = 'A0';
  const c8 = document.createElement('span');
  c8.className = 'sp-mm-end';
  c8.textContent = 'C8';
  el.append(a0, track, c8);

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
