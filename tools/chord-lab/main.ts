import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { PianoSynth } from './engine/synth';
import { MidiBridge } from './engine/midi';
import { createKeyboard } from './ui/keyboard';
import { createMinimap } from './ui/minimap';
import { createRack, type RackItem } from './ui/screen';
import { injectPianoStyles } from './ui/styles';
import { renderNoteCluster, renderChordSeq, type StaffSeqChord } from './ui/staff';
import {
  QUALITY_MAP,
  PC_NAMES,
  pcOf,
  pcName,
  pcSetOf,
  chordName,
  exactChord,
  completionHints,
  bestCompletion,
  extractRootPc,
  nearestVoicing,
  stepRootPc,
  stepLabel,
  stepChordName,
  stepIntervals,
  ProgressionTracker,
  TONALITY_LABEL,
  type ChordQualityId,
  type Tonality,
  type ProgStep,
} from './theory';
import { PROGRESSION_MAP } from './data/progressions';
import {
  loadState,
  saveState,
  clampWindow,
  activeQualities,
  PALETTE,
  PALETTE_LEN,
  type LabState,
} from './settings';

initTheme();
injectPianoStyles();

/** 卡片上的音级公式（紧凑写法） */
const FORMULA_SHORT: Record<ChordQualityId, string> = {
  maj: '1 · 3 · 5',
  min: '1 · ♭3 · 5',
  aug: '1 · 3 · ♯5',
  dim: '1 · ♭3 · ♭5',
  '7': '1 · 3 · 5 · ♭7',
  maj7: '1 · 3 · 5 · 7',
  m7: '1 · ♭3 · 5 · ♭7',
  sus2: '1 · 2 · 5',
  sus4: '1 · 4 · 5',
  add9: '1 · 3 · 5 · 9',
};

const INVERSION_LABEL = ['原位', '第一转位', '第二转位', '第三转位'];

/**
 * 电脑键盘 → 相对 compBase 的半音偏移（标准 DAW 双排映射）：
 * 下排 Z 行 = 当前窗口的 C 起，上排 Q 行 = 高八度。
 */
const KEYMAP: Readonly<Record<string, number>> = {
  z: 0,
  s: 1,
  x: 2,
  d: 3,
  c: 4,
  v: 5,
  g: 6,
  b: 7,
  h: 8,
  n: 9,
  j: 10,
  m: 11,
  q: 12,
  '2': 13,
  w: 14,
  '3': 15,
  e: 16,
  r: 17,
  '5': 18,
  t: 19,
  '6': 20,
  y: 21,
  '7': 22,
  u: 23,
  i: 24,
  '9': 25,
  o: 26,
  '0': 27,
  p: 28,
};

/** 走向匹配的和弦事件去抖：和弦是逐个音按下的，落定 140ms 后才判定一次 */
const CHORD_EVAL_MS = 140;

/**
 * 和弦琴房 —— 和弦结构 × 和弦走向的互动学习琴房。
 *
 * 布局（自上而下）：
 *   1. 学习引导：模式选择（和弦结构 / 和弦走向）+ 学习内容勾选 + 手势说明
 *   2. 拟物琴体：面板条（LCD 卡片架 + 控制旋钮区）→ 虚拟键盘（25/32 键）
 *      → 谱架指示区（文字读数 + 五线谱）
 *   3. 快捷键说明
 *
 * 三种输入殊途同归进 noteOn/noteOff：鼠标/触控点虚拟键、电脑键盘双排
 * 映射、Web MIDI 外接键盘。跟随按压为默认；延音踏板（按钮/空格/MIDI CC64）
 * 让已松开的音继续参与判定与发声。
 */
