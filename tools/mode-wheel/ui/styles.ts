import { h } from '@/core/components/element';

/**
 * 调式罗盘 —— 转盘样式（注入一次，全部 mw- 前缀，与 Tailwind 共存）。
 *
 * 染色语义（图例见页面下方）：
 *   紫 = 主和弦；橙 = 共同音 ≥2（近，顺滑）；蓝 = 共同音 1；
 *   粉 = 共同音 0（远，意外/紧张）；灰 = 调外音或堆不出和弦的级。
 * 彩色格统一浅底色 + 深色字，明暗主题下都保持可读；灰格跟随主题变量。
 */
export function injectWheelStyles(): void {
  if (document.getElementById('mw-styles')) return;
  const style = h('style', { id: 'mw-styles' });
  style.textContent = `
/* ── 转盘容器 ─────────────────────────── */
.mw-svg {
  width: 100%;
  height: auto;
  max-width: 620px;
  display: block;
  margin: 0 auto;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
}

/* ── 外圈音名格 ───────────────────────── */
.mw-seg {
  stroke: var(--bg);
  stroke-width: 2;
  transition: filter .15s ease, opacity .2s ease;
}
.mw-seg--tonic { fill: #c4b5fd; }
.mw-seg--near  { fill: #fdba74; }
.mw-seg--mid   { fill: #93c5fd; }
.mw-seg--far   { fill: #f0abfc; }
.mw-seg--dead  { fill: #cbd5e1; }
.dark .mw-seg--dead { fill: #475569; }
.mw-seg--off   { fill: var(--bg-elevated); stroke: var(--border); }

.mw-note {
  font-size: 27px;
  font-weight: 700;
  text-anchor: middle;
  dominant-baseline: central;
  fill: #0f172a;
  pointer-events: none;
}
.mw-note--off { fill: var(--fg-muted); font-weight: 500; }

/* ── 内圈级数格 ───────────────────────── */
.mw-dseg {
  fill: var(--bg-elevated);
  stroke: var(--bg);
  stroke-width: 2;
  transition: filter .15s ease;
}
.mw-dseg--dead { fill: var(--bg); }
.mw-numeral {
  font-size: 20px;
  font-weight: 600;
  text-anchor: middle;
  dominant-baseline: central;
  fill: var(--fg);
  pointer-events: none;
}
.mw-alt {
  font-size: 13px;
  text-anchor: middle;
  dominant-baseline: central;
  fill: var(--fg-muted);
  pointer-events: none;
}

/* ── 交互态 ───────────────────────────── */
.mw-clickable { cursor: pointer; }
.mw-clickable:hover .mw-seg,
.mw-clickable:hover .mw-dseg { filter: brightness(1.07); }
.mw-clickable:focus-visible { outline: none; }
.mw-clickable:focus-visible .mw-seg {
  stroke: var(--accent);
  stroke-width: 3;
}

/* 演奏发光（点按 flash 与巡航光标共用） */
.mw-playing .mw-seg,
.mw-held .mw-seg,
.mw-playing .mw-dseg,
.mw-held .mw-dseg {
  filter: brightness(1.15) drop-shadow(0 0 12px rgba(99, 102, 241, .65));
}
.mw-playing .mw-note,
.mw-held .mw-note {
  paint-order: stroke;
  stroke: rgba(255, 255, 255, .9);
  stroke-width: 2.5px;
}

/* ── 锚点与演奏箭头 ────────────────────── */
.mw-anchor {
  fill: var(--accent);
  opacity: .9;
}
.mw-arrow {
  transition: transform .16s ease-out, opacity .12s ease;
  pointer-events: none;
}
.mw-arrow-head, .mw-arrow-stem {
  fill: #ef4444;
  filter: drop-shadow(0 2px 6px rgba(239, 68, 68, .45));
}

/* ── 中心文字 ─────────────────────────── */
.mw-center-zh {
  font-size: 30px;
  font-weight: 700;
  text-anchor: middle;
  fill: var(--fg);
}
.mw-center-en {
  font-size: 19px;
  text-anchor: middle;
  fill: var(--fg-muted);
}
.mw-center-key {
  font-size: 15px;
  font-weight: 600;
  text-anchor: middle;
  fill: var(--accent);
}

/* ── 度数条（视频右侧那张表） ──────────── */
.mw-strip {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 4px;
  text-align: center;
}
.mw-strip-cell {
  border-radius: 8px;
  padding: 6px 2px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
}
.mw-strip-cell--sig {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.mw-strip-deg {
  font-size: 15px;
  font-weight: 700;
  color: var(--fg);
  position: relative;
}
.mw-strip-deg .mw-sig {
  position: absolute;
  top: -11px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  color: #ef4444;
}
.mw-strip-num {
  font-size: 13px;
  color: var(--fg-muted);
  margin-top: 2px;
}

/* ── 进行处方卡 ───────────────────────── */
.mw-prog {
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
  background: var(--bg-elevated);
  transition: border-color .15s ease, box-shadow .15s ease, transform .1s ease;
  cursor: pointer;
  width: 100%;
}
.mw-prog:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,.08); }
.mw-prog--active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent), 0 4px 14px rgba(99,102,241,.18);
}
.mw-prog-name { font-weight: 700; color: var(--fg); font-size: 14px; }
.mw-prog-steps { font-size: 13px; color: var(--accent); margin-top: 2px; font-weight: 600; }
.mw-prog-desc { font-size: 12px; color: var(--fg-muted); margin-top: 3px; line-height: 1.5; }

/* ── 选择芯片 ─────────────────────────── */
.mw-chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 13px;
  background: var(--bg-elevated);
  color: var(--fg);
  cursor: pointer;
  white-space: nowrap;
  transition: all .12s ease;
}
.mw-chip:hover { border-color: var(--accent); }
.mw-chip--active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-fg);
  font-weight: 600;
}

/* ── 和声轨迹（巡航时和弦间连线，渐隐） ── */
.mw-trail {
  stroke: var(--accent);
  stroke-width: 3;
  stroke-linecap: round;
  pointer-events: none;
  animation: mw-trail-fade 2.4s ease-out forwards;
}
@keyframes mw-trail-fade {
  from { opacity: .75; }
  to { opacity: 0; }
}

/* ── 编排器 ───────────────────────────── */
.mw-seq {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 38px;
  align-items: center;
}
.mw-seq-slot {
  border: 1px solid var(--accent);
  background: var(--bg-elevated);
  color: var(--fg);
  border-radius: 8px;
  padding: 5px 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all .12s ease;
}
.mw-seq-slot:hover { background: #fee2e2; border-color: #ef4444; }
.dark .mw-seq-slot:hover { background: #450a0a; }
.mw-seq-slot--current {
  background: var(--accent);
  color: var(--accent-fg);
}
.mw-seq-empty {
  font-size: 12px;
  color: var(--fg-muted);
}

/* ── 旋律垫 ───────────────────────────── */
.mw-pad {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 6px;
}
.mw-pad-key {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: linear-gradient(180deg, var(--bg-elevated), var(--bg));
  padding: 14px 2px 10px;
  font-size: 15px;
  font-weight: 700;
  color: var(--fg);
  cursor: pointer;
  transition: all .08s ease;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}
.mw-pad-key small {
  display: block;
  font-size: 10px;
  font-weight: 500;
  color: var(--fg-muted);
  margin-top: 2px;
}
.mw-pad-key:active, .mw-pad-key--held {
  background: var(--accent);
  color: var(--accent-fg);
  transform: translateY(1px);
}
.mw-pad-key:active small, .mw-pad-key--held small { color: var(--accent-fg); }

/* ── 步进格子（编排模式） ─────────────── */
.mw-grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 2px 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}
.mw-grid-layer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 2px;
}
.mw-grid-cells {
  display: grid;
  grid-template-columns: repeat(var(--cells, 16), 1fr);
  gap: 3px;
  min-width: 340px;
}
.mw-cell {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  min-height: 30px;
  font-size: 11px;
  font-weight: 700;
  color: var(--fg);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all .08s ease;
  user-select: none;
  -webkit-user-select: none;
  padding: 0 2px;
}
.mw-cell:nth-child(4n + 1) { border-left: 2px solid var(--fg-muted); }
.mw-cell:hover { border-color: var(--accent); }
.mw-cell--beat { background: var(--bg-elevated); }
.mw-cell--filled { border-color: var(--accent); background: var(--bg-elevated); }
.mw-cell--filled.mw-cell--chord { box-shadow: inset 0 0 0 1.5px var(--accent); }
.mw-cell--filled.mw-cell--melody { box-shadow: inset 0 0 0 1.5px #22c55e; }
.mw-cell--selected {
  outline: 2.5px solid var(--accent);
  outline-offset: -1px;
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-elevated));
}
.mw-cell--playing { box-shadow: inset 0 0 0 1.5px #f59e0b, 0 0 8px rgba(245,158,11,.35); }
.mw-cell--drop { outline: 2px dashed var(--accent); outline-offset: -2px; }
/* 长音延续块：与已填格同色相、更弱的描边 */
.mw-cell--cont { background: var(--bg-elevated); }
.mw-cell--cont-chord { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 35%, transparent); }
.mw-cell--cont-melody { box-shadow: inset 0 0 0 1.5px rgba(34, 197, 94, 0.35); }
/* 格内序列（长格装多个）：字号缩一点放得下 "Ⅰ·Ⅳ·Ⅴ" */
.mw-cell--seq { font-size: 9.5px; letter-spacing: -0.5px; padding: 0 1px; }
/* 非常规时值的角标（1/2、2拍 等，每格独立） */
.mw-cell[data-tv]::after {
  content: attr(data-tv);
  position: absolute;
  top: 1px;
  right: 3px;
  font-size: 8px;
  font-weight: 500;
  color: var(--fg-muted);
  pointer-events: none;
}

/* 调色板（可点也可拖） */
.mw-palette { display: flex; flex-wrap: wrap; gap: 6px; }
.mw-palette .mw-chip[draggable="true"] { cursor: grab; }
.mw-palette .mw-chip[draggable="true"]:active { cursor: grabbing; }

/* ── Looper 面板 ──────────────────────── */
.mw-loop-progress {
  height: 6px;
  border-radius: 999px;
  background: var(--bg);
  border: 1px solid var(--border);
  overflow: hidden;
}
.mw-loop-progress > div {
  height: 100%;
  width: 0%;
  background: var(--accent);
  border-radius: 999px;
  transition: none;
}
.mw-layer {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px 10px;
  background: var(--bg-elevated);
}
.mw-layer--muted { opacity: .45; }
.mw-layer-name { font-size: 13px; font-weight: 700; color: var(--fg); }
.mw-layer-meta { font-size: 11px; color: var(--fg-muted); flex: 1; }
.mw-layer-btn {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 13px;
  padding: 2px 6px;
  border-radius: 6px;
  color: var(--fg-muted);
}
.mw-layer-btn:hover { background: var(--bg); color: var(--fg); }
.mw-rec-dot {
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #ef4444;
  margin-right: 5px;
  animation: mw-rec-blink 1s steps(2) infinite;
}
@keyframes mw-rec-blink { 50% { opacity: .25; } }

/* ── 图例 ─────────────────────────────── */
.mw-legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  margin-right: 5px;
  vertical-align: baseline;
}
`;
  document.head.append(style);
}
