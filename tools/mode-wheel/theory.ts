/**
 * 调式罗盘 —— 乐理引擎（纯函数，不碰 DOM / Web Audio，方便 vitest 单测）。
 *
 * 三大块：
 *   1. 五度圈：音高类 ↔ 圈上位置的互换，以及按调选升降拼写
 *   2. 调式和弦表：给定调式音程表 + 主音，对每个级数根音试四种三和弦
 *      形状（大/小/减/增），哪些的音全部落在调式音集合里——这一个算法
 *      自动得到「Ⅰ/i 并立、♯Ⅱ、iii°、5 级空缺、vi/vi° 并立」这类
 *      视频里手工整理的表格，且对任意七声调式通用
 *   3. 色彩与发声数据：共同音计数（转盘染色的"远近"依据）、罗马数字
 *      标签、把 voicing 放到指定音区 / 做最近转位连接
 *
 * 级数语义：度数标签相对自然大调书写（Mixolydian ♯2 的第二个音记作
 * ♯2 而非"第 2 个音"），因此同一条级数进行可以跨调式对齐——这是
 * 「调式变形对比」玩法的数据基础。
 */

// ───────────── 基础 ─────────────

export const PC_NAMES_SHARP = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;
export const PC_NAMES_FLAT = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
] as const;

/** MIDI → 音高类 0-11 */
export function pcOf(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

/** 音高类 → 显示名；preferFlat 用降号拼写（F/Bb/Eb/Ab/Db/Gb 调） */
export function pcName(pc: number, preferFlat = false): string {
  return (preferFlat ? PC_NAMES_FLAT : PC_NAMES_SHARP)[pcOf(pc)]!;
}

/** MIDI → 频率（A4=69=440Hz） */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** 该主音的调习惯用降号拼写（F、Bb、Eb、Ab、Db、Gb） */
export function prefersFlat(keyPc: number): boolean {
  return [1, 3, 5, 6, 8, 10].includes(pcOf(keyPc));
}

// ───────────── 五度圈 ─────────────

/** 五度圈上的音高类（顺时针，从顶部 C 开始）：C G D A E B F# Db Ab Eb Bb F */
export const FIFTH_ORDER: readonly number[] = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

/** 音高类 → 五度圈位置 0-11（0 = 顶部 C，顺时针） */
export function fifthIndex(pc: number): number {
  return FIFTH_ORDER.indexOf(pcOf(pc));
}

// ───────────── 调式定义 ─────────────

export interface ModeDef {
  id: string;
  /** 英文名（谱面惯例），如 Mixolydian ♯2 */
  name: string;
  /** 中文名 */
  zhName: string;
  icon: string;
  /** 一句话听感 */
  flavor: string;
  /** 相对主音的半音音程（含 0，升序，七声） */
  offsets: readonly number[];
  /** 度数标签（相对自然大调书写），如 ['1','♯2','3','4','5','6','♭7'] */
  degreeLabels: readonly string[];
  /** 特征音级下标（转盘上打 ▽ 标记）；-1 表示无 */
  signature: number;
}

// ───────────── 和弦表 ─────────────

export type TriadQuality = 'maj' | 'min' | 'dim' | 'aug';

export const TRIAD_SHAPES: Record<TriadQuality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
};

export const QUALITY_NAME: Record<TriadQuality, string> = {
  maj: '大三和弦',
  min: '小三和弦',
  dim: '减三和弦',
  aug: '增三和弦',
};

/** 主位/备用和 chord 的挑选优先级：大 > 小 > 减 > 增 */
const QUALITY_PREFERENCE: readonly TriadQuality[] = ['maj', 'min', 'dim', 'aug'];

const ROMAN_UPPER = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ'] as const;
const ROMAN_LOWER = ['ⅰ', 'ⅱ', 'ⅲ', 'ⅳ', 'ⅴ', 'ⅵ', 'ⅶ'] as const;

/** 度数标签 + 三和弦性质 → 罗马数字（'♯2'+maj → '♯Ⅱ'；'3'+dim → 'ⅲ°'） */
export function numeralFor(degreeLabel: string, quality: TriadQuality): string {
  const acc = degreeLabel[0] === '♯' || degreeLabel[0] === '♭' ? degreeLabel[0] : '';
  const n = Number(acc ? degreeLabel.slice(1) : degreeLabel);
  const roman = quality === 'maj' || quality === 'aug' ? ROMAN_UPPER[n - 1]! : ROMAN_LOWER[n - 1]!;
  const suffix = quality === 'dim' ? '°' : quality === 'aug' ? '+' : '';
  return acc + roman + suffix;
}

