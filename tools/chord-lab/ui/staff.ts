/**
 * 和弦琴房 —— 五线谱渲染（手写 SVG，零依赖）。
 *
 * 高音谱表一条，两种用法：
 *   renderNoteCluster  和弦模式：把按下的音画成一个纵向音簇
 *   renderChordSeq     走向模式：把一条走向的和弦横向排开，已弹的染色、
 *                      下一步空心描边、未到的灰白（歌词式逐格变色）
 *
 * 记谱简化约定：升号拼写（♯），不画拍号与小节线；相邻二度音程的符头
 * 左右错开（标准记谱做法）。符头椭圆旋转 -16°，符干按平均高度决定上下。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 音高类 → 自然音级步（C=0 … B=6）；黑键与相邻白键同步、带 ♯ */
const DIA_STEP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6] as const;
const IS_SHARP = [false, true, false, true, false, false, true, false, true, false, true, false];

const GAP = 9; // 线间距
const LINE_Y0 = 62; // 下加一线（E4 下一线）基准：最下面那条线的 y
const STEP_E4 = 4 * 7 + 2; // E4 的绝对音级步

function stepOf(midi: number): number {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return octave * 7 + DIA_STEP[pc]!;
}

function isSharp(midi: number): boolean {
  return IS_SHARP[((midi % 12) + 12) % 12]!;
}

/** 音级步 → y 坐标（步越大越靠上） */
function yOf(step: number): number {
  return LINE_Y0 - (step - STEP_E4) * (GAP / 2);
}

interface SvgAttrs {
  [k: string]: string | number;
}

function se<K extends keyof SVGElementTagNameMap>(
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

function staffLines(x0: number, x1: number): SVGElement[] {
  const out: SVGElement[] = [];
  for (let i = 0; i < 5; i++) {
    const y = LINE_Y0 - i * GAP;
    out.push(se('line', { x1: x0, y1: y, x2: x1, y2: y, stroke: '#b8b3a4', 'stroke-width': 1 }));
  }
  return out;
}

function clef(x: number): SVGElement {
  return se('text', {
    x,
    y: LINE_Y0 + GAP * 0.9,
    'font-size': 40,
    fill: '#d6d1c0',
    'font-family': 'serif',
    textContent: '𝄞',
  });
}

/** 一组纵向音簇（和弦）的符头 + 符干 + 临时记号 + 加线 */
function chordStack(
  cx: number,
  midis: readonly number[],
  color: string,
  hollow: boolean,
): SVGElement[] {
  if (midis.length === 0) return [];
  const sorted = [...midis].sort((a, b) => a - b);
  const steps = sorted.map(stepOf);
  const g: SVGElement[] = [];

  // 加线：谱外每个偶数步一条（上从第 6 条线位起，下从第 0 条之下起）
  const lineSteps = new Set<number>();
  for (const s of steps) {
    for (let ls = STEP_E4 + 10; ls <= s + 1; ls += 2) lineSteps.add(ls);
    for (let ls = STEP_E4 - 2; ls >= s - 1; ls -= 2) lineSteps.add(ls);
  }
  for (const ls of lineSteps) {
    const y = yOf(ls);
    g.push(
      se('line', {
        x1: cx - 10,
        y1: y,
        x2: cx + 10,
        y2: y,
        stroke: '#b8b3a4',
        'stroke-width': 1,
      }),
    );
  }

  // 二度相邻的符头左右错开（先按步分组决定偏左/偏右）
  const xOffset = new Map<number, number>(); // index → dx
  for (let i = 1; i < steps.length; i++) {
    if (steps[i]! - steps[i - 1]! === 1) {
      const prevShift = xOffset.get(i - 1) ?? 0;
      xOffset.set(i, prevShift === 0 ? -7 : 0);
    }
  }

  const stemUp = steps.reduce((a, b) => a + b, 0) / steps.length < STEP_E4 + 4;
  const fill = hollow ? 'none' : color;
  const strokeW = hollow ? 1.6 : 0;

  sorted.forEach((midi, i) => {
    const s = steps[i]!;
    const y = yOf(s);
    const dx = xOffset.get(i) ?? 0;
    if (isSharp(midi)) {
      const t = se('text', {
        x: cx - 17 + dx,
        y: y + 4,
        'font-size': 11,
        fill: color,
        textContent: '♯',
      });
      g.push(t);
    }
    const head = se('ellipse', {
      cx: cx + dx,
      cy: y,
      rx: 5.4,
      ry: 4,
      fill,
      stroke: color,
      'stroke-width': strokeW || 0,
      transform: `rotate(-16 ${cx + dx} ${y})`,
    });
    g.push(head);
  });

  // 符干：上伸在最高音右侧，下伸在最低音左侧
  const topY = yOf(steps[steps.length - 1]!);
  const botY = yOf(steps[0]!);
  const stemX = stemUp ? cx + 5.2 : cx - 5.2;
  const [y1, y2] = stemUp ? [topY - 3, botY] : [topY, botY + 3];
  g.push(
    se('line', {
      x1: stemX,
      y1: stemUp ? y1 - 30 : y1,
      x2: stemX,
      y2: stemUp ? y2 : y2 + 30,
      stroke: color,
      'stroke-width': 1.4,
    }),
  );
  return g;
}

function baseSvg(width: number): SVGSVGElement {
  const svg = se('svg', {
    width,
    height: 96,
    viewBox: `0 0 ${width} 96`,
    role: 'img',
    'aria-label': '五线谱',
  });
  svg.append(...staffLines(6, width - 6), clef(12));
  return svg;
}

export interface StaffNote {
  midi: number;
  color?: string;
}

/** 和弦模式：按下的音画成一个音簇（默认深绿，与键帽下半截一致） */
export function renderNoteCluster(notes: readonly StaffNote[]): SVGSVGElement {
  const width = 150;
  const svg = baseSvg(width);
  if (notes.length > 0) {
    svg.append(
      ...chordStack(
        92,
        notes.map((n) => n.midi),
        notes[0]!.color ?? '#4ade80',
        false,
      ),
    );
  }
  return svg;
}

export type SeqStepState = 'done' | 'next' | 'todo';

export interface StaffSeqChord {
  midis: readonly number[];
  state: SeqStepState;
  color: string;
}

/** 走向模式：和弦序列横排，done 染色 / next 空心描边 / todo 灰白 */
export function renderChordSeq(chords: readonly StaffSeqChord[]): SVGSVGElement {
  const slot = 46;
  const width = 54 + chords.length * slot;
  const svg = baseSvg(width);
  chords.forEach((c, i) => {
    const cx = 50 + i * slot;
    const color = c.state === 'todo' ? '#8f8a7a' : c.color;
    svg.append(...chordStack(cx, c.midis, color, c.state === 'next'));
  });
  return svg;
}
