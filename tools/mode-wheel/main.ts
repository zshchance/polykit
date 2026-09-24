import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { copyText, downloadBlob } from '@/core/utils/clipboard';
import { ChordSynth } from './engine/synth';
import {
  LooperStore,
  STEPS_PER_BEAT,
  DEFAULT_EVENT_LEN,
  tvCapacity,
  subCount,
  chordStrokes,
  melodyStrokes,
  type LoopEvent,
  type LoopLayer,
} from './engine/looper';
import { writeSmf, type MidiNote, type MidiTrackInput } from './engine/midifile';
import { createWheel } from './ui/wheel';
import { injectWheelStyles } from './ui/styles';
import {
  buildModeTable,
  decodeSteps,
  encodeSteps,
  pcName,
  prefersFlat,
  progPreview,
  resolveStep,
  voiceChord,
  midiToDegree,
  QUALITY_NAME,
  FIFTH_ORDER,
  type DegreeChord,
  type DegreeInfo,
  type ModeTable,
  type Register,
  type WheelStep,
} from './theory';
import { MODES, MODE_MAP, MODE_PROGS } from './data/modes';
import { loadState, saveState, type WheelState } from './settings';

initTheme();
injectWheelStyles();

/** 调选择芯片顺序：沿五度圈走，与转盘的空间直觉一致 */
const KEY_CHIPS = FIFTH_ORDER.map((pc) => pc);

const QUALITY_SUFFIX: Record<DegreeChord['quality'], string> = {
  maj: '',
  min: 'm',
  dim: '°',
  aug: '+',
};

/** 可选时值（每格独立设置）：<1 = 把这一拍细分成 1/tv 个音；>1 = 单音延音 tv 拍。数字键 1-7 一一对应 */
const TV_OPTIONS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4] as const;
const TV_LABELS = ['1/16', '1/8', '1/4', '1/2', '1', '2拍', '4拍'] as const;

/** 电脑键盘 → 旋律度数（A S D F G H J = 调内 1-7 级音） */
const MELODY_KEYS: Record<string, number> = { a: 0, s: 1, d: 2, f: 3, g: 4, h: 5, j: 6 };

/**
 * 调式罗盘 —— 可调式的和弦转盘。
 *
 * v2 新增：
 *   - 调式变形：巡航不中断，切调/调式时同一段级数在新调式里实时重生，
 *     耳朵直接对比色彩（级数语义跨调式对齐的数据设计在此兑现）
 *   - 我的进行：编排器点级数攒出自己的进行，可巡航、可清空
 *   - 分享链接：调/调式/BPM/自定义进行编码进 URL hash，点开即复现
 *   - 和声轨迹：巡航时转盘内圈画出和弦间连线，看见"歌曲的形状"
 */
