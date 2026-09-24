/**
 * 调式罗盘 —— 五度圈转盘（SVG）。
 *
 * 渲染模型（对照视频里的圆环）：
 *   - 外圈 12 格音名按五度圈钉死不动（C 永远在顶部）——换调不换盘，
 *     只是"调式窗口"（调内格被点亮、级数标签）整体滑到新主音
 *   - 内圈级数格与外圈同角度对齐，只有调内音的格子才出现；
 *     堆不出三和弦的级显示 '–'，调外音没有内圈格
 *   - 染色 = 与主和弦的共同音数（紫=主和弦，橙=近，蓝=中，粉=远），
 *     一眼看出 ♯Ⅱ 为什么是"意外之美"
 *   - 主音锚点 = 常驻小三角；演奏光标 = 外圈大箭头 + 该格发光，
 *     两者分离：箭头随节拍走，锚点随调走
 *
 * 交互：点调内格即弹该级和弦；点的位置在环的内半圈 = 低把位，
 * 外半圈 = 高把位（一维力度条）。键盘可 Tab 聚焦后 Enter 触发。
 */

import {
  FIFTH_ORDER,
  degreePrimaryNumeral,
  fifthIndex,
  pcName,
  type DegreeInfo,
  type ModeTable,
  type Register,
} from '../theory';

const NS = 'http://www.w3.org/2000/svg';
const SIZE = 640;
const CX = SIZE / 2;
const CY = SIZE / 2;

/** 环的几何参数 */
const OUTER_R_IN = 172;
const OUTER_R_OUT = 246;
const INNER_R_IN = 114;
const INNER_R_OUT = 164;
const NOTE_R = 209; // 音名半径
const NUMERAL_R = 139; // 级数半径
const GAP_DEG = 1.1; // 格间缝隙（单侧）

export interface WheelEvents {
  /** 点按某级（register 由点击半径决定） */
  onStrike: (degree: DegreeInfo, register: Register) => void;
}

export interface WheelApi {
  el: SVGSVGElement;
  /** 换调/换调式：整体重绘（音名不动，窗口与标签滑动） */
  render: (table: ModeTable, preferFlat: boolean) => void;
  /** 演奏光标：箭头指向该级并发光；null 收起 */
  setCursor: (degreeIndex: number | null) => void;
  /** 点按高亮（不移动箭头，仅短暂发光） */
  flash: (degreeIndex: number) => void;
}

type SvgAttrs = Record<string, string | number>;

function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: SvgAttrs = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** 角度（0=顶部，顺时针，度）→ 坐标 */
function polar(r: number, angleDeg: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: CX + r * Math.sin(a), y: CY - r * Math.cos(a) };
}

