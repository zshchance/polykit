/**
 * 识谱琴房 —— 五线谱卷轴渲染（手写 SVG，零依赖）。
 *
 * 一页会跟着演奏滚动的奶油色谱纸：
 *   - 谱号 + 调号（升降号按五度圈标准位置）+ 拍号 + 小节线 + 小节序号
 *   - 音符状态：墨色待弹 / 呼吸描边 = 当前目标 / 命中变绿 / 演奏模式错过的变灰红
 *   - 和弦事件画音簇（二度错开符头），八分音符同拍内连符杠，附点/加线齐全
 *   - 自动卷动：当前目标始终停在视口约 1/3 处
 *   - 错音星光：sparkle(midi) 在播放头 x × 弹错音的谱面高度 放一颗金色四角星
 *
 * 渲染只消费 buildScore 拼写好的 step/acc，不再算乐理。
 * 状态更新走 class 切换（CSS 过渡），不重建 SVG，动画与星光互不干扰。
 */

import type { Score, ScoreEvent } from '../score';
import { spellInKey, type KeySig } from '../theory';

const SVG_NS = 'http://www.w3.org/2000/svg';

const GAP = 10; // 线间距
const LINE_Y0 = 118; // 最下面那条线（E4）的 y
const STEP_E4 = 30; // E4 的绝对音级步（4*7+2）
const BEAT_W = 36; // 每拍横向宽度
const MEAS_PAD = 12; // 小节内左右留白
const LEFT_PAD = 14; // 谱面左缘
const CLEF_W = 34;
const TIMESIG_W = 20;
const END_PAD = 34;

/** 升号在五线谱（高音谱号）上的标准位置（绝对音级步） */
const SHARP_STEPS = [38, 35, 39, 36, 33, 37, 34] as const; // F♯5 C♯5 G♯5 D♯5 A♯4 E♯5 B♯4
const FLAT_STEPS = [34, 37, 33, 36, 32, 35, 31] as const; // B♭4 E♭5 A♭4 D♭5 G♭4 C♭5 F♭4

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

export type EventState = 'todo' | 'current' | 'done' | 'passed';

export interface ScoreView {
  el: HTMLElement;
  /** 换谱：重建整个 SVG */
  setScore(score: Score | null): void;
  /** 设置某事件状态（current 会自动卷动谱面） */
  setEventState(index: number, state: EventState): void;
  /** 全部重置为 todo */
  resetStates(): void;
  /** 在「播放头 x × 该音谱面高度」处放一颗错音星光 */
  sparkle(midi: number): void;
  /** 命中时在当前目标上放一个小的命中光圈 */
  hitPop(): void;
  /** 演奏模式播放头（拍）；wait 模式传 null 隐藏 */
  setPlayhead(beat: number | null): void;
  /** 视口宽度变化时重新对齐 */
  relayout(): void;
}

interface EvRef {
  g: SVGGElement;
  x: number;
  beat: number;
}

