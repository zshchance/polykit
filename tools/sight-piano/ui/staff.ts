/**
 * 识谱琴房 —— 五线谱几何与绘图基元（scoreview 与 freestaff 共用）。
 *
 * 坐标约定：
 *   绝对音级步 step = octave*7 + 字母序（C=0…B=6）
 *   高音谱表（treble）：最下一线 E4 = step 30，线间距 GAP=10，半步 5px
 *   低音谱表（bass）  ：最下一线 G2 = step 18；中央 C（step 28）在两谱表
 *                      中间的同一根加线上（两套 y 公式在 step 28 处汇合）
 * 单谱表布局保持旧的 176px 高；大谱表 236px。
 * 渲染只消费拼写好的 step/acc，不算乐理。
 */

import type { KeySig, SpelledNote } from '../theory';

const SVG_NS = 'http://www.w3.org/2000/svg';

export const GAP = 10;
export const STEP_E4 = 30; // 高音谱表最下一线
export const STEP_G2 = 18; // 低音谱表最下一线
export const STEP_C4 = 28; // 中央 C

export const BEAT_W = 36;
export const MEAS_PAD = 12;
export const LEFT_PAD = 14;
export const CLEF_W = 34;
export const TIMESIG_W = 20;
export const END_PAD = 34;

export type StaffId = 't' | 'b';

export interface StaffGeom {
  grand: boolean;
  /** 高音谱表最下一线（E4）的 y */
  trebleY0: number;
  /** 低音谱表最下一线（G2）的 y（单谱表时与 treble 同位，不会用到） */
  bassY0: number;
  /** SVG 高度 */
  height: number;
}

export function geomFor(grand: boolean): StaffGeom {
  return grand
    ? { grand, trebleY0: 96, bassY0: 156, height: 236 }
    : { grand, trebleY0: 118, bassY0: 118, height: 176 };
}

/** 音级步 → y 坐标（指定谱表） */
export function yOf(step: number, staff: StaffId, geom: StaffGeom): number {
  const y0 = staff === 't' ? geom.trebleY0 : geom.bassY0;
  const base = staff === 't' ? STEP_E4 : STEP_G2;
  return y0 - (step - base) * (GAP / 2);
}

/** 该音级步需要画的加线（线间之间的空格音不画） */
export function ledgerSteps(step: number, staff: StaffId): number[] {
  const base = staff === 't' ? STEP_E4 : STEP_G2;
  const out: number[] = [];
  for (let ls = base + 10; ls <= step; ls += 2) out.push(ls);
  for (let ls = base - 2; ls >= step; ls -= 2) out.push(ls);
  return out;
}

/** 大谱表上这个音该进哪一层（中央 C 为界，含 C4 归高音谱表） */
export function staffOfStep(step: number): StaffId {
  return step < STEP_C4 ? 'b' : 't';
}

/** 升号/降号在两谱表的标准位置（绝对音级步） */
export const TREBLE_SHARP_STEPS = [38, 35, 39, 36, 33, 37, 34] as const; // F♯5 C♯5 G♯5 D♯5 A♯4 E♯5 B♯4
export const TREBLE_FLAT_STEPS = [34, 37, 33, 36, 32, 35, 31] as const; // B♭4 E♭5 A♭4 D♭5 G♭4 C♭5 F♭4
export const BASS_SHARP_STEPS = [24, 21, 25, 22, 19, 23, 20] as const; // F♯3 C♯3 G♯3 D♯3 A♯2 E♯3 B♯2
export const BASS_FLAT_STEPS = [20, 23, 19, 22, 18, 21, 17] as const; // B♭2 E♭3 A♭2 D♭3 G♭2 C♭3 F♭2

export interface SvgAttrs {
  [k: string]: string | number;
}

export function se<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: SvgAttrs,
  children: (SVGElement | Text)[] = [],
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'textContent') el.appendChild(document.createTextNode(String(v)));
    else el.setAttribute(k, String(v));
  }
  el.append(...children);
  return el;
}

