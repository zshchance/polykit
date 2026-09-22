import { h } from '@/core/components/element';

/**
 * 和弦琴房 —— 拟物琴体样式（注入一次，全部 cl- 前缀，与 Tailwind 共存）。
 *
 * 设计取向：琴体是「实物」，所以在明暗主题下都保持固定的深色金属漆 +
 * 象牙键 + 黑檀键；LCD 屏用深绿黑底 + 扫描线 + 内发光模拟数码钢琴屏幕。
 * 交互反馈（按下位移、呼吸光、卡片拖影）都在这里，组件只管改 class。
 */
export function injectPianoStyles(): void {
  if (document.getElementById('cl-styles')) return;
  const style = h('style', { id: 'cl-styles' });
  style.textContent = `
/* ── 琴体 ─────────────────────────────── */
.cl-piano {
  border-radius: 20px;
  padding: 14px 16px 16px;
  background:
    radial-gradient(120% 90% at 50% 0%, #45454c 0%, #303035 45%, #212126 100%);
  box-shadow:
    0 18px 40px rgba(0,0,0,.35),
    inset 0 1px 0 rgba(255,255,255,.12),
    inset 0 -2px 6px rgba(0,0,0,.5);
  border: 1px solid #17171b;
  position: relative;
}
/* 琴体四角的螺丝 */
.cl-piano::before, .cl-piano::after {
  content: ''; position: absolute; width: 10px; height: 10px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #9a9aa2, #4c4c54 60%, #26262b);
  box-shadow: inset 0 0 2px rgba(0,0,0,.8), 0 1px 1px rgba(255,255,255,.15);
  top: 8px;
}
.cl-piano::before { left: 10px; }
.cl-piano::after { right: 10px; }

/* ── 面板条（屏幕 + 旋钮区） ───────────── */
.cl-bezel {
  display: flex; flex-wrap: wrap; gap: 10px; align-items: stretch;
  border-radius: 12px; padding: 10px;
  background: linear-gradient(180deg, #3a3a41, #2b2b30 60%, #34343a);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.1), inset 0 -1px 3px rgba(0,0,0,.6);
  border: 1px solid #1c1c20;
}
.cl-lcd {
  flex: 1 1 320px; min-width: 0;
  border-radius: 8px;
  background:
    repeating-linear-gradient(0deg, rgba(255,255,255,.025) 0 1px, transparent 1px 3px),
    radial-gradient(140% 120% at 50% -20%, #173325 0%, #0c1a13 55%, #08110c 100%);
  box-shadow:
    inset 0 2px 10px rgba(0,0,0,.85),
    inset 0 0 24px rgba(60,220,140,.07),
    0 1px 0 rgba(255,255,255,.08);
  border: 1px solid #05100a;
  padding: 8px 10px;
  display: flex; align-items: center; gap: 8px;
  overflow-x: auto; overflow-y: hidden;
  scrollbar-width: thin;
  min-height: 86px;
}
.cl-lcd-title {
  flex-shrink: 0; align-self: stretch; display: flex; flex-direction: column;
  justify-content: center; gap: 2px; padding-right: 8px; margin-right: 2px;
  border-right: 1px dashed rgba(140,240,190,.18);
  color: #9fe8c4; font-size: 10px; letter-spacing: .08em; user-select: none;
}
.cl-lcd-title b { font-size: 11px; font-weight: 600; }
.cl-lcd-hint { color: rgba(159,232,196,.55); font-size: 10px; }

/* LCD 内的卡片（和弦性质 / 走向） */
.cl-card {
  flex-shrink: 0; user-select: none; touch-action: none; cursor: grab;
  border-radius: 8px; padding: 6px 9px; min-width: 74px;
  border: 1px solid var(--cl-card-c, #22c55e);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--cl-card-c, #22c55e) 22%, #0d1f14), #0b1810 80%);
  color: #d8f3e3;
  box-shadow: 0 0 8px color-mix(in srgb, var(--cl-card-c, #22c55e) 30%, transparent),
    inset 0 1px 0 rgba(255,255,255,.14);
  transition: transform .12s ease, opacity .15s ease, box-shadow .15s ease;
  position: relative;
}
.cl-card:hover { transform: translateY(-1px); }
.cl-card-name { font-size: 12px; font-weight: 600; line-height: 1.25; white-space: nowrap; }
.cl-card-sub { font-size: 9px; opacity: .72; margin-top: 2px; white-space: nowrap; }
.cl-card-dot {
  position: absolute; top: 5px; right: 5px; width: 7px; height: 7px; border-radius: 50%;
  background: var(--cl-card-c, #22c55e); box-shadow: 0 0 5px var(--cl-card-c, #22c55e);
}
.cl-card-off { opacity: .38; filter: grayscale(.9); box-shadow: none; }
.cl-card-drag { opacity: .85; cursor: grabbing; z-index: 20; position: relative;
  transform: scale(1.04); box-shadow: 0 8px 18px rgba(0,0,0,.5), 0 0 12px var(--cl-card-c); }
.cl-card-gap { outline: 2px dashed rgba(180,255,210,.4); outline-offset: 2px; }

/* 面板上的按钮/旋钮区 */
.cl-ctl {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  color: #cfd2dc; font-size: 11px; user-select: none;
}
.cl-btn {
  border-radius: 7px; padding: 5px 9px; font-size: 11px; line-height: 1.3;
  color: #d7dae2; cursor: pointer;
  background: linear-gradient(180deg, #4c4c54, #35353c);
  border: 1px solid #1d1d22;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.14), 0 2px 4px rgba(0,0,0,.4);
  transition: filter .1s ease, transform .05s ease;
}
.cl-btn:hover { filter: brightness(1.14); }
.cl-btn:active { transform: translateY(1px); }
.cl-btn-on {
  background: linear-gradient(180deg, #2f7d4c, #1d5c36);
  color: #eafff2; border-color: #123a22;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.2), 0 0 10px rgba(60,220,140,.35);
}
.cl-seg { display: inline-flex; border-radius: 7px; overflow: hidden; border: 1px solid #1d1d22; }
.cl-seg > button { border-radius: 0; border: 0; border-right: 1px solid #1d1d22; }
.cl-seg > button:last-child { border-right: 0; }
.cl-select {
  background: #1f1f24; color: #e6e9f0; border: 1px solid #121216; border-radius: 7px;
  font-size: 11px; padding: 4px 6px; outline: none;
}
.cl-lamp { width: 8px; height: 8px; border-radius: 50%; display: inline-block;
  background: #4a4a52; box-shadow: inset 0 1px 1px rgba(0,0,0,.7); }
.cl-lamp-on { background: #34d399; box-shadow: 0 0 7px #34d399; }
.cl-vol { width: 74px; accent-color: #34d399; }

/* ── 键盘 ─────────────────────────────── */
.cl-keys {
  position: relative; margin-top: 12px;
  background: #0c0c0f; border-radius: 4px 4px 14px 14px;
  padding: 0 8px 9px;
  box-shadow: inset 0 3px 8px rgba(0,0,0,.9);
  touch-action: none; user-select: none;
}
.cl-keys::before { /* 键盘上方红色呢毡条（真钢琴细节） */
  content: ''; display: block; height: 5px; margin: 0 -2px;
  background: linear-gradient(180deg, #8f2f35, #5d1c22);
  border-radius: 2px 2px 0 0;
  box-shadow: 0 1px 3px rgba(0,0,0,.7);
}
.cl-whiterow { display: flex; gap: 2px; height: 188px; position: relative; }
.cl-blacklayer { position: absolute; inset: 21px 8px auto 8px; height: 0; }

.cl-key { position: relative; cursor: pointer; }
.cl-whitek {
  flex: 1 1 0; min-width: 0;
  background: linear-gradient(180deg, #fdfcf7 0%, #f3f0e6 82%, #ddd8c8 100%);
  border: 1px solid #b9b3a2; border-top: 0;
  border-radius: 0 0 6px 6px;
  box-shadow: inset 0 -5px 8px rgba(0,0,0,.12), inset 2px 0 3px rgba(0,0,0,.05);
  transition: transform .04s ease;
}
.cl-blackk {
  position: absolute; top: 0; height: 112px; transform: translateX(-50%);
  background: linear-gradient(180deg, #3d3d44 0%, #17171b 78%, #000 100%);
  border: 1px solid #000; border-radius: 0 0 5px 5px;
  box-shadow: 0 5px 7px rgba(0,0,0,.55), inset 0 -4px 5px rgba(255,255,255,.06);
  z-index: 3;
  transition: transform .04s ease;
}
.cl-whitek.cl-down { transform: translateY(2px);
  box-shadow: inset 0 -2px 4px rgba(0,0,0,.2), inset 0 3px 6px rgba(0,0,0,.18); }
.cl-blackk.cl-down { transform: translateX(-50%) translateY(2px);
  box-shadow: 0 2px 4px rgba(0,0,0,.6), inset 0 2px 5px rgba(0,0,0,.7); }

/* 四层染色元素 */
.cl-hint { position: absolute; inset: 0; border-radius: inherit; opacity: .55;
  pointer-events: none; transition: background .12s ease; }
.cl-hinted.cl-whitek { box-shadow: inset 0 -5px 8px rgba(0,0,0,.12), 0 0 14px rgba(90,240,160,.28); }
.cl-hinted.cl-blackk { box-shadow: 0 5px 7px rgba(0,0,0,.55), 0 0 14px rgba(90,240,160,.3); }
.cl-top { position: absolute; left: 0; right: 0; top: 0; height: 55%;
  border-radius: inherit; border-bottom-left-radius: 0; border-bottom-right-radius: 0;
  pointer-events: none; }
.cl-bottom { position: absolute; left: 0; right: 0; top: 55%; bottom: 0;
  border-radius: inherit; border-top-left-radius: 0; border-top-right-radius: 0;
  pointer-events: none; }
.cl-dots { position: absolute; top: 7px; left: 0; right: 0; display: flex;
  justify-content: center; gap: 3px; pointer-events: none; z-index: 4; }
.cl-blackk .cl-dots { top: 5px; }
.cl-dot { width: 6px; height: 6px; border-radius: 50%; box-shadow: 0 0 4px rgba(0,0,0,.35), 0 0 6px currentColor; }

.cl-klabel { position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%);
  font-size: 10px; font-weight: 600; color: #8a8577; pointer-events: none; }
.cl-blackk .cl-klabel { bottom: 5px; color: #6d6d78; font-size: 9px; }
.cl-oct { position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%);
  font-size: 9px; color: #a09a88; pointer-events: none; }

/* ── 谱架（指示区） ───────────────────── */
.cl-stand {
  margin-top: 12px; border-radius: 10px; padding: 10px 14px;
  background: linear-gradient(180deg, #33333a, #26262b 70%, #2d2d33);
  border: 1px solid #1a1a1f;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.09), inset 0 -1px 3px rgba(0,0,0,.5);
  display: flex; gap: 16px; align-items: center; min-height: 118px; flex-wrap: wrap;
}
.cl-readout { flex: 1 1 260px; min-width: 0; color: #e8eaf2; }
.cl-readout-big { font-size: 20px; font-weight: 700; line-height: 1.3; }
.cl-readout-sub { font-size: 12px; color: #a9adc0; margin-top: 3px; line-height: 1.5; }
.cl-staffwrap { flex: 0 1 auto; margin-left: auto; background: rgba(255,253,245,.06);
  border-radius: 8px; padding: 6px 10px; border: 1px solid rgba(255,255,255,.07); }

/* 走向序列 chip（歌词式逐个变色） */
.cl-seq { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.cl-step {
  border-radius: 5px; padding: 1.5px 6px; font-size: 12px; font-weight: 600;
  color: #8f93a6; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08);
  transition: all .15s ease;
}
.cl-step-done { color: #0b0b0e; background: var(--cl-c); border-color: var(--cl-c);
  box-shadow: 0 0 8px color-mix(in srgb, var(--cl-c) 55%, transparent); }
.cl-step-next { color: var(--cl-c); border-color: var(--cl-c);
  animation: cl-pulse 1.1s ease-in-out infinite; }
.cl-step-arrow { color: #555a6e; font-size: 10px; }
@keyframes cl-pulse { 0%,100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--cl-c) 45%, transparent); }
  50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--cl-c) 28%, transparent); } }

/* 引导面板模式卡 */
.cl-mode {
  text-align: left; border-radius: 12px; border: 1px solid var(--border);
  background: var(--bg-elevated); padding: 12px 14px; cursor: pointer;
  transition: all .15s ease; flex: 1 1 220px;
}
.cl-mode:hover { border-color: var(--accent); transform: translateY(-1px); }
.cl-mode-on { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent),
  0 6px 16px color-mix(in srgb, var(--accent) 18%, transparent); }

@media (max-width: 640px) {
  .cl-whiterow { height: 138px; }
  .cl-blackk { height: 84px; }
  .cl-readout-big { font-size: 17px; }
}
`;
  document.head.append(style);
}
