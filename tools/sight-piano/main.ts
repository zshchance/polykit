import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { PianoSynth } from './engine/synth';
import { BeatScheduler } from './engine/scheduler';
import { MidiBridge } from './engine/midi';
import { createKeyboard } from './ui/keyboard';
import { createMinimap } from './ui/minimap';
import { createScoreView } from './ui/scoreview';
import { createSongRack, type SongCardItem } from './ui/songrack';
import { injectSightStyles } from './ui/styles';
import {
  JudgeSession,
  accuracyOf,
  scoreRange,
  starsOf,
  STAGE_LABEL,
  type Score,
  type Stage,
} from './score';
import {
  keyDisplayName,
  midiName,
  pcName,
  pcOf,
  spelledName,
  spellInKey,
  TONALITY_LABEL,
} from './theory';
import { BUILTIN_SONGS, type BuiltinSong } from './data/songs';
import { RHYTHM_MAP, RHYTHM_STYLES } from './data/rhythms';
import { importSheet } from './parsers';
import {
  loadState,
  saveState,
  clampWindow,
  pushImported,
  type LabState,
} from './settings';

initTheme();
injectSightStyles();

/**
 * 电脑键盘 → 相对 compBase 的半音偏移（标准 DAW 双排映射）：
 * 下排 Z 行 = 当前窗口的 C 起，上排 Q 行 = 高八度。
 */
const KEYMAP: Readonly<Record<string, number>> = {
  z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11,
  q: 12, '2': 13, w: 14, '3': 15, e: 16, r: 17, '5': 18, t: 19, '6': 20,
  y: 21, '7': 22, u: 23, i: 24, '9': 25, o: 26, '0': 27, p: 28,
};

/** 犹豫多久后给出加强提示（毫秒） */
const HESITATE_MS = 2600;

const STAGE_DESC: Record<Stage, { icon: string; title: string; desc: string }> = {
  read: {
    icon: '🎼',
    title: '识谱 · 五线谱认读',
    desc: '从中央 C 出发，跟着谱面弹单音。调号按 C→G→F→D→降B 逐个加码，练的是「看到音符就知道键在哪」。',
  },
  chord: {
    icon: '🎹',
    title: '和弦 · 走向进行',
    desc: '每小节一个和弦块，三个音一起按齐就点亮。1564、4536、卡农……感受经典走向的情绪走向。',
  },
  arp: {
    icon: '🌊',
    title: '琶音 · 伴奏织体',
    desc: '把和弦拆成流动的八分音符。弹对时贝斯和鼓会跟上你——这就是给歌配伴奏的感觉。',
  },
};

/** 谱面位置的人话描述（高音谱表，E4 为下一线） */
function staffPositionName(step: number): string {
  const d = step - 30; // E4 = 0
  if (d >= 0 && d <= 8) {
    return d % 2 === 0 ? `第 ${d / 2 + 1} 线` : `第 ${(d + 1) / 2} 间`;
  }
  if (d < 0) {
    const n = -d;
    return n % 2 === 0 ? `下加 ${n / 2} 线` : `下加 ${(n + 1) / 2} 间`;
  }
  const n = d - 8;
  return n % 2 === 0 ? `上加 ${n / 2} 线` : `上加 ${(n + 1) / 2} 间`;
}

