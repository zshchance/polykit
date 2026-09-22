/**
 * 识谱琴房 —— 五线谱卷轴渲染（手写 SVG，零依赖）。
 *
 * 一页会跟着演奏滚动的奶油色谱纸：
 *   - 单谱表（单手曲）或大谱表（双手曲，高低音谱表 + 连谱线）
 *   - 谱号 + 调号（两谱表各自的标准位置）+ 拍号 + 小节线 + 小节序号
 *   - 音符状态：墨色待弹 / 琥珀呼吸 = 当前目标 / 命中变绿 / 演奏错过变灰红
 *   - 连杠按谱表分组（同拍八分成杠、十六分双杠），附点/加线齐全
 *
 * 滚动（本条重写的心脏）：一个 rAF 循环独占 transform——
 *   演奏模式：拍→像素是纯线性映射（xOfBeat = 原点 + beat*BEAT_W），
 *             小节线只是装饰、不占时间轴宽度，谱面左移严格匀速、
 *             过小节零跳变；当前音符高亮由同一帧的连续播放头节拍
 *             驱动，变化精确落在指示条压到符头的瞬间；
 *   跟弹模式：目标变化时以临界阻尼滑过去，没有缓动重启的忽快忽慢。
 * 错音反馈画在谱面坐标系里（fx 层在 SVG 内部，随谱面一起滚）：
 * 在「弹的那个音」的谱面位置画幽灵音符 + 金星——弹成 C 就标在 C 上。
 */

import { isGrand, type Score, type ScoreEvent } from '../score';
import { spellInKey, type KeySig } from '../theory';
import {
  BEAT_W,
  CLEF_W,
  END_PAD,
  GAP,
  LEFT_PAD,
  TIMESIG_W,
  drawClefs,
  drawKeySig,
  drawNoteCluster,
  drawRest,
  drawStaffLines,
  drawTimeSig,
  geomFor,
  keySigWidth,
  ledgerSteps,
  se,
  staffOfStep,
  yOf,
  type StaffGeom,
  type StaffId,
} from './staff';

export type EventState = 'todo' | 'current' | 'done' | 'passed';

/** 拍号之后、首个音符之前的呼吸位 */
const FIRST_PAD = 10;
/** 小节线相对小节边界拍点的最大提前量（落在两音间隙中点，不压符头） */
const BAR_INSET_MAX = 20;
/** 播放头指示条宽度（谱面坐标 px），中心亮线即精确节拍位 */
const BAND_W = 26;

export interface ScoreView {
  el: HTMLElement;
  /** 换谱：重建整个 SVG */
  setScore(score: Score | null): void;
  /** 设置某事件状态（current 会成为平滑滚动的锚点） */
  setEventState(index: number, state: EventState): void;
  /** 全部重置为 todo */
  resetStates(): void;
  /** 错音反馈：在弹错音自己的谱面位置画幽灵音符 + 星光 */
  sparkle(midi: number): void;
  /** 命中时在当前目标上放一个小的命中光圈 */
  hitPop(): void;
  /** 演奏模式连续播放头（拍，音频时钟驱动）；跟弹模式传 null 隐藏 */
  setPlayhead(beat: number | null): void;
  /** 视口宽度变化时重新对齐（滚动循环每帧自取视口宽，这里仅兜底） */
  relayout(): void;
}

interface EvRef {
  g: SVGGElement;
  gt: SVGGElement | null;
  gb: SVGGElement | null;
  x: number;
  beat: number;
}

