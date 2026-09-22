/**
 * 识谱琴房 —— 谱面模型与命中判定（纯逻辑，不碰 DOM / Audio）。
 *
 * 谱面（Score）是一串按拍排序的事件：单音（识谱/琶音）或音簇（和弦走向）。
 * 所有事件在构建时已按调号拼写好（step/acc），渲染层直接取坐标，不再算乐理。
 *
 * 判定（JudgeSession）两种模式：
 *   exact —— 识谱/琶音：当前目标单音，按下的 MIDI 完全相等才算命中
 *   chord —— 和弦走向：目标是一组音高类，按下的音覆盖全部目标即命中；
 *            多余的音记一次 miss（星光提示）但不打断，松掉后可以再齐
 * 休止符自动跳过；错音不惩罚（不终止、不扣分，只断连击），契合低惩罚设计。
 */

import {
  keySigOf,
  spellInKey,
  type KeySig,
  type SpelledNote,
  type Tonality,
} from './theory';

export type Stage = 'read' | 'chord' | 'arp';

export const STAGE_LABEL: Record<Stage, string> = {
  read: '识谱',
  chord: '和弦走向',
  arp: '琶音伴奏',
};

export interface ScoreEvent {
  /** 全曲绝对起始拍（四分音符 = 1 拍） */
  beat: number;
  /** 时值（拍） */
  dur: number;
  /** 音（休止符为空数组；和弦事件为多音，升序） */
  midis: number[];
  /** 与 midis 平行的谱面拼写（已按调号算好） */
  spelled: SpelledNote[];
  /** 事件标签（和弦名 / 级数，如 "C" "vi"），谱面上方小字 */
  label?: string;
  /** 贝斯根音音高类（和弦/琶音阶段，伴奏贝斯跟着它走） */
  bassPc?: number;
}

export interface Score {
  id: string;
  title: string;
  stage: Stage;
  keyPc: number;
  tonality: Tonality;
  sig: KeySig;
  /** 每小节拍数（分子） */
  beatsPerBar: number;
  /** 拍单位（分母，展示用） */
  beatUnit: number;
  events: ScoreEvent[];
  totalBeats: number;
  /** 建议 BPM（演奏模式与伴奏速度默认值） */
  bpm: number;
  /** 曲库分组（内置：按难度；导入：'我的曲库'） */
  group?: string;
}

export interface RawEvent {
  beat: number;
  dur: number;
  midis: number[];
  label?: string;
  bassPc?: number;
}

export interface BuildScoreOpts {
  id: string;
  title: string;
  stage: Stage;
  keyPc: number;
  tonality?: Tonality;
  beatsPerBar?: number;
  beatUnit?: number;
  bpm?: number;
  group?: string;
}

/** 由裸事件构建完整谱面：排序、拼写、算总长 */
export function buildScore(raw: readonly RawEvent[], opts: BuildScoreOpts): Score {
  const tonality = opts.tonality ?? 'major';
  const sig = keySigOf(opts.keyPc, tonality);
  const events: ScoreEvent[] = [...raw]
    .sort((a, b) => a.beat - b.beat)
    .map((e) => ({
      beat: Math.round(e.beat * 1000) / 1000,
      dur: e.dur,
      midis: [...e.midis].sort((a, b) => a - b),
      spelled: e.midis.map((m) => spellInKey(m, sig)),
      ...(e.label !== undefined ? { label: e.label } : {}),
      ...(e.bassPc !== undefined ? { bassPc: e.bassPc } : {}),
    }));
  const last = events[events.length - 1];
  const beatsPerBar = opts.beatsPerBar ?? 4;
  const end = last ? last.beat + last.dur : 0;
  return {
    id: opts.id,
    title: opts.title,
    stage: opts.stage,
    keyPc: opts.keyPc,
    tonality,
    sig,
    beatsPerBar,
    beatUnit: opts.beatUnit ?? 4,
    events,
    totalBeats: Math.ceil(end / beatsPerBar) * beatsPerBar || beatsPerBar,
    bpm: opts.bpm ?? 96,
    ...(opts.group !== undefined ? { group: opts.group } : {}),
  };
}

/** 谱面音域（忽略休止符）；空谱返回 null */
export function scoreRange(score: Score): { lo: number; hi: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const e of score.events) {
    for (const m of e.midis) {
      if (m < lo) lo = m;
      if (m > hi) hi = m;
    }
  }
  return lo <= hi ? { lo, hi } : null;
}

// ───────────── 判定 ─────────────

export type JudgeMode = 'exact' | 'chord';

export type JudgeVerdict =
  | { type: 'hit'; event: ScoreEvent; index: number }
  | { type: 'miss'; midi: number }
  | { type: 'ignore' };

