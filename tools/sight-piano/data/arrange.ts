/**
 * 识谱琴房 —— 自动配左手（双手视奏曲的生产车间）。
 *
 * 输入一条单旋律（beat/dur/midi）和调性，输出低音谱表的左手事件流：
 * 逐小节从自然音阶三和弦里选出与旋律音重合度最高的和弦
 * （首尾小节偏向主和弦、小调额外考虑和声小调的 V），
 * 再按三种织体铺开：
 *   whole   —— 全音符单音根音（入门双手：左手只管「按住」）
 *   broken  —— 四分分解 1-5-8-5（进阶：左手开始走路）
 *   alberti —— 八分阿尔贝蒂 1-8-5-8（挑战：古典左手标配）
 * 左手音域收在 F2–B3（41–59），低音谱表上加线以内，双手总跨度
 * 控制在 25/32 键窗口跟得上的范围。输出事件带和弦标签与 bassPc，
 * 伴奏贝斯在演奏模式会跟着和弦根音走。
 */

import {
  SCALE_OFFSETS,
  SCALE_QUALITIES,
  chordName,
  keySigOf,
  pcOf,
  spellInKey,
  type Tonality,
} from '../theory';
import type { RawEvent } from '../score';

export type ArrangeStyle = 'whole' | 'broken' | 'alberti';

export const ARRANGE_LABEL: Record<ArrangeStyle, string> = {
  whole: '双手 · 根音长音',
  broken: '双手 · 分解和弦',
  alberti: '双手 · 阿尔贝蒂',
};

export interface ArrangeOpts {
  keyPc: number;
  tonality: Tonality;
  beatsPerBar: number;
  totalBeats: number;
  style: ArrangeStyle;
}

interface MelodyNote {
  beat: number;
  dur: number;
  midi: number;
}

/** 旋律音落在和弦音上的加权得分（正拍权重高） */
function barChordScore(
  notes: readonly MelodyNote[],
  chordPcs: ReadonlySet<number>,
  barStart: number,
  beatsPerBar: number,
): number {
  let score = 0;
  for (const n of notes) {
    const inBar = n.beat - barStart;
    if (inBar < -1e-6 || inBar >= beatsPerBar - 1e-6) continue;
    const w = (inBar % 2 < 1e-6 ? 2 : 1) * Math.min(n.dur, 2);
    score += chordPcs.has(pcOf(n.midi)) ? 2 * w : -w;
  }
  return score;
}

/** 一小节的候选和弦：自然三和弦；小调追加和声小调 V（大三） */
function candidates(
  keyPc: number,
  tonality: Tonality,
): { rootPc: number; q: 'maj' | 'min' | 'dim'; degree: number }[] {
  const out: { rootPc: number; q: 'maj' | 'min' | 'dim'; degree: number }[] = [];
  const offsets = SCALE_OFFSETS[tonality];
  const qualities = SCALE_QUALITIES[tonality];
  for (let d = 0; d < 7; d++) {
    out.push({ rootPc: pcOf(keyPc + offsets[d]!), q: qualities[d]!, degree: d + 1 });
  }
  if (tonality === 'minor') {
    // 和声小调 V：升七音的大三和弦（小调旋律里 #7 出现时首选）
    out.push({ rootPc: pcOf(keyPc + offsets[4]!), q: 'maj', degree: 5 });
  }
  return out;
}

const QUALITY_INTERVALS: Record<'maj' | 'min' | 'dim', readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
};

/** 根音音高类 → 左手音区的 MIDI（收在 41–52：F2–E3，低音谱表腹地） */
function bassMidi(rootPc: number): number {
  for (let m = 41; m <= 52; m++) if (pcOf(m) === rootPc) return m;
  // 41–52 必含全部 12 个音高类，理论不可达
  return 41 + rootPc;
}

/**
 * 给旋律配左手。返回与旋律事件并排的左手事件流（midis 恒为空，
 * 全部写在 bassMidis 上），buildScore 会把同拍事件合并成双手事件。
 */
export function arrangeLeftHand(
  melody: readonly MelodyNote[],
  opts: ArrangeOpts,
): RawEvent[] {
  const { keyPc, tonality, beatsPerBar, totalBeats, style } = opts;
  const barCount = Math.ceil(totalBeats / beatsPerBar);
  const cands = candidates(keyPc, tonality);
  const out: RawEvent[] = [];

  /** 每小节选定的和弦 */
  const chosen: { rootPc: number; q: 'maj' | 'min' | 'dim'; degree: number }[] = [];
  for (let bar = 0; bar < barCount; bar++) {
    const barStart = bar * beatsPerBar;
    const priority = [1, 5, 4, 6, 2, 3, 7]; // 同分时的级数偏好
    const isBoundary = bar === 0 || bar === barCount - 1;
    let best = cands[0]!;
    let bestScore = -Infinity;
    for (const c of cands) {
      const pcs = new Set(QUALITY_INTERVALS[c.q].map((i) => pcOf(c.rootPc + i)));
      let s = barChordScore(melody, pcs, barStart, beatsPerBar);
      if (isBoundary && c.degree === 1 && c.q === (tonality === 'minor' ? 'min' : 'maj')) s += 1.5;
      s += (8 - priority.indexOf(c.degree)) * 0.01; // 稳定的微偏好，保证确定性
      if (s > bestScore + 1e-9) {
        bestScore = s;
        best = c;
      }
    }
    chosen.push(best);
  }

  chosen.forEach((chord, bar) => {
    const barStart = bar * beatsPerBar;
    const root = bassMidi(chord.rootPc);
    const fifth = root + 7;
    const octave = root + 12;
    const label = chordName(chord.rootPc, chord.q);
    const base = { label, bassPc: chord.rootPc, midis: [] as number[] };

    if (style === 'whole') {
      out.push({ ...base, beat: barStart, dur: beatsPerBar, bassMidis: [root] });
      return;
    }
    if (style === 'broken') {
      // 四分分解：1 5 8 5（三拍子取前三个）
      const seq = [root, fifth, octave, fifth];
      for (let b = 0; b < beatsPerBar; b++) {
        out.push({
          ...(b === 0 ? base : { midis: [] as number[] }),
          beat: barStart + b,
          dur: 1,
          bassMidis: [seq[b % seq.length]!],
        });
      }
      return;
    }
    // alberti：八分 1 8 5 8 循环
    const seq = [root, octave, fifth, octave];
    for (let s = 0; s < beatsPerBar * 2; s++) {
      out.push({
        ...(s === 0 ? base : { midis: [] as number[] }),
        beat: barStart + s * 0.5,
        dur: 0.5,
        bassMidis: [seq[s % seq.length]!],
      });
    }
  });

  return out;
}

/** 快速自检：旋律里每个音在给定调性下的拼写（调外用临时记号）——arrange 测试用 */
export function spellMelody(melody: readonly MelodyNote[], keyPc: number, tonality: Tonality) {
  const sig = keySigOf(keyPc, tonality);
  return melody.map((n) => spellInKey(n.midi, sig));
}