function renderWheel(): void {
  const { content } = renderToolLayout(document.getElementById('app')!, '调式罗盘');

  const state: WheelState = loadState();

  const synth = new ChordSynth();

  const persist = (): void => saveState({ ...state, customSteps: [...state.customSteps] });

  applyHash(state);
  synth.setVolume(state.volume);
  const flat = (): boolean => prefersFlat(state.keyPc);
  const table = (): ModeTable => buildModeTable(MODE_MAP.get(state.modeId)!, state.keyPc);

  /** 分享链接：#k=主音&m=调式&b=BPM&s=我的进行（编码见 theory.encodeSteps） */
  function applyHash(target: WheelState): void {
    const raw = location.hash.replace(/^#/, '');
    if (!raw) return;
    const params = new URLSearchParams(raw);
    const kRaw = params.get('k');
    const k = kRaw === null ? NaN : Number(kRaw);
    if (Number.isInteger(k) && k >= 0 && k <= 11) target.keyPc = k;
    const m = params.get('m');
    if (m && MODE_MAP.has(m)) target.modeId = m;
    const b = Number(params.get('b'));
    if (Number.isFinite(b) && b > 0) target.bpm = Math.min(160, Math.max(60, Math.round(b)));
    const s = params.get('s');
    if (s) {
      const steps = decodeSteps(s);
      if (steps) target.customSteps = steps.slice(0, 32);
    }
    if (kRaw !== null || m || s) persist();
  }

  // ────────── 读数面板 ──────────
  const readoutName = h('div', { class: 'text-3xl font-bold tracking-wide' });
  const readoutMeta = h('div', { class: 'mt-1 text-sm text-[var(--fg-muted)]' });
  const readoutHint = h('div', { class: 'mt-2 text-sm leading-relaxed' });
  const readout = h(
    'section',
    {
      class: 'rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 min-h-[132px]',
      'aria-live': 'polite',
    },
    [readoutName, readoutMeta, readoutHint],
  );

  function chordSymbol(chord: DegreeChord): string {
    return pcName(chord.rootPc, flat()) + QUALITY_SUFFIX[chord.quality];
  }

  function showChord(degree: DegreeInfo, chord: DegreeChord): void {
    const noteNames = chord.pcs.map((p) => pcName(p, flat())).join(' · ');
    readoutName.textContent = `${chord.numeral} · ${chordSymbol(chord)}`;
    readoutMeta.textContent = `${QUALITY_NAME[chord.quality]} · 构成音 ${noteNames}`;
    if (degree.index === 0) {
      readoutHint.textContent = chord.primary
        ? '主和弦——家的位置，进行从这里出发，也最终回到这里。'
        : '同一个根音的小三和弦——主和弦的阴天版本，蓝调的秘密武器。';
    } else if (chord.common >= 2) {
      readoutHint.textContent = `与主和弦共享 ${chord.common} 个音——挨得近，切过去很顺滑。`;
    } else if (chord.common === 1) {
      readoutHint.textContent = '与主和弦只共享 1 个音——若即若离，自带一点悬而未决。';
    } else {
      readoutHint.textContent = '与主和弦没有共同音——远关系，砸下去就是"意外之美"。';
    }
  }

  function showIdle(): void {
    const m = MODE_MAP.get(state.modeId)!;
    readoutName.textContent = `${m.icon} ${m.zhName}`;
    readoutMeta.textContent = `1 = ${pcName(state.keyPc, flat())}`;
    readoutHint.textContent = m.flavor;
  }

  // ────────── 发声 ──────────
  function strikeChord(
    chord: DegreeChord,
    register: Register,
    prev: number[] | null,
    at?: number,
  ): number[] {
    const { bass, tones } = voiceChord(chord, register, prev);
    synth.strike(bass, { time: at, vel: 0.55 });
    // 轻微扫弦：相邻音错开 14ms，比齐响更像"弹"出来的
    tones.forEach((midi, i) => {
      const t = (at ?? synth.ensure().currentTime) + 0.014 * (i + 1);
      synth.strike(midi, { time: t, vel: 0.62 });
    });
    return tones;
  }

  const wheel = createWheel({
    onStrike: (degree, register) => {
      const chord = degree.chords[0];
      if (!chord) return;
      strikeChord(chord, register, null);
      wheel.flash(degree.index);
      showChord(degree, chord);
    },
  });

  // ────────── 巡航（进行自动演奏） ──────────
  const LOOKAHEAD_MS = 25;
  const AHEAD_S = 0.15;

  /** 巡航中的步序列（处方的或"我的进行"）；sourceId = 处方 id / 'custom' */
  let cruiseSteps: readonly WheelStep[] | null = null;
  let cruiseSourceId: string | null = null;
  let cruiseTimer: ReturnType<typeof setInterval> | null = null;
  let uiTimer: ReturnType<typeof setInterval> | null = null;
  let nextStepIdx = 0;
  let nextTime = 0;
  let prevTones: number[] | null = null;
  let scheduled: { idx: number; time: number }[] = [];

  const beatDur = (): number => 60 / state.bpm;
  const chordDur = (): number => beatDur() * state.beatsPerChord;

  function scheduleStep(idx: number, time: number): void {
    const step = cruiseSteps![idx]!;
    const chord = resolveStep(table(), step);
    // 该级在当前调式无和弦：静默但光标照常推进（变形玩法会碰到）
    if (chord) {
      const { bass, tones } = voiceChord(chord, 'low', prevTones);
      prevTones = tones;
      const hold = chordDur() * 0.92;
      synth.strike(bass, { time, vel: 0.5, dur: hold });
      tones.forEach((midi, i) => {
        synth.strike(midi, { time: time + 0.012 * (i + 1), vel: 0.56, dur: hold });
      });
    }
    scheduled.push({ idx, time });
    if (scheduled.length > 32) scheduled.splice(0, scheduled.length - 32);
  }

  function cruiseTick(): void {
    const ctx = synth.ensure();
    while (nextTime < ctx.currentTime + AHEAD_S) {
      scheduleStep(nextStepIdx, nextTime);
      nextTime += chordDur();
      nextStepIdx = (nextStepIdx + 1) % cruiseSteps!.length;
    }
  }

  /** UI 轮询：从音频时钟反推当前该亮哪个和弦（低频即可，不影响音频精度） */
  function uiTick(): void {
    const now = synth.ensure().currentTime;
    let current: number | null = null;
    for (let i = scheduled.length - 1; i >= 0; i--) {
      if (scheduled[i]!.time <= now) {
        current = scheduled[i]!.idx;
        break;
      }
    }
    if (current === null || !cruiseSteps) return;
    const step = cruiseSteps[current]!;
    const t = table();
    const degree = t.degrees[step.d]!;
    wheel.setCursor(step.d);
    const chord = resolveStep(t, step);
    if (chord) {
      showChord(degree, chord);
    } else {
      readoutName.textContent = `${degree.label} · –`;
      readoutMeta.textContent = '这个级在当前调式里堆不出三和弦';
      readoutHint.textContent = '换一个调式试试——级数不变，色彩会变。';
    }
    if (cruiseSourceId === 'custom') highlightSeqSlot(current);
  }

  function startCruise(steps: readonly WheelStep[], sourceId: string): void {
    stopCruise();
    if (loopPlaying) stopLoop(); // 巡航与循环互斥
    cruiseSteps = steps;
    cruiseSourceId = sourceId;
    nextStepIdx = 0;
    prevTones = null;
    scheduled = [];
    const ctx = synth.ensure();
    nextTime = ctx.currentTime + 0.08;
    cruiseTimer = setInterval(cruiseTick, LOOKAHEAD_MS);
    uiTimer = setInterval(uiTick, 50);
    refreshProgCards();
    refreshCruiseStatus();
  }

  function stopCruise(): void {
    if (cruiseTimer) clearInterval(cruiseTimer);
    if (uiTimer) clearInterval(uiTimer);
    cruiseTimer = null;
    uiTimer = null;
    cruiseSteps = null;
    cruiseSourceId = null;
    synth.stopAll();
    wheel.setCursor(null);
    refreshProgCards();
    refreshCruiseStatus();
  }

  const cruising = (): boolean => cruiseSteps !== null;

  // ────────── Looper：步进编排与循环播放 ──────────
  const store = new LooperStore();
  store.restoreLayers(state.loopLayers);
  store.loopBeats = state.loopBeats;

  let loopPlaying = false;
  let metronomeOn = true;
  let playStartTime = 0;
  let nextBoundary = 0;
  let loopTimer: ReturnType<typeof setInterval> | null = null;
  let loopUiTimer: ReturnType<typeof setInterval> | null = null;
  /** 已排程事件的视觉回调（发光），由 UI 轮询触发 */
  let loopVisuals: { kind: 'chord' | 'melody'; d: number; time: number }[] = [];

  /** 编排光标：选中的格子（layerId + 格下标），点击调色板/旋律垫填入此处 */
  let selected: { layerId: number; cell: number } | null = null;
  /** 和弦层填入用的把位 */
  let fillRegister: Register = 'low';
  /** 当前播放头所在格（列高亮用；-1 = 未播放） */
  let playCell = -1;

  const loopDur = (): number => beatDur() * store.loopBeats;

  function persistLoop(): void {
    state.loopLayers = store.layers;
    state.loopBeats = store.loopBeats;
    persist();
  }

  function scheduleLoopEvent(ev: LoopEvent, t0: number): void {
    if (ev.kind === 'chord') {
      for (const s of chordStrokes(ev)) {
        const chord = resolveStep(table(), { d: s.d, alt: s.alt });
        if (!chord) continue;
        const { bass, tones } = voiceChord(chord, ev.register, null);
        const t = t0 + s.at * beatDur();
        const hold = s.len * beatDur();
        synth.strike(bass, { time: t, vel: 0.5, dur: hold });
        tones.forEach((midi, i) => {
          synth.strike(midi, { time: t + 0.012 * (i + 1), vel: 0.56, dur: hold });
        });
        loopVisuals.push({ kind: 'chord', d: s.d, time: t });
      }
    } else {
      for (const s of melodyStrokes(ev)) {
        const midi = melodyMidi(s.deg, s.octave);
        if (midi === null) continue;
        const t = t0 + s.at * beatDur();
        synth.strike(midi, { time: t, vel: 0.6, dur: s.len * beatDur() * 0.95 });
        loopVisuals.push({ kind: 'melody', d: s.deg, time: t });
      }
    }
  }

  function scheduleLoopIteration(t0: number): void {
    for (const layer of store.layers) {
      if (layer.muted) continue;
      for (const ev of layer.events) scheduleLoopEvent(ev, t0);
    }
    if (metronomeOn) {
      for (let b = 0; b < store.loopBeats; b++) {
        synth.tick(b === 0, t0 + b * beatDur());
      }
    }
  }

  function loopTick(): void {
    const now = synth.ensure().currentTime;
    while (nextBoundary < now + AHEAD_S) {
      scheduleLoopIteration(nextBoundary);
      nextBoundary += loopDur();
    }
  }

  function loopUiTick(): void {
    const now = synth.ensure().currentTime;
    const beatNow = (now - playStartTime) / beatDur();
    const cell = Math.floor((beatNow % store.loopBeats) * STEPS_PER_BEAT);
    if (cell !== playCell) {
      playCell = cell;
      highlightPlayCell(cell);
    }
    for (const v of loopVisuals) {
      if (v.time <= now) {
        if (v.kind === 'chord') wheel.flash(v.d);
        else flashPadKey(v.d);
      }
    }
    loopVisuals = loopVisuals.filter((v) => v.time > now);
  }

  function startLoop(): void {
    if (loopPlaying) return;
    stopCruise(); // 巡航与循环互斥
    loopPlaying = true;
    playStartTime = synth.ensure().currentTime + 0.1;
    nextBoundary = playStartTime;
    loopVisuals = [];
    loopTimer = setInterval(loopTick, LOOKAHEAD_MS);
    loopUiTimer = setInterval(loopUiTick, 50);
    refreshLoopPanel();
  }

  function stopLoop(): void {
    if (loopTimer) clearInterval(loopTimer);
    if (loopUiTimer) clearInterval(loopUiTimer);
    loopTimer = null;
    loopUiTimer = null;
    loopPlaying = false;
    loopVisuals = [];
    playCell = -1;
    highlightPlayCell(-1);
    synth.stopAll();
    refreshLoopPanel();
  }

  /** 旋律度数 → MIDI（基准八度 4，octave ∈ -1/0/+1） */
  function melodyMidi(deg: number, octave: number): number | null {
    const off = MODE_MAP.get(state.modeId)!.offsets[deg];
    if (off === undefined) return null;
    return 12 * (5 + octave) + state.keyPc + off;
  }

  // ────────── 调式 / 调选择 ──────────
  const flavorLine = h('p', { class: 'mt-2 text-sm text-[var(--fg-muted)] leading-relaxed' });

  const modeChips = h('div', { class: 'flex flex-wrap gap-2' });
  MODES.forEach((m) => {
    const chip = h('button', {
      class: 'mw-chip',
      type: 'button',
      textContent: `${m.icon} ${m.zhName}`,
      onclick: () => {
        if (state.modeId === m.id) return;
        // 调式变形：巡航不中断，同一段级数在新调式里实时重生
        state.modeId = m.id;
        persist();
        refreshAll();
      },
    });
    chip.dataset.modeId = m.id;
    modeChips.append(chip);
  });

  const keyChips = h('div', { class: 'flex flex-wrap gap-2' });
  KEY_CHIPS.forEach((pc) => {
    const chip = h('button', {
      class: 'mw-chip',
      type: 'button',
      textContent: pcName(pc, prefersFlat(pc)),
      onclick: () => {
        if (state.keyPc === pc) return;
        state.keyPc = pc;
        persist();
        refreshAll();
      },
    });
    chip.dataset.keyPc = String(pc);
    keyChips.append(chip);
  });

  // ────────── 度数条（视频右侧那张表） ──────────
  const strip = h('div', { class: 'mw-strip mt-3' });

  function renderStrip(): void {
    const t = table();
    strip.replaceChildren();
    for (const degree of t.degrees) {
      const isSig = t.mode.signature === degree.index;
      const degLabel = h('div', { class: 'mw-strip-deg', textContent: degree.label });
      if (isSig) degLabel.append(h('span', { class: 'mw-sig', textContent: '▽' }));
      const alt = degree.chords.find((c) => !c.primary);
      const numeral = degree.chords[0]?.numeral ?? '–';
      strip.append(
        h('div', { class: `mw-strip-cell ${isSig ? 'mw-strip-cell--sig' : ''}` }, [
          degLabel,
          h('div', {
            class: 'mw-strip-num',
            textContent: alt ? `${numeral} (${alt.numeral})` : numeral,
          }),
        ]),
      );
    }
  }

  // ────────── 巡航控制 ──────────
  const bpmValue = h('span', { class: 'text-sm font-semibold w-14 text-right tabular-nums' });
  const bpmSlider = h('input', {
    type: 'range',
    min: '60',
    max: '160',
    step: '1',
    class: 'flex-1 accent-[var(--accent)]',
    oninput: (ev: Event) => {
      state.bpm = Number((ev.target as HTMLInputElement).value);
      persist();
      bpmValue.textContent = `${state.bpm} BPM`;
    },
  });

  const beatsChips = h('div', { class: 'flex gap-2' });
  ([2, 4] as const).forEach((beats) => {
    const chip = h('button', {
      class: 'mw-chip',
      type: 'button',
      textContent: `${beats} 拍/和弦`,
      onclick: () => {
        state.beatsPerChord = beats;
        persist();
        refreshTransport();
      },
    });
    chip.dataset.beats = String(beats);
    beatsChips.append(chip);
  });

  const volumeSlider = h('input', {
    type: 'range',
    min: '0',
    max: '100',
    step: '1',
    class: 'flex-1 accent-[var(--accent)]',
    oninput: (ev: Event) => {
      state.volume = Number((ev.target as HTMLInputElement).value) / 100;
      synth.setVolume(state.volume);
      persist();
    },
  });

  /** 巡航状态行：显示当前步序列预览 + 停止按钮（变形玩法的主要控制台） */
  const cruiseStatusText = h('span', { class: 'text-sm font-semibold text-[var(--accent)]' });
  const cruiseStatus = h(
    'div',
    { class: 'items-center justify-between gap-2 hidden', style: 'display:none' },
    [
      h('div', { class: 'min-w-0' }, [
        h('div', { class: 'text-xs text-[var(--fg-muted)]' }, ['巡航中 · 切调式可变形']),
        cruiseStatusText,
      ]),
      h('button', {
        class: 'mw-chip shrink-0',
        type: 'button',
        textContent: '⏸ 停止',
        onclick: () => stopCruise(),
      }),
    ],
  );

  function refreshCruiseStatus(): void {
    if (!cruiseSteps) {
      cruiseStatus.style.display = 'none';
      return;
    }
    const preview = cruiseSteps.map((s) => resolveStep(table(), s)?.numeral ?? '–').join(' → ');
    cruiseStatusText.textContent = preview;
    cruiseStatus.style.display = 'flex';
  }

  function refreshTransport(): void {
    bpmSlider.value = String(state.bpm);
    bpmValue.textContent = `${state.bpm} BPM`;
    volumeSlider.value = String(Math.round(state.volume * 100));
    beatsChips.querySelectorAll<HTMLElement>('.mw-chip').forEach((chip) => {
      chip.classList.toggle('mw-chip--active', chip.dataset.beats === String(state.beatsPerChord));
    });
  }

  const transport = h(
    'section',
    { class: 'rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 space-y-3' },
    [
      h('div', { class: 'flex items-center gap-3' }, [
        h('span', { class: 'text-sm text-[var(--fg-muted)] shrink-0', textContent: '速度' }),
        bpmSlider,
        bpmValue,
      ]),
      h('div', { class: 'flex items-center gap-3' }, [
        h('span', { class: 'text-sm text-[var(--fg-muted)] shrink-0', textContent: '长度' }),
        beatsChips,
      ]),
      h('div', { class: 'flex items-center gap-3' }, [
        h('span', { class: 'text-sm text-[var(--fg-muted)] shrink-0', textContent: '音量' }),
        volumeSlider,
      ]),
      cruiseStatus,
    ],
  );

  // ────────── 我的进行（编排器） ──────────
  let useAlt = false;
  const seqRow = h('div', { class: 'mw-seq' });
  const seqPlayBtn = h('button', {
    class: 'mw-chip',
    type: 'button',
    onclick: () => {
      if (cruiseSourceId === 'custom') {
        stopCruise();
      } else if (state.customSteps.length > 0) {
        startCruise(state.customSteps, 'custom');
      }
    },
  });
  const seqClearBtn = h('button', {
    class: 'mw-chip',
    type: 'button',
    textContent: '✕ 清空',
    onclick: () => {
      if (cruiseSourceId === 'custom') stopCruise();
      state.customSteps = [];
      persist();
      refreshSequencer();
    },
  });
  const shareBtn = h('button', {
    class: 'mw-chip',
    type: 'button',
    textContent: '🔗 分享',
    onclick: () => void shareLink(),
  });
  const altToggle = h('button', {
    class: 'mw-chip',
    type: 'button',
    textContent: '备用和弦：关',
    onclick: () => {
      useAlt = !useAlt;
      altToggle.textContent = `备用和弦：${useAlt ? '开' : '关'}`;
      altToggle.classList.toggle('mw-chip--active', useAlt);
    },
  });
  const degreeAddRow = h('div', { class: 'flex flex-wrap gap-1.5' });

  function addStep(d: number): void {
    if (state.customSteps.length >= 32) return;
    const t = table();
    const degree = t.degrees[d]!;
    const chord = useAlt ? resolveStep(t, { d, alt: true }) : degree.chords[0];
    if (!chord) return;
    state.customSteps.push(useAlt ? { d, alt: true } : { d });
    persist();
    refreshSequencer();
    // 加入即试听（高把位，和巡航的低把位区分开）
    strikeChord(chord, 'high', null);
    wheel.flash(d);
    showChord(degree, chord);
  }

  function highlightSeqSlot(current: number): void {
    seqRow.querySelectorAll('.mw-seq-slot').forEach((el, i) => {
      el.classList.toggle('mw-seq-slot--current', i === current);
    });
  }

  function refreshSequencer(): void {
    const t = table();
    // 级数添加按钮（与度数条同源，但可点）
    degreeAddRow.replaceChildren();
    for (const degree of t.degrees) {
      const hasChord = degree.chords.length > 0;
      const btn = h('button', {
        class: 'mw-chip',
        type: 'button',
        disabled: !hasChord,
        textContent: degree.chords[0]?.numeral ?? '–',
        title: hasChord ? `加入 ${degree.chords[0]!.numeral} 级到我的进行` : '该级在当前调式无和弦',
        onclick: () => addStep(degree.index),
      });
      if (!hasChord) btn.style.opacity = '0.4';
      degreeAddRow.append(btn);
    }
    // 序列格
    seqRow.replaceChildren();
    if (state.customSteps.length === 0) {
      seqRow.append(
        h('span', { class: 'mw-seq-empty', textContent: '点上方级数，攒出你自己的进行' }),
      );
    } else {
      state.customSteps.forEach((step, i) => {
        const numeral = resolveStep(t, step)?.numeral ?? '–';
        seqRow.append(
          h('button', {
            class: 'mw-seq-slot',
            type: 'button',
            textContent: numeral,
            title: '点击删除这步',
            onclick: () => {
              if (cruiseSourceId === 'custom') stopCruise();
              state.customSteps.splice(i, 1);
              persist();
              refreshSequencer();
            },
          }),
        );
      });
    }
    seqPlayBtn.textContent =
      cruiseSourceId === 'custom' ? '⏸ 停止' : `▶ 巡航（${state.customSteps.length} 步）`;
  }

  async function shareLink(): Promise<void> {
    const params = new URLSearchParams();
    params.set('k', String(state.keyPc));
    params.set('m', state.modeId);
    params.set('b', String(state.bpm));
    if (state.customSteps.length > 0) params.set('s', encodeSteps(state.customSteps));
    const hash = params.toString();
    history.replaceState(null, '', `#${hash}`);
    const ok = await copyText(`${location.origin}${location.pathname}#${hash}`);
    shareBtn.textContent = ok ? '✓ 已复制链接' : '✗ 复制失败';
    setTimeout(() => (shareBtn.textContent = '🔗 分享'), 1500);
  }

  // ────────── 旋律垫（调内 7 音，怎么弹都不跑调） ──────────
  let melodyOctave = 0;
  const padRow = h('div', { class: 'mw-pad' });
  const padOctaveLabel = h('span', { class: 'text-sm font-semibold' });

  function flashPadKey(deg: number): void {
    const key = padRow.querySelector(`[data-pad-deg="${deg}"]`);
    if (!key) return;
    key.classList.add('mw-pad-key--held');
    setTimeout(() => key.classList.remove('mw-pad-key--held'), 240);
  }

  function strikeMelody(deg: number, octave: number, durBeats = 1, at?: number): void {
    const midi = melodyMidi(deg, octave);
    if (midi === null) return;
    synth.strike(midi, { time: at, vel: 0.65, dur: durBeats * beatDur() });
  }

  function refreshMelodyPad(): void {
    const t = table();
    const flatName = flat();
    padOctaveLabel.textContent = `旋律八度 ${melodyOctave > 0 ? '+' : ''}${melodyOctave}`;
    padRow.querySelectorAll<HTMLElement>('.mw-pad-key').forEach((key, deg) => {
      const noteName = pcName(t.pcSet[deg]!, flatName);
      key.innerHTML = '';
      key.append(
        document.createTextNode(noteName),
        h('small', { textContent: t.degrees[deg]!.label }),
      );
    });
  }

  MODE_MAP.get(state.modeId)!.offsets.forEach((_, deg) => {
    const key = h('button', {
      class: 'mw-pad-key',
      type: 'button',
      'data-pad-deg': String(deg),
    });
    key.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      strikeMelody(deg, melodyOctave, 1.5);
      key.classList.add('mw-pad-key--held');
      fillMelodyAtSelection(deg, melodyOctave);
    });
    const release = () => {
      key.classList.remove('mw-pad-key--held');
    };
    key.addEventListener('pointerup', release);
    key.addEventListener('pointercancel', release);
    key.addEventListener('pointerleave', release);
    padRow.append(key);
  });

  const melodyPad = h('div', { class: 'mt-3 pt-3 border-t border-[var(--border)]' }, [
    h('div', { class: 'flex items-center justify-between mb-2' }, [
      h('span', { class: 'text-xs text-[var(--fg-muted)]' }, [
        '旋律垫 · 调内音 · 键盘 A–J 弹奏，Z/X 移八度 · 细分格连按=格内音序',
      ]),
      h('div', { class: 'flex items-center gap-1' }, [
        h('button', {
          class: 'mw-chip',
          type: 'button',
          textContent: '−8ve',
          onclick: () => {
            melodyOctave = Math.max(-1, melodyOctave - 1);
            refreshMelodyPad();
          },
        }),
        padOctaveLabel,
        h('button', {
          class: 'mw-chip',
          type: 'button',
          textContent: '+8ve',
          onclick: () => {
            melodyOctave = Math.min(1, melodyOctave + 1);
            refreshMelodyPad();
          },
        }),
      ]),
    ]),
    padRow,
  ]);

  // ────────── Looper 编排面板（FL 式步进网格） ──────────
  const loopHint = h('span', { class: 'text-xs text-[var(--fg-muted)]' });
  const loopBtnPlay = h('button', {
    class: 'mw-chip',
    type: 'button',
    onclick: () => (loopPlaying ? stopLoop() : startLoop()),
  });
  const loopLenChips = h('div', { class: 'flex gap-1.5' });
  ([4, 8, 16] as const).forEach((beats) => {
    loopLenChips.append(
      h('button', {
        class: 'mw-chip',
        type: 'button',
        textContent: `${beats} 拍`,
        'data-loop-beats': String(beats),
        onclick: () => {
          store.loopBeats = beats;
          selected = null;
          persistLoop();
          if (loopPlaying) {
            stopLoop();
            startLoop();
          }
          refreshLoopPanel();
        },
      }),
    );
  });
  const metroChip = h('button', {
    class: 'mw-chip',
    type: 'button',
    onclick: () => {
      metronomeOn = !metronomeOn;
      refreshLoopPanel();
    },
  });
  const registerChip = h('button', {
    class: 'mw-chip',
    type: 'button',
    onclick: () => {
      fillRegister = fillRegister === 'low' ? 'high' : 'low';
      refreshLoopPanel();
    },
  });
  /** 时值 chips：每格独立——选中哪格就显示/修改哪格的时值（<1 细分装多个音，>1 单音延音） */
  const lenChips = h('div', { class: 'flex gap-1.5' });
  TV_OPTIONS.forEach((tv, i) => {
    lenChips.append(
      h('button', {
        class: 'mw-chip',
        type: 'button',
        textContent: TV_LABELS[i],
        'data-len': String(tv),
        title: '选中格的时值：1/2=这一拍装 2 个音，2拍=单音延音两拍（数字键 1-7，每格独立）',
        onclick: () => applyTv(tv),
      }),
    );
  });
  // ── MIDI 键盘输入（渐进增强：不支持的浏览器禁用入口） ──
  const midiSupported = 'requestMIDIAccess' in navigator;
  let midiAccess: MIDIAccess | null = null;
  let midiOn = false;
  const midiChip = h('button', {
    class: 'mw-chip',
    type: 'button',
    disabled: !midiSupported,
    title: midiSupported
      ? '连接 MIDI 键盘：琴键自动吸附到调内音，等同旋律垫'
      : '此浏览器不支持 Web MIDI（Chrome / Edge 可用）',
    onclick: () => void toggleMidi(),
  });

  function onMidiMessage(ev: MIDIMessageEvent): void {
    const data = ev.data;
    if (!data || data.length < 3) return;
    const [status, note, vel] = data;
    // 只收 Note On（力度 0 按惯例视为 Note Off）
    if ((status! & 0xf0) !== 0x90 || vel! === 0) return;
    const mapped = midiToDegree(MODE_MAP.get(state.modeId)!, state.keyPc, note!);
    if (!mapped) return;
    playMelodyKey(mapped.deg, mapped.octave);
  }

  function attachMidiInputs(): void {
    midiAccess?.inputs.forEach((input) => {
      input.onmidimessage = onMidiMessage;
    });
  }

  async function toggleMidi(): Promise<void> {
    if (midiOn) {
      midiOn = false;
      midiAccess?.inputs.forEach((input) => (input.onmidimessage = null));
      refreshLoopPanel();
      return;
    }
    try {
      midiAccess = await navigator.requestMIDIAccess();
      midiOn = true;
      attachMidiInputs();
      midiAccess.onstatechange = attachMidiInputs;
      flashLoopHint('MIDI 已连接——弹琴键即可，音会吸附到当前调式');
    } catch {
      midiAccess = null;
      flashLoopHint('MIDI 授权被拒绝——可在浏览器设置里放行后重试');
    }
    refreshLoopPanel();
  }
  const exportBtn = h('button', {
    class: 'mw-chip',
    type: 'button',
    textContent: '🎼 导出 MIDI',
    onclick: () => exportMidi(),
  });

  let loopHintTimer: ReturnType<typeof setTimeout> | null = null;
  function flashLoopHint(text: string): void {
    loopHint.textContent = text;
    if (loopHintTimer) clearTimeout(loopHintTimer);
    loopHintTimer = setTimeout(() => (loopHint.textContent = ''), 2400);
  }

  // ── 调色板：级数（点=填入选中格，拖=放到格子；和弦名即"和弦名称"） ──
  const paletteRow = h('div', { class: 'mw-palette' });

  function chordLabel(d: number, alt: boolean): string {
    const chord = resolveStep(table(), { d, alt });
    if (!chord) return '–';
    return `${chord.numeral} ${chordSymbol(chord)}`;
  }

  function refreshPalette(): void {
    const t = table();
    paletteRow.replaceChildren();
    for (const degree of t.degrees) {
      const hasChord = degree.chords.length > 0;
      const btn = h('button', {
        class: 'mw-chip',
        type: 'button',
        disabled: !hasChord,
        draggable: hasChord,
        textContent: hasChord ? chordLabel(degree.index, false) : '–',
        title: hasChord ? '点击=预听；有选中格时同时填入 · 也可拖到格子' : '该级在当前调式无和弦',
        onclick: () => fillChordAtSelection(degree.index, false),
      });
      if (!hasChord) btn.style.opacity = '0.4';
      else {
        btn.addEventListener('dragstart', (ev) => {
          (ev as DragEvent).dataTransfer?.setData(
            'text/plain',
            JSON.stringify({ type: 'chord', d: degree.index }),
          );
        });
      }
      paletteRow.append(btn);
    }
    // 备用和弦（有则出现）
    t.degrees.forEach((degree) => {
      if (!degree.chords.some((c) => !c.primary)) return;
      const btn = h('button', {
        class: 'mw-chip',
        type: 'button',
        draggable: true,
        textContent: chordLabel(degree.index, true),
        title: '备用和弦：点击=预听；有选中格时同时填入 · 也可拖到格子',
        onclick: () => fillChordAtSelection(degree.index, true),
      });
      btn.addEventListener('dragstart', (ev) => {
        (ev as DragEvent).dataTransfer?.setData(
          'text/plain',
          JSON.stringify({ type: 'chord', d: degree.index, alt: true }),
        );
      });
      paletteRow.append(btn);
    });
  }

  /** 写入选中格并把编排光标推进到下一格（层内从左到右）；stay = 长格留在原地等连按 */
  function fillAndAdvance(
    layerId: number,
    cell: number,
    event: LoopEvent | null,
    stay = false,
  ): void {
    if (!store.setCell(layerId, cell, event)) return;
    persistLoop();
    const layer = store.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const next = cell + 1;
    selected = stay || next >= store.totalCells ? { layerId, cell } : { layerId, cell: next };
    refreshLoopPanel();
  }

  function fillChordAtSelection(d: number, alt: boolean): void {
    const chord = resolveStep(table(), { d, alt });
    if (!chord) return;
    // 点即预听（高把位，和循环的低把位区分开）；能否填入再看选中格
    strikeChord(chord, 'high', null);
    wheel.flash(d);
    if (!selected) return flashLoopHint('先点选一个格子（和弦层），再点这里的和弦填入');
    const layer = store.layers.find((l) => l.id === selected!.layerId);
    if (!layer) return;
    if (layer.kind !== 'chord')
      return flashLoopHint('这是旋律层——和弦请填到和弦层，音符用下方旋律垫');
    const cur = store.eventAtCell(layer.id, selected.cell);
    const tv = store.cellTv(layer.id, selected.cell);
    if (cur && cur.kind === 'chord') {
      const cap = tvCapacity(tv);
      if (subCount(cur) < cap) {
        // 细分格连按 = 往这一拍里追加（格内均分依次发声）
        const updated: LoopEvent = {
          ...cur,
          extra: [...(cur.extra ?? []), { d, alt: alt || undefined }],
        };
        store.setCell(layer.id, selected.cell, updated);
        persistLoop();
        refreshLoopPanel();
        flashLoopHint(`格内序列 ${subCount(updated)}/${cap}——继续点级数再加，点满自动前进`);
        return;
      }
      // 满了：跳到本格时值后面的格子继续填
      const next = Math.min(
        LooperStore.cellOfBeat(cur.beat + (cur.len ?? DEFAULT_EVENT_LEN.chord)),
        store.totalCells - 1,
      );
      if (next !== selected.cell) selected = { layerId: layer.id, cell: next };
    }
    const cap = tvCapacity(tv);
    const len = tv >= 1 ? tv : 1; // 细分格事件占本格一拍；延音格事件长 tv 拍
    fillAndAdvance(
      selected.layerId,
      selected.cell,
      { kind: 'chord', d, alt: alt || undefined, register: fillRegister, beat: 0, len },
      cap > 1,
    );
    if (cap > 1) flashLoopHint(`这一格（时值 ${tv}）可装 ${cap} 个和弦——继续点级数往里装`);
  }

  function fillMelodyAtSelection(deg: number, octave: number): boolean {
    if (!selected) return false;
    const layer = store.layers.find((l) => l.id === selected!.layerId);
    if (!layer || layer.kind !== 'melody') return false;
    const cur = store.eventAtCell(layer.id, selected.cell);
    const tv = store.cellTv(layer.id, selected.cell);
    if (cur && cur.kind === 'melody') {
      const cap = tvCapacity(tv);
      if (subCount(cur) < cap) {
        const updated: LoopEvent = { ...cur, extra: [...(cur.extra ?? []), { deg, octave }] };
        store.setCell(layer.id, selected.cell, updated);
        persistLoop();
        refreshLoopPanel();
        flashLoopHint(`格内序列 ${subCount(updated)}/${cap}——继续弹可再加，点满自动前进`);
        return true;
      }
      const next = Math.min(LooperStore.cellOfBeat(cur.beat + cur.len), store.totalCells - 1);
      if (next !== selected.cell) selected = { layerId: layer.id, cell: next };
    }
    const cap = tvCapacity(tv);
    const len = tv >= 1 ? tv : 1;
    fillAndAdvance(
      selected.layerId,
      selected.cell,
      { kind: 'melody', deg, octave, beat: 0, len },
      cap > 1,
    );
    if (cap > 1) flashLoopHint(`这一格（时值 ${tv}）可装 ${cap} 个音——继续弹往里装`);
    return true;
  }

  /**
   * 设选中格的时值（每格独立，空格也生效并记忆）：
   * tv < 1 = 把这一拍细分成 1/tv 个音（已填格改占一拍，格内音保留、容量按新时值）；
   * tv > 1 = 单音延音 tv 拍（已填格只留第一个音，其余撤掉）；tv = 1 回缺省。
   */
  function applyTv(tv: number): void {
    if (!selected) return flashLoopHint('先选中一个格子，再调时值（数字键 1-7 也行）');
    const layer = store.layers.find((l) => l.id === selected!.layerId);
    if (!layer) return;
    const cell = selected.cell;
    store.setCellTv(layer.id, cell, tv);
    const ev = store.eventAtCell(layer.id, cell);
    if (ev) {
      const updated: LoopEvent = { ...ev, len: tv >= 1 ? tv : 1 };
      if (tv >= 1) delete updated.extra; // 延音格只留第一个音
      store.setCell(layer.id, cell, updated);
      previewCellEvent(updated);
      if (tv >= 1 && ev.extra?.length) flashLoopHint(`已改为延音 ${tv} 拍——格内只留第一个音`);
    }
    persistLoop();
    refreshLoopPanel();
  }

  /** 键盘编排：空格=留空前进；←→ 移动；Backspace/Delete 清空当前格；数字键 1-7 调时值 */
  function onGridKeydown(ev: KeyboardEvent): void {
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
    if (!selected) return;
    const layer = store.layers.find((l) => l.id === selected!.layerId);
    if (!layer) return;
    if (ev.key === ' ') {
      ev.preventDefault();
      fillAndAdvance(selected.layerId, selected.cell, null);
    } else if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
      ev.preventDefault();
      const delta = ev.key === 'ArrowRight' ? 1 : -1;
      const cell = Math.min(store.totalCells - 1, Math.max(0, selected.cell + delta));
      selected = { layerId: selected.layerId, cell };
      refreshLoopPanel();
    } else if (ev.key === 'Backspace' || ev.key === 'Delete') {
      ev.preventDefault();
      const cur = store.eventAtCell(layer.id, selected.cell);
      if (cur?.extra?.length) {
        // 格内序列：先逐个撤最后装入的音，再按一次才清空整格
        const updated: LoopEvent =
          cur.kind === 'chord'
            ? { ...cur, extra: cur.extra.slice(0, -1) }
            : { ...cur, extra: cur.extra.slice(0, -1) };
        store.setCell(layer.id, selected.cell, updated);
        flashLoopHint('撤掉格内最后一个；再按一次清空整格');
      } else {
        store.setCell(selected.layerId, selected.cell, null);
      }
      persistLoop();
      refreshLoopPanel();
    } else if (/^[1-7]$/.test(ev.key)) {
      const tv = TV_OPTIONS[Number(ev.key) - 1];
      if (tv !== undefined) {
        ev.preventDefault();
        applyTv(tv);
      }
    }
  }
  window.addEventListener('keydown', onGridKeydown);

  /** 弹一个旋律音：发声 + 垫子闪光；选中旋律格时同时填入（MIDI 与电脑键盘共用） */
  function playMelodyKey(deg: number, octave = melodyOctave): void {
    strikeMelody(deg, octave, 1.5);
    flashPadKey(deg);
    fillMelodyAtSelection(deg, octave);
  }

  /** 旋律键盘：A S D F G H J = 调内 1-7 级音，Z/X 移八度（无选中格时仅试奏） */
  function onMelodyKeydown(ev: KeyboardEvent): void {
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.repeat) return;
    const key = ev.key.toLowerCase();
    if (key === 'z' || key === 'x') {
      melodyOctave = key === 'z' ? Math.max(-1, melodyOctave - 1) : Math.min(1, melodyOctave + 1);
      refreshMelodyPad();
      return;
    }
    const deg = MELODY_KEYS[key];
    if (deg === undefined) return;
    playMelodyKey(deg);
  }
  window.addEventListener('keydown', onMelodyKeydown);

  // ── 网格渲染 ──
  const gridWrap = h('div', { class: 'mw-grid', style: `--cells:${store.totalCells}` });

  function cellContent(layer: LoopLayer, cell: number): string {
    const ev = store.eventAtCell(layer.id, cell);
    if (!ev) return '';
    const labels =
      ev.kind === 'chord'
        ? [{ d: ev.d, alt: ev.alt }, ...(ev.extra ?? [])].map(
            (c) => resolveStep(table(), c)?.numeral ?? '·',
          )
        : [{ deg: ev.deg, octave: ev.octave }, ...(ev.extra ?? [])].map(
            (n) => table().degrees[n.deg]?.label ?? '·',
          );
    // 细分最多 16 个音：超 4 个时省略中段，只显示前 3 个 + 总数
    return labels.length <= 4
      ? labels.join('·')
      : `${labels.slice(0, 3).join('·')}·×${labels.length}`;
  }

  function highlightPlayCell(cell: number): void {
    gridWrap.querySelectorAll('.mw-cell--playing').forEach((el) => {
      el.classList.remove('mw-cell--playing');
    });
    if (cell < 0) return;
    gridWrap.querySelectorAll(`[data-cell="${cell}"]`).forEach((el) => {
      el.classList.add('mw-cell--playing');
    });
  }

  /** 只更新选中高亮、不重排 DOM（双击清空依赖同一元素连续接收点击） */
  function updateCellSelection(): void {
    gridWrap.querySelectorAll<HTMLElement>('.mw-cell').forEach((el) => {
      const isSel =
        selected !== null &&
        el.dataset.layerId === String(selected.layerId) &&
        el.dataset.cell === String(selected.cell);
      el.classList.toggle('mw-cell--selected', isSel);
    });
  }

  /** 时值 chips 跟随选中格，原地切换不重排（点选格子不触发 refreshLoopPanel，必须单独刷） */
  function updateTvChips(): void {
    const selLayer = selected ? store.layers.find((l) => l.id === selected!.layerId) : undefined;
    const curTv = selLayer ? store.cellTv(selLayer.id, selected!.cell) : null;
    lenChips.querySelectorAll<HTMLElement>('.mw-chip').forEach((chip) => {
      chip.classList.toggle(
        'mw-chip--active',
        curTv !== null && Number(chip.dataset.len) === curTv,
      );
    });
  }

  /** 预听格子里已填的内容：单发原样发声；格内序列按均分顺序连播（长段压缩到至多 1 拍/段） */
  function previewCellEvent(ev: LoopEvent): void {
    let t = synth.ensure().currentTime + 0.03;
    if (ev.kind === 'chord') {
      for (const s of chordStrokes(ev)) {
        const chord = resolveStep(table(), { d: s.d, alt: s.alt });
        if (!chord) continue;
        strikeChord(chord, ev.register, null, t);
        t += Math.min(s.len, 1) * beatDur();
      }
      wheel.flash(ev.d);
    } else {
      for (const s of melodyStrokes(ev)) {
        strikeMelody(s.deg, s.octave, Math.min(s.len, 1), t);
        t += Math.min(s.len, 1) * beatDur();
      }
      flashPadKey(ev.deg);
    }
  }

  function refreshGrid(): void {
    gridWrap.style.setProperty('--cells', String(store.totalCells));
    gridWrap.replaceChildren();
    for (const layer of store.layers) {
      const head = h('div', { class: 'mw-grid-layer' }, [
        h('span', { class: 'mw-layer-name', textContent: layer.name }),
        h('button', {
          class: 'mw-layer-btn',
          type: 'button',
          textContent: layer.muted ? '🔇' : '🔊',
          title: layer.muted ? '取消静音' : '静音',
          onclick: () => {
            store.toggleMute(layer.id);
            persistLoop();
            refreshLoopPanel();
          },
        }),
        h('button', {
          class: 'mw-layer-btn',
          type: 'button',
          textContent: '✕',
          title: '删除这层',
          onclick: () => {
            if (selected?.layerId === layer.id) selected = null;
            store.removeLayer(layer.id);
            persistLoop();
            refreshLoopPanel();
          },
        }),
      ]);
      const cells = h('div', { class: 'mw-grid-cells' });
      // 长音延续格（纯视觉标记，格本身仍为空、可点选填入）
      const contCells = new Set<number>();
      for (const ev of layer.events) {
        const span = Math.max(
          1,
          Math.round((ev.len ?? DEFAULT_EVENT_LEN[layer.kind]) * STEPS_PER_BEAT),
        );
        const start = LooperStore.cellOfBeat(ev.beat);
        for (let k = start + 1; k < Math.min(start + span, store.totalCells); k++) {
          contCells.add(k);
        }
      }
      for (let cell = 0; cell < store.totalCells; cell++) {
        const isSelected = selected?.layerId === layer.id && selected.cell === cell;
        const cellEv = store.eventAtCell(layer.id, cell);
        const filled = cellEv !== null;
        const isCont = !filled && contCells.has(cell);
        const tv = store.cellTv(layer.id, cell);
        const tvLabel = TV_LABELS[TV_OPTIONS.indexOf(tv as (typeof TV_OPTIONS)[number])];
        const cellEl = h('button', {
          class: [
            'mw-cell',
            filled ? `mw-cell--filled mw-cell--${layer.kind}` : '',
            filled && subCount(cellEv) > 1 ? 'mw-cell--seq' : '',
            isCont ? `mw-cell--cont mw-cell--cont-${layer.kind}` : '',
            isSelected ? 'mw-cell--selected' : '',
            playCell === cell ? 'mw-cell--playing' : '',
          ]
            .filter(Boolean)
            .join(' '),
          type: 'button',
          'data-layer-id': String(layer.id),
          'data-cell': String(cell),
          'data-tv': tv !== 1 && tvLabel ? tvLabel : null,
          textContent: cellContent(layer, cell),
          title: filled
            ? `点击=选中并预听 · 时值 ${tvLabel ?? tv}${tv < 1 ? '（连按级数/音垫=格内追加）' : '（延音）'} · 双击=清空 · 数字键 1-7=时值`
            : isCont
              ? '延音覆盖格（可点选填入新内容）'
              : `点击选中（时值 ${tvLabel ?? tv}），然后点级数/旋律垫填入；空格留空前进`,
          onclick: () => {
            selected = { layerId: layer.id, cell };
            updateCellSelection();
            updateTvChips();
            // 点已填的格子 = 预听其中的内容
            const ev = store.eventAtCell(layer.id, cell);
            if (ev) previewCellEvent(ev);
          },
          ondblclick: () => {
            // 双击已填格 = 清空（单击留给预听）
            if (store.eventAtCell(layer.id, cell) === null) return;
            store.setCell(layer.id, cell, null);
            persistLoop();
            refreshLoopPanel();
          },
        });
        cellEl.addEventListener('dragover', (ev) => {
          ev.preventDefault();
          cellEl.classList.add('mw-cell--drop');
        });
        cellEl.addEventListener('dragleave', () => cellEl.classList.remove('mw-cell--drop'));
        cellEl.addEventListener('drop', (ev) => {
          ev.preventDefault();
          cellEl.classList.remove('mw-cell--drop');
          try {
            const payload = JSON.parse(
              (ev as DragEvent).dataTransfer?.getData('text/plain') ?? '{}',
            ) as { type?: string; d?: number; alt?: boolean };
            if (payload.type !== 'chord' || typeof payload.d !== 'number') return;
            if (layer.kind !== 'chord') {
              flashLoopHint('这是旋律层——和弦请放到和弦层');
              return;
            }
            const chord = resolveStep(table(), { d: payload.d, alt: payload.alt });
            if (!chord) return;
            const dropTv = store.cellTv(layer.id, cell);
            fillAndAdvance(layer.id, cell, {
              kind: 'chord',
              d: payload.d,
              alt: payload.alt || undefined,
              register: fillRegister,
              beat: 0,
              len: dropTv >= 1 ? dropTv : 1,
            });
            strikeChord(chord, 'high', null);
            wheel.flash(payload.d);
          } catch {
            // 非法拖拽数据忽略
          }
        });
        cells.append(cellEl);
      }
      gridWrap.append(head, cells);
    }
    if (store.layers.length === 0) {
      gridWrap.append(
        h('div', {
          class: 'text-xs text-[var(--fg-muted)] py-1',
          style: 'grid-column: 1 / -1',
          textContent:
            '还没有层。先「+ 和弦层」或「+ 旋律层」，然后：点格子选中 → 点级数/旋律垫/键盘 A–J 填入（自动前进）；一格 = 一拍，每格时值独立（数字键 1-7）：1/2 = 这一拍连按装 2 个音、1/4 装 4 个，2拍/4拍 = 单音延音；Backspace 先撤格内音再清空；点已填格子 = 预听，双击 = 清空；也可以把和弦直接拖到格子上。',
        }),
      );
    }
  }

  function addLayer(kind: 'chord' | 'melody'): void {
    const layer = store.addLayer(kind);
    if (!layer) return flashLoopHint('层数已满（8 层），先删一层');
    persistLoop();
    selected = { layerId: layer.id, cell: 0 };
    refreshLoopPanel();
  }

  function refreshLoopPanel(): void {
    loopBtnPlay.textContent = loopPlaying ? '■ 停止' : '▶ 播放';
    loopLenChips.querySelectorAll<HTMLElement>('.mw-chip').forEach((chip) => {
      chip.classList.toggle('mw-chip--active', chip.dataset.loopBeats === String(store.loopBeats));
    });
    metroChip.textContent = `节拍器：${metronomeOn ? '开' : '关'}`;
    metroChip.classList.toggle('mw-chip--active', metronomeOn);
    registerChip.textContent = `把位：${fillRegister === 'low' ? '低' : '高'}`;
    registerChip.classList.toggle('mw-chip--active', fillRegister === 'high');
    // 时值 chips：跟随选中格的时值（每格独立，空格也有自己的设置，缺省 1）
    updateTvChips();
    midiChip.textContent = midiSupported ? `🎹 MIDI：${midiOn ? '开' : '关'}` : '🎹 MIDI 不可用';
    midiChip.classList.toggle('mw-chip--active', midiOn);
    refreshPalette();
    refreshGrid();
  }

  const looperPanel = h(
    'section',
    { class: 'mt-5 rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4' },
    [
      h('div', { class: 'flex flex-wrap items-center gap-x-4 gap-y-2' }, [
        h('span', { class: 'text-sm font-semibold' }, ['循环编排']),
        h('div', { class: 'flex gap-1.5' }, [
          h('button', {
            class: 'mw-chip',
            type: 'button',
            textContent: '+ 和弦层',
            onclick: () => addLayer('chord'),
          }),
          h('button', {
            class: 'mw-chip',
            type: 'button',
            textContent: '+ 旋律层',
            onclick: () => addLayer('melody'),
          }),
        ]),
        loopBtnPlay,
        h('div', { class: 'flex items-center gap-2' }, [
          h('span', { class: 'text-xs text-[var(--fg-muted)]' }, ['循环']),
          loopLenChips,
        ]),
        registerChip,
        h('div', { class: 'flex items-center gap-2' }, [
          h('span', { class: 'text-xs text-[var(--fg-muted)]' }, ['时值']),
          lenChips,
        ]),
        metroChip,
        midiChip,
        h('div', { class: 'flex-1' }),
        exportBtn,
      ]),
      h('div', { class: 'mt-3' }, [
        h('div', { class: 'text-xs text-[var(--fg-muted)] mb-1.5' }, [
          '级数 → 点=预听/填入选中格 · 细分格连点=格内进行 · 拖到格子也可',
        ]),
        paletteRow,
      ]),
      h('div', { class: 'mt-3' }, [gridWrap]),
      h('div', { class: 'mt-2' }, [loopHint]),
    ],
  );

  // ────────── MIDI 导出 ──────────
  function chordToMidiNotes(
    chord: DegreeChord,
    register: Register,
    beat: number,
    lenBeats: number,
  ): MidiNote[] {
    const { bass, tones } = voiceChord(chord, register, null);
    return [
      { midi: bass, beat, len: lenBeats, vel: 76 },
      ...tones.map((midi, i) => ({
        midi,
        beat: beat + 0.012 * (i + 1),
        len: lenBeats,
        vel: 88,
      })),
    ];
  }

  function exportMidi(): void {
    const bpm = state.bpm;
    const tracks: MidiTrackInput[] = [];
    let stem = 'loop';

    if (store.audibleEvents() > 0) {
      // 循环内容：和弦一轨、旋律一轨，导出一遍循环
      const chordNotes: MidiNote[] = [];
      const melodyNotes: MidiNote[] = [];
      for (const layer of store.layers) {
        if (layer.muted) continue;
        for (const ev of layer.events) {
          if (ev.kind === 'chord') {
            for (const s of chordStrokes(ev)) {
              const chord = resolveStep(table(), { d: s.d, alt: s.alt });
              if (!chord) continue;
              chordNotes.push(...chordToMidiNotes(chord, ev.register, s.at, s.len));
            }
          } else {
            for (const s of melodyStrokes(ev)) {
              const midi = melodyMidi(s.deg, s.octave);
              if (midi !== null) {
                melodyNotes.push({ midi, beat: s.at, len: s.len, vel: 92 });
              }
            }
          }
        }
      }
      if (chordNotes.length > 0) tracks.push({ name: 'chords', channel: 0, notes: chordNotes });
      if (melodyNotes.length > 0) tracks.push({ name: 'melody', channel: 1, notes: melodyNotes });
    } else if (state.customSteps.length > 0) {
      // 没录循环时导出"我的进行"
      stem = 'progression';
      const notes: MidiNote[] = [];
      let prev: number[] | null = null;
      state.customSteps.forEach((step, i) => {
        const chord = resolveStep(table(), step);
        if (!chord) return;
        const { bass, tones } = voiceChord(chord, 'low', prev);
        prev = tones;
        const beat = i * state.beatsPerChord;
        const len = state.beatsPerChord * 0.92;
        notes.push({ midi: bass, beat, len, vel: 76 });
        tones.forEach((midi, j) => {
          notes.push({ midi, beat: beat + 0.012 * (j + 1), len, vel: 88 });
        });
      });
      if (notes.length > 0) tracks.push({ name: 'progression', channel: 0, notes });
    }

    if (tracks.length === 0) {
      return flashLoopHint('还没有可导出的内容——录一段循环，或先在"我的进行"里编一条');
    }
    const keyName = pcName(state.keyPc, flat()).replace('#', 's');
    const bytes = writeSmf(tracks, bpm);
    downloadBlob(
      new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/midi' }),
      `mode-wheel-${keyName}-${state.modeId}-${stem}.mid`,
    );
    flashLoopHint('已导出 .mid，可直接拖进 DAW 继续创作');
  }

  // ────────── 进行处方卡 ──────────
  const progList = h('div', { class: 'space-y-2' });

  function refreshProgCards(): void {
    const t = table();
    progList.replaceChildren();
    for (const prog of MODE_PROGS[state.modeId] ?? []) {
      const active = cruiseSourceId === prog.id;
      const card = h(
        'button',
        {
          class: `mw-prog ${active ? 'mw-prog--active' : ''}`,
          type: 'button',
          onclick: () => (active ? stopCruise() : startCruise(prog.steps, prog.id)),
        },
        [
          h('div', { class: 'flex items-center justify-between gap-2' }, [
            h('span', { class: 'mw-prog-name', textContent: `${prog.icon} ${prog.name}` }),
            h('span', { class: 'text-xs', textContent: active ? '⏸ 停止' : '▶ 巡航' }),
          ]),
          h('div', { class: 'mw-prog-steps', textContent: progPreview(t, prog) }),
          h('div', { class: 'mw-prog-desc', textContent: prog.desc }),
        ],
      );
      progList.append(card);
    }
    refreshSequencer();
  }

  // ────────── 整体刷新 ──────────
  const keyLabel = h('div', { class: 'text-sm font-semibold mt-4 mb-2 text-[var(--fg-muted)]' });

  function refreshAll(): void {
    const m = MODE_MAP.get(state.modeId)!;
    flavorLine.textContent = m.flavor;
    keyLabel.textContent = `调（1 = ${pcName(state.keyPc, flat())}）`;
    modeChips.querySelectorAll<HTMLElement>('.mw-chip').forEach((chip) => {
      chip.classList.toggle('mw-chip--active', chip.dataset.modeId === state.modeId);
    });
    keyChips.querySelectorAll<HTMLElement>('.mw-chip').forEach((chip) => {
      chip.classList.toggle('mw-chip--active', Number(chip.dataset.keyPc) === state.keyPc);
    });
    renderStrip();
    refreshTransport();
    wheel.render(table(), flat());
    refreshProgCards();
    refreshCruiseStatus();
    refreshMelodyPad();
    refreshLoopPanel();
    if (!cruising()) showIdle();
  }

  // ────────── 组装页面 ──────────
  const legend = h(
    'div',
    { class: 'flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--fg-muted)]' },
    [
      h('span', {}, [h('i', { class: 'mw-legend-dot', style: 'background:#c4b5fd' }), '主和弦']),
      h('span', {}, [
        h('i', { class: 'mw-legend-dot', style: 'background:#fdba74' }),
        '共同音多 · 近',
      ]),
      h('span', {}, [
        h('i', { class: 'mw-legend-dot', style: 'background:#93c5fd' }),
        '共同音 1 个',
      ]),
      h('span', {}, [
        h('i', { class: 'mw-legend-dot', style: 'background:#f0abfc' }),
        '无共同音 · 远',
      ]),
      h('span', {}, [
        h('i', { class: 'mw-legend-dot', style: 'background:#cbd5e1' }),
        '调外 / 无和弦',
      ]),
    ],
  );

  content.append(
    h('section', { class: 'mb-5' }, [
      h('div', { class: 'text-sm font-semibold mb-2 text-[var(--fg-muted)]' }, ['调式']),
      modeChips,
      flavorLine,
      keyLabel,
      keyChips,
      strip,
    ]),
    h('div', { class: 'grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px] items-start' }, [
      h('div', { class: 'rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3' }, [
        wheel.el,
        melodyPad,
      ]),
      h('aside', { class: 'space-y-4' }, [
        readout,
        transport,
        h('div', {}, [
          h('div', { class: 'text-sm font-semibold mb-2 text-[var(--fg-muted)]' }, ['我的进行']),
          h('div', { class: 'space-y-2' }, [
            degreeAddRow,
            h('div', { class: 'flex items-center gap-2' }, [altToggle]),
            seqRow,
            h('div', { class: 'flex gap-2' }, [seqPlayBtn, seqClearBtn, shareBtn]),
          ]),
        ]),
        h('div', {}, [
          h('div', { class: 'text-sm font-semibold mb-2 text-[var(--fg-muted)]' }, ['招牌进行']),
          progList,
        ]),
      ]),
    ]),
    looperPanel,
    h('footer', { class: 'mt-5 space-y-2' }, [
      legend,
      h('p', { class: 'text-xs text-[var(--fg-muted)] leading-relaxed' }, [
        '手势：点扇区 = 弹该级和弦；点环的内半圈 = 低把位、外半圈 = 高把位；点进行卡 = 自动巡航（红色箭头指向当前和弦）；巡航中切调式 = 同一段级数实时变形。键盘 A–J = 弹旋律（Z/X 移八度）。编排格一格 = 一拍，每格时值独立（选中后数字键 1–7）：1/2、1/4 = 这一拍装 2、4 个音均分播放（连按装入，Backspace 逐个撤），2拍/4拍 = 单音延音；MIDI 键盘即接即弹，音自动吸附到调内。Tab + Enter 也可弹奏。',
      ]),
    ]),
  );

  // 页面已打开时再粘贴新分享链接：hash 变化不触发整页刷新，监听后同样生效
  window.addEventListener('hashchange', () => {
    applyHash(state);
    refreshAll();
  });

  refreshAll();
}

renderWheel();
