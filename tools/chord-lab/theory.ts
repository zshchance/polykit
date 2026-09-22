/**
 * 和弦琴房 —— 乐理引擎（纯函数 / 纯状态机）。
 *
 * 不碰 DOM、Web Audio、Web MIDI，输入输出都是 MIDI 音高数与音高类（0-11），
 * 方便 vitest 直接单测。三大块：
 *   1. 和弦结构：性质词表、精确识别、补全提示（还缺哪些音能组成某性质和弦）
 *   2. 和弦走向：级数 → 根音/性质/罗马数字标签，走向匹配状态机
 *   3. 声部连接：给定目标和弦与参考音区，选一套最近把位的 voicing
 *
 * 匹配约定（与产品交互一致）：
 *   - 和弦模式按「音高类集合」判断，与八度无关（按 C3+E5 也算 C+E）
 *   - 和弦的根音候选只取「按下的音」（最低音优先）：按 C+♭E 只尝试
 *     C / ♭E 为根的和弦，因此它指向 C 小三而不是 ♭A 大三——与学习者
 *     「最低音即根音」的直觉一致（转位识别不受影响，见 exactChord）
 *   - 走向模式只按根音音高类匹配级数，大小性质不强制（弹单音视为根音）
 */

// ───────────── 基础 ─────────────

export const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export type Tonality = 'major' | 'minor';

export const TONALITY_LABEL: Record<Tonality, string> = { major: '大调', minor: '小调' };

