/**
 * 识谱琴房 —— 自由弹奏的实时大谱表。
 *
 * 没有曲目时谱架不空着：这是一张「你弹什么就显什么」的活谱纸。
 * 按下琴键，音符（或和弦）立刻以全音符形态落在谱面中央——
 * 中央 C 以上进高音谱表、以下进低音谱表；松开就消失。
 * 调号由用户自选（右上角调号选择器，选择会被记住），
 * 临时记号按所选调号拼写，借此熟悉「同一个键在不同调里的名字」。
 */

import { keySigOf, spellInKey, type SpelledNote, type Tonality } from '../theory';
import {
  CLEF_W,
  LEFT_PAD,
  TIMESIG_W,
  drawClefs,
  drawKeySig,
  drawNoteCluster,
  drawStaffLines,
  geomFor,
  keySigWidth,
  se,
  staffOfStep,
  type StaffGeom,
} from './staff';

export interface FreeStaffView {
  el: HTMLElement;
  /** 换调号：重建谱纸（谱号 + 调号）并重画当前和弦 */
  setKey(keyPc: number, tonality: Tonality): void;
  /** 当前按下的音（MIDI 升序）；空数组 = 全部松开 */
  setNotes(midis: readonly number[]): void;
  /** 视口宽度变化时重建 */
  relayout(): void;
}

export function createFreeStaff(): FreeStaffView {
  const el = document.createElement('div');
  el.className = 'sp-scorewrap sp-freestaff';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', '自由弹奏实时谱面');

  const geom: StaffGeom = geomFor(true);
  let keyPc = 0;
  let tonality: Tonality = 'major';
  let notes: readonly number[] = [];
  let svg: SVGSVGElement | null = null;
  let chordG: SVGGElement | null = null;
  let hintEl: SVGTextElement | null = null;

  function width(): number {
    return Math.max(640, el.clientWidth || 640);
  }

  function chordX(): number {
    return LEFT_PAD + CLEF_W + keySigWidth(keySigOf(keyPc, tonality)) + TIMESIG_W + 72;
  }

  function render(): void {
    const w = width();
    const sig = keySigOf(keyPc, tonality);
    svg = se('svg', {
      width: w,
      height: geom.height,
      viewBox: `0 0 ${w} ${geom.height}`,
      class: 'sp-score',
    });
    const inner = se('g', {});
    svg.append(inner);
    drawStaffLines(inner, geom, 8, w - 10);
    drawClefs(inner, geom);
    drawKeySig(inner, sig, geom);
    // 结尾双细线（谱纸的收尾感）
    inner.append(
      se('line', {
        x1: w - 14,
        y1: geom.trebleY0 - 40,
        x2: w - 14,
        y2: geom.bassY0,
        class: 'sp-barline',
      }),
    );
    hintEl = se('text', {
      x: chordX() + 36,
      y: (geom.trebleY0 + geom.bassY0) / 2 - 12,
      'font-size': 13,
      class: 'sp-freehint',
      'text-anchor': 'middle',
      textContent: '按下琴键，音符会落在这里',
    });
    chordG = se('g', {});
    inner.append(hintEl, chordG);
    el.style.height = `${geom.height}px`;
    el.replaceChildren(svg);
    drawChord();
  }

  function drawChord(): void {
    if (!chordG || !hintEl) return;
    chordG.replaceChildren();
    hintEl.setAttribute('visibility', notes.length ? 'hidden' : 'visible');
    if (!notes.length) return;
    const sig = keySigOf(keyPc, tonality);
    const spelled: SpelledNote[] = notes.map((m) => spellInKey(m, sig));
    const treble = spelled.filter((s) => staffOfStep(s.step) === 't');
    const bass = spelled.filter((s) => staffOfStep(s.step) === 'b');
    // 全音符形态（空心、无符干）：安静地展示「现在响着什么」
    if (treble.length) drawNoteCluster(chordG, treble, chordX(), 4, 't', geom);
    if (bass.length) drawNoteCluster(chordG, bass, chordX(), 4, 'b', geom);
  }

  return {
    el,

    setKey(pc: number, t: Tonality): void {
      keyPc = pc;
      tonality = t;
      render();
    },

    setNotes(midis: readonly number[]): void {
      notes = midis;
      drawChord();
    },

    relayout(): void {
      if (svg && Number(svg.getAttribute('width')) !== width()) render();
    },
  };
}