export function createScoreView(): ScoreView {
  const el = document.createElement('div');
  el.className = 'sp-scorewrap';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', '五线谱卷轴');

  const fxLayer = document.createElement('div');
  fxLayer.className = 'sp-fxlayer';

  let score: Score | null = null;
  let svg: SVGSVGElement | null = null;
  let inner: SVGGElement | null = null;
  let playheadLine: SVGLineElement | null = null;
  let refs: EvRef[] = [];
  let totalWidth = 0;
  let translateX = 0;
  let currentX = 0;
  let sig: KeySig | null = null;

  function viewportW(): number {
    return el.clientWidth || 720;
  }

  function applyTranslate(): void {
    if (!svg) return;
    svg.style.transform = `translateX(${translateX}px)`;
  }

  /** 让 x 落在视口约 32% 处 */
  function scrollTo(x: number): void {
    const target = Math.min(0, Math.max(viewportW() - totalWidth, viewportW() * 0.32 - x));
    if (Math.abs(target - translateX) > 1) {
      translateX = target;
      applyTranslate();
    }
  }

  function xOfBeat(beat: number): number {
    if (!score) return 0;
    const contentX = LEFT_PAD + CLEF_W + keySigWidth(score.sig) + TIMESIG_W;
    const measureW = MEAS_PAD * 2 + score.beatsPerBar * BEAT_W;
    const bar = Math.floor(beat / score.beatsPerBar);
    const inBar = beat - bar * score.beatsPerBar;
    return contentX + bar * measureW + MEAS_PAD + inBar * BEAT_W;
  }

  function drawNote(g: SVGGElement, ev: ScoreEvent, x: number): void {
    if (ev.midis.length === 0) {
      // 休止符
      g.append(
        se('text', {
          x,
          y: LINE_Y0 - GAP * 2.4,
          'font-size': 20,
          class: 'sp-rest',
          'text-anchor': 'middle',
          textContent: '𝄽',
        }),
      );
      return;
    }

    const steps = ev.spelled.map((s) => s.step);
    const hollow = ev.dur >= 2;
    const noStem = ev.dur >= 3.5;
    const eighth = ev.dur <= 0.75;

    // 加线
    const lineSteps = new Set<number>();
    for (const s of steps) {
      for (let ls = STEP_E4 + 10; ls <= s + 1; ls += 2) lineSteps.add(ls);
      for (let ls = STEP_E4 - 2; ls >= s - 1; ls -= 2) lineSteps.add(ls);
    }
    for (const ls of lineSteps) {
      g.append(
        se('line', {
          x1: x - 10,
          y1: yOf(ls),
          x2: x + 10,
          y2: yOf(ls),
          class: 'sp-ledger',
        }),
      );
    }

    // 二度相邻符头错开
    const xOffset = new Map<number, number>();
    for (let i = 1; i < steps.length; i++) {
      if (steps[i]! - steps[i - 1]! === 1) {
        const prev = xOffset.get(i - 1) ?? 0;
        xOffset.set(i, prev === 0 ? -6.5 : 0);
      }
    }

    const stemUp = steps.reduce((a, b) => a + b, 0) / steps.length < STEP_E4 + 4;

    ev.spelled.forEach((sp, i) => {
      const y = yOf(sp.step);
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
    if (Math.abs(ev.dur % 1 - 0.5) < 0.01 || Math.abs(ev.dur % 1 - 0.75) < 0.01) {
      const topY = yOf(steps[steps.length - 1]!);
      g.append(se('circle', { cx: x + 9.5, cy: topY - 2, r: 1.6, class: 'sp-dot' }));
    }

    if (noStem) return;

    const topY = yOf(steps[steps.length - 1]!);
    const botY = yOf(steps[0]!);
    const stemX = stemUp ? x + 5 : x - 5;
    const [y1, y2] = stemUp ? [topY - 3 - 30, botY] : [topY, botY + 3 + 30];
    g.append(se('line', { x1: stemX, y1, x2: stemX, y2, class: 'sp-stem' }));

    // 孤立八分音符画小旗（同拍成对的会由连杠层统一抹掉重画）
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

  function keySigWidth(s: KeySig): number {
    const n = Math.abs(s.fifths);
    return n === 0 ? 0 : n * 9 + 6;
  }

  function render(sc: Score): void {
    sig = sc.sig;
    const measureW = MEAS_PAD * 2 + sc.beatsPerBar * BEAT_W;
    const barCount = Math.ceil(sc.totalBeats / sc.beatsPerBar);
    const contentX = LEFT_PAD + CLEF_W + keySigWidth(sc.sig) + TIMESIG_W;
    totalWidth = contentX + barCount * measureW + END_PAD;

    svg = se('svg', {
      width: totalWidth,
      height: 176,
      viewBox: `0 0 ${totalWidth} 176`,
      class: 'sp-score',
    });
    inner = se('g', {});
    svg.append(inner);
    refs = [];

    // 五线
    for (let i = 0; i < 5; i++) {
      const y = LINE_Y0 - i * GAP;
      inner.append(
        se('line', { x1: 8, y1: y, x2: totalWidth - 10, y2: y, class: 'sp-line' }),
      );
    }
    // 谱号
    inner.append(
      se('text', {
        x: LEFT_PAD,
        y: LINE_Y0 + GAP * 0.9,
        'font-size': 42,
        class: 'sp-clef',
        textContent: '𝄞',
      }),
    );
    // 调号
    const fifths = sc.sig.fifths;
    const steps = fifths >= 0 ? SHARP_STEPS : FLAT_STEPS;
    const sym = fifths >= 0 ? '♯' : '♭';
    for (let i = 0; i < Math.abs(fifths); i++) {
      inner.append(
        se('text', {
          x: LEFT_PAD + CLEF_W + i * 9,
          y: yOf(steps[i]!) + 4,
          'font-size': 13,
          class: 'sp-acc',
          textContent: sym,
        }),
      );
    }
    // 拍号
    const tsX = LEFT_PAD + CLEF_W + keySigWidth(sc.sig) + 2;
    inner.append(
      se('text', {
        x: tsX,
        y: LINE_Y0 - GAP * 2 + 3,
        'font-size': 15,
        class: 'sp-timesig',
        textContent: String(sc.beatsPerBar),
      }),
      se('text', {
        x: tsX,
        y: LINE_Y0 + 4,
        'font-size': 15,
        class: 'sp-timesig',
        textContent: String(sc.beatUnit),
      }),
    );

    // 小节线 + 小节序号
    for (let b = 0; b <= barCount; b++) {
      const x = contentX + b * measureW;
      const last = b === barCount;
      inner.append(
        se('line', {
          x1: x,
          y1: LINE_Y0 - GAP * 4,
          x2: x,
          y2: LINE_Y0,
          class: 'sp-barline',
        }),
      );
      if (last) {
        inner.append(
          se('rect', {
            x: x + 2,
            y: LINE_Y0 - GAP * 4,
            width: 3.4,
            height: GAP * 4,
            class: 'sp-finalbar',
          }),
        );
      }
      if (b < barCount) {
        inner.append(
          se('text', {
            x: x + 3,
            y: LINE_Y0 - GAP * 4 - 16,
            'font-size': 9,
            class: 'sp-barnum',
            textContent: String(b + 1),
          }),
        );
      }
    }

    // 事件
    const byBar = new Map<number, { ev: ScoreEvent; x: number; ref: EvRef }[]>();
    sc.events.forEach((ev, idx) => {
      const x = xOfBeat(ev.beat);
      const g = se('g', { class: 'sp-ev', 'data-idx': idx }) as SVGGElement;
      // 和弦名 / 级数标签
      if (ev.label) {
        g.append(
          se('text', {
            x,
            y: LINE_Y0 - GAP * 4 - 6,
            'font-size': 10.5,
            class: 'sp-evlabel',
            'text-anchor': 'middle',
            textContent: ev.label,
          }),
        );
      }
      const ref: EvRef = { g, x, beat: ev.beat };
      refs.push(ref);
      const bar = Math.floor(ev.beat / sc.beatsPerBar);
      const arr = byBar.get(bar) ?? [];
      arr.push({ ev, x, ref });
      byBar.set(bar, arr);
      inner!.append(g);
      drawNote(g, ev, x);
    });

    // 连杠两趟的第二趟：找出同拍八分音符组，抹掉各自的符干/旗，统一画杠
    for (const arr of byBar.values()) {
      drawBeamsPrep(arr);
    }

    // 播放头
    playheadLine = se('line', {
      x1: 0,
      y1: 24,
      x2: 0,
      y2: LINE_Y0 + 24,
      class: 'sp-playhead',
      visibility: 'hidden',
    });
    inner.append(playheadLine);

    el.replaceChildren(svg, fxLayer);
    translateX = 0;
    applyTranslate();
  }

  /**
   * 连杠需要两趟：第一趟画音符时还不知道同拍伙伴。
   * 做法：drawNote 先照单画；这里找出可连杠组，抹掉组内音符的符干/旗，
   * 再统一画连杠与补齐的符干。
   */
  function drawBeamsPrep(barEvents: { ev: ScoreEvent; x: number; ref: EvRef }[]): void {
    const groups = new Map<number, { ev: ScoreEvent; x: number; ref: EvRef }[]>();
    for (const item of barEvents) {
      if (item.ev.midis.length === 0 || item.ev.dur > 0.75 || item.ev.dur < 0.4) continue;
      const inBar = item.ev.beat % score!.beatsPerBar;
      const key = Math.floor(inBar);
      const arr = groups.get(key) ?? [];
      arr.push(item);
      groups.set(key, arr);
    }
    for (const arr of groups.values()) {
      if (arr.length < 2) continue;
      // 抹掉组内每个事件已画的符干和旗
      for (const it of arr) {
        it.ref.g.querySelectorAll('.sp-stem, .sp-flag').forEach((n) => n.remove());
      }
      const allSteps = arr.flatMap((it) => it.ev.spelled.map((s) => s.step));
      const avg = allSteps.reduce((a, b) => a + b, 0) / allSteps.length;
      const up = avg < STEP_E4 + 4;
      const beamY = up
        ? Math.min(...arr.map((it) => yOf(Math.max(...it.ev.spelled.map((s) => s.step))) - 33))
        : Math.max(...arr.map((it) => yOf(Math.min(...it.ev.spelled.map((s) => s.step))) + 33));
      for (const it of arr) {
        const steps = it.ev.spelled.map((s) => s.step);
        const headY = up ? yOf(Math.max(...steps)) - 2 : yOf(Math.min(...steps)) + 2;
        const sx = it.x + (up ? 5 : -5);
        it.ref.g.append(
          se('line', { x1: sx, y1: beamY, x2: sx, y2: headY, class: 'sp-stem' }),
        );
      }
      const x1 = arr[0]!.x + (up ? 5 : -5);
      const x2 = arr[arr.length - 1]!.x + (up ? 5 : -5);
      arr[arr.length - 1]!.ref.g.append(
        se('rect', {
          x: x1 - 0.5,
          y: up ? beamY : beamY - 4.4,
          width: x2 - x1 + 1,
          height: 4.4,
          class: 'sp-beam',
        }),
      );
    }
  }

  return {
    el,

    setScore(sc: Score | null): void {
      score = sc;
      if (!sc) {
        svg = null;
        sig = null;
        refs = [];
        el.replaceChildren(fxLayer);
        fxLayer.replaceChildren();
        return;
      }
      render(sc);
    },

    setEventState(index: number, state: EventState): void {
      const ref = refs[index];
      if (!ref) return;
      ref.g.classList.remove('sp-ev-current', 'sp-ev-done', 'sp-ev-passed');
      if (state !== 'todo') ref.g.classList.add(`sp-ev-${state}`);
      if (state === 'current') {
        currentX = ref.x;
        scrollTo(ref.x);
      }
    },

    resetStates(): void {
      for (const ref of refs) {
        ref.g.classList.remove('sp-ev-current', 'sp-ev-done', 'sp-ev-passed');
      }
      translateX = 0;
      applyTranslate();
      fxLayer.replaceChildren();
    },

    sparkle(midi: number): void {
      if (!score || !sig) return;
      const sp = spellInKey(midi, sig);
      const star = document.createElement('i');
      star.className = 'sp-sparkle';
      star.textContent = '✦';
      const jitter = (Math.random() - 0.5) * 14;
      star.style.left = `${currentX + translateX + jitter}px`;
      star.style.top = `${yOf(sp.step) - 8 + (Math.random() - 0.5) * 8}px`;
      star.style.animationDuration = `${0.7 + Math.random() * 0.4}s`;
      fxLayer.append(star);
      setTimeout(() => star.remove(), 1200);
    },

    hitPop(): void {
      const pop = document.createElement('i');
      pop.className = 'sp-hitpop';
      pop.style.left = `${currentX + translateX}px`;
      pop.style.top = `${LINE_Y0 - GAP * 2}px`;
      fxLayer.append(pop);
      setTimeout(() => pop.remove(), 500);
    },

    setPlayhead(beat: number | null): void {
      if (!playheadLine) return;
      if (beat === null) {
        playheadLine.setAttribute('visibility', 'hidden');
        return;
      }
      const x = xOfBeat(beat);
      playheadLine.setAttribute('x1', String(x));
      playheadLine.setAttribute('x2', String(x));
      playheadLine.setAttribute('visibility', 'visible');
      scrollTo(x + BEAT_W);
    },

    relayout(): void {
      if (refs.length) scrollTo(currentX);
    },
  };
}