/** MIDI → 音高类 0-11 */
export function pcOf(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

/** 音高类 → 显示名（升号拼写） */
export function pcName(pc: number): string {
  return PC_NAMES[pcOf(pc)]!;
}

/** MIDI → 频率（A4=69=440Hz） */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** 一组 MIDI → 去重排序的音高类集合 */
export function pcSetOf(midis: Iterable<number>): number[] {
  const set = new Set<number>();
  for (const m of midis) set.add(pcOf(m));
  return [...set].sort((a, b) => a - b);
}

// ───────────── 和弦性质词表 ─────────────

export type ChordQualityId =
  'maj' | 'min' | 'aug' | 'dim' | '7' | 'maj7' | 'm7' | 'sus2' | 'sus4' | 'add9';

export interface ChordQualityDef {
  id: ChordQualityId;
  /** 中文名（大三和弦 / 小三和弦 …） */
  name: string;
  /** 和弦名后缀（C、Cm、Caug …） */
  suffix: string;
  /** 相对根音的半音音程（含 0，升序；add9 的 14 表示复音程） */
  intervals: readonly number[];
  /** 卡片上展示的构成公式 */
  formula: string;
  /** 一句话听感描述（详情提示用） */
  flavor: string;
  /** 是否属于进阶包（默认不出现在屏幕卡片架，引导面板可勾选加入） */
  advanced: boolean;
  /** 默认引导色（调色板索引见 settings.PALETTE） */
  defaultColor: number;
  /** 默认是否开启引导 */
  defaultEnabled: boolean;
}

export const CHORD_QUALITIES: readonly ChordQualityDef[] = [
  {
    id: 'maj',
    name: '大三和弦',
    suffix: '',
    intervals: [0, 4, 7],
    formula: '根音 + 大三度 + 纯五度',
    flavor: '明亮、稳定，像晴天',
    advanced: false,
    defaultColor: 0, // 绿
    defaultEnabled: true,
  },
  {
    id: 'min',
    name: '小三和弦',
    suffix: 'm',
    intervals: [0, 3, 7],
    formula: '根音 + 小三度 + 纯五度',
    flavor: '柔和、忧郁，像阴天',
    advanced: false,
    defaultColor: 1, // 淡绿
    defaultEnabled: true,
  },
  {
    id: 'aug',
    name: '增三和弦',
    suffix: 'aug',
    intervals: [0, 4, 8],
    formula: '根音 + 大三度 + 增五度',
    flavor: '悬浮、不安，梦一样的扩张感',
    advanced: false,
    defaultColor: 9, // 灰
    defaultEnabled: false,
  },
  {
    id: 'dim',
    name: '减三和弦',
    suffix: 'dim',
    intervals: [0, 3, 6],
    formula: '根音 + 小三度 + 减五度',
    flavor: '紧张、收缩，悬疑片的拐角',
    advanced: false,
    defaultColor: 9, // 灰
    defaultEnabled: false,
  },
  {
    id: '7',
    name: '属七和弦',
    suffix: '7',
    intervals: [0, 4, 7, 10],
    formula: '大三和弦 + 小七度',
    flavor: '布鲁斯的标志，想回家（解决到主和弦）',
    advanced: true,
    defaultColor: 4, // 琥珀
    defaultEnabled: true,
  },
  {
    id: 'maj7',
    name: '大七和弦',
    suffix: 'maj7',
    intervals: [0, 4, 7, 11],
    formula: '大三和弦 + 大七度',
    flavor: '慵懒、高级，咖啡馆落地窗',
    advanced: true,
    defaultColor: 2, // 天蓝
    defaultEnabled: true,
  },
  {
    id: 'm7',
    name: '小七和弦',
    suffix: 'm7',
    intervals: [0, 3, 7, 10],
    formula: '小三和弦 + 小七度',
    flavor: '温柔夜色，R&B 常客',
    advanced: true,
    defaultColor: 3, // 紫
    defaultEnabled: true,
  },
  {
    id: 'sus2',
    name: '挂二和弦',
    suffix: 'sus2',
    intervals: [0, 2, 7],
    formula: '根音 + 大二度 + 纯五度',
    flavor: '空旷、开放，留白的东方感',
    advanced: true,
    defaultColor: 6, // 玫红
    defaultEnabled: true,
  },
  {
    id: 'sus4',
    name: '挂四和弦',
    suffix: 'sus4',
    intervals: [0, 5, 7],
    formula: '根音 + 纯四度 + 纯五度',
    flavor: '悬而未决，等待落回大三',
    advanced: true,
    defaultColor: 5, // 橙
    defaultEnabled: true,
  },
  {
    id: 'add9',
    name: '加九和弦',
    suffix: 'add9',
    intervals: [0, 4, 7, 14],
    formula: '大三和弦 + 九度音',
    flavor: '清亮闪光，流行编曲的糖霜',
    advanced: true,
    defaultColor: 8, // 青
    defaultEnabled: true,
  },
];

export const QUALITY_MAP: ReadonlyMap<ChordQualityId, ChordQualityDef> = new Map(
  CHORD_QUALITIES.map((q) => [q.id, q]),
);

/** 某和弦的音高类集合（升序去重；add9 的 14 折叠回 2） */
export function chordPcs(rootPc: number, quality: ChordQualityId): number[] {
  const iv = QUALITY_MAP.get(quality)!.intervals;
  const set = new Set<number>();
  for (const i of iv) set.add(pcOf(rootPc + i));
  return [...set].sort((a, b) => a - b);
}

/** 和弦显示名（C、Cm、G7、Fmaj7） */
export function chordName(rootPc: number, quality: ChordQualityId): string {
  return `${pcName(rootPc)}${QUALITY_MAP.get(quality)!.suffix}`;
}

function isSubset(sub: readonly number[], full: readonly number[]): boolean {
  return sub.every((x) => full.includes(x));
}

function sameSet(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && isSubset(a, b);
}

// ───────────── 和弦模式：识别与补全 ─────────────

export interface ChordMatch {
  rootPc: number;
  quality: ChordQualityId;
  /** 转位：0 = 原位（最低音即根音），1/2/3 = 三音/五音/七音在最低 */
  inversion: number;
}

/**
 * 精确识别：按下的音高类集合恰好等于某和弦。
 * priority 为卡片优先级顺序（先者胜）；同性质多根音等价时（如增三和弦
 * C-E-G# 三种命名）优先取「最低音为根音」的命名，其次音高类较小者。
 */
export function exactChord(
  pressedPcs: readonly number[],
  lowestPc: number,
  priority: readonly ChordQualityId[],
): ChordMatch | null {
  if (pressedPcs.length < 2) return null;
  for (const q of priority) {
    for (const r of rootCandidates(pressedPcs, lowestPc)) {
      const pcs = chordPcs(r, q);
      if (sameSet(pressedPcs, pcs)) {
        // 转位按和弦音的区间顺序（根/三/五/七）定位最低音，而非音高类排序序
        const tones = QUALITY_MAP.get(q)!.intervals.map((i) => pcOf(r + i));
        return { rootPc: r, quality: q, inversion: Math.max(0, tones.indexOf(lowestPc)) };
      }
    }
  }
  return null;
}

/** 根音候选顺序：最低音优先，其余按音高类升序 */
function rootCandidates(pressedPcs: readonly number[], lowestPc: number): number[] {
  const rest = pressedPcs.filter((p) => p !== lowestPc);
  return [lowestPc, ...rest];
}

export interface CompletionInfo {
  /** 可补全的性质列表（按卡片优先级过滤排序，只含「按下的音能嵌入」的性质） */
  satisfiable: ChordQualityId[];
  /** 每个可补全音的音高类 → 性质 id（高优先级性质先占位） */
  hints: Map<number, ChordQualityId>;
}

/**
 * 补全提示：对每种启用的性质（按优先级顺序），以每个按下的音为候选根音，
 * 找出能包含全部按下音的和弦，缺失音成为提示音。一个音同时能补全多种
 * 性质时，高优先级胜出。已经精确成和弦时仍可用（提示的是扩展音，
 * 如 C 大三已齐时提示 ♭B 可成 C7）。
 */
export function completionHints(
  pressedPcs: readonly number[],
  priority: readonly ChordQualityId[],
): CompletionInfo {
  const satisfiable: ChordQualityId[] = [];
  const hints = new Map<number, ChordQualityId>();
  if (pressedPcs.length === 0) return { satisfiable, hints };
  for (const q of priority) {
    let any = false;
    for (const r of pressedPcs) {
      const pcs = chordPcs(r, q);
      if (!isSubset(pressedPcs, pcs)) continue;
      any = true;
      for (const p of pcs) {
        if (!pressedPcs.includes(p) && !hints.has(p)) hints.set(p, q);
      }
    }
    if (any) satisfiable.push(q);
  }
  return { satisfiable, hints };
}

export interface BestCompletion {
  rootPc: number;
  quality: ChordQualityId;
  /** 还缺的音（音高类，升序） */
  missing: number[];
}

/**
 * 最佳补全目标：缺口最小者优先，缺口相同按卡片优先级，再按「最低音即根音」。
 * 用于指示区文案「再按 G 组成 C 大三和弦」。
 */
export function bestCompletion(
  pressedPcs: readonly number[],
  lowestPc: number,
  priority: readonly ChordQualityId[],
): BestCompletion | null {
  let best: BestCompletion | null = null;
  for (const q of priority) {
    for (const r of rootCandidates(pressedPcs, lowestPc)) {
      const pcs = chordPcs(r, q);
      if (!isSubset(pressedPcs, pcs)) continue;
      const missing = pcs.filter((p) => !pressedPcs.includes(p));
      if (missing.length === 0) continue; // 精确匹配交给 exactChord
      const cand: BestCompletion = { rootPc: r, quality: q, missing };
      if (
        !best ||
        missing.length < best.missing.length ||
        (missing.length === best.missing.length && r === lowestPc && best.rootPc !== lowestPc)
      ) {
        best = cand;
      }
    }
    // 同优先级内已找到最小缺口后，更高缺口的本性质其它根音不必再看，
    // 但低优先级性质仍可能以更小缺口胜出吗？不会——缺口按性质全局比较，
    // 所以继续扫剩余性质，仅在缺口更小时替换。
  }
  return best;
}

// ───────────── 走向模式：级数与调 ─────────────

export interface ProgStep {
  /** 级数 1-7 */
  d: number;
  /** 临时升降号（-1 = ♭，1 = ♯），相对自然音级 */
  acc?: -1 | 0 | 1;
  /** 性质覆盖；缺省用调式自然三和弦性质 */
  q?: 'maj' | 'min' | 'dim';
}

export interface Progression {
  id: string;
  name: string;
  icon: string;
  /** 一句话听感/场景描述 */
  desc: string;
  steps: readonly ProgStep[];
  /** 默认引导色（调色板索引） */
  defaultColor: number;
  /** 默认是否开启引导 */
  defaultEnabled: boolean;
}

export const SCALE_OFFSETS: Record<Tonality, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

/** 调式自然三和弦性质（dim 仅在 vii°/ii° 出现） */
export const SCALE_QUALITIES: Record<Tonality, readonly ('maj' | 'min' | 'dim')[]> = {
  major: ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'],
  minor: ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'],
};

/** 某级在某调下的根音音高类 */
export function stepRootPc(keyPc: number, tonality: Tonality, step: ProgStep): number {
  return pcOf(keyPc + SCALE_OFFSETS[tonality][step.d - 1]! + (step.acc ?? 0));
}

/** 某级在某调下的三和弦性质 */
export function stepQuality(tonality: Tonality, step: ProgStep): 'maj' | 'min' | 'dim' {
  return step.q ?? SCALE_QUALITIES[tonality][step.d - 1]!;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;

/** 罗马数字标签：小写 = 小三，°= 减三，前缀 ♭/♯（如 I、vi、♭VII、ii°） */
export function stepLabel(tonality: Tonality, step: ProgStep): string {
  const q = stepQuality(tonality, step);
  let label: string = ROMAN[step.d - 1]!;
  if (q === 'min') label = label.toLowerCase();
  else if (q === 'dim') label = label.toLowerCase() + '°';
  if (step.acc === -1) label = '♭' + label;
  else if (step.acc === 1) label = '♯' + label;
  return label;
}

/** 某级的完整和弦名（当前调下），如 C 大调 4 级 = F */
export function stepChordName(keyPc: number, tonality: Tonality, step: ProgStep): string {
  return chordName(stepRootPc(keyPc, tonality, step), stepQuality(tonality, step));
}

/** 级数的三和弦音程（voicing / 五线谱用；dim 也是三音堆叠） */
export function stepIntervals(tonality: Tonality, step: ProgStep): readonly number[] {
  const q = stepQuality(tonality, step);
  return QUALITY_MAP.get(q)!.intervals;
}

// ───────────── 走向模式：匹配状态机 ─────────────

export interface ProgRuntime {
  prog: Progression;
  /** 已匹配到的步数（0 = 未激活，len = 走完一轮） */
  pos: number;
  active: boolean;
}

/**
 * 走向追踪器：并行跟踪多条走向（数组顺序即卡片优先级）。
 * 喂入和弦事件（根音音高类）后的规则：
 *   - 命中当前期待级 → 前进一步；走完一轮后下一次命中首级 = 循环重来
 *   - 命中首级 → （重新）从第 1 步激活
 *   - 重复同一级 → 原地不动（不算失败）
 *   - 其它 → 该走向本轮失败，沉默直至再次命中首级
 */
export class ProgressionTracker {
  private runtime: ProgRuntime[];
  private rootSeqs: number[][];
  private progs: readonly Progression[];

  constructor(progs: readonly Progression[], keyPc: number, tonality: Tonality) {
    this.progs = progs;
    this.rootSeqs = progs.map((p) => p.steps.map((s) => stepRootPc(keyPc, tonality, s)));
    this.runtime = progs.map((prog) => ({ prog, pos: 0, active: false }));
  }

  feed(rootPc: number): void {
    for (let i = 0; i < this.progs.length; i++) {
      const rt = this.runtime[i]!;
      const roots = this.rootSeqs[i]!;
      const len = roots.length;
      const first = roots[0]!;
      if (!rt.active) {
        if (rootPc === first) {
          rt.active = true;
          rt.pos = 1;
        }
        continue;
      }
      const expected = rt.pos < len ? roots[rt.pos]! : null;
      if (expected !== null && rootPc === expected) {
        rt.pos++;
      } else if (rootPc === first) {
        rt.pos = 1; // 走完后命中首级 = 循环；中途命中首级 = 重启
      } else if (rootPc === roots[rt.pos - 1]!) {
        // 重复当前级：保持
      } else {
        rt.active = false;
        rt.pos = 0;
      }
    }
  }

  /** 进行中的走向（按卡片优先级），pos 为已完成的步数 */
  actives(): ProgRuntime[] {
    return this.runtime.filter((r) => r.active);
  }

  /** 某走向下一步期待的级（走完一轮返回 null） */
  nextStep(id: string): ProgStep | null {
    const rt = this.runtime.find((r) => r.prog.id === id);
    if (!rt || !rt.active || rt.pos >= rt.prog.steps.length) return null;
    return rt.prog.steps[rt.pos]!;
  }

  reset(): void {
    for (const rt of this.runtime) {
      rt.active = false;
      rt.pos = 0;
    }
  }
}

// ───────────── 声部连接（就近 voicing） ─────────────

/**
 * 给定目标和弦（根音音高类 + 音程）与参考中心音，在 [lo, hi] 内选一套
 * 最近把位的 voicing：遍历各转位与根音八度，以「平均距中心最近、音域最窄」
 * 打分。返回升序 MIDI 数组；区间内实在放不下时才允许越界半八度。
 */
export function nearestVoicing(
  rootPc: number,
  intervals: readonly number[],
  centerMidi: number,
  lo: number,
  hi: number,
): number[] {
  const n = intervals.length;
  let best: number[] | null = null;
  let bestScore = Infinity;

  const consider = (raw: number[], slack: number): void => {
    const notes = [...raw].sort((a, b) => a - b); // 转位旋转后乱序，先排好再算音域
    if (notes.some((m) => m < lo - slack || m > hi + slack)) return;
    const mean = notes.reduce((a, b) => a + b, 0) / n;
    const span = notes[n - 1]! - notes[0]!;
    const score = Math.abs(mean - centerMidi) + span * 0.25;
    if (score < bestScore - 1e-6) {
      bestScore = score;
      best = notes;
    }
  };

  for (const slack of [0, 12]) {
    for (let inv = 0; inv < n; inv++) {
      // 转位：第 inv 个和弦音做最低音，其余顺移（必要时抬八度）
      const invIv = intervals.map((i) => {
        let x = i - intervals[inv]!;
        while (x < 0) x += 12;
        return x;
      });
      const bassPc = pcOf(rootPc + intervals[inv]!);
      // 最低音候选：窗口上下一个八度内所有该音高类
      for (let bass = lo - 12; bass <= hi + 12; bass++) {
        if (pcOf(bass) !== bassPc) continue;
        consider(
          invIv.map((i) => bass + i),
          slack,
        );
      }
    }
    if (best) break;
  }
  return best ?? [];
}

// ───────────── 输入归纳：按下的音 → 和弦事件根音 ─────────────

/**
 * 走向模式的「当前根音」：精确成和弦时取和弦根音（优先最低音命名），
 * 否则取最低音（弹单音/双音时视为根音，大小性质不强制）。
 */
export function extractRootPc(
  pressedMidis: readonly number[],
  priority: readonly ChordQualityId[],
): number | null {
  if (pressedMidis.length === 0) return null;
  const sorted = [...pressedMidis].sort((a, b) => a - b);
  const lowestPc = pcOf(sorted[0]!);
  const pcs = pcSetOf(sorted);
  const m = exactChord(pcs, lowestPc, priority);
  return m ? m.rootPc : lowestPc;
}