export function createScoreView(): ScoreView {
  const el = document.createElement('div');
  el.className = 'sp-scorewrap';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', '五线谱卷轴');

  let score: Score | null = null;
  let sig: KeySig | null = null;
  let geom: StaffGeom = geomFor(false);
  let svg: SVGSVGElement | null = null;
  let inner: SVGGElement | null = null;
  let fxG: SVGGElement | null = null;
  let playheadLine: SVGLineElement | null = null;
  let playheadBand: SVGRectElement | null = null;
  let refs: EvRef[] = [];
  let totalWidth = 0;
  /** 内容原点：谱号 + 调号 + 拍号之后的 x */
  let contentX = 0;
  let currentX = 0;
  let translateX = 0;
  let playheadBeat: number | null = null;
  /** 演奏模式下播放头正压着的事件（-1 = 无），随播放头逐帧刷新 */
  let nowIdx = -1;
  let raf = 0;
  let lastFrame = 0;

  function viewportW(): number {
    return el.clientWidth || 720;
  }

  function anchorX(): number {
    return viewportW() * 0.32;
  }

  function clampTx(v: number): number {
    return Math.min(0, Math.max(viewportW() - totalWidth, v));
  }

  function applyTranslate(): void {
    if (!svg) return;
    svg.style.transform = `translateX(${translateX}px)`;
  }

  /** 滚动主循环：演奏 = 音频时钟直出；跟弹 = 阻尼滑向目标 */
  function frame(t: number): void {
    if (!svg || !score) {
      raf = 0;
      return;
    }
    const dt = Math.min(0.05, Math.max(0.001, (t - lastFrame) / 1000));
    lastFrame = t;
    if (playheadBeat !== null) {
      const x = xOfBeat(Math.max(0, playheadBeat));
      translateX = clampTx(anchorX() - x);
      if (playheadBand) {
        playheadBand.setAttribute('x', String(x - BAND_W / 2));
        playheadBand.setAttribute('visibility', 'visible');
      }
      if (playheadLine) {
        playheadLine.setAttribute('x1', String(x));
        playheadLine.setAttribute('x2', String(x));
        playheadLine.setAttribute('visibility', 'visible');
      }
      // 错音星光/命中光圈落在指示条处；当前音符高亮与位移同一帧同节拍更新
      currentX = x;
      markNow(playheadBeat);
    } else {
      if (playheadBand) playheadBand.setAttribute('visibility', 'hidden');
      if (playheadLine) playheadLine.setAttribute('visibility', 'hidden');
      const goal = clampTx(anchorX() - currentX);
      translateX += (goal - translateX) * (1 - Math.exp(-dt * 6.5));
      if (Math.abs(goal - translateX) < 0.3) translateX = goal;
    }
    applyTranslate();
    raf = requestAnimationFrame(frame);
  }

  function startLoop(): void {
    if (raf) return;
    lastFrame = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stopLoop(): void {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /**
   * 拍 → 谱面 x：严格线性（匀速滚动的心脏）。
   * 小节线不占时间轴宽度，只是画在两音间隙里的装饰，
   * 因此播放头过界时谱面没有任何跳变。
   */
  function xOfBeat(beat: number): number {
    if (!score) return 0;
    return contentX + FIRST_PAD + beat * BEAT_W;
  }

  /**
   * 演奏模式：播放头正压着的事件换成 current 高亮（琥珀呼吸）。
   * 与谱面位移共用同一帧的连续节拍，变化精确对齐指示条中心；
   * 已判定（done/passed）的事件不再染回琥珀。
   */
  function markNow(beat: number): void {
    let lo = 0;
    let hi = refs.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (refs[mid]!.beat <= beat + 1e-4) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (idx === nowIdx) return;
    if (nowIdx >= 0) refs[nowIdx]!.g.classList.remove('sp-ev-current');
    nowIdx = idx;
    if (idx >= 0) {
      const g = refs[idx]!.g;
      if (!g.classList.contains('sp-ev-done') && !g.classList.contains('sp-ev-passed')) {
        g.classList.add('sp-ev-current');
      }
    }
  }

  function drawEvent(ev: ScoreEvent, x: number, idx: number): EvRef {
    const g = se('g', { class: 'sp-ev', 'data-idx': idx }) as SVGGElement;
    let gt: SVGGElement | null = null;
    let gb: SVGGElement | null = null;

    // 标签（和弦名 / 级数）在大谱表也始终放在高音谱表上方
    if (ev.label) {
      g.append(
        se('text', {
          x,
          y: geom.trebleY0 - GAP * 4 - (geom.grand ? 14 : 6),
          'font-size': 10.5,
          class: 'sp-evlabel',
          'text-anchor': 'middle',
          textContent: ev.label,
        }),
      );
    }

    if (ev.spelled.length) {
      gt = se('g', {}) as SVGGElement;
      drawNoteCluster(gt, ev.spelled, x, ev.dur, 't', geom);
      g.append(gt);
    } else if (!ev.bassSpelled.length) {
      drawRest(g, x, geom);
    }
    // 左手音：高音谱表侧为空时不再补休止符（右手长音在视觉上延续）
    if (ev.bassSpelled.length) {
      gb = se('g', {}) as SVGGElement;
      drawNoteCluster(gb, ev.bassSpelled, x, ev.dur, 'b', geom);
      g.append(gb);
    }
    return { g, gt, gb, x, beat: ev.beat };
  }

  function render(sc: Score): void {
    sig = sc.sig;
    geom = geomFor(isGrand(sc));
    contentX = LEFT_PAD + CLEF_W + keySigWidth(sc.sig) + TIMESIG_W;
    const barCount = Math.ceil(sc.totalBeats / sc.beatsPerBar);
    totalWidth = contentX + FIRST_PAD + sc.totalBeats * BEAT_W + END_PAD;

    svg = se('svg', {
      width: totalWidth,
      height: geom.height,
      viewBox: `0 0 ${totalWidth} ${geom.height}`,
      class: 'sp-score',
    });
    // 播放头指示条的琥珀渐变（水平：两边透明、中间聚拢）
    const defs = se('defs', {});
    const grad = se('linearGradient', { id: 'sp-phgrad', x1: '0', y1: '0', x2: '1', y2: '0' });
    grad.append(
      se('stop', { offset: '0%', 'stop-color': '#d97706', 'stop-opacity': '0' }),
      se('stop', { offset: '30%', 'stop-color': '#d97706', 'stop-opacity': '0.13' }),
      se('stop', { offset: '50%', 'stop-color': '#d97706', 'stop-opacity': '0.30' }),
      se('stop', { offset: '70%', 'stop-color': '#d97706', 'stop-opacity': '0.13' }),
      se('stop', { offset: '100%', 'stop-color': '#d97706', 'stop-opacity': '0' }),
    );
    defs.append(grad);
    svg.append(defs);
    inner = se('g', {});
    svg.append(inner);
    refs = [];
    nowIdx = -1;

    drawStaffLines(inner, geom, 8, totalWidth - 10);
    drawClefs(inner, geom);
    drawKeySig(inner, sc.sig, geom);
    drawTimeSig(inner, sc.sig, geom, sc.beatsPerBar, sc.beatUnit);

    // 小节线（大谱表连通两层）：不占时间轴宽度，画在「边界拍点与前一个
    // 事件间隙」的中点（上限 BAR_INSET_MAX），过界滚动因此零跳变；
    // 起始处按标准记谱不画小节线，结尾画终止双线
    const barTop = geom.trebleY0 - GAP * 4;
    const barBottom = geom.grand ? geom.bassY0 : geom.trebleY0;
    const barXOf = (b: number): number => {
      const boundary = b * sc.beatsPerBar;
      const bx = xOfBeat(boundary);
      let prev = -Infinity;
      for (const ev of sc.events) {
        if (ev.beat >= boundary - 1e-6) break;
        prev = ev.beat;
      }
      const inset =
        prev === -Infinity ? BAR_INSET_MAX : Math.min((bx - xOfBeat(prev)) / 2, BAR_INSET_MAX);
      return bx - inset;
    };
    for (let b = 1; b <= barCount; b++) {
      const x = barXOf(b);
      const last = b === barCount;
      inner.append(se('line', { x1: x, y1: barTop, x2: x, y2: barBottom, class: 'sp-barline' }));
      if (last) {
        inner.append(
          se('rect', { x: x + 2, y: barTop, width: 3.4, height: barBottom - barTop, class: 'sp-finalbar' }),
        );
      }
    }
    for (let b = 0; b < barCount; b++) {
      inner.append(
        se('text', {
          x: b === 0 ? xOfBeat(0) - 8 : barXOf(b) + 3,
          y: barTop - (geom.grand ? 22 : 16),
          'font-size': 9,
          class: 'sp-barnum',
          textContent: String(b + 1),
        }),
      );
    }

    // 事件
    const byBar = new Map<number, { ev: ScoreEvent; ref: EvRef }[]>();
    sc.events.forEach((ev, idx) => {
      const x = xOfBeat(ev.beat);
      const ref = drawEvent(ev, x, idx);
      inner!.append(ref.g);
      refs.push(ref);
      const bar = Math.floor(ev.beat / sc.beatsPerBar);
      const arr = byBar.get(bar) ?? [];
      arr.push({ ev, ref });
      byBar.set(bar, arr);
    });

    // 连杠第二趟：按谱表分组，抹掉组内符干/旗，统一画杠（十六分双杠）
    for (const arr of byBar.values()) {
      drawBeams(arr, 't');
      drawBeams(arr, 'b');
    }

    // fx 层（星光/命中光圈，谱面坐标系，随谱面滚动）
    fxG = se('g', { class: 'sp-fxg' });
    inner.append(fxG);

    // 播放头指示条：琥珀渐变带 + 中心亮线（谱面坐标，随位移逐帧对齐视口锚点）
    playheadBand = se('rect', {
      x: 0,
      y: 14,
      width: BAND_W,
      height: barBottom + 26 - 14,
      rx: 7,
      fill: 'url(#sp-phgrad)',
      class: 'sp-phband',
      visibility: 'hidden',
    });
    playheadLine = se('line', {
      x1: 0,
      y1: 14,
      x2: 0,
      y2: barBottom + 26,
      class: 'sp-playhead',
      visibility: 'hidden',
    });
    inner.append(playheadBand, playheadLine);

    el.style.height = `${geom.height}px`;
    el.replaceChildren(svg);
    translateX = 0;
    currentX = xOfBeat(0);
    applyTranslate();
    startLoop();
  }

  /** 连杠：同小节、同谱表、同拍内的八分/十六分成组 */
  function drawBeams(barEvents: { ev: ScoreEvent; ref: EvRef }[], staff: StaffId): void {
    if (!score) return;
    const groups = new Map<number, { ev: ScoreEvent; ref: EvRef }[]>();
    for (const item of barEvents) {
      const sub = staff === 't' ? item.ref.gt : item.ref.gb;
      if (!sub) continue;
      if (item.ev.dur > 0.75 || item.ev.dur < 0.2) continue;
      const inBar = item.ev.beat % score.beatsPerBar;
      const key = Math.floor(inBar);
      const arr = groups.get(key) ?? [];
      arr.push(item);
      groups.set(key, arr);
    }
    for (const arr of groups.values()) {
      if (arr.length < 2) continue;
      for (const it of arr) {
        const sub = (staff === 't' ? it.ref.gt : it.ref.gb)!;
        sub.querySelectorAll('.sp-stem, .sp-flag').forEach((n) => n.remove());
      }
      const spelledOf = (it: { ev: ScoreEvent }) =>
        (staff === 't' ? it.ev.spelled : it.ev.bassSpelled).map((s) => s.step);
      const allSteps = arr.flatMap(spelledOf);
      if (!allSteps.length) continue;
      const avg = allSteps.reduce((a, b) => a + b, 0) / allSteps.length;
      const centerStep = staff === 't' ? 34 : 22;
      const up = avg < centerStep;
      const beamY = up
        ? Math.min(...arr.map((it) => yOf(Math.max(...spelledOf(it)), staff, geom) - 33))
        : Math.max(...arr.map((it) => yOf(Math.min(...spelledOf(it)), staff, geom) + 33));
      for (const it of arr) {
        const steps = spelledOf(it);
        const headY = up ? yOf(Math.max(...steps), staff, geom) - 2 : yOf(Math.min(...steps), staff, geom) + 2;
        const sx = it.ref.x + (up ? 5 : -5);
        const sub = (staff === 't' ? it.ref.gt : it.ref.gb)!;
        sub.append(se('line', { x1: sx, y1: beamY, x2: sx, y2: headY, class: 'sp-stem' }));
      }
      const x1 = arr[0]!.ref.x + (up ? 5 : -5);
      const x2 = arr[arr.length - 1]!.ref.x + (up ? 5 : -5);
      const lastSub = (staff === 't' ? arr[arr.length - 1]!.ref.gt : arr[arr.length - 1]!.ref.gb)!;
      lastSub.append(
        se('rect', {
          x: x1 - 0.5,
          y: up ? beamY : beamY - 4.4,
          width: x2 - x1 + 1,
          height: 4.4,
          class: 'sp-beam',
        }),
      );
      // 十六分音符（时值 ≤ 0.3）加第二道杠
      if (arr.every((it) => it.ev.dur <= 0.3)) {
        lastSub.append(
          se('rect', {
            x: x1 - 0.5,
            y: up ? beamY + 5.4 : beamY - 9.8,
            width: x2 - x1 + 1,
            height: 4.4,
            class: 'sp-beam',
          }),
        );
      }
    }
  }

  return {
    el,

    setScore(sc: Score | null): void {
      stopLoop();
      score = sc;
      playheadBeat = null;
      nowIdx = -1;
      if (!sc) {
        svg = null;
        sig = null;
        refs = [];
        fxG = null;
        playheadLine = null;
        playheadBand = null;
        el.replaceChildren();
        return;
      }
      render(sc);
    },

    setEventState(index: number, state: EventState): void {
      const ref = refs[index];
      if (!ref) return;
      ref.g.classList.remove('sp-ev-current', 'sp-ev-done', 'sp-ev-passed');
      if (state !== 'todo') ref.g.classList.add(`sp-ev-${state}`);
      if (state === 'current') currentX = ref.x;
    },

    resetStates(): void {
      for (const ref of refs) {
        ref.g.classList.remove('sp-ev-current', 'sp-ev-done', 'sp-ev-passed');
      }
      translateX = 0;
      playheadBeat = null;
      nowIdx = -1;
      fxG?.replaceChildren();
      applyTranslate();
    },

    sparkle(midi: number): void {
      if (!score || !sig || !fxG) return;
      const sp = spellInKey(midi, sig);
      const staff: StaffId = geom.grand ? staffOfStep(sp.step) : 't';
      const y = yOf(sp.step, staff, geom);
      const x = currentX;
      const g = se('g', { class: 'sp-ghost' }) as SVGGElement;
      // 幽灵音符：加线 + 临时记号 + 符头，精确落在弹错音的谱面位置
      for (const ls of ledgerSteps(sp.step, staff)) {
        g.append(
          se('line', { x1: x - 9, y1: yOf(ls, staff, geom), x2: x + 9, y2: yOf(ls, staff, geom), class: 'sp-ghost-ledger' }),
        );
      }
      if (sp.acc !== 0) {
        g.append(
          se('text', {
            x: x - 14,
            y: y + 4,
            'font-size': 12,
            class: 'sp-ghost-acc',
            'text-anchor': 'middle',
            textContent: sp.acc === 1 ? '♯' : sp.acc === -1 ? '♭' : '♮',
          }),
        );
      }
      g.append(
        se('ellipse', {
          cx: x,
          cy: y,
          rx: 5.2,
          ry: 4,
          class: 'sp-ghost-head',
          transform: `rotate(-16 ${x} ${y})`,
        }),
      );
      const star = se('text', {
        x,
        y: y - 11,
        'font-size': 17,
        class: 'sp-ghost-star',
        'text-anchor': 'middle',
        textContent: '✦',
      });
      g.append(star);
      fxG.append(g);
      setTimeout(() => g.remove(), 1300);
    },

    hitPop(): void {
      if (!fxG) return;
      const pop = se('circle', {
        cx: currentX,
        cy: geom.trebleY0 - GAP * 2,
        r: 14,
        class: 'sp-hitpop',
      });
      fxG.append(pop);
      setTimeout(() => pop.remove(), 500);
    },

    setPlayhead(beat: number | null): void {
      playheadBeat = beat;
      if (beat === null) {
        if (playheadBand) playheadBand.setAttribute('visibility', 'hidden');
        if (playheadLine) playheadLine.setAttribute('visibility', 'hidden');
        // 播放头收起时摘掉它驱动的 current（跟弹模式的 current 由判定侧重设）
        if (nowIdx >= 0) {
          refs[nowIdx]?.g.classList.remove('sp-ev-current');
          nowIdx = -1;
        }
      }
    },

    relayout(): void {
      applyTranslate();
    },
  };
}