export interface DegreeChord {
  quality: TriadQuality;
  rootPc: number;
  /** 和弦音高类（3 个） */
  pcs: number[];
  numeral: string;
  /** 主位和弦（每级至多一个）或备用和弦（如 ⅰ、ⅵ°） */
  primary: boolean;
  /** 与主和弦的共同音数 0-3（转盘染色的"远近"依据） */
  common: number;
}

export interface DegreeInfo {
  /** 级下标 0-6 */
  index: number;
  /** 度数标签（'♯2'） */
  label: string;
  rootPc: number;
  /** 该级可用的三和弦（0-2 个；空 = 堆不出正常三和弦，显示 '–'） */
  chords: DegreeChord[];
}

export interface ModeTable {
  mode: ModeDef;
  keyPc: number;
  /** 调内 7 个音高类（按级数顺序，非音高序） */
  pcSet: number[];
  degrees: DegreeInfo[];
  /** 主和弦音高类（共同音计数的基准） */
  tonicPcs: number[];
}

/**
 * 生成调式和弦表：对每级根音试四种三和弦形状，音全在调内即成立。
 * 第一个成立的（大>小>减>增）为主位和弦，其余为备用和弦。
 */
export function buildModeTable(mode: ModeDef, keyPc: number): ModeTable {
  const pcSet = mode.offsets.map((o) => pcOf(keyPc + o));

  const fitsPerDegree = mode.offsets.map((off, i) => {
    const rootPc = pcOf(keyPc + off);
    const fits = QUALITY_PREFERENCE.filter((q) =>
      TRIAD_SHAPES[q].every((iv) => pcSet.includes(pcOf(rootPc + iv))),
    );
    return { index: i, label: mode.degreeLabels[i]!, rootPc, fits };
  });

  // 共同音基准：主和弦（Ⅰ 主位）；极端调式若Ⅰ级无和弦，退化为纯五度框架
  const tonicFits = fitsPerDegree[0]!.fits;
  const tonicQuality = tonicFits[0];
  const tonicPcs = tonicQuality
    ? TRIAD_SHAPES[tonicQuality].map((iv) => pcOf(keyPc + iv))
    : [keyPc, pcOf(keyPc + 7)];

  const degrees: DegreeInfo[] = fitsPerDegree.map(({ index, label, rootPc, fits }) => ({
    index,
    label,
    rootPc,
    chords: fits.map((quality, rank) => {
      const pcs = TRIAD_SHAPES[quality].map((iv) => pcOf(rootPc + iv));
      return {
        quality,
        rootPc,
        pcs,
        numeral: numeralFor(label, quality),
        primary: rank === 0,
        common: pcs.filter((p) => tonicPcs.includes(p)).length,
      };
    }),
  }));

  return { mode, keyPc: pcOf(keyPc), pcSet, degrees, tonicPcs };
}

/** 级的显示标签：主位罗马数字（无和弦时 '–'） */
export function degreePrimaryNumeral(degree: DegreeInfo): string {
  return degree.chords[0]?.numeral ?? '–';
}

// ───────────── 进行 ─────────────

export interface WheelStep {
  /** 级下标 0-6 */
  d: number;
  /** true = 用备用和弦（如 ⅰ、ⅵ°） */
  alt?: boolean;
}

export interface WheelProg {
  id: string;
  name: string;
  icon: string;
  desc: string;
  steps: readonly WheelStep[];
}

/** 解析一步 → 具体和弦；该级无和弦时返回 null（播放时跳过） */
export function resolveStep(table: ModeTable, step: WheelStep): DegreeChord | null {
  const degree = table.degrees[step.d];
  if (!degree) return null;
  if (step.alt) return degree.chords.find((c) => !c.primary) ?? degree.chords[0] ?? null;
  return degree.chords[0] ?? null;
}

/** 进行预览文本：'Ⅰ → ♯Ⅱ → Ⅳ → Ⅰ' */
export function progPreview(table: ModeTable, prog: WheelProg): string {
  return prog.steps.map((s) => resolveStep(table, s)?.numeral ?? '–').join(' → ');
}

