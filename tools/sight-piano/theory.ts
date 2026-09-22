/**
 * 识谱琴房 —— 乐理引擎（纯函数）。
 *
 * 不碰 DOM / Web Audio / Web MIDI，输入输出都是 MIDI 音高数与音高类（0-11），
 * 方便 vitest 直接单测。两大块：
 *   1. 音高拼写：给定调号，把 MIDI 音高拼成「音名 + 升降 + 绝对音级步」，
 *      供五线谱定位（升号调用 ♯ 拼写，降号调用 ♭ 拼写，调内音不带临时记号）
 *   2. 和弦与走向：性质词表、级数 → 根音/性质、就近 voicing（走向/琶音阶段用）
 *
 * 记谱约定：高音谱表，绝对音级步 step = octave*7 + 字母序（C=0…B=6），
 * E4（谱表最下一条线）的 step = 4*7+2 = 30，与 ui/scoreview 的定位公式一致。
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

const PC_NAMES_FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'] as const;

/** 调名显示：降号侧用降号拼写（B♭ 大调而不是 A# 大调） */
export function keyDisplayName(keyPc: number, tonality: Tonality): string {
  return keyFifths(keyPc, tonality) < 0 ? PC_NAMES_FLAT[pcOf(keyPc)]! : pcName(keyPc);
}

/** MIDI → 频率（A4=69=440Hz） */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** MIDI → 音名 + 八度（如 C4、F#3），读数区用 */
export function midiName(midi: number): string {
  return `${pcName(pcOf(midi))}${Math.floor(midi / 12) - 1}`;
}

/** 一组 MIDI → 去重排序的音高类集合 */
export function pcSetOf(midis: Iterable<number>): number[] {
  const set = new Set<number>();
  for (const m of midis) set.add(pcOf(m));
  return [...set].sort((a, b) => a - b);
}

// ───────────── 调号与拼写 ─────────────

/** 字母 → 自然音高类 */
const NAT_PC = [0, 2, 4, 5, 7, 9, 11] as const; // C D E F G A B

/** 五度圈序号 → 升号调按顺序 sharps、降号调按顺序 flats（音高类） */
const SHARP_ORDER = [5, 0, 7, 2, 9, 4, 11] as const; // F C G D A E B
const FLAT_ORDER = [11, 4, 9, 2, 7, 0, 5] as const; // B E A D G C F

/**
 * 大调主音音高类 → 五度圈序号（C=0，G=1 … F♯=6；F=-1 … 降G=-6）。
 * 小调先换算关系大调（主音 +3）。
 */
export function keyFifths(keyPc: number, tonality: Tonality): number {
  const pc = pcOf(tonality === 'minor' ? keyPc + 3 : keyPc);
  const table: Record<number, number> = {
    0: 0, // C
    7: 1, // G
    2: 2, // D
    9: 3, // A
    4: 4, // E
    11: 5, // B
    6: 6, // F#
    5: -1, // F
    10: -2, // Bb
    3: -3, // Eb
    8: -4, // Ab
    1: -5, // Db
  };
  return table[pc] ?? 0;
}

export interface KeySig {
  /** 五度圈序号：正 = 升号数，负 = 降号数 */
  fifths: number;
  /** 调号影响的音高类 → 升降量（+1 / -1），如 G 大调 {5:+1}（F♯） */
  sig: Map<number, number>;
}

export function keySigOf(keyPc: number, tonality: Tonality): KeySig {
  const fifths = keyFifths(keyPc, tonality);
  const sig = new Map<number, number>();
  if (fifths > 0) for (const pc of SHARP_ORDER.slice(0, fifths)) sig.set(pc, 1);
  else if (fifths < 0) for (const pc of FLAT_ORDER.slice(0, -fifths)) sig.set(pc, -1);
  return { fifths, sig };
}

