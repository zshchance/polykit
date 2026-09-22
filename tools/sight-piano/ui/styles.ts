/**
 * 识谱琴房 —— 拟物琴体样式（注入一次，全部 sp- 前缀，与 Tailwind 共存）。
 *
 * 与和弦琴房同一血统的深色金属漆琴体，但身份色换成琥珀金：
 * LCD 屏是暖琥珀底光（像老式带背光的谱面灯），谱架上的谱纸是奶油色纸张。
 * 明暗主题下琴体都保持实物感；交互反馈（按键位移、呼吸引导、星光、连击）
 * 全在这里，组件只管切 class。
 */

export function injectSightStyles(): void {
  if (document.getElementById('sp-styles')) return;
  const style = document.createElement('style');
  style.id = 'sp-styles';
  style.textContent = `
/* ── 琴体 ─────────────────────────────── */
.sp-piano {
  border-radius: 20px;
  padding: 14px 16px 16px;
  background:
    radial-gradient(120% 90% at 50% 0%, #4a4540 0%, #33302c 45%, #232120 100%);
  box-shadow:
    0 18px 40px rgba(0,0,0,.35),
    inset 0 1px 0 rgba(255,255,255,.12),
    inset 0 -2px 6px rgba(0,0,0,.5);
  border: 1px solid #1a1815;
  position: relative;
}
.sp-piano::before, .sp-piano::after {
  content: ''; position: absolute; width: 10px; height: 10px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #a8a29a, #57504a 60%, #2a2724);
  box-shadow: inset 0 0 2px rgba(0,0,0,.8), 0 1px 1px rgba(255,255,255,.15);
  top: 8px;
}
.sp-piano::before { left: 10px; }
.sp-piano::after { right: 10px; }

/* ── 面板条（屏幕 + 控制区） ───────────── */
.sp-bezel {
  display: flex; flex-wrap: wrap; gap: 10px; align-items: stretch;
  border-radius: 12px; padding: 10px;
  background: linear-gradient(180deg, #413d38, #2e2b27 60%, #383430);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.1), inset 0 -1px 3px rgba(0,0,0,.6);
  border: 1px solid #1f1c19;
}
.sp-lcd {
  flex: 1 1 320px; min-width: 0;
  border-radius: 8px;
  background:
    repeating-linear-gradient(0deg, rgba(255,255,255,.03) 0 1px, transparent 1px 3px),
    radial-gradient(140% 120% at 50% -20%, #3a2c12 0%, #211806 55%, #140e04 100%);
  box-shadow:
    inset 0 2px 10px rgba(0,0,0,.85),
    inset 0 0 24px rgba(250,190,60,.08),
    0 1px 0 rgba(255,255,255,.08);
  border: 1px solid #120c03;
  padding: 8px 10px;
  display: flex; align-items: center; gap: 8px;
  overflow-x: auto; overflow-y: hidden;
  scrollbar-width: thin;
  min-height: 92px;
}
.sp-lcd-title {
  flex-shrink: 0; align-self: stretch; display: flex; flex-direction: column;
  justify-content: center; gap: 2px; padding-right: 8px; margin-right: 2px;
  border-right: 1px dashed rgba(250,200,110,.25);
  color: #f7ce83; font-size: 10px; letter-spacing: .08em; user-select: none;
}
.sp-lcd-title b { font-size: 11px; font-weight: 600; }
.sp-lcd-hint { color: rgba(247,206,131,.6); font-size: 10px; }

/* LCD 曲目卡 */
.sp-songrack { display: flex; align-items: center; gap: 7px; min-height: 70px; }
.sp-songgroup {
  flex-shrink: 0; writing-mode: vertical-lr; letter-spacing: .18em;
  font-size: 9px; color: rgba(247,206,131,.55); user-select: none;
  border-left: 1px dashed rgba(250,200,110,.3); padding-left: 4px; margin-left: 2px;
}
.sp-songcard {
  flex-shrink: 0; user-select: none; cursor: pointer; text-align: left;
  border-radius: 8px; padding: 6px 10px; min-width: 86px;
  border: 1px solid rgba(250,200,110,.35);
  background: linear-gradient(180deg, rgba(120,84,20,.4), rgba(28,19,5,.9) 80%);
  color: #f5e6c8;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.12);
  transition: transform .12s ease, box-shadow .15s ease, border-color .15s ease;
}
.sp-songcard:hover { transform: translateY(-1px); }
.sp-songcard-name { font-size: 12px; font-weight: 600; line-height: 1.25; white-space: nowrap; }
.sp-songcard-sub { font-size: 9px; opacity: .7; margin-top: 2px; white-space: nowrap; }
.sp-songcard-stars { font-size: 10px; color: #fbbf24; margin-top: 3px; letter-spacing: .1em;
  text-shadow: 0 0 6px rgba(251,191,36,.5); }
.sp-songcard-on {
  border-color: #fbbf24;
  box-shadow: 0 0 10px rgba(251,191,36,.4), inset 0 1px 0 rgba(255,255,255,.18);
  background: linear-gradient(180deg, rgba(180,124,30,.55), rgba(46,30,8,.95) 80%);
}

/* 面板控件 */
.sp-ctl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  color: #d6cfc4; font-size: 11px; user-select: none; }
.sp-btn {
  border-radius: 7px; padding: 5px 9px; font-size: 11px; line-height: 1.3;
  color: #e2d9c8; cursor: pointer;
  background: linear-gradient(180deg, #524c45, #3a3630);
  border: 1px solid #201d19;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.14), 0 2px 4px rgba(0,0,0,.4);
  transition: filter .1s ease, transform .05s ease;
}
.sp-btn:hover { filter: brightness(1.14); }
.sp-btn:active { transform: translateY(1px); }
.sp-btn-on {
  background: linear-gradient(180deg, #92600f, #6b430a);
  color: #fff3dd; border-color: #3a2504;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.2), 0 0 10px rgba(251,191,36,.4);
}
.sp-seg { display: inline-flex; border-radius: 7px; overflow: hidden; border: 1px solid #201d19; }
.sp-seg > button { border-radius: 0; border: 0; border-right: 1px solid #201d19; }
.sp-seg > button:last-child { border-right: 0; }
.sp-select {
  background: #242019; color: #ede4d2; border: 1px solid #14110c; border-radius: 7px;
  font-size: 11px; padding: 4px 6px; outline: none; max-width: 130px;
}
.sp-lamp { width: 8px; height: 8px; border-radius: 50%; display: inline-block;
  background: #4d4741; box-shadow: inset 0 1px 1px rgba(0,0,0,.7); transition: all .1s; }
.sp-lamp-on { background: #fbbf24; box-shadow: 0 0 7px #fbbf24; }
.sp-lamp-beat { background: #fde68a; box-shadow: 0 0 12px #fbbf24; transform: scale(1.4); }
.sp-vol { width: 68px; accent-color: #fbbf24; }
.sp-bpm {
  width: 46px; background: #242019; color: #fde68a; border: 1px solid #14110c;
  border-radius: 6px; font-size: 11px; padding: 3px 4px; text-align: center; outline: none;
}

/* ── 谱纸（五线谱卷轴） ────────────────── */
.sp-stand {
  margin-top: 12px; border-radius: 10px; padding: 10px 12px;
  background: linear-gradient(180deg, #383430, #2a2724 70%, #322e2a);
  border: 1px solid #1d1a16;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.09), inset 0 -1px 3px rgba(0,0,0,.5);
}
.sp-scorewrap {
  position: relative; overflow: hidden; border-radius: 6px;
  background:
    radial-gradient(140% 100% at 50% 0%, #f8f1de 0%, #f1e8d0 55%, #e7dcc0 100%);
  box-shadow: inset 0 2px 10px rgba(90,70,30,.25), 0 1px 0 rgba(255,255,255,.08);
  height: 176px;
}
.sp-score { display: block; transition: transform .38s ease; will-change: transform; }
.sp-fxlayer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }

.sp-line { stroke: #a89a78; stroke-width: 1; }
.sp-ledger { stroke: #a89a78; stroke-width: 1; }
.sp-barline { stroke: #9c8f6d; stroke-width: 1.1; }
.sp-finalbar { fill: #9c8f6d; }
.sp-clef { fill: #6b5d3f; font-family: serif; }
.sp-acc { fill: #5d5140; }
.sp-timesig { fill: #5d5140; font-weight: 700; font-family: serif; }
.sp-barnum { fill: #b3a582; }
.sp-rest { fill: #5d5140; }
.sp-evlabel { fill: #8a7a52; font-weight: 600; }

.sp-ev .sp-head { fill: #3c352a; stroke: none; transition: fill .18s ease; }
.sp-ev .sp-head-hollow { fill: none; stroke: #3c352a; stroke-width: 1.5; transition: stroke .18s ease; }
.sp-ev .sp-stem { stroke: #3c352a; stroke-width: 1.3; transition: stroke .18s ease; }
.sp-ev .sp-flag, .sp-ev .sp-beam, .sp-ev .sp-dot { fill: #3c352a; transition: fill .18s ease; }
.sp-ev .sp-acc { transition: fill .18s ease; }

/* 当前目标：琥珀呼吸描边 */
.sp-ev-current .sp-head { fill: #b45309; animation: sp-note-pulse 1.2s ease-in-out infinite; }
.sp-ev-current .sp-head-hollow { fill: none; stroke: #b45309; stroke-width: 1.8; }
.sp-ev-current .sp-stem, .sp-ev-current .sp-acc { stroke: #b45309; fill: #b45309; }
.sp-ev-current .sp-flag, .sp-ev-current .sp-beam, .sp-ev-current .sp-dot { fill: #b45309; }
.sp-ev-current .sp-evlabel { fill: #b45309; }
@keyframes sp-note-pulse {
  0%, 100% { filter: drop-shadow(0 0 1px rgba(217,119,6,.9)); }
  50% { filter: drop-shadow(0 0 6px rgba(217,119,6,.9)); }
}
/* 命中：变绿 */
.sp-ev-done .sp-head { fill: #15803d; }
.sp-ev-done .sp-head-hollow { fill: none; stroke: #15803d; }
.sp-ev-done .sp-stem, .sp-ev-done .sp-acc { stroke: #15803d; fill: #15803d; }
.sp-ev-done .sp-flag, .sp-ev-done .sp-beam, .sp-ev-done .sp-dot { fill: #15803d; }
.sp-ev-done .sp-evlabel { fill: #15803d; }
/* 演奏模式错过：灰红淡出 */
.sp-ev-passed { opacity: .55; }
.sp-ev-passed .sp-head { fill: #b0563c; }
.sp-ev-passed .sp-head-hollow { fill: none; stroke: #b0563c; }
.sp-ev-passed .sp-stem, .sp-ev-passed .sp-acc { stroke: #b0563c; fill: #b0563c; }
.sp-ev-passed .sp-flag, .sp-ev-passed .sp-beam, .sp-ev-passed .sp-dot { fill: #b0563c; }

.sp-playhead { stroke: rgba(180,83,9,.5); stroke-width: 1.6;
  transition: x1 .1s linear, x2 .1s linear; }

/* 错音星光：金色四角星在谱面闪烁 */
.sp-sparkle {
  position: absolute; transform: translate(-50%, -50%);
  color: #f59e0b; font-size: 20px; font-style: normal;
  text-shadow: 0 0 8px #fbbf24, 0 0 16px rgba(251,191,36,.7);
  animation: sp-spark .9s ease-out forwards;
}
@keyframes sp-spark {
  0% { opacity: 0; transform: translate(-50%,-50%) scale(.3) rotate(0deg); }
  25% { opacity: 1; transform: translate(-50%,-50%) scale(1.25) rotate(45deg); }
  100% { opacity: 0; transform: translate(-50%,-50%) scale(1.6) rotate(120deg) translateY(-10px); }
}
/* 命中光圈 */
.sp-hitpop {
  position: absolute; width: 30px; height: 30px; border-radius: 50%;
  transform: translate(-50%, -50%);
  border: 2px solid rgba(34,197,94,.9);
  box-shadow: 0 0 12px rgba(34,197,94,.6);
  animation: sp-pop .45s ease-out forwards;
}
@keyframes sp-pop {
  0% { opacity: .95; transform: translate(-50%,-50%) scale(.4); }
  100% { opacity: 0; transform: translate(-50%,-50%) scale(1.5); }
}

/* ── 键盘 ─────────────────────────────── */
.sp-keys {
  position: relative; margin-top: 12px;
  background: #0e0c0a; border-radius: 4px 4px 14px 14px;
  padding: 0 8px 9px;
  box-shadow: inset 0 3px 8px rgba(0,0,0,.9);
  touch-action: none; user-select: none;
}
.sp-keys::before { /* 键盘上方红色呢毡条 */
  content: ''; display: block; height: 5px; margin: 0 -2px;
  background: linear-gradient(180deg, #8f2f35, #5d1c22);
  border-radius: 2px 2px 0 0;
  box-shadow: 0 1px 3px rgba(0,0,0,.7);
}
.sp-whiterow { display: flex; gap: 2px; height: 188px; position: relative; }
.sp-blacklayer { position: absolute; inset: 5px 8px auto 8px; height: 0; }

.sp-key { position: relative; cursor: pointer; }
.sp-whitek {
  flex: 1 1 0; min-width: 0;
  background: linear-gradient(180deg, #fdfcf7 0%, #f3f0e6 82%, #ddd8c8 100%);
  border: 1px solid #b9b3a2; border-top: 0;
  border-radius: 0 0 6px 6px;
  box-shadow: inset 0 -5px 8px rgba(0,0,0,.12), inset 2px 0 3px rgba(0,0,0,.05);
  transition: transform .04s ease;
}
.sp-blackk {
  position: absolute; top: 0; height: 112px; transform: translateX(-50%);
  background: linear-gradient(180deg, #3d3d44 0%, #17171b 78%, #000 100%);
  border: 1px solid #000; border-radius: 0 0 5px 5px;
  box-shadow: 0 5px 7px rgba(0,0,0,.55), inset 0 -4px 5px rgba(255,255,255,.06);
  z-index: 3;
  transition: transform .04s ease;
}
.sp-whitek.sp-down { transform: translateY(2px);
  box-shadow: inset 0 -2px 4px rgba(0,0,0,.2), inset 0 3px 6px rgba(0,0,0,.18); }
.sp-blackk.sp-down { transform: translateX(-50%) translateY(2px);
  box-shadow: 0 2px 4px rgba(0,0,0,.6), inset 0 2px 5px rgba(0,0,0,.7); }

.sp-hint { position: absolute; inset: 0; border-radius: inherit; opacity: .55;
  pointer-events: none; transition: background .12s ease; }
.sp-hinted.sp-whitek { box-shadow: inset 0 -5px 8px rgba(0,0,0,.12), 0 0 14px rgba(251,191,36,.35); }
.sp-hinted.sp-blackk { box-shadow: 0 5px 7px rgba(0,0,0,.55), 0 0 14px rgba(251,191,36,.4); }
.sp-hint-strong .sp-hint { animation: sp-key-pulse .9s ease-in-out infinite; }
@keyframes sp-key-pulse {
  0%, 100% { opacity: .35; }
  50% { opacity: .85; }
}
.sp-top { position: absolute; left: 0; right: 0; top: 0; height: 55%;
  border-radius: inherit; border-bottom-left-radius: 0; border-bottom-right-radius: 0;
  pointer-events: none; }
.sp-bottom { position: absolute; left: 0; right: 0; top: 55%; bottom: 0;
  border-radius: inherit; border-top-left-radius: 0; border-top-right-radius: 0;
  pointer-events: none; }
.sp-dots { position: absolute; top: 7px; left: 0; right: 0; display: flex;
  justify-content: center; gap: 3px; pointer-events: none; z-index: 4; }
.sp-blackk .sp-dots { top: 5px; }
.sp-dot { width: 6px; height: 6px; border-radius: 50%;
  box-shadow: 0 0 4px rgba(0,0,0,.35), 0 0 6px currentColor; }

.sp-klabel { position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%);
  font-size: 10px; font-weight: 600; color: #8a8577; pointer-events: none; }
.sp-blackk .sp-klabel { bottom: 5px; color: #6d6d78; font-size: 9px; }
.sp-oct { position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%);
  font-size: 9px; color: #a09a88; pointer-events: none; }

/* ── 88 键指示条 ──────────────────────── */
.sp-minimap { display: flex; align-items: center; gap: 6px; margin-top: 10px; padding: 0 4px; }
.sp-mm-end { font-size: 8px; color: #8b8478; letter-spacing: .02em; user-select: none; }
.sp-mm-track {
  position: relative; flex: 1; height: 22px; border-radius: 4px;
  background: #12100d; border: 1px solid #201d19;
  box-shadow: inset 0 2px 5px rgba(0,0,0,.8);
  overflow: hidden; cursor: pointer; touch-action: none; user-select: none;
}
.sp-mm-whites { display: flex; height: 100%; }
.sp-mm-w { flex: 1 1 0; min-width: 0; background: linear-gradient(180deg, #4d4741, #36322c);
  border-right: 1px solid rgba(0,0,0,.55); }
.sp-mm-w:last-child { border-right: 0; }
.sp-mm-b { position: absolute; top: 0; height: 58%; transform: translateX(-50%);
  background: #0c0a08; border-radius: 0 0 2px 2px; }
.sp-mm-view {
  position: absolute; top: 0; bottom: 0; border: 1px solid #fbbf24; border-radius: 3px;
  background: rgba(251,191,36,.13);
  box-shadow: 0 0 8px rgba(251,191,36,.45), inset 0 0 6px rgba(251,191,36,.22);
  display: flex; align-items: center; justify-content: center;
  pointer-events: none; transition: left .18s ease, width .18s ease;
}
.sp-mm-range { font-size: 8px; font-weight: 600; color: #ffe3a3;
  text-shadow: 0 1px 2px rgba(0,0,0,.9); white-space: nowrap; }

/* ── 琴体下方读数条（谱纸下面） ────────── */
.sp-readout {
  margin-top: 10px; border-radius: 10px; padding: 9px 14px;
  background: linear-gradient(180deg, #383430, #2a2724 70%, #322e2a);
  border: 1px solid #1d1a16;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.09);
  display: flex; gap: 14px; align-items: center; flex-wrap: wrap; min-height: 52px;
  color: #ede4d2;
}
.sp-readout-big { font-size: 17px; font-weight: 700; line-height: 1.3; }
.sp-readout-sub { font-size: 11px; color: #b5ab98; margin-top: 2px; line-height: 1.5; }
.sp-combo {
  margin-left: auto; text-align: right; user-select: none;
  font-variant-numeric: tabular-nums;
}
.sp-combo-n { font-size: 22px; font-weight: 800; color: #fbbf24;
  text-shadow: 0 0 10px rgba(251,191,36,.5); }
.sp-combo-hot { animation: sp-combo-bounce .3s ease; }
@keyframes sp-combo-bounce {
  0% { transform: scale(1); } 40% { transform: scale(1.35); } 100% { transform: scale(1); }
}
.sp-combo-label { font-size: 9px; color: #b5ab98; letter-spacing: .1em; }

/* ── 学习路径卡 ───────────────────────── */
.sp-stage {
  text-align: left; border-radius: 12px; border: 1px solid var(--border);
  background: var(--bg-elevated); padding: 12px 14px; cursor: pointer;
  transition: all .15s ease; flex: 1 1 200px; position: relative; overflow: hidden;
}
.sp-stage:hover { border-color: var(--accent); transform: translateY(-1px); }
.sp-stage-on { border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent), 0 6px 16px color-mix(in srgb, var(--accent) 18%, transparent); }
.sp-stage-bar { height: 5px; border-radius: 3px; background: var(--border);
  overflow: hidden; margin-top: 8px; }
.sp-stage-fill { height: 100%; border-radius: 3px;
  background: linear-gradient(90deg, #f59e0b, #fbbf24); transition: width .4s ease; }

/* ── 曲终结算卡 ───────────────────────── */
.sp-done {
  position: absolute; inset: 0; z-index: 30; border-radius: 6px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; background: rgba(248,241,222,.94);
  animation: sp-done-in .3s ease;
}
@keyframes sp-done-in { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: none; } }
.sp-done-stars { font-size: 34px; letter-spacing: .12em; color: #d97706;
  text-shadow: 0 2px 10px rgba(217,119,6,.4); }
.sp-done-star-pop { display: inline-block; animation: sp-star-pop .5s ease backwards; }
.sp-done-star-pop:nth-child(2) { animation-delay: .12s; }
.sp-done-star-pop:nth-child(3) { animation-delay: .24s; }
@keyframes sp-star-pop { 0% { transform: scale(0) rotate(-40deg); opacity: 0; }
  70% { transform: scale(1.3); } 100% { transform: none; opacity: 1; } }

/* ── 导入面板 ─────────────────────────── */
.sp-dropzone-drag { border-color: var(--accent) !important;
  box-shadow: 0 0 0 1px var(--accent); }

@media (max-width: 640px) {
  .sp-whiterow { height: 138px; }
  .sp-blackk { height: 84px; }
  .sp-readout-big { font-size: 15px; }
  .sp-scorewrap { height: 150px; }
}
`;
  document.head.append(style);
}