// ───────────── Voicing ─────────────

export type Register = 'low' | 'high';

/** 各音区的 voicing 中心与低音八度 */
const REGISTER_CENTER: Record<Register, { center: number; bassOctave: number }> = {
  low: { center: 54, bassOctave: 2 },
  high: { center: 66, bassOctave: 3 },
};

/**
 * 把一个和弦放进指定音区：低音（根音，低两个八度）+ 三音和弦。
 * prev 给出上一和弦的 chord 音（不含低音），选位移最小的转位，
 * 巡航播放时声部连接顺滑；prev 为 null 时取离中心最近的原位/转位。
 */
export function voiceChord(
  chord: DegreeChord,
  register: Register,
  prev: number[] | null,
): { bass: number; tones: number[] } {
  const { center, bassOctave } = REGISTER_CENTER[register];
  const rootMidi = 12 * (bassOctave + 1) + chord.rootPc;
  const bass = rootMidi - 12;

  // 候选：所有转位 × 上下八度平移，中心落在 44-78 之间
  const n = chord.pcs.length;
  const candidates: number[][] = [];
  for (let inv = 0; inv < n; inv++) {
    const rotated = chord.pcs.map((_, i) => chord.pcs[(i + inv) % n]!);
    const stack: number[] = [];
    let base = 12 * 5 + rotated[0]!; // 以八度 4 为锚
    for (let i = 0; i < n; i++) {
      let tone = 12 * 5 + rotated[i]!;
      while (tone < base) tone += 12;
      stack.push(tone);
      base = tone;
    }
    for (let shift = -24; shift <= 24; shift += 12) {
      const cand = stack.map((t) => t + shift);
      const avg = cand.reduce((a, b) => a + b, 0) / n;
      if (avg >= 44 && avg <= 78) candidates.push(cand);
    }
  }

  const reference = prev ?? [center - 4, center, center + 4];
  let best = candidates[0]!;
  let bestScore = Infinity;
  for (const cand of candidates) {
    const score = cand.reduce((acc, t, i) => acc + Math.abs(t - (reference[i] ?? center)), 0);
    if (score < bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return { bass, tones: best };
}

// ───────────── 分享编码 ─────────────

/**
 * 把进行编码进 URL hash 的紧凑格式：
 * 级下标（0-6）用 '.' 连接，备用和弦在数字后加 'a'。
 * 例：[{d:0},{d:1},{d:0,alt:true},{d:3}] → '0.1.0a.3'
 */
export function encodeSteps(steps: readonly WheelStep[]): string {
  return steps.map((s) => `${s.d}${s.alt ? 'a' : ''}`).join('.');
}

/** 解码；格式非法或级下标越界（非 0-6）时返回 null，调用方静默回退 */
export function decodeSteps(encoded: string): WheelStep[] | null {
  if (!/^[0-6]a?(\.[0-6]a?)*$/.test(encoded)) return null;
  return encoded.split('.').map((tok) => ({
    d: Number(tok[0]),
    alt: tok.endsWith('a') || undefined,
  }));
}

/**
 * MIDI 音高 → 最近的调内度数 + 八度偏移（MIDI 键盘输入吸附到调内音）。
 * 八度基准与旋律垫一致：octave 0 = 落在 C4 八度区段（midi 60-71），钳制 -1..+1；
 * 调外音按半音距离吸附到最近度数，平手取低度数。
 */
export function midiToDegree(
  mode: ModeDef,
  keyPc: number,
  midi: number,
): { deg: number; octave: number } | null {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) return null;
  const pc = (((midi - keyPc) % 12) + 12) % 12;
  let bestDeg = -1;
  let bestDist = 99;
  mode.offsets.forEach((off, deg) => {
    const dist = Math.min(Math.abs(off - pc), 12 - Math.abs(off - pc));
    if (dist < bestDist) {
      bestDist = dist;
      bestDeg = deg;
    }
  });
  if (bestDeg < 0) return null;
  const off = mode.offsets[bestDeg]!;
  const octave = Math.max(-1, Math.min(1, Math.round((midi - keyPc - off) / 12) - 5));
  return { deg: bestDeg, octave };
}