/** 甜甜圈扇形路径（a0→a1 顺时针，度） */
function sectorPath(rIn: number, rOut: number, a0: number, a1: number): string {
  const p1 = polar(rOut, a0);
  const p2 = polar(rOut, a1);
  const p3 = polar(rIn, a1);
  const p4 = polar(rIn, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return [
    `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    `A ${rOut} ${rOut} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
    `A ${rIn} ${rIn} 0 ${large} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

/** 该级对应的染色类名（共同音远近） */
function toneClass(degree: DegreeInfo): string {
  const chord = degree.chords[0];
  if (!chord) return 'mw-seg--dead';
  if (degree.index === 0) return 'mw-seg--tonic';
  if (chord.common >= 2) return 'mw-seg--near';
  if (chord.common === 1) return 'mw-seg--mid';
  return 'mw-seg--far';
}

export function createWheel(events: WheelEvents): WheelApi {
  const svg = s('svg', {
    viewBox: `0 0 ${SIZE} ${SIZE}`,
    class: 'mw-svg',
    role: 'img',
    'aria-label': '调式和弦转盘',
  });

  // 图层顺序：外圈 → 内圈 → 和声轨迹 → 锚点/箭头 → 中心文字
  const outerLayer = s('g', { class: 'mw-layer-outer' });
  const innerLayer = s('g', { class: 'mw-layer-inner' });
  const trailLayer = s('g', { class: 'mw-layer-trail' });
  const markerLayer = s('g', { class: 'mw-layer-marker' });
  const centerLayer = s('g', { class: 'mw-layer-center' });
  svg.append(outerLayer, innerLayer, trailLayer, markerLayer, centerLayer);

  // 演奏箭头（常驻 DOM，只改角度与可见性，平滑滑动）
  const arrow = s('g', { class: 'mw-arrow', transform: 'rotate(0 320 320)', opacity: '0' });
  const arrowHead = s('path', {
    d: `M ${CX - 22} 16 L ${CX + 22} 16 L ${CX} 56 Z`,
    class: 'mw-arrow-head',
  });
  const arrowStem = s('rect', {
    x: CX - 9,
    y: -2,
    width: 18,
    height: 20,
    rx: 4,
    class: 'mw-arrow-stem',
  });
  arrow.append(arrowStem, arrowHead);
  markerLayer.append(arrow);

  let table: ModeTable | null = null;
  let cursorIndex: number | null = null;
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  /** 级下标 → 该级根音所在格的中心角（度） */
  function degreeAngle(degree: DegreeInfo): number {
    return fifthIndex(degree.rootPc) * 30;
  }

  function applyCursor(): void {
    arrow.setAttribute('opacity', cursorIndex === null ? '0' : '1');
    if (cursorIndex === null || !table) return;
    const degree = table.degrees[cursorIndex];
    if (!degree) return;
    arrow.setAttribute('transform', `rotate(${degreeAngle(degree)} ${CX} ${CY})`);
    svg.querySelectorAll('.mw-playing').forEach((el) => el.classList.remove('mw-playing'));
    svg
      .querySelectorAll(`[data-degree="${cursorIndex}"]`)
      .forEach((el) => el.classList.add('mw-playing'));
  }

  function strikeFromEvent(degree: DegreeInfo, ev: PointerEvent | KeyboardEvent): void {
    let register: Register = 'high';
    if (ev instanceof PointerEvent) {
      const rect = svg.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) * SIZE) / rect.width;
      const y = ((ev.clientY - rect.top) * SIZE) / rect.height;
      const dist = Math.hypot(x - CX, y - CY);
      register = dist < NOTE_R ? 'low' : 'high';
    }
    events.onStrike(degree, register);
  }

  function render(nextTable: ModeTable, preferFlat: boolean): void {
    table = nextTable;
    outerLayer.replaceChildren();
    innerLayer.replaceChildren();
    trailLayer.replaceChildren();
    markerLayer.querySelectorAll('.mw-anchor').forEach((el) => el.remove());
    centerLayer.replaceChildren();

    const { mode, keyPc, degrees, pcSet } = nextTable;

    // ── 外圈 12 格（音名钉死，明暗随调式窗口） ──
    FIFTH_ORDER.forEach((pc, slot) => {
      const a0 = slot * 30 - 15 + GAP_DEG;
      const a1 = slot * 30 + 15 - GAP_DEG;
      const degree = degrees.find((d) => d.rootPc === pc);
      const inScale = pcSet.includes(pc);
      const playable = !!degree && degree.chords.length > 0;

      const seg = s('path', {
        d: sectorPath(OUTER_R_IN, OUTER_R_OUT, a0, a1),
        class: `mw-seg ${inScale && degree ? toneClass(degree) : 'mw-seg--off'}`,
      });

      const mid = polar(NOTE_R, slot * 30);
      const note = s('text', {
        x: mid.x,
        y: mid.y,
        class: `mw-note ${inScale ? '' : 'mw-note--off'}`,
      });
      note.textContent = pcName(pc, preferFlat);

      const group = s('g', { class: 'mw-slot' });
      group.append(seg, note);

      if (playable && degree) {
        group.classList.add('mw-clickable');
        group.setAttribute('data-degree', String(degree.index));
        group.setAttribute('tabindex', '0');
        group.setAttribute('role', 'button');
        const chordName = `${pcName(degree.rootPc, preferFlat)}${degree.chords[0]!.quality === 'maj' ? '' : degree.chords[0]!.quality === 'min' ? 'm' : degree.chords[0]!.quality === 'dim' ? '°' : '+'}`;
        group.setAttribute(
          'aria-label',
          `弹奏 ${degreePrimaryNumeral(degree)} 级和弦 ${chordName}`,
        );
        group.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          strikeFromEvent(degree, ev as PointerEvent);
        });
        group.addEventListener('keydown', (ev) => {
          const key = (ev as KeyboardEvent).key;
          if (key === 'Enter' || key === ' ') {
            ev.preventDefault();
            strikeFromEvent(degree, ev as KeyboardEvent);
          }
        });
      }
      outerLayer.append(group);

      // ── 内圈级数格（仅调内音；无和弦的级画灰格写 '–'） ──
      if (degree) {
        const dseg = s('path', {
          d: sectorPath(INNER_R_IN, INNER_R_OUT, a0, a1),
          class: `mw-dseg ${degree.chords.length ? '' : 'mw-dseg--dead'}`,
        });
        const dmid = polar(NUMERAL_R, slot * 30);
        const numeral = s('text', {
          x: dmid.x,
          y: degree.chords.some((c) => !c.primary) ? dmid.y - 4 : dmid.y,
          class: 'mw-numeral',
        });
        numeral.textContent = degreePrimaryNumeral(degree);

        const dGroup = s('g', { class: 'mw-dslot' });
        dGroup.append(dseg, numeral);

        const alt = degree.chords.find((c) => !c.primary);
        if (alt) {
          const altText = s('text', { x: dmid.x, y: dmid.y + 15, class: 'mw-alt' });
          altText.textContent = `(${alt.numeral})`;
          dGroup.append(altText);
        }

        if (degree.chords.length > 0) {
          dGroup.setAttribute('data-degree', String(degree.index));
          dGroup.classList.add('mw-clickable');
          dGroup.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            events.onStrike(degree, 'low');
          });
        }
        innerLayer.append(dGroup);
      }
    });

    // ── 主音锚点：常驻小三角（指向圆心） ──
    const tonicSlot = fifthIndex(keyPc);
    const anchorPos = polar(OUTER_R_OUT + 14, tonicSlot * 30);
    const anchor = s('path', {
      d: `M 0 -7 L 8 6 L -8 6 Z`,
      class: 'mw-anchor',
      transform: `translate(${anchorPos.x} ${anchorPos.y}) rotate(${tonicSlot * 30 + 180})`,
    });
    anchor.classList.add('mw-anchor');
    markerLayer.append(anchor);

    // ── 中心：调式名 + 度数行 ──
    const zh = s('text', { x: CX, y: CY - 16, class: 'mw-center-zh' });
    zh.textContent = mode.zhName;
    const en = s('text', { x: CX, y: CY + 10, class: 'mw-center-en' });
    en.textContent = mode.name;
    const keyText = s('text', { x: CX, y: CY + 34, class: 'mw-center-key' });
    keyText.textContent = `1 = ${pcName(keyPc, preferFlat)}`;
    centerLayer.append(zh, en, keyText);

    applyCursor();
  }

  /**
   * 和声轨迹：光标从一级走到另一级时，在内圈画一条渐隐连线。
   * 巡航几轮之后，"这首歌的形状"就留在了转盘上。
   */
  function drawTrail(fromIdx: number, toIdx: number): void {
    if (!table) return;
    const from = table.degrees[fromIdx];
    const to = table.degrees[toIdx];
    if (!from || !to) return;
    const p1 = polar(NUMERAL_R, degreeAngle(from));
    const p2 = polar(NUMERAL_R, degreeAngle(to));
    const line = s('line', {
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      class: 'mw-trail',
    });
    trailLayer.append(line);
    while (trailLayer.childElementCount > 24) trailLayer.firstElementChild?.remove();
    setTimeout(() => line.remove(), 2500);
  }

  function setCursor(degreeIndex: number | null): void {
    if (degreeIndex !== null && cursorIndex !== null && degreeIndex !== cursorIndex) {
      drawTrail(cursorIndex, degreeIndex);
    }
    cursorIndex = degreeIndex;
    applyCursor();
  }

  function flash(degreeIndex: number): void {
    svg
      .querySelectorAll(`[data-degree="${degreeIndex}"]`)
      .forEach((el) => el.classList.add('mw-held'));
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      svg.querySelectorAll('.mw-held').forEach((el) => el.classList.remove('mw-held'));
    }, 300);
  }

  return { el: svg, render, setCursor, flash };
}