function renderLab(): void {
  const { content } = renderToolLayout(document.getElementById('app')!, '和弦琴房');

  const state: LabState = loadState();
  const synth = new PianoSynth();
  synth.setVolume(state.volume);

  function persist(): void {
    saveState({ ...state, chordCards: [...state.chordCards], progCards: [...state.progCards] });
  }

  // ────────── 按下集合管理（跟随按压 + 踏板锁定） ──────────
  /** 物理按住计数（鼠标/键盘/MIDI 可能同音叠按） */
  const holdCount = new Map<number, number>();
  /** 踏板踩着时已松开的音 */
  const latched = new Set<number>();

  function isPressed(midi: number): boolean {
    return (holdCount.get(midi) ?? 0) > 0 || (state.pedalOn && latched.has(midi));
  }

  function effectivePressed(): number[] {
    const out = new Set<number>(holdCount.keys());
    if (state.pedalOn) for (const m of latched) out.add(m);
    return [...out].sort((a, b) => a - b);
  }

  function qualityColor(qid: ChordQualityId): string {
    const pref = state.chordCards.find((c) => c.id === qid);
    return PALETTE[pref?.color ?? QUALITY_MAP.get(qid)!.defaultColor]!;
  }

  function progColor(pid: string): string {
    const pref = state.progCards.find((c) => c.id === pid);
    return PALETTE[pref?.color ?? 0]!;
  }

  // ────────── 走向追踪器（调性/卡片变化时重建） ──────────
  let tracker = buildTracker();

  function orderedProgs() {
    return state.progCards.filter((c) => c.enabled).map((c) => PROGRESSION_MAP.get(c.id)!);
  }

  function buildTracker(): ProgressionTracker {
    return new ProgressionTracker(orderedProgs(), state.keyPc, state.tonality);
  }

  // ────────── 虚拟键盘 ──────────
  /** 电脑键盘映射基准：窗口内第一个 C（窗口起点不是 C 时向上取整） */
  function compBase(): number {
    return state.windowStart + ((12 - pcOf(state.windowStart)) % 12);
  }

  const keyLabels = new Map<number, string>();
  function rebuildKeyLabels(): void {
    keyLabels.clear();
    for (const [letter, off] of Object.entries(KEYMAP)) {
      keyLabels.set(compBase() + off, letter.toUpperCase());
    }
  }

  const kbd = createKeyboard({
    onNoteOn: (midi) => noteOn(midi, 0.85),
    onNoteOff: (midi) => noteOff(midi),
    labelFor: (midi) => keyLabels.get(midi) ?? null,
  });

  // 88 键位置指示条：点击 / 拖动把窗口跳到对应音区
  const minimap = createMinimap({
    keyCount: () => state.keyCount,
    onJump: (start) => {
      const next = clampWindow(start, state.keyCount);
      if (next === state.windowStart) return;
      state.windowStart = next;
      renderKeyboard();
      persist();
    },
  });

  function renderKeyboard(): void {
    rebuildKeyLabels();
    kbd.render(state.windowStart, state.keyCount);
    minimap.render(state.windowStart, state.keyCount);
    refresh();
  }

  /** 视图跟随：按下的音在窗外时，窗口滑动到以它为中心 */
  function followWindow(midi: number): void {
    if (kbd.contains(midi)) return;
    state.windowStart = clampWindow(midi - Math.floor(state.keyCount / 2), state.keyCount);
    renderKeyboard();
    persist();
  }

  function shiftWindow(delta: number): void {
    const next = clampWindow(state.windowStart + delta, state.keyCount);
    if (next === state.windowStart) return;
    state.windowStart = next;
    renderKeyboard();
    persist();
  }

  // ────────── 音符进出（三种输入的汇合点） ──────────
  function noteOn(midi: number, vel: number): void {
    holdCount.set(midi, (holdCount.get(midi) ?? 0) + 1);
    latched.delete(midi);
    synth.noteOn(midi, vel);
    followWindow(midi);
    scheduleChordEval();
    refresh();
  }

  function noteOff(midi: number): void {
    const c = (holdCount.get(midi) ?? 0) - 1;
    if (c > 0) {
      holdCount.set(midi, c);
    } else {
      holdCount.delete(midi);
      if (state.pedalOn) latched.add(midi);
      else synth.noteOff(midi);
    }
    scheduleChordEval();
    refresh();
  }

  function setPedal(on: boolean): void {
    if (state.pedalOn === on) return;
    state.pedalOn = on;
    synth.setPedal(on);
    if (!on) latched.clear(); // 抬踏板：锁定的音退出判定（声音由 synth 收尾）
    syncPedalBtn();
    persist();
    refresh();
  }

  function releaseAllNotes(): void {
    holdCount.clear();
    latched.clear();
    synth.releaseAll();
    lastFedRoot = null;
    refresh();
  }

  // ────────── 走向和弦事件（去抖后喂 tracker） ──────────
  let evalTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFedRoot: number | null = null;

  function scheduleChordEval(): void {
    if (state.mode !== 'prog') return;
    if (evalTimer) clearTimeout(evalTimer);
    evalTimer = setTimeout(() => {
      evalTimer = null;
      const midis = effectivePressed();
      if (midis.length === 0) {
        lastFedRoot = null;
        refresh();
        return;
      }
      const root = extractRootPc(midis, activeQualities(state));
      if (root !== null && root !== lastFedRoot) {
        lastFedRoot = root;
        tracker.feed(root);
      }
      refresh();
    }, CHORD_EVAL_MS);
  }

  // ────────── 琴键上色（两模式的公共出口） ──────────
  function paintPressed(topColor: string | null): void {
    const [lo, hi] = kbd.range();
    for (let m = lo; m <= hi; m++) {
      if (isPressed(m)) kbd.press(m, topColor);
      else kbd.release(m);
    }
  }

  function paintHints(map: Map<number, string>): void {
    const [lo, hi] = kbd.range();
    for (let m = lo; m <= hi; m++) {
      if (isPressed(m)) continue;
      const c = map.get(pcOf(m));
      if (c) kbd.setHint(m, c);
    }
  }

  function paintDots(map: Map<number, string[]>): void {
    const [lo, hi] = kbd.range();
    for (let m = lo; m <= hi; m++) {
      if (isPressed(m)) continue;
      const cs = map.get(pcOf(m));
      if (cs) kbd.setDots(m, cs);
    }
  }

  function addDot(map: Map<number, string[]>, midi: number, color: string): void {
    const pc = pcOf(midi);
    const arr = map.get(pc) ?? [];
    if (!arr.includes(color)) arr.push(color);
    map.set(pc, arr);
  }

  // ────────── 谱架（指示区） ──────────
  const readoutBig = h('div', { class: 'cl-readout-big' });
  const readoutSub = h('div', { class: 'cl-readout-sub' });
  const seqRows = h('div', { class: 'mt-2 space-y-1.5' });
  const staffWrap = h('div', { class: 'cl-staffwrap' });

  function setStaff(svg: SVGElement | null): void {
    staffWrap.replaceChildren(svg ?? '');
    staffWrap.style.display = svg ? '' : 'none';
  }

  // ────────── 和弦模式刷新 ──────────
  function refreshChord(midis: number[]): void {
    if (midis.length === 0) {
      paintPressed(null);
      readoutBig.textContent = '按下琴键，看看能长出什么和弦';
      readoutSub.textContent =
        '单击屏幕卡片可开关某类和弦的引导；跟着彩色键再按一两个音，就能拼出完整和弦。';
      seqRows.replaceChildren();
      setStaff(renderNoteCluster([]));
      return;
    }

    const qs = activeQualities(state);
    const pcs = pcSetOf(midis);
    const lowestPc = pcOf(midis[0]!);
    const exact = exactChord(pcs, lowestPc, qs);
    const { satisfiable, hints } = completionHints(pcs, qs);
    const topQ = satisfiable[0] ?? null;

    paintPressed(topQ ? qualityColor(topQ) : null);
    const hintMap = new Map<number, string>();
    for (const [pc, q] of hints) hintMap.set(pc, qualityColor(q));
    paintHints(hintMap);

    const namesText = midis.map((m) => `${pcName(pcOf(m))}${Math.floor(m / 12) - 1}`).join(' + ');
    if (exact) {
      const q = QUALITY_MAP.get(exact.quality)!;
      const inv =
        exact.inversion > 0
          ? ` · ${INVERSION_LABEL[exact.inversion]}（低音 ${pcName(lowestPc)}）`
          : '';
      readoutBig.textContent = `${chordName(exact.rootPc, exact.quality)} ${q.name}${inv}`;
      readoutSub.textContent = `${namesText} · ${q.formula} · ${q.flavor}`;
    } else {
      const best = bestCompletion(pcs, lowestPc, qs);
      if (best) {
        const q = QUALITY_MAP.get(best.quality)!;
        readoutBig.textContent = `再按 ${best.missing.map(pcName).join('、')} → ${chordName(best.rootPc, best.quality)} ${q.name}`;
        const others = satisfiable
          .filter((q) => q !== best.quality)
          .map((q) => QUALITY_MAP.get(q)!.name);
        readoutSub.textContent =
          `${namesText}` + (others.length ? ` · 也可往 ${others.join(' / ')} 方向走` : '');
      } else {
        readoutBig.textContent = '这组音暂时对不上任何已开启的和弦';
        readoutSub.textContent = `${namesText} · 松开几个音，或在屏幕上打开更多和弦性质试试`;
      }
    }
    setStaff(renderNoteCluster(midis.map((m) => ({ midi: m, color: '#4ade80' }))));
  }

  // ────────── 走向模式刷新 ──────────
  /** 谱面 voicing：围绕 C4 就近声部连接，形成平滑的低移动线条 */
  function staffVoicings(steps: readonly ProgStep[]): number[][] {
    let center = 64; // E4 附近起步
    return steps.map((st) => {
      const v = nearestVoicing(
        stepRootPc(state.keyPc, state.tonality, st),
        stepIntervals(state.tonality, st),
        center,
        55,
        79,
      );
      if (v.length) center = Math.round(v.reduce((a, b) => a + b, 0) / v.length);
      return v;
    });
  }

  function refreshProg(midis: number[]): void {
    const actives = tracker.actives();
    const top = actives[0] ?? null;
    const topColor = top ? progColor(top.prog.id) : null;
    const [lo, hi] = kbd.range();
    const center = midis.length
      ? Math.round(midis.reduce((a, b) => a + b, 0) / midis.length)
      : Math.round((lo + hi) / 2);

    paintPressed(topColor);

    // 下一步和弦提示：最高优先级走向整键上色（就近 voicing），
    // 其余八度与其余活跃走向用小圆点弱提示
    const dotMap = new Map<number, string[]>();
    if (top) {
      const nxt = tracker.nextStep(top.prog.id) ?? top.prog.steps[0]!;
      const voicing = nearestVoicing(
        stepRootPc(state.keyPc, state.tonality, nxt),
        stepIntervals(state.tonality, nxt),
        center,
        lo,
        hi,
      );
      const voiced = new Set(voicing);
      // 就近 voicing 按 MIDI 精确上色（只染这一套把位），其余八度走弱提示圆点
      const voicedPc = new Set([...voiced].map(pcOf));
      for (const m of voicing) if (!isPressed(m)) kbd.setHint(m, topColor!);
      for (let m = lo; m <= hi; m++) {
        if (!voiced.has(m) && voicedPc.has(pcOf(m))) addDot(dotMap, m, topColor!);
      }
      for (const rt of actives.slice(1, 4)) {
        const st = tracker.nextStep(rt.prog.id) ?? rt.prog.steps[0]!;
        const v = nearestVoicing(
          stepRootPc(state.keyPc, state.tonality, st),
          stepIntervals(state.tonality, st),
          center,
          lo,
          hi,
        );
        for (const m of v) addDot(dotMap, m, progColor(rt.prog.id));
      }
    } else {
      // 空闲：把前三条开启走向的首级和弦用圆点请出来，引导用户开弹
      for (const c of state.progCards.filter((c) => c.enabled).slice(0, 3)) {
        const prog = PROGRESSION_MAP.get(c.id)!;
        const st = prog.steps[0]!;
        const v = nearestVoicing(
          stepRootPc(state.keyPc, state.tonality, st),
          stepIntervals(state.tonality, st),
          center,
          lo,
          hi,
        );
        for (const m of v) addDot(dotMap, m, progColor(prog.id));
      }
    }
    paintDots(dotMap);

    // 读数区：活跃走向按优先级逐行展示，序列像歌词一样逐个变色
    if (top) {
      readoutBig.textContent = `已匹配：${top.prog.icon} ${top.prog.name}`;
      const done = top.pos >= top.prog.steps.length;
      readoutSub.textContent = done
        ? '走完一轮！从首级再弹一遍可以循环。'
        : midis.length
          ? '跟着琴键上的颜色弹下一个和弦'
          : '继续保持，弹下一个和弦';
    } else {
      readoutBig.textContent = '弹出任意和弦，屏幕会认出它在哪条走向里';
      readoutSub.textContent = `当前调：${pcName(state.keyPc)} ${TONALITY_LABEL[state.tonality]} · 屏幕圆点是几条走向的起点，随便挑一个下手`;
    }

    seqRows.replaceChildren(
      ...actives.slice(0, 4).map((rt) => {
        const color = progColor(rt.prog.id);
        const chips: HTMLElement[] = [];
        rt.prog.steps.forEach((st, i) => {
          const cls =
            i < rt.pos ? 'cl-step cl-step-done' : i === rt.pos ? 'cl-step cl-step-next' : 'cl-step';
          chips.push(
            h('span', {
              class: cls,
              style: `--cl-c:${color}`,
              textContent: `${stepLabel(state.tonality, st)} ${stepChordName(state.keyPc, state.tonality, st)}`,
            }),
          );
          if (i < rt.prog.steps.length - 1)
            chips.push(h('span', { class: 'cl-step-arrow', textContent: '→' }));
        });
        if (rt.pos >= rt.prog.steps.length)
          chips.push(h('span', { class: 'cl-step-arrow', textContent: '↺' }));
        return h('div', { class: 'flex items-center gap-2' }, [
          h('span', {
            class: 'cl-dot',
            style: `background:${color};flex-shrink:0;display:inline-block`,
          }),
          h('div', { class: 'cl-seq' }, chips),
        ]);
      }),
    );

    // 谱面：最高优先级走向的和弦序列；空闲时预览第一条开启的走向
    if (top) {
      const voicings = staffVoicings(top.prog.steps);
      const chords: StaffSeqChord[] = top.prog.steps.map((_, i) => ({
        midis: voicings[i]!,
        state: i < top.pos ? 'done' : i === top.pos ? 'next' : 'todo',
        color: progColor(top.prog.id),
      }));
      setStaff(renderChordSeq(chords));
    } else {
      const first = state.progCards.find((c) => c.enabled);
      if (first) {
        const prog = PROGRESSION_MAP.get(first.id)!;
        const voicings = staffVoicings(prog.steps);
        setStaff(
          renderChordSeq(
            prog.steps.map((_, i) => ({
              midis: voicings[i]!,
              state: 'todo' as const,
              color: progColor(prog.id),
            })),
          ),
        );
      } else setStaff(null);
    }
  }

  // ────────── 刷新总出口 ──────────
  function refresh(): void {
    const midis = effectivePressed();
    kbd.clearGuide(); // 引导染色/圆点全量重画，避免上一状态残留
    if (state.mode === 'chord') refreshChord(midis);
    else refreshProg(midis);
    renderLcdTitle();
  }

  // ────────── LCD 屏幕（卡片架 + 屏标） ──────────
  const lcdTitle = h('div', { class: 'cl-lcd-title' });

  function renderLcdTitle(): void {
    lcdTitle.replaceChildren(
      h('b', { textContent: state.mode === 'chord' ? '和弦结构' : '和弦走向' }),
      h('span', {
        class: 'cl-lcd-hint',
        textContent:
          state.mode === 'chord'
            ? '拖排序 · 点开关 · 双击换色'
            : `${pcName(state.keyPc)} ${TONALITY_LABEL[state.tonality]}`,
      }),
    );
  }

  const rack = createRack({
    onReorder: (visibleIds) => {
      // 只重排可见卡片；隐藏的卡片（进阶包未勾选）保持相对顺序附在末尾
      const cards = state.mode === 'chord' ? state.chordCards : state.progCards;
      const visible = visibleIds.map((id) => cards.find((c) => c.id === id)!);
      const hidden = cards.filter((c) => !visibleIds.includes(c.id));
      const next = [...visible, ...hidden];
      cards.splice(0, cards.length, ...next);
      persist();
      renderRack();
      refresh();
    },
    onToggle: (id) => {
      const cards = state.mode === 'chord' ? state.chordCards : state.progCards;
      const c = cards.find((c) => c.id === id)!;
      c.enabled = !c.enabled;
      if (state.mode === 'prog') tracker = buildTracker();
      persist();
      renderRack();
      refresh();
    },
    onCycleColor: (id) => {
      const cards = state.mode === 'chord' ? state.chordCards : state.progCards;
      const c = cards.find((c) => c.id === id)!;
      c.color = (c.color + 1) % PALETTE_LEN;
      persist();
      renderRack();
      refresh();
    },
  });

  function renderRack(): void {
    let items: RackItem[];
    if (state.mode === 'chord') {
      items = state.chordCards
        .filter((c) => {
          const q = QUALITY_MAP.get(c.id as ChordQualityId)!;
          return state.advancedPack || !q.advanced;
        })
        .map((c) => {
          const q = QUALITY_MAP.get(c.id as ChordQualityId)!;
          return {
            id: c.id,
            color: PALETTE[c.color]!,
            enabled: c.enabled,
            name: q.name,
            sub: FORMULA_SHORT[q.id],
            tip: `${q.formula} · ${q.flavor}。拖动排序 · 单击开关 · 双击换色`,
          };
        });
    } else {
      items = state.progCards.map((c) => {
        const p = PROGRESSION_MAP.get(c.id)!;
        return {
          id: c.id,
          color: PALETTE[c.color]!,
          enabled: c.enabled,
          name: `${p.icon} ${p.name}`,
          sub: p.steps.map((st) => stepLabel(state.tonality, st)).join(' '),
          tip: `${p.desc}。拖动排序 · 单击开关 · 双击换色`,
        };
      });
    }
    rack.render(items);
  }

  const lcd = h('div', { class: 'cl-lcd' }, [lcdTitle, rack.el]);

  // ────────── 面板控制区 ──────────
  function segButton(
    label: string,
    on: boolean,
    onclick: () => void,
    title?: string,
  ): HTMLButtonElement {
    return h('button', {
      type: 'button',
      class: 'cl-btn' + (on ? ' cl-btn-on' : ''),
      textContent: label,
      title,
      onclick,
    });
  }

  // 键数切换
  const keyCountSeg = h('div', { class: 'cl-seg' });
  function renderKeyCountSeg(): void {
    keyCountSeg.replaceChildren(
      ...([25, 32] as const).map((n) =>
        segButton(
          String(n),
          state.keyCount === n,
          () => {
            if (state.keyCount === n) return;
            state.keyCount = n;
            state.windowStart = clampWindow(state.windowStart, n);
            renderKeyCountSeg();
            renderKeyboard();
            persist();
          },
          `${n} 键视图`,
        ),
      ),
    );
  }

  // 调性（走向模式）
  const rootSelect = h(
    'select',
    {
      class: 'cl-select',
      title: '走向模式的主音',
      onchange: () => {
        state.keyPc = Number(rootSelect.value);
        tracker = buildTracker();
        persist();
        renderRack();
        refresh();
      },
    },
    PC_NAMES.map((n, i) => h('option', { value: String(i), textContent: n })),
  ) as HTMLSelectElement;
  rootSelect.value = String(state.keyPc);

  const tonalitySeg = h('div', { class: 'cl-seg' });
  function renderTonalitySeg(): void {
    tonalitySeg.replaceChildren(
      ...(['major', 'minor'] as Tonality[]).map((t) =>
        segButton(TONALITY_LABEL[t], state.tonality === t, () => {
          if (state.tonality === t) return;
          state.tonality = t;
          tracker = buildTracker();
          persist();
          renderTonalitySeg();
          renderRack();
          refresh();
        }),
      ),
    );
  }

  const keyControls = h('div', { class: 'cl-ctl' }, [
    h('span', { textContent: '调性' }),
    rootSelect,
    tonalitySeg,
  ]);

  // 踏板
  const pedalBtn = h('button', {
    type: 'button',
    class: 'cl-btn',
    title: '延音踏板（空格切换；MIDI 踏板 CC64 同步）：踩着时松开的音继续参与和弦判定',
    onclick: () => setPedal(!state.pedalOn),
  });
  function syncPedalBtn(): void {
    pedalBtn.className = 'cl-btn' + (state.pedalOn ? ' cl-btn-on' : '');
    pedalBtn.textContent = state.pedalOn ? '🟢 踏板踩着' : '踏板';
  }

  // MIDI
  const midiLamp = h('span', { class: 'cl-lamp' });
  const midiStatus = h('span', { class: 'cl-lcd-hint', textContent: '未连接' });
  const midi = new MidiBridge({
    onNoteOn: (m, v) => noteOn(m, Math.max(0.25, v)),
    onNoteOff: (m) => noteOff(m),
    onPedal: (down) => setPedal(down),
    onStatus: (text, online) => {
      midiStatus.textContent = text;
      midiLamp.className = 'cl-lamp' + (online ? ' cl-lamp-on' : '');
    },
  });
  const midiBtn = h('button', {
    type: 'button',
    class: 'cl-btn',
    textContent: '🎹 MIDI',
    title: '连接外接 MIDI 键盘（Chrome/Edge 支持）',
    onclick: () => void midi.connect(),
  });

  // 音量
  const volSlider = h('input', {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.05',
    class: 'cl-vol',
    title: '音量',
  }) as HTMLInputElement;
  volSlider.value = String(state.volume);
  volSlider.addEventListener('input', () => {
    state.volume = Number(volSlider.value);
    synth.setVolume(state.volume);
    persist();
  });

  const bezel = h('div', { class: 'cl-bezel' }, [
    h('div', { class: 'cl-ctl' }, [
      h('span', { textContent: '键数' }),
      keyCountSeg,
      segButton('◀', false, () => shiftWindow(-12), '视图左移一个八度'),
      segButton('▶', false, () => shiftWindow(12), '视图右移一个八度'),
    ]),
    lcd,
    h('div', { class: 'cl-ctl', style: 'justify-content:flex-end' }, [
      keyControls,
      pedalBtn,
      h('span', { class: 'cl-ctl' }, [midiBtn, midiLamp, midiStatus]),
      h('span', { class: 'cl-ctl' }, [h('span', { textContent: '🔊' }), volSlider]),
    ]),
  ]);

  // ────────── 引导面板（学习模式 / 内容选择） ──────────
  const modeCards = new Map<'chord' | 'prog', HTMLButtonElement>();
  const chordOpts = h('div', { class: 'mt-3 flex flex-wrap items-center gap-2' });
  const progOpts = h('div', {
    class: 'mt-3 text-xs leading-relaxed text-[var(--fg-muted)]',
  });

  function renderGuide(): void {
    for (const [m, btn] of modeCards) {
      btn.className = 'cl-mode' + (state.mode === m ? ' cl-mode-on' : '');
    }
    chordOpts.style.display = state.mode === 'chord' ? '' : 'none';
    progOpts.style.display = state.mode === 'prog' ? '' : 'none';
    keyControls.style.display = state.mode === 'prog' ? '' : 'none';
  }

  for (const def of [
    {
      m: 'chord' as const,
      icon: '🎹',
      title: '学和弦结构',
      desc: '按下一个音，看它能长出哪些和弦；跟着彩色引导键补上缺音，亲手拼出大三 / 小三 / 增 / 减的听感差异。',
    },
    {
      m: 'prog' as const,
      icon: '🎼',
      title: '学和弦走向',
      desc: '1564、4536、卡农……跟着屏幕上的经典走向弹，序列会像歌词一样逐格点亮，感受不同走向的情绪。',
    },
  ]) {
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'cl-mode',
        onclick: () => {
          if (state.mode === def.m) return;
          state.mode = def.m;
          tracker = buildTracker();
          lastFedRoot = null;
          persist();
          renderGuide();
          renderRack();
          refresh();
        },
      },
      [
        h('div', { class: 'flex items-center gap-2' }, [
          h('span', { class: 'text-lg', textContent: def.icon }),
          h('span', { class: 'text-sm font-semibold text-[var(--fg)]', textContent: def.title }),
        ]),
        h('p', {
          class: 'mt-1.5 text-xs leading-relaxed text-[var(--fg-muted)]',
          textContent: def.desc,
        }),
      ],
    );
    modeCards.set(def.m, btn);
  }

  const advCheckbox = h('input', { type: 'checkbox', class: 'accent-[var(--accent)]' });
  advCheckbox.checked = state.advancedPack;
  advCheckbox.addEventListener('change', () => {
    state.advancedPack = advCheckbox.checked;
    persist();
    renderRack();
    refresh();
  });
  chordOpts.replaceChildren(
    h(
      'label',
      {
        class:
          'inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--fg)] transition-colors hover:border-[var(--accent)]',
      },
      [advCheckbox, '进阶和弦包（属七 / 大七 / 小七 / 挂二 / 挂四 / add9）'],
    ),
    h('span', {
      class: 'text-xs text-[var(--fg-muted)]',
      textContent: '勾选后屏幕会多出 6 张色彩和弦卡片',
    }),
  );
  progOpts.textContent =
    '屏幕上的每张卡片是一条经典走向：拖动调整优先级，单击开关，双击换色。从任何一级弹起都能被认出；弹错级不会惩罚，走向会安静退场等你重新开始。';

  const guidePanel = h(
    'section',
    { class: 'rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 sm:p-5' },
    [
      h('div', { class: 'flex flex-wrap items-baseline gap-2' }, [
        h('span', {
          class: 'text-sm font-semibold text-[var(--fg)]',
          textContent: '🎓 想学点什么？',
        }),
        h('span', {
          class: 'text-xs text-[var(--fg-muted)]',
          textContent: '选择学习模式，剩下的交给手指',
        }),
      ]),
      h('div', { class: 'mt-3 flex flex-wrap gap-3' }, [...modeCards.values()]),
      chordOpts,
      progOpts,
    ],
  );

  // ────────── 电脑键盘 ──────────
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (
      t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable)
    ) {
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === ' ') {
      e.preventDefault();
      setPedal(!state.pedalOn);
      return;
    }
    if (k === 'escape') {
      releaseAllNotes();
      return;
    }
    if (k === 'arrowleft') {
      e.preventDefault();
      shiftWindow(-12);
      return;
    }
    if (k === 'arrowright') {
      e.preventDefault();
      shiftWindow(12);
      return;
    }
    const off = KEYMAP[k];
    if (off !== undefined) noteOn(compBase() + off, 0.85);
  });
  document.addEventListener('keyup', (e: KeyboardEvent) => {
    const off = KEYMAP[e.key.toLowerCase()];
    if (off !== undefined) noteOff(compBase() + off);
  });

  // ────────── 装配 ──────────
  const piano = h('div', { class: 'cl-piano' }, [
    bezel,
    minimap.el,
    kbd.el,
    h('div', { class: 'cl-stand' }, [
      h('div', { class: 'cl-readout' }, [readoutBig, readoutSub, seqRows]),
      staffWrap,
    ]),
  ]);

  content.append(
    h('p', {
      class: 'mb-4 text-sm text-[var(--fg-muted)]',
      textContent:
        '一台放在浏览器里的练琴房：鼠标点、电脑键盘（Z 排 / Q 排双排映射）或外接 MIDI 键盘都能弹。和弦模式下按下音就能看到它能组成什么和弦、还缺哪个音；走向模式下跟着 1564、4536、卡农等经典走向弹，序列逐格点亮、五线谱同步记谱。全部本地合成发声，配置自动记忆。',
    }),
    guidePanel,
    h('div', { class: 'mt-5' }, [piano]),
    h('p', {
      class: 'mt-4 text-[11px] leading-relaxed text-[var(--fg-muted)]',
      textContent:
        '快捷键：Z 排 = 当前窗口白键区（C 起），Q 排 = 高八度，←/→ 移动视图八度，空格 = 延音踏板，Esc = 全部松开。键盘上方的微型指示条标示窗口在 88 键中的位置，点击 / 拖动可快速跳转音区。MIDI 设备点面板上的「🎹 MIDI」连接，支持踏板 CC64。',
    }),
  );

  // 初始渲染
  renderKeyCountSeg();
  renderTonalitySeg();
  syncPedalBtn();
  renderGuide();
  renderRack();
  renderKeyboard();
}

renderLab();