export interface SpelledNote {
  /** 字母序 C=0…B=6 */
  letter: number;
  /** 科学记谱八度（C4 的 4） */
  octave: number;
  /** 临时记号：-1 ♭ / 0 无（调号已覆盖）/ +1 ♯ / 2 ♮（抵消调号的升降） */
  acc: -1 | 0 | 1 | 2;
  /** 绝对音级步 = octave*7 + letter，五线谱纵坐标定位用 */
  step: number;
}

/**
 * 把 MIDI 音高按指定调号拼写到谱面。
 * 调内音：落在调号覆盖的音级上，不带临时记号；
 * 调外音：若恰是调号升降音的还原（如 F 大调的 B 自然）拼 ♮；
 *        其余升号调（含 C）用 ♯ 拼写，降号调用 ♭。
 */
export function spellInKey(midi: number, sig: KeySig): SpelledNote {
  const pc = pcOf(midi);
  const useSharp = sig.fifths >= 0;

  for (let letter = 0; letter < 7; letter++) {
    const natPc = NAT_PC[letter]!;
    const sigAdj = sig.sig.get(natPc) ?? 0;
    const basePc = pcOf(natPc + sigAdj);
    if (basePc === pc) return makeSpelled(midi, letter, 0);
  }
  // 调外音：优先「还原调号」（如 G 大调的 F♮）
  for (let letter = 0; letter < 7; letter++) {
    const natPc = NAT_PC[letter]!;
    const sigAdj = sig.sig.get(natPc) ?? 0;
    if (sigAdj !== 0 && natPc === pc) return makeSpelled(midi, letter, 2);
  }
  for (let letter = 0; letter < 7; letter++) {
    const natPc = NAT_PC[letter]!;
    const sigAdj = sig.sig.get(natPc) ?? 0;
    const basePc = pcOf(natPc + sigAdj);
    if (useSharp && pcOf(basePc + 1) === pc) return makeSpelled(midi, letter, 1);
    if (!useSharp && pcOf(basePc - 1) === pc) return makeSpelled(midi, letter, -1);
  }
  // 理论不可达（12 个音高类必有一种拼法），兜底按自然音
  return makeSpelled(midi, nearestLetter(pc), 0);
}

function makeSpelled(midi: number, letter: number, acc: -1 | 0 | 1 | 2): SpelledNote {
  const targetPc = pcOf(NAT_PC[letter]! + acc);
  // 求八度：使「字母自然音 + 临时记号」的音高最接近实际 MIDI
  let octave = Math.floor(midi / 12) - 1;
  let best = Math.abs((octave + 1) * 12 + targetPc - midi);
  for (const o of [octave - 1, octave + 1]) {
    const d = Math.abs((o + 1) * 12 + targetPc - midi);
    if (d < best) {
      best = d;
      octave = o;
    }
  }
  return { letter, octave, acc, step: octave * 7 + letter };
}

