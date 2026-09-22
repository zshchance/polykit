/**
 * 和声引擎 —— 根音 / 和弦性质 / 调式 / 和弦垫 的纯函数计算。
 *
 * 不依赖 Web Audio，输入输出都是 MIDI 音高数字，方便 vitest 直接单测。
 * 音域约定：和弦根音落在 C3-B3（MIDI 48-59），琶音在其上叠八度。
 */

/** 支持和弦性质 → 半音音程（相对根音） */
export type ChordQuality = 'maj' | 'min' | '7' | 'm7' | 'sus4' | 'add9';

export const QUALITY_INTERVALS: Record<ChordQuality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
};

/** 和弦性质的中文后缀（C、Dm、G7、Am7、Dsus4、Cadd9） */
export const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  maj: '',
  min: 'm',
  '7': '7',
  m7: 'm7',
  sus4: 'sus4',
  add9: 'add9',
};

export const ROOT_NAMES = [
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

export type Tonality = 'major' | 'minor';

export const TONALITY_LABEL: Record<Tonality, string> = { major: '大调', minor: '小调' };

/** 和弦垫上的一个和弦：级数标签 + 根音音高类（0-11）+ 性质 */
export interface PadChord {
  /** 罗马数字级数标签（如 I、ii、V7、i、III） */
  degree: string;
  /** 根音音高类 0-11（已含调性偏移） */
  rootPc: number;
  quality: ChordQuality;
}

/**
 * 某调的 8 个和弦垫。
 * 大调：I ii iii IV V vi V7 Iadd9（V7 与 Iadd9 提供色彩替换）；
 * 自然小调：i III iv v V VI VII i7（V 借自和声小调，是小调作品中最常用的倾向性和弦）。
 * 级数相对主音的半音偏移：大调音阶 0 2 4 5 7 9 11，自然小调 0 2 3 5 7 8 10。
 */
export function diatonicPads(keyPc: number, tonality: Tonality): PadChord[] {
  const table: ReadonlyArray<readonly [number, ChordQuality, string]> =
    tonality === 'major'
      ? [
          [0, 'maj', 'I'],
          [2, 'min', 'ii'],
          [4, 'min', 'iii'],
          [5, 'maj', 'IV'],
          [7, 'maj', 'V'],
          [9, 'min', 'vi'],
          [7, '7', 'V7'],
          [0, 'add9', 'Iadd9'],
        ]
      : [
          [0, 'min', 'i'],
          [3, 'maj', 'III'],
          [5, 'min', 'iv'],
          [7, 'min', 'v'],
          [7, 'maj', 'V'],
          [8, 'maj', 'VI'],
          [10, 'maj', 'VII'],
          [0, 'm7', 'i7'],
        ];
  return table.map(([offset, quality, degree]) => ({
    degree,
    rootPc: (keyPc + offset) % 12,
    quality,
  }));
}

/** 和弦显示名（如 C、Dm、G7、Am7） */
export function chordName(rootPc: number, quality: ChordQuality): string {
  return `${ROOT_NAMES[rootPc]}${QUALITY_SUFFIX[quality]}`;
}

/** 琶音基准音区：根音落在 C3-B3，太高会刺耳、太低会糊 */
export const PAD_BASE_MIDI = 48;

/** 和弦垫实际发声的根音 MIDI（48-59） */
export function padRootMidi(rootPc: number): number {
  return PAD_BASE_MIDI + rootPc;
}

/**
 * 计算琶音可用的和弦音列（MIDI，升序）。
 * octaves=2 时在上方再叠一个八度（三和弦 → 6 音，七/九和弦 → 8 音）。
 */
export function chordTones(rootMidi: number, quality: ChordQuality, octaves: 1 | 2): number[] {
  const base = QUALITY_INTERVALS[quality];
  const intervals = octaves === 2 ? [...base, ...base.map((i) => i + 12)] : [...base];
  return intervals.map((i) => rootMidi + i);
}

/** MIDI 音高 → 频率（A4=69=440Hz） */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