function renderApp(): void {
  const { content } = renderToolLayout(document.getElementById('app')!, '识谱琴房');

  const state: LabState = loadState();
  const synth = new PianoSynth();
  synth.setVolume(state.volume);
  synth.setBandVolume(state.bandVolume);

  function persist(): void {
    saveState(state);
  }

  // ────────── 曲目登记（内置 + 导入，导入懒解析带缓存） ──────────
  const importCache = new Map<string, Score | null>();

  function importedScores(): { score: Score; tip: string }[] {
    const out: { score: Score; tip: string }[] = [];
    for (const s of state.imported) {
      let sc = importCache.get(s.id);
      if (sc === undefined) {
        try {
          const res =
            s.kind === 'midi'
              ? importSheet({ kind: 'midi', buf: base64ToBuf(s.data) }, s.id, 'read', s.title)
              : importSheet({ kind: 'text', text: s.data }, s.id, 'read', s.title);
          sc = res.score;
        } catch {
          sc = null;
        }
        importCache.set(s.id, sc);
      }
      if (sc) out.push({ score: sc, tip: `我的曲库 · ${s.format} 导入` });
    }
    return out;
  }

  function stageSongs(stage: Stage): { score: Score; tip: string }[] {
    const builtin: { score: Score; tip: string }[] = BUILTIN_SONGS[stage].map((s: BuiltinSong) => ({
      score: s.score,
      tip: s.tip,
    }));
    // 导入的谱面只进识谱阶段（旋律线）
    return stage === 'read' ? [...builtin, ...importedScores()] : builtin;
  }

  function findSong(id: string): { score: Score; tip: string } | null {
    for (const st of ['read', 'chord', 'arp'] as const) {
      const hit = stageSongs(st).find((s) => s.score.id === id);
      if (hit) return hit;
    }
    return null;
  }

  // ────────── 当前曲目与判定会话 ──────────
  let song: { score: Score; tip: string } | null = null;
  let session: JudgeSession | null = null;
  let hesitateTimer: ReturnType<typeof setTimeout> | null = null;
  /** 演奏模式：谱面播放头轮询 */
  let playTimer: ReturnType<typeof setInterval> | null = null;

  function currentBpm(): number {
    return state.bpm ?? song?.score.bpm ?? 96;
  }

  /** 选曲后窗口对齐到 C 起、且尽量装下整曲音域（装不下才居中，跟随接管） */
  function windowStartFor(range: { lo: number; hi: number }): number {
    const kc = state.keyCount;
    const desired = Math.round((range.lo + range.hi) / 2) - Math.floor(kc / 2);
    const down = desired - pcOf(desired);
    const cands = [down, down + 12, down - 12].map((s) => clampWindow(s, kc));
    const fits = cands.filter((s) => range.lo >= s && range.hi <= s + kc - 1);
    if (!fits.length) return clampWindow(desired, kc);
    return fits.reduce((a, b) => (Math.abs(a - desired) <= Math.abs(b - desired) ? a : b));
  }

  function selectSong(id: string, opts: { autopersist?: boolean } = {}): void {
    stopPlayhead();
    clearHesitate();
    doneOverlay.remove();
    const found = findSong(id);
    song = found;
    if (!found) return;
    state.songId[state.stage] = id;
    if (opts.autopersist !== false) persist();

    const score = found.score;
    session = new JudgeSession(score, score.stage === 'chord' ? 'chord' : 'exact');
    view.setScore(score);
    view.setPlayhead(null);

    // 窗口自动对齐到曲目音域（C 起）
    const range = scoreRange(score);
    if (range) {
      state.windowStart = windowStartFor(range);
      renderKeyboard();
    }
    bpmInput.value = String(currentBpm());
    refreshTarget();
    renderRack();
    updateReadoutIdle();
    syncBand({ restart: state.mode === 'play' });
  }

  // ────────── 按下集合（跟随按压 + 踏板） ──────────
  const holdCount = new Map<number, number>();
  const latched = new Set<number>();

  function isPressed(midi: number): boolean {
    return (holdCount.get(midi) ?? 0) > 0 || (state.pedalOn && latched.has(midi));
  }

  // ────────── 琴键与谱面 ──────────
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

  const view = createScoreView();

  function renderKeyboard(): void {
    rebuildKeyLabels();
    kbd.render(state.windowStart, state.keyCount);
    minimap.render(state.windowStart, state.keyCount);
    paintTarget();
  }

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

  // ────────── 音符进出（三路输入的汇合点） ──────────
  function noteOn(midi: number, vel: number): void {
    holdCount.set(midi, (holdCount.get(midi) ?? 0) + 1);
    latched.delete(midi);
    synth.noteOn(midi, vel);
    followWindow(midi);

    if (session && !session.stats().done) {
      const verdict = session.feedOn(midi);
      if (verdict.type === 'hit') {
        kbd.press(midi, 'linear-gradient(180deg, rgba(52,211,153,.95), rgba(21,128,61,.95))');
        view.setEventState(verdict.index, 'done');
        view.hitPop();
        refreshTarget();
        updateCombo();
        if (session.stats().done) onSongDone();
      } else if (verdict.type === 'miss') {
        kbd.press(midi, 'linear-gradient(180deg, rgba(248,113,113,.95), rgba(185,28,28,.95))');
        view.sparkle(midi);
        updateCombo();
      } else {
        kbd.press(midi, null);
      }
    } else {
      kbd.press(midi, null);
    }
    paintTarget();
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
    session?.feedOff(midi);
    kbd.release(midi);
    paintTarget();
  }

  function setPedal(on: boolean): void {
    if (state.pedalOn === on) return;
    state.pedalOn = on;
    synth.setPedal(on);
    if (!on) latched.clear();
    syncPedalBtn();
    persist();
  }

  function releaseAllNotes(): void {
    holdCount.clear();
    latched.clear();
    synth.releaseAll();
    const [lo, hi] = kbd.range();
    for (let m = lo; m <= hi; m++) kbd.release(m);
  }

  // ────────── 目标引导（琴键染色 + 谱面当前项 + 犹豫提示） ──────────
  function paintTarget(): void {
    kbd.clearGuide();
    const [lo, hi] = kbd.range();
    for (let m = lo; m <= hi; m++) {
      if (isPressed(m)) continue;
      kbd.release(m);
    }
    if (!session || !song) return;
    const ev = session.current();
    if (!ev) return;
    const guideColor = 'linear-gradient(180deg, rgba(251,191,36,.75), rgba(217,119,6,.75))';
    if (song.score.stage === 'chord') {
      const pcs = new Set(ev.midis.map(pcOf));
      const voiced = new Set(ev.midis);
      for (let m = lo; m <= hi; m++) {
        if (voiced.has(m)) kbd.setHint(m, guideColor);
        else if (pcs.has(pcOf(m))) kbd.setDots(m, ['#fbbf24']);
      }
    } else {
      const target = ev.midis[0];
      // 识谱/琶音练的就是「谱面这个音 = 琴键这个键」，只点亮精确八度
      if (target !== undefined && state.keyGuide && target >= lo && target <= hi) {
        kbd.setHint(target, guideColor);
      }
    }
  }

  function refreshTarget(): void {
    if (!session || !song) return;
    const idx = session.currentIndex();
    if (idx >= 0) view.setEventState(idx, 'current');
    const ev = session.current();
    // 目标不在窗口内时把窗口挪过去（识谱模式的音区跟随）
    if (ev && ev.midis.length) {
      const target = ev.midis[0]!;
      if (!kbd.contains(target)) {
        state.windowStart = clampWindow(target - Math.floor(state.keyCount / 2), state.keyCount);
        renderKeyboard();
        persist();
      }
    }
    paintTarget();
    clearHesitate();
    if (ev && state.mode === 'wait') {
      hesitateTimer = setTimeout(() => showHesitationHint(), HESITATE_MS);
    }
    updateTargetReadout();
  }

  function clearHesitate(): void {
    if (hesitateTimer) clearTimeout(hesitateTimer);
    hesitateTimer = null;
  }

  function showHesitationHint(): void {
    if (!session || !song) return;
    const ev = session.current();
    if (!ev) return;
    const [lo, hi] = kbd.range();
    if (song.score.stage === 'chord') {
      for (const m of ev.midis) {
        for (let k = Math.max(lo, m - 12); k <= Math.min(hi, m + 12); k++) {
          if (pcOf(k) === pcOf(m)) kbd.setHintStrong(k, true);
        }
      }
      readoutBig.textContent = `试着一起按下 ${ev.label ?? '这个和弦'}`;
      readoutSub.textContent = `${ev.midis.map(midiName).join(' + ')} · 金色的键都在等你`;
    } else {
      const target = ev.midis[0]!;
      if (target >= lo && target <= hi) kbd.setHintStrong(target, true);
      const sp = spellInKey(target, song.score.sig);
      readoutBig.textContent = `这个音是 ${spelledName(sp)}${sp.octave}，在谱面${staffPositionName(sp.step)}`;
      readoutSub.textContent = '看它在五线谱上的位置，再找琴键上对应的键——线间关系比数格子快。';
    }
  }

  // ────────── 读数区 ──────────
  const readoutBig = h('div', { class: 'sp-readout-big' });
  const readoutSub = h('div', { class: 'sp-readout-sub' });
  const comboN = h('div', { class: 'sp-combo-n', textContent: '0' });
  const comboBox = h('div', { class: 'sp-combo' }, [
    comboN,
    h('div', { class: 'sp-combo-label', textContent: '连击' }),
  ]);

  const ENCOURAGE = ['很好！', '稳！', '耳朵很灵', '就是这个音', '继续保持', '漂亮', '节奏不错'];

  function updateTargetReadout(): void {
    if (!session || !song) return;
    const st = session.stats();
    const ev = session.current();
    if (!ev) return;
    if (song.score.stage === 'chord') {
      readoutBig.textContent = `弹 ${ev.label ?? '这个和弦'}`;
      readoutSub.textContent = `${ev.midis.map(midiName).join(' + ')} · 一起按齐就过`;
    } else {
      const sp = spellInKey(ev.midis[0]!, song.score.sig);
      readoutBig.textContent = `${spelledName(sp)}${sp.octave} · 谱面${staffPositionName(sp.step)}`;
      readoutSub.textContent = `第 ${Math.floor(ev.beat / song.score.beatsPerBar) + 1} 小节 · ${
        st.progressed + 1
      }/${st.total} 音`;
    }
  }

  function updateReadoutIdle(): void {
    if (!song) {
      readoutBig.textContent = '随便弹，琴房听你自由发挥';
      readoutSub.textContent = '自由弹奏模式：从屏幕选一首曲子就开始有目标地练。';
      return;
    }
    readoutBig.textContent = `《${song.score.title}》准备好了`;
    readoutSub.textContent = song.tip;
    comboN.textContent = '0';
  }

  function updateCombo(): void {
    if (!session) return;
    const st = session.stats();
    comboN.textContent = String(st.combo);
    if (st.combo > 0 && st.combo % 5 === 0) {
      comboN.classList.remove('sp-combo-hot');
      void comboN.offsetWidth;
      comboN.classList.add('sp-combo-hot');
      readoutSub.textContent =
        st.combo >= 20 ? `🔥 ${st.combo} 连击！手已经热了` : `${ENCOURAGE[Math.floor(Math.random() * ENCOURAGE.length)]} ${st.combo} 连击`;
    }
  }

  // ────────── 曲终结算 ──────────
  const doneOverlay = h('div', { class: 'sp-done', style: 'display:none' });

  function onSongDone(): void {
    if (!session || !song) return;
    stopPlayhead();
    clearHesitate();
    const st = session.stats();
    const stars = starsOf(st);
    const acc = accuracyOf(st);
    const id = song.score.id;
    const prev = state.progress[id] ?? { stars: 0, bestAcc: 0, plays: 0 };
    state.progress[id] = {
      stars: Math.max(prev.stars, stars),
      bestAcc: Math.max(prev.bestAcc, acc),
      plays: prev.plays + 1,
    };
    persist();
    synth.tada(synth.currentTime + 0.05, 72);

    const starHtml = [1, 2, 3]
      .map(
        (i) =>
          `<span class="sp-done-star-pop" style="animation-delay:${(i - 1) * 0.14}s">${
            i <= stars ? '★' : '☆'
          }</span>`,
      )
      .join('');
    const msg =
      stars === 3
        ? '完美！视奏的架子已经搭起来了'
        : stars === 2
          ? '很稳！再磨一遍冲击满星'
          : '弹完了！错音没关系，再来一遍会更顺';
    doneOverlay.replaceChildren(
      h('div', { class: 'sp-done-stars', innerHTML: starHtml }),
      h('div', { style: 'font-size:14px;font-weight:700;color:#5b4a24', textContent: msg }),
      h('div', {
        style: 'font-size:11px;color:#8a7a52',
        textContent: `正确率 ${Math.round(acc * 100)}% · 最高连击 ${st.maxCombo} · 历史最好 ${'★'.repeat(state.progress[id]!.stars)}`,
      }),
      h('div', { style: 'display:flex;gap:8px;margin-top:6px' }, [
        overlayBtn('再来一遍', () => selectSong(id)),
        overlayBtn('下一首', () => {
          const list = stageSongs(state.stage);
          const idx = list.findIndex((s) => s.score.id === id);
          const next = list[(idx + 1) % list.length];
          if (next) selectSong(next.score.id);
        }),
        overlayBtn('收下成绩', () => doneOverlay.remove()),
      ]),
    );
    doneOverlay.style.display = '';
    view.el.append(doneOverlay);
    renderRack();
    renderPath();
  }

  function overlayBtn(label: string, onclick: () => void): HTMLButtonElement {
    const b = h('button', {
      type: 'button',
      class: 'sp-btn',
      textContent: label,
      onclick,
    });
    b.style.background = 'linear-gradient(180deg,#92600f,#6b430a)';
    b.style.color = '#fff3dd';
    return b;
  }

  // ────────── 伴奏（节拍器 + 鼓 + 贝斯） ──────────
  const scheduler = new BeatScheduler({
    getContext: () => synth.ensure(),
    onStep: (step, bar, time) => {
      schedulerBar = bar;
      scheduleBandStep(step, time);
    },
  });

  function rhythmStyle() {
    return RHYTHM_MAP.get(state.rhythmId) ?? RHYTHM_STYLES[0]!;
  }

  /** 把样式原生步数映射到当前曲目的每小节步数 */
  function mapSteps(steps: readonly number[] | undefined, from: number, to: number): number[] {
    if (!steps) return [];
    if (from === to) return [...steps];
    const scale = to / from;
    const out = new Set<number>();
    for (const s of steps) {
      const mapped = Math.round(s * scale);
      if (mapped < to) out.add(mapped);
    }
    return [...out];
  }

  /** 某拍点上生效的贝斯根音音高类（最近一个带 bassPc 的事件） */
  function bassPcAt(beat: number): number | null {
    if (!song) return null;
    let pc: number | null = null;
    for (const e of song.score.events) {
      if (e.beat > beat + 1e-6) break;
      if (e.bassPc !== undefined) pc = e.bassPc;
    }
    return pc;
  }

  function scheduleBandStep(step: number, time: number): void {
    const style = rhythmStyle();
    const spb = scheduler.stepsPerBar;
    const beats = step / 4;
    const scoreBeat = currentScoreBeat(step);
    const native = style.stepsPerBar;

    const kicks = mapSteps(style.kick, native, spb);
    const snares = mapSteps(style.snare, native, spb);
    const hats = mapSteps(style.hat, native, spb);
    const clicks = mapSteps(style.click, native, spb);
    const bassSteps = mapSteps(style.bassSteps, native, spb);

    if (kicks.includes(step)) synth.kick(time, step === 0 ? 1 : 0.85);
    if (snares.includes(step)) synth.snare(time, 0.9);
    if (hats.includes(step)) synth.hat(time, step % 4 === 0 ? 0.9 : 0.55);
    if (clicks.includes(step)) synth.click(time, step === 0);

    if (bassSteps.includes(step) && style.bassKind) {
      const pc = bassPcAt(scoreBeat ?? 0);
      if (pc !== null) {
        let note = 36 + pc; // C2 区
        if (style.bassKind === 'rootfive' && beats % 2 === 1) note += 7;
        if (style.bassKind === 'walk') {
          const walk = [0, 4, 7, 9][Math.floor(beats) % 4]!;
          note += walk;
        }
        synth.bass(time, note, (60 / scheduler.bpm) * 0.9, 0.75);
      }
    }

    // 节拍灯
    if (step % 4 === 0) {
      const delay = Math.max(0, (time - synth.currentTime) * 1000);
      setTimeout(() => flashBeatLamp(step === 0), delay);
    }
  }

  function flashBeatLamp(accent: boolean): void {
    beatLamp.className = 'sp-lamp sp-lamp-beat' + (accent ? ' sp-lamp-on' : '');
    setTimeout(() => {
      beatLamp.className = 'sp-lamp' + (scheduler.playing ? ' sp-lamp-on' : '');
    }, 110);
  }

  /** 谱面拍 → 演奏模式留一小节预备拍（wait 模式不偏移） */
  function currentScoreBeat(step: number): number | null {
    if (!song) return null;
    const raw = schedulerBar * song.score.beatsPerBar + step / 4;
    return state.mode === 'play' ? raw - song.score.beatsPerBar : raw;
  }

  let schedulerBar = 0;

  function syncBand(opts: { restart?: boolean } = {}): void {
    const style = rhythmStyle();
    const wantPlay = state.rhythmId !== 'off' || state.mode === 'play';
    scheduler.bpm = currentBpm();
    scheduler.swing = style.swing ?? 0;
    scheduler.stepsPerBar = (song?.score.beatsPerBar ?? 4) * 4;
    // 演奏模式换曲/进模式时重来：预备拍从小节 0 重新数
    if (opts.restart && scheduler.playing) scheduler.stop();
    if (wantPlay && !scheduler.playing) {
      schedulerBar = 0;
      scheduler.start();
    } else if (!wantPlay && scheduler.playing) {
      scheduler.stop();
      stopPlayhead();
    }
    // 幂等：只要演奏模式有曲就保证播放头轮询在跑
    startPlayheadIfNeeded();
    syncRhythmUI();
  }

  function startPlayheadIfNeeded(): void {
    if (state.mode !== 'play' || !song || playTimer) return;
    playTimer = setInterval(() => tickPlayhead(), 50);
  }

  function stopPlayhead(): void {
    if (playTimer) clearInterval(playTimer);
    playTimer = null;
    view.setPlayhead(null);
  }

  let countInAnnounced = -1;

  function tickPlayhead(): void {
    if (!scheduler.playing || !song || !session) return;
    const cur = scheduler.current();
    if (!cur) return;
    schedulerBar = cur.bar;
    const spb = song.score.beatsPerBar;
    const rawBeat = cur.bar * spb + cur.step / 4;
    const scoreBeat = rawBeat - spb; // 一小节预备拍

    if (scoreBeat < 0) {
      const count = Math.ceil(-scoreBeat);
      if (count !== countInAnnounced) {
        countInAnnounced = count;
        readoutBig.textContent = `预备 · ${count}`;
        readoutSub.textContent = '听着节拍器，准备起手';
      }
      view.setPlayhead(null);
      return;
    }
    countInAnnounced = -1;
    view.setPlayhead(scoreBeat);

    // 到点未命中 → 温柔放过（谱面染灰红，不断曲）
    let guard = 0;
    for (;;) {
      const ev = session.current();
      if (!ev) break;
      const deadline = ev.beat + ev.dur + 0.08;
      if (scoreBeat <= deadline || guard++ > 64) break;
      const idx = session.currentIndex();
      session.advanceMissed();
      view.setEventState(idx, 'passed');
      updateCombo();
      const nxt = session.currentIndex();
      if (nxt >= 0) view.setEventState(nxt, 'current');
    }

    if (session.stats().done) {
      onSongDone();
      return;
    }
    // 播到结尾兜底
    if (scoreBeat >= song.score.totalBeats + spb) {
      while (session.current()) session.advanceMissed();
      onSongDone();
    }
  }

  // ────────── 面板控件 ──────────
  function segButton(label: string, on: boolean, onclick: () => void, title?: string): HTMLButtonElement {
    return h('button', {
      type: 'button',
      class: 'sp-btn' + (on ? ' sp-btn-on' : ''),
      textContent: label,
      ...(title ? { title } : {}),
      onclick,
    });
  }

  const keyCountSeg = h('div', { class: 'sp-seg' });
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

  // 练习模式：跟弹（等待）/ 演奏（带伴奏按时间走）
  const modeSeg = h('div', { class: 'sp-seg' });
  function renderModeSeg(): void {
    modeSeg.replaceChildren(
      segButton('🎓 跟弹', state.mode === 'wait', () => setMode('wait'), '谱面等你弹对才往下走'),
      segButton('🎧 演奏', state.mode === 'play', () => setMode('play'), '伴奏按速度走，错过不等你（一小节预备拍）'),
    );
  }
  function setMode(m: 'wait' | 'play'): void {
    if (state.mode === m) return;
    state.mode = m;
    if (m === 'play' && state.rhythmId === 'off') state.rhythmId = 'metro';
    persist();
    renderModeSeg();
    if (song) selectSong(song.score.id, { autopersist: false });
  }

  // 节奏型
  const rhythmSelect = h('select', {
    class: 'sp-select',
    title: '节拍器 / 节奏型伴奏',
    onchange: () => {
      state.rhythmId = rhythmSelect.value;
      persist();
      syncBand();
    },
  }) as HTMLSelectElement;
  rhythmSelect.replaceChildren(
    ...RHYTHM_STYLES.map((r) => h('option', { value: r.id, textContent: r.name })),
  );

  // BPM
  const bpmInput = h('input', {
    class: 'sp-bpm',
    type: 'number',
    min: '40',
    max: '220',
    title: '速度（BPM）',
    onchange: () => {
      const v = Number(bpmInput.value);
      if (Number.isFinite(v) && v >= 40 && v <= 220) {
        state.bpm = v;
        scheduler.bpm = v;
        persist();
      } else {
        bpmInput.value = String(currentBpm());
      }
    },
  }) as HTMLInputElement;
  const bpmReset = segButton(
    '↺',
    false,
    () => {
      state.bpm = null;
      bpmInput.value = String(currentBpm());
      scheduler.bpm = currentBpm();
      persist();
    },
    '恢复曲目建议速度',
  );

  // 键盘引导开关
  const guideBtn = h('button', {
    type: 'button',
    class: 'sp-btn',
    title: '常亮引导：目标音对应的琴键一直亮着；关掉则只在犹豫 2.6 秒后出现',
    onclick: () => {
      state.keyGuide = !state.keyGuide;
      persist();
      syncGuideBtn();
      paintTarget();
    },
  });
  function syncGuideBtn(): void {
    guideBtn.className = 'sp-btn' + (state.keyGuide ? ' sp-btn-on' : '');
    guideBtn.textContent = state.keyGuide ? '💡 引导常亮' : '💡 引导';
  }

  // 踏板
  const pedalBtn = h('button', {
    type: 'button',
    class: 'sp-btn',
    title: '延音踏板（空格切换；MIDI 踏板 CC64 同步）',
    onclick: () => setPedal(!state.pedalOn),
  });
  function syncPedalBtn(): void {
    pedalBtn.className = 'sp-btn' + (state.pedalOn ? ' sp-btn-on' : '');
    pedalBtn.textContent = state.pedalOn ? '🟢 踏板' : '踏板';
  }

  // MIDI
  const midiLamp = h('span', { class: 'sp-lamp' });
  const midiStatus = h('span', { class: 'sp-lcd-hint', textContent: '未连接' });
  const midi = new MidiBridge({
    onNoteOn: (m, v) => noteOn(m, Math.max(0.25, v)),
    onNoteOff: (m) => noteOff(m),
    onPedal: (down) => setPedal(down),
    onStatus: (text, online) => {
      midiStatus.textContent = text;
      midiLamp.className = 'sp-lamp' + (online ? ' sp-lamp-on' : '');
    },
  });
  const midiBtn = h('button', {
    type: 'button',
    class: 'sp-btn',
    textContent: '🎹 MIDI',
    title: '连接外接 MIDI 键盘（Chrome/Edge 支持）',
    onclick: () => void midi.connect(),
  });

  // 音量
  const volSlider = h('input', {
    type: 'range', min: '0', max: '1', step: '0.05', class: 'sp-vol', title: '琴声音量',
  }) as HTMLInputElement;
  volSlider.value = String(state.volume);
  volSlider.addEventListener('input', () => {
    state.volume = Number(volSlider.value);
    synth.setVolume(state.volume);
    persist();
  });
  const bandVolSlider = h('input', {
    type: 'range', min: '0', max: '1', step: '0.05', class: 'sp-vol', title: '伴奏音量',
  }) as HTMLInputElement;
  bandVolSlider.value = String(state.bandVolume);
  bandVolSlider.addEventListener('input', () => {
    state.bandVolume = Number(bandVolSlider.value);
    synth.setBandVolume(state.bandVolume);
    persist();
  });

  const beatLamp = h('span', { class: 'sp-lamp', title: '节拍指示灯' });

  function syncRhythmUI(): void {
    rhythmSelect.value = state.rhythmId;
    beatLamp.className = 'sp-lamp' + (scheduler.playing ? ' sp-lamp-on' : '');
  }

  // ────────── LCD（屏标 + 曲目卡架） ──────────
  const lcdTitle = h('div', { class: 'sp-lcd-title' });
  function renderLcdTitle(): void {
    lcdTitle.replaceChildren(
      h('b', { textContent: STAGE_LABEL[state.stage] }),
      h('span', {
        class: 'sp-lcd-hint',
        textContent: song
          ? `${keyDisplayName(song.score.keyPc, song.score.tonality)} ${TONALITY_LABEL[song.score.tonality]} · ${currentBpm()}♩`
          : '自由弹奏',
      }),
    );
  }

  const rack = createSongRack((id) => {
    if (id === 'free') {
      song = null;
      session = null;
      stopPlayhead();
      view.setScore(null);
      state.songId[state.stage] = 'free';
      persist();
      renderRack();
      updateReadoutIdle();
      renderLcdTitle();
      paintTarget();
      return;
    }
    selectSong(id);
  });

  function renderRack(): void {
    const items: SongCardItem[] = [];
    if (state.stage === 'read') {
      items.push({
        id: 'free',
        name: '自由弹奏',
        sub: '无谱面 · 纯玩',
        stars: 0,
        active: !song,
        group: '热身',
        tip: '不看谱，随便弹；节拍器和伴奏照常可用',
      });
    }
    for (const s of stageSongs(state.stage)) {
      const p = state.progress[s.score.id];
      items.push({
        id: s.score.id,
        name: s.score.title,
        sub: `${keyDisplayName(s.score.keyPc, s.score.tonality)} ${TONALITY_LABEL[s.score.tonality]} · ${s.score.beatsPerBar}/${s.score.beatUnit}`,
        stars: p?.stars ?? 0,
        active: song?.score.id === s.score.id,
        group: s.score.group ?? null,
        tip: s.tip,
      });
    }
    rack.render(items);
    renderLcdTitle();
  }

  const lcd = h('div', { class: 'sp-lcd' }, [lcdTitle, rack.el]);

  const bezel = h('div', { class: 'sp-bezel' }, [
    h('div', { class: 'sp-ctl' }, [
      h('span', { textContent: '键数' }),
      keyCountSeg,
      segButton('◀', false, () => shiftWindow(-12), '视图左移一个八度'),
      segButton('▶', false, () => shiftWindow(12), '视图右移一个八度'),
      modeSeg,
    ]),
    lcd,
    h('div', { class: 'sp-ctl', style: 'justify-content:flex-end' }, [
      h('span', { class: 'sp-ctl' }, [h('span', { textContent: '🥁' }), rhythmSelect, beatLamp]),
      h('span', { class: 'sp-ctl' }, [h('span', { textContent: '♩' }), bpmInput, bpmReset]),
      guideBtn,
      pedalBtn,
      h('span', { class: 'sp-ctl' }, [midiBtn, midiLamp, midiStatus]),
      h('span', { class: 'sp-ctl' }, [h('span', { textContent: '🎚' }), volSlider, bandVolSlider]),
    ]),
  ]);

  // ────────── 学习路径面板 ──────────
  const stageCards = new Map<Stage, HTMLButtonElement>();
  const pathPanel = h('section', {
    class: 'rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 sm:p-5',
  });

  function stageSuggestion(st: Stage): string {
    const list = BUILTIN_SONGS[st];
    const next = list.find((s) => (state.progress[s.score.id]?.stars ?? 0) === 0);
    if (!next) return '全部拿下！试试「导入自己的谱」练喜欢的歌';
    const firstDone = list.some((s) => (state.progress[s.score.id]?.stars ?? 0) > 0);
    return firstDone ? `下一步：《${next.score.title}》` : `从《${next.score.title}》开始`;
  }

  function renderPath(): void {
    pathPanel.replaceChildren(
      h('div', { class: 'flex flex-wrap items-baseline gap-2' }, [
        h('span', { class: 'text-sm font-semibold text-[var(--fg)]', textContent: '🎓 练琴路径' }),
        h('span', {
          class: 'text-xs text-[var(--fg-muted)]',
          textContent: '识谱打底 → 和弦上色 → 琶音开花。弹完一首得星，星星点亮进度',
        }),
      ]),
      h(
        'div',
        { class: 'mt-3 flex flex-wrap gap-3' },
        (['read', 'chord', 'arp'] as const).map((st) => {
          const def = STAGE_DESC[st];
          const list = BUILTIN_SONGS[st];
          const doneCount = list.filter((s) => (state.progress[s.score.id]?.stars ?? 0) > 0).length;
          const pct = Math.round((doneCount / list.length) * 100);
          const btn = stageCards.get(st) ?? h('button', { type: 'button', class: 'sp-stage' });
          stageCards.set(st, btn);
          btn.className = 'sp-stage' + (state.stage === st ? ' sp-stage-on' : '');
          btn.onclick = () => {
            if (state.stage === st) return;
            state.stage = st;
            persist();
            renderPath();
            renderRack();
            const saved = state.songId[st];
            const target = findSong(saved) ?? stageSongs(st)[0] ?? null;
            if (saved === 'free') {
              song = null;
              session = null;
              view.setScore(null);
              updateReadoutIdle();
              renderLcdTitle();
              renderRack();
            } else if (target) {
              selectSong(target.score.id);
            }
          };
          btn.replaceChildren(
            h('div', { class: 'flex items-center gap-2' }, [
              h('span', { class: 'text-lg', textContent: def.icon }),
              h('span', { class: 'text-sm font-semibold text-[var(--fg)]', textContent: def.title }),
            ]),
            h('p', {
              class: 'mt-1.5 text-xs leading-relaxed text-[var(--fg-muted)]',
              textContent: def.desc,
            }),
            h('div', { class: 'sp-stage-bar' }, [
              h('div', { class: 'sp-stage-fill', style: `width:${pct}%` }),
            ]),
            h('p', {
              class: 'mt-1.5 text-[11px] text-[var(--fg-muted)]',
              textContent: `${doneCount}/${list.length} 首 · ${stageSuggestion(st)}`,
            }),
          );
          return btn;
        }),
      ),
    );
  }

  // ────────── 导入面板 ──────────
  const importStatus = h('p', {
    class: 'mt-2 text-xs text-[var(--fg-muted)]',
    textContent: '',
  });
  const importText = h('textarea', {
    class:
      'mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 font-mono text-xs leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]',
    rows: 4,
    placeholder:
      '粘贴数字简谱：\n小星星\n1=C 4/4 ♩=96\n1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 -\n\n也支持 ABC 记谱（X:/T:/M:/L:/K: 头 + C D E F G 字母），或直接把 .mid 文件拖进来',
  }) as HTMLTextAreaElement;

  function doImportText(): void {
    const text = importText.value.trim();
    if (!text) {
      importStatus.textContent = '先在文本框里粘贴简谱或 ABC 记谱';
      return;
    }
    try {
      const id = `u-${Date.now().toString(36)}`;
      const res = importSheet({ kind: 'text', text }, id, 'read');
      const ok = pushImported(state, {
        id,
        title: res.score.title,
        format: res.format,
        kind: 'text',
        data: text,
        addedAt: Date.now(),
      });
      if (!ok) {
        importStatus.textContent = '曲库满了（或谱面过大），先清空一部分我的曲库再导入';
        return;
      }
      importCache.delete(id);
      persist();
      importText.value = '';
      state.stage = 'read';
      renderPath();
      selectSong(id);
      importStatus.textContent =
        `已导入《${res.score.title}》（${res.format} · ${pcName(res.score.keyPc)} ${TONALITY_LABEL[res.score.tonality]} · ${res.score.events.length} 个记号）` +
        (res.warnings.length ? `；提示：${res.warnings.slice(0, 2).join('；')}` : '');
    } catch (err) {
      importStatus.textContent = `导入失败：${err instanceof Error ? err.message : String(err)}`;
    }
  }

  function doImportFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const buf = reader.result as ArrayBuffer;
        const isMidi =
          file.name.toLowerCase().endsWith('.mid') ||
          file.name.toLowerCase().endsWith('.midi') ||
          (buf.byteLength > 14 && new DataView(buf).getUint32(0) === 0x4d546864);
        const id = `u-${Date.now().toString(36)}`;
        if (isMidi) {
          const res = importSheet({ kind: 'midi', buf }, id, 'read', file.name.replace(/\.[^.]+$/, ''));
          const ok = pushImported(state, {
            id,
            title: res.score.title,
            format: 'MIDI',
            kind: 'midi',
            data: bufToBase64(buf),
            addedAt: Date.now(),
          });
          if (!ok) throw new Error('曲库满了或文件过大');
          importCache.delete(id);
          persist();
          state.stage = 'read';
          renderPath();
          selectSong(id);
          importStatus.textContent = `已导入《${res.score.title}》（MIDI · 已提取最高声部旋律并量化）`;
        } else {
          const text = new TextDecoder().decode(buf);
          importText.value = text;
          doImportText();
        }
      } catch (err) {
        importStatus.textContent = `导入失败：${err instanceof Error ? err.message : String(err)}`;
      }
    };
    reader.readAsArrayBuffer(file);
  }

  const fileInput = h('input', {
    type: 'file',
    accept: '.txt,.abc,.mid,.midi',
    style: 'display:none',
    onchange: () => {
      const f = fileInput.files?.[0];
      if (f) doImportFile(f);
      fileInput.value = '';
    },
  }) as HTMLInputElement;

  const importPanel = h(
    'section',
    { class: 'mt-5 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 sm:p-5' },
    [
      h('div', { class: 'flex flex-wrap items-baseline gap-2' }, [
        h('span', { class: 'text-sm font-semibold text-[var(--fg)]', textContent: '📥 导入自己的谱' }),
        h('span', {
          class: 'text-xs text-[var(--fg-muted)]',
          textContent: '数字简谱 / ABC / MIDI 文件，自动判调、量化、移到顺手音区',
        }),
      ]),
      importText,
      h('div', { class: 'mt-2 flex flex-wrap items-center gap-2' }, [
        h('button', {
          type: 'button',
          class:
            'rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-fg)] hover:opacity-90',
          textContent: '导入文本谱',
          onclick: () => doImportText(),
        }),
        h('button', {
          type: 'button',
          class:
            'rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--fg)] hover:border-[var(--accent)]',
          textContent: '选择文件（.mid / .txt / .abc）',
          onclick: () => fileInput.click(),
        }),
        h('button', {
          type: 'button',
          class: 'text-xs text-[var(--fg-muted)] hover:text-[var(--accent)]',
          textContent: '清空我的曲库',
          onclick: () => {
            if (!state.imported.length) return;
            state.imported = [];
            state.lastImportedId = null;
            importCache.clear();
            persist();
            renderRack();
            importStatus.textContent = '我的曲库已清空';
            if (!song) return;
            if (!findSong(song.score.id)) selectSong(BUILTIN_SONGS[state.stage][0]!.score.id);
          },
        }),
        fileInput,
      ]),
      importStatus,
    ],
  );

  // 拖拽 MIDI/文本文件到导入面板
  importPanel.addEventListener('dragover', (e) => {
    e.preventDefault();
    importPanel.classList.add('sp-dropzone-drag');
  });
  importPanel.addEventListener('dragleave', () => importPanel.classList.remove('sp-dropzone-drag'));
  importPanel.addEventListener('drop', (e) => {
    e.preventDefault();
    importPanel.classList.remove('sp-dropzone-drag');
    const f = e.dataTransfer?.files?.[0];
    if (f) doImportFile(f);
  });

  // ────────── 电脑键盘 ──────────
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
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

  window.addEventListener('resize', () => view.relayout());

  // ────────── 装配 ──────────
  const piano = h('div', { class: 'sp-piano' }, [
    bezel,
    h('div', { class: 'sp-stand' }, [view.el]),
    minimap.el,
    kbd.el,
    h('div', { class: 'sp-readout' }, [
      h('div', { style: 'flex:1 1 260px;min-width:0' }, [readoutBig, readoutSub]),
      comboBox,
    ]),
  ]);

  content.append(
    h('p', {
      class: 'mb-4 text-sm text-[var(--fg-muted)]',
      textContent:
        '一台放在浏览器里的识谱练琴房：跟着五线谱弹，弹对的音符变绿、弹错的位置闪星光，连击越久琴越烫。识谱、和弦走向、琶音伴奏三段路径循序渐进；鼠标点、电脑键盘（Z 排 / Q 排双排映射）或外接 MIDI 键盘都能弹，节拍器与节奏伴奏随行。支持导入数字简谱 / ABC / MIDI，全部本地运行，进度与曲库自动记忆。',
    }),
    pathPanel,
    h('div', { class: 'mt-5' }, [piano]),
    importPanel,
    h('p', {
      class: 'mt-4 text-[11px] leading-relaxed text-[var(--fg-muted)]',
      textContent:
        '快捷键：Z 排 = 当前窗口白键区（C 起），Q 排 = 高八度，←/→ 移动视图八度，空格 = 延音踏板，Esc = 全部松开。跟弹模式谱面等你弹对；演奏模式有一小节预备拍，错过不等人但也不罚停。调号爬坡顺序 C → G → F → D → 降B，每个调只多一个升降号，正是视奏练习的经典路径。',
    }),
  );

  // 初始渲染
  renderKeyCountSeg();
  renderModeSeg();
  syncPedalBtn();
  syncGuideBtn();
  renderPath();

  // 恢复上次曲目（优先各阶段记忆的 songId；导入曲失效自动回退）
  const savedId = state.songId[state.stage];
  if (savedId === 'free') {
    song = null;
    view.setScore(null);
    updateReadoutIdle();
  } else {
    const found = findSong(savedId) ?? stageSongs(state.stage)[0] ?? null;
    if (found) selectSong(found.score.id, { autopersist: false });
  }
  renderRack();
  syncBand();
}

// ────────── base64 工具（MIDI 导入存档） ──────────
function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

renderApp();