/** 五线（一层或两层） */
export function drawStaffLines(inner: SVGGElement, geom: StaffGeom, x1: number, x2: number): void {
  const staves: { staff: StaffId; y0: number }[] = [{ staff: 't', y0: geom.trebleY0 }];
  if (geom.grand) staves.push({ staff: 'b', y0: geom.bassY0 });
  for (const { y0 } of staves) {
    for (let i = 0; i < 5; i++) {
      inner.append(se('line', { x1, y1: y0 - i * GAP, x2, y2: y0 - i * GAP, class: 'sp-line' }));
    }
  }
  if (geom.grand) {
    // 左侧连谱线（大谱表的简化括号）
    inner.append(
      se('line', {
        x1: 8,
        y1: geom.trebleY0 - GAP * 4,
        x2: 8,
        y2: geom.bassY0,
        class: 'sp-brace',
      }),
    );
  }
}

/** 谱号（𝄞 / 大谱表加 𝄢） */
export function drawClefs(inner: SVGGElement, geom: StaffGeom): void {
  inner.append(
    se('text', {
      x: LEFT_PAD,
      y: geom.trebleY0 + GAP * 0.9,
      'font-size': 42,
      class: 'sp-clef',
      textContent: '𝄞',
    }),
  );
  if (geom.grand) {
    inner.append(
      se('text', {
        x: LEFT_PAD + 2,
        y: geom.bassY0 - GAP * 0.4,
        'font-size': 32,
        class: 'sp-clef',
        textContent: '𝄢',
      }),
    );
  }
}

export function keySigWidth(sig: KeySig): number {
  const n = Math.abs(sig.fifths);
  return n === 0 ? 0 : n * 9 + 6;
}

/** 调号（两层谱表各画一份，位置按谱表标准位） */
export function drawKeySig(inner: SVGGElement, sig: KeySig, geom: StaffGeom): void {
  const fifths = sig.fifths;
  const sym = fifths >= 0 ? '♯' : '♭';
  const staves: StaffId[] = geom.grand ? ['t', 'b'] : ['t'];
  for (const staff of staves) {
    const steps =
      staff === 't'
        ? fifths >= 0
          ? TREBLE_SHARP_STEPS
          : TREBLE_FLAT_STEPS
        : fifths >= 0
          ? BASS_SHARP_STEPS
          : BASS_FLAT_STEPS;
    for (let i = 0; i < Math.abs(fifths); i++) {
      inner.append(
        se('text', {
          x: LEFT_PAD + CLEF_W + i * 9,
          y: yOf(steps[i]!, staff, geom) + 4,
          'font-size': 13,
          class: 'sp-acc',
          textContent: sym,
        }),
      );
    }
  }
}

/** 拍号（两层谱表各画一份） */
export function drawTimeSig(
  inner: SVGGElement,
  sig: KeySig,
  geom: StaffGeom,
  beatsPerBar: number,
  beatUnit: number,
): void {
  const tsX = LEFT_PAD + CLEF_W + keySigWidth(sig) + 2;
  const staves: { staff: StaffId; y0: number }[] = [{ staff: 't', y0: geom.trebleY0 }];
  if (geom.grand) staves.push({ staff: 'b', y0: geom.bassY0 });
  for (const { y0 } of staves) {
    inner.append(
      se('text', {
        x: tsX,
        y: y0 - GAP * 2 + 3,
        'font-size': 15,
        class: 'sp-timesig',
        textContent: String(beatsPerBar),
      }),
      se('text', {
        x: tsX,
        y: y0 + 4,
        'font-size': 15,
        class: 'sp-timesig',
        textContent: String(beatUnit),
      }),
    );
  }
}

/**
 * 画一组同时发声的音（单音或音簇）：符头、临时记号、加线、
 * 符干（含孤立八分小旗）、附点。同拍连杠由调用方第二趟统一处理
 * （会先抹掉符干/小旗再画连杠）。
 */