function nearestLetter(pc: number): number {
  let best = 0;
  let bestD = 12;
  for (let l = 0; l < 7; l++) {
    const d = Math.min(Math.abs(NAT_PC[l]! - pc), 12 - Math.abs(NAT_PC[l]! - pc));
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best;
}

/** 拼写结果的记号显示：-1 ♭ / 0 无 / +1 ♯ / 2 ♮ */
export const ACC_SYMBOL: Record<number, string> = { '-1': '♭', 0: '', 1: '♯', 2: '♮' };
const LETTER_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

export function spelledName(n: SpelledNote): string {
  return `${LETTER_NAMES[n.letter]}${ACC_SYMBOL[n.acc]}`;
}

// ───────────── 调号识别（导入谱面自动判调） ─────────────

const MAJOR_SCALE: readonly number[] = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE: readonly number[] = [0, 2, 3, 5, 7, 8, 10];

/**
 * 极简判调：调内音占比 + 主音出现频次加权（首尾音常是主音），
 * 并列时优先升降号少的调、再优先大调（导入小曲的直觉预期）。
 */
export function detectKey(midis: readonly number[]): { keyPc: number; tonality: Tonality } {
  const counts = new Array<number>(12).fill(0);
  let total = 0;
  for (const m of midis) {
    counts[pcOf(m)]!++;
    total++;
  }
  if (total === 0) return { keyPc: 0, tonality: 'major' };

  let best: { keyPc: number; tonality: Tonality; score: number; accidentals: number } | null = null;
  for (let keyPc = 0; keyPc < 12; keyPc++) {
    for (const tonality of ['major', 'minor'] as const) {
      const scale = tonality === 'major' ? MAJOR_SCALE : MINOR_SCALE;
      let inCount = 0;
      for (let pc = 0; pc < 12; pc++) {
        if (scale.includes(pcOf(pc - keyPc))) inCount += counts[pc]!;
      }
      // 主音权重：主音出现越频繁越像这个调（首尾音再加一票）
      let tonicCount = counts[keyPc]!;
      const first = pcOf(midis[0]!);
      const last = pcOf(midis[midis.length - 1]!);
      if (first === keyPc) tonicCount += 1;
      if (last === keyPc) tonicCount += 1;
      const score = inCount / total + (tonicCount / (total + 2)) * 0.06;
      const accidentals = Math.abs(keyFifths(keyPc, tonality));
      if (
        !best ||
        score > best.score + 1e-6 ||
        (Math.abs(score - best.score) < 1e-6 &&
          (accidentals < best.accidentals ||
            (accidentals === best.accidentals && tonality === 'major' && best.tonality === 'minor')))
      ) {
        best = { keyPc, tonality, score, accidentals };
      }
    }
  }
  return best ? { keyPc: best.keyPc, tonality: best.tonality } : { keyPc: 0, tonality: 'major' };
}

// ───────────── 和弦性质词表 ─────────────

export type ChordQualityId = 'maj' | 'min' | 'dim' | 'aug' | '7' | 'maj7' | 'm7' | 'sus2' | 'sus4';

export interface ChordQualityDef {
  id: ChordQualityId;
  name: string;
  suffix: string;
  intervals: readonly number[];
}

export const CHORD_QUALITIES: readonly ChordQualityDef[] = [
  { id: 'maj', name: '大三', suffix: '', intervals: [0, 4, 7] },
  { id: 'min', name: '小三', suffix: 'm', intervals: [0, 3, 7] },
  { id: 'dim', name: '减三', suffix: 'dim', intervals: [0, 3, 6] },
  { id: 'aug', name: '增三', suffix: 'aug', intervals: [0, 4, 8] },
  { id: '7', name: '属七', suffix: '7', intervals: [0, 4, 7, 10] },
  { id: 'maj7', name: '大七', suffix: 'maj7', intervals: [0, 4, 7, 11] },
  { id: 'm7', name: '小七', suffix: 'm7', intervals: [0, 3, 7, 10] },
  { id: 'sus2', name: '挂二', suffix: 'sus2', intervals: [0, 2, 7] },
  { id: 'sus4', name: '挂四', suffix: 'sus4', intervals: [0, 5, 7] },
];

export const QUALITY_MAP: ReadonlyMap<ChordQualityId, ChordQualityDef> = new Map(
  CHORD_QUALITIES.map((q) => [q.id, q]),
);

export function chordPcs(rootPc: number, quality: ChordQualityId): number[] {
  const set = new Set<number>();
  for (const i of QUALITY_MAP.get(quality)!.intervals) set.add(pcOf(rootPc + i));
  return [...set].sort((a, b) => a - b);
}

export function chordName(rootPc: number, quality: ChordQualityId): string {
  return `${pcName(rootPc)}${QUALITY_MAP.get(quality)!.suffix}`;
}

const QUALITY_CN: Record<ChordQualityId, string> = {
  maj: '大三和弦',
  min: '小三和弦',
  dim: '减三和弦',
  aug: '增三和弦',
  '7': '属七和弦',
  maj7: '大七和弦',
  m7: '小七和弦',
  sus2: '挂二和弦',
  sus4: '挂四和弦',
};

/**
 * 认和弦：给定一组按下的音高（MIDI），找出精确匹配的三/四和弦。
 * 返回「C 大三和弦」这样的人话名字；最低音不是根音时标注转位（C/E）。
 * 先按「最低音 = 根音」找（C F G 低 C 是 C 挂四而不是 F 挂二），
 * 找不到再放宽到任意根音（转位）；认不出来返回 null。
 */
export function detectChordName(midis: readonly number[]): string | null {
  const pcs = pcSetOf(midis);
  if (pcs.length < 3 || pcs.length > 4) return null;
  const order: ChordQualityId[] = ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4', '7', 'maj7', 'm7'];
  const lowest = pcOf(Math.min(...midis));

  const tryRoot = (root: number): ChordQualityId | null => {
    for (const q of order) {
      const want = QUALITY_MAP.get(q)!.intervals;
      if (want.length !== pcs.length) continue;
      const got = new Set(want.map((i) => pcOf(root + i)));
      if (got.size === pcs.length && pcs.every((p) => got.has(p))) return q;
    }
    return null;
  };

  const inversions: { root: number; q: ChordQualityId }[] = [];
  for (const root of pcs) {
    const q = tryRoot(root);
    if (q) {
      if (root === lowest) return `${pcName(root)} ${QUALITY_CN[q]}`;
      inversions.push({ root, q });
    }
  }
  const inv = inversions[0];
  return inv ? `${pcName(inv.root)}/${pcName(lowest)} ${QUALITY_CN[inv.q]}（转位）` : null;
}

// ───────────── 走向（级数 → 和弦） ─────────────

export interface ProgStep {
  /** 级数 1-7 */
  d: number;
  /** 临时升降（-1 = ♭，1 = ♯），相对自然音级 */
  acc?: -1 | 0 | 1;
  /** 性质覆盖；缺省用调式自然三和弦 */
  q?: 'maj' | 'min' | 'dim';
}

export const SCALE_OFFSETS: Record<Tonality, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

export const SCALE_QUALITIES: Record<Tonality, readonly ('maj' | 'min' | 'dim')[]> = {
  major: ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'],
  minor: ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'],
};

export function stepRootPc(keyPc: number, tonality: Tonality, step: ProgStep): number {
  return pcOf(keyPc + SCALE_OFFSETS[tonality][step.d - 1]! + (step.acc ?? 0));
}

export function stepQuality(tonality: Tonality, step: ProgStep): 'maj' | 'min' | 'dim' {
  return step.q ?? SCALE_QUALITIES[tonality][step.d - 1]!;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;

/** 罗马数字标签：小写 = 小三，°= 减三，前缀 ♭/♯ */
export function stepLabel(tonality: Tonality, step: ProgStep): string {
  const q = stepQuality(tonality, step);
  let label: string = ROMAN[step.d - 1]!;
  if (q === 'min') label = label.toLowerCase();
  else if (q === 'dim') label = label.toLowerCase() + '°';
  if (step.acc === -1) label = '♭' + label;
  else if (step.acc === 1) label = '♯' + label;
  return label;
}

export function stepChordName(keyPc: number, tonality: Tonality, step: ProgStep): string {
  return chordName(stepRootPc(keyPc, tonality, step), stepQuality(tonality, step));
}

/**
 * 就近 voicing：给定目标和弦音高类与参考中心音，在 [lo, hi] 内选一套
 * 平均距中心最近、音域最窄的把位。走向谱面与琶音展开共用。
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
    const notes = [...raw].sort((a, b) => a - b);
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
      const invIv = intervals.map((i) => {
        let x = i - intervals[inv]!;
        while (x < 0) x += 12;
        return x;
      });
      const bassPc = pcOf(rootPc + intervals[inv]!);
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