export interface JudgeStats {
  hits: number;
  misses: number;
  combo: number;
  maxCombo: number;
  /** 已完成的目标事件数（不含休止符） */
  progressed: number;
  /** 目标事件总数（不含休止符） */
  total: number;
  done: boolean;
}

/**
 * 判定会话：跟随用户弹奏推进谱面。
 * 音符进出都上报；会话只关心「当前目标」，命中推进、错音记 miss。
 * 演奏模式（带伴奏按时间走）由 main 调 advanceTime() 强推，未命中的目标记 missed。
 */
export class JudgeSession {
  private readonly score: Score;
  private readonly mode: JudgeMode;
  /** 当前目标下标（始终指向非休止事件；越界 = 弹完） */
  private idx = 0;
  /** chord 模式：当前目标已按下的音高类 */
  private matched = new Set<number>();
  /** 统计 */
  private s = { hits: 0, misses: 0, combo: 0, maxCombo: 0, progressed: 0, total: 0, done: false };
  /** exact 模式同音连弹去重：命中后要求先松掉该音再算下一次 */
  private awaitRelease: number | null = null;

  constructor(score: Score, mode: JudgeMode) {
    this.score = score;
    this.mode = mode;
    this.s.total = score.events.filter((e) => e.midis.length > 0).length;
    this.skipRests();
  }

  /** 当前目标事件（null = 已弹完） */
  current(): ScoreEvent | null {
    return this.s.done ? null : (this.score.events[this.idx] ?? null);
  }

  /** 当前目标在 events 里的下标（渲染高亮用） */
  currentIndex(): number {
    return this.s.done ? -1 : this.idx;
  }

  stats(): JudgeStats {
    return { ...this.s };
  }

  /** 按下 */
  feedOn(midi: number): JudgeVerdict {
    const ev = this.current();
    if (!ev) return { type: 'ignore' };

    if (this.mode === 'exact') {
      const target = ev.midis[0];
      if (target === undefined) return { type: 'ignore' };
      if (this.awaitRelease === midi) return { type: 'ignore' };
      if (midi === target) {
        const hitIdx = this.idx;
        this.registerHit(ev);
        this.awaitRelease = midi;
        return { type: 'hit', event: ev, index: hitIdx };
      }
      this.registerMiss();
      return { type: 'miss', midi };
    }

    // chord 模式：音高类判定
    const pcs = new Set(ev.midis.map((m) => ((m % 12) + 12) % 12));
    const pc = ((midi % 12) + 12) % 12;
    if (pcs.has(pc)) {
      this.matched.add(pc);
      if (pcs.size <= this.matched.size) {
        const hitIdx = this.idx;
        this.registerHit(ev);
        this.matched.clear();
        return { type: 'hit', event: ev, index: hitIdx };
      }
      return { type: 'ignore' };
    }
    this.registerMiss();
    return { type: 'miss', midi };
  }

  /** 松开 */
  feedOff(midi: number): void {
    if (this.awaitRelease === midi) this.awaitRelease = null;
    // chord 模式刻意不清理已匹配音：和弦是一个个音先后按下的
    // （滚奏/分解输入在跟弹模式同样算数），凑齐即过、错音只记 miss
  }

  /**
   * 演奏模式：时间到点而当前目标未命中 → 记 missed（断连击 + miss），推进。
   * 返回被跳过的目标（渲染染红），弹完返回 null。
   */
  advanceMissed(): ScoreEvent | null {
    const ev = this.current();
    if (!ev) return null;
    this.s.misses++;
    this.s.combo = 0;
    this.advance();
    return ev;
  }

  private registerHit(_ev: ScoreEvent): void {
    this.s.hits++;
    this.s.combo++;
    if (this.s.combo > this.s.maxCombo) this.s.maxCombo = this.s.combo;
    this.advance();
  }

  private registerMiss(): void {
    this.s.misses++;
    this.s.combo = 0;
  }

  private advance(): void {
    this.s.progressed++;
    this.idx++;
    this.skipRests();
    if (!this.s.done && this.idx >= this.score.events.length) this.s.done = true;
  }

  private skipRests(): void {
    while (this.idx < this.score.events.length) {
      const ev = this.score.events[this.idx]!;
      if (ev.midis.length > 0) return;
      this.idx++;
    }
    this.s.done = true;
  }
}

/** 正确率 0-1（无弹奏记录时为 0） */
export function accuracyOf(s: JudgeStats): number {
  const n = s.hits + s.misses;
  return n === 0 ? 0 : s.hits / n;
}

/**
 * 曲终评星：3★ ≥95%，2★ ≥85%，1★ 弹完。
 * 未弹完（中途切歌）不给星。
 */
export function starsOf(s: JudgeStats): 0 | 1 | 2 | 3 {
  if (!s.done || s.hits === 0) return 0;
  const acc = accuracyOf(s);
  if (acc >= 0.95) return 3;
  if (acc >= 0.85) return 2;
  return 1;
}