export function drawNoteCluster(
  g: SVGGElement,
  spelled: readonly SpelledNote[],
  x: number,
  dur: number,
  staff: StaffId,
  geom: StaffGeom,
): void {
  if (!spelled.length) return;
  const steps = spelled.map((s) => s.step);
  const hollow = dur >= 2;
  const noStem = dur >= 3.5;
  const eighth = dur <= 0.75;

  // 加线
  const lineSteps = new Set<number>();
  for (const s of steps) for (const ls of ledgerSteps(s, staff)) lineSteps.add(ls);
  for (const ls of lineSteps) {
    g.append(se('line', { x1: x - 10, y1: yOf(ls, staff, geom), x2: x + 10, y2: yOf(ls, staff, geom), class: 'sp-ledger' }));
  }

  // 二度相邻符头错开
  const xOffset = new Map<number, number>();
  for (let i = 1; i < steps.length; i++) {
    if (steps[i]! - steps[i - 1]! === 1) {
      const prev = xOffset.get(i - 1) ?? 0;
      xOffset.set(i, prev === 0 ? -6.5 : 0);
    }
  }

  const centerStep = staff === 't' ? STEP_E4 + 4 : STEP_G2 + 4;
  const stemUp = steps.reduce((a, b) => a + b, 0) / steps.length < centerStep;

  spelled.forEach((sp, i) => {
    const y = yOf(sp.step, staff, geom);
    const dx = xOffset.get(i) ?? 0;
    if (sp.acc !== 0) {
      g.append(
        se('text', {
          x: x + dx - 15,
          y: y + 4.5,
          'font-size': 13,
          class: 'sp-acc',
          'text-anchor': 'middle',
          textContent: sp.acc === 1 ? '♯' : sp.acc === -1 ? '♭' : '♮',
        }),
      );
    }
    g.append(
      se('ellipse', {
        cx: x + dx,
        cy: y,
        rx: 5.4,
        ry: 4.1,
        class: 'sp-head' + (hollow ? ' sp-head-hollow' : ''),
        transform: `rotate(-16 ${x + dx} ${y})`,
      }),
    );
  });

  // 附点（时值含半拍零头的近似判断）
  if (Math.abs(dur % 1 - 0.5) < 0.01 || Math.abs(dur % 1 - 0.75) < 0.01) {
    const topY = yOf(steps[steps.length - 1]!, staff, geom);
    g.append(se('circle', { cx: x + 9.5, cy: topY - 2, r: 1.6, class: 'sp-dot' }));
  }

  if (noStem) return;

  const topY = yOf(steps[steps.length - 1]!, staff, geom);
  const botY = yOf(steps[0]!, staff, geom);
  const stemX = stemUp ? x + 5 : x - 5;
  const [y1, y2] = stemUp ? [topY - 3 - 30, botY] : [topY, botY + 3 + 30];
  g.append(se('line', { x1: stemX, y1, x2: stemX, y2, class: 'sp-stem' }));

  // 孤立八分音符画小旗（同拍成组的会由连杠层统一抹掉重画）
  if (eighth) {
    const fy = stemUp ? y1 : y2;
    g.append(
      se('path', {
        d: stemUp
          ? `M ${stemX} ${fy} q 8 2 7 12 q -1 -6 -7 -8 Z`
          : `M ${stemX} ${fy} q 8 -2 7 -12 q -1 6 -7 8 Z`,
        class: 'sp-flag',
      }),
    );
  }
}

/** 全休止符（画在高音谱表中部） */
export function drawRest(g: SVGGElement, x: number, geom: StaffGeom): void {
  g.append(
    se('text', {
      x,
      y: geom.trebleY0 - GAP * 2.4,
      'font-size': 20,
      class: 'sp-rest',
      'text-anchor': 'middle',
      textContent: '𝄽',
    }),
  );
}
