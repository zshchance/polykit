/**
 * 识谱琴房 —— 导入统一入口：格式探测 → 解析 → 自动整理成可演奏谱面。
 *
 * 「自动整理」做三件事：
 *   1. 判调：未指定调号时按音高类分布选出最省升降号的调
 *   2. 移调居中：整曲按八度平移，让旋律中位音落在 C4–C5 附近
 *      （25/32 键窗口与便携 MIDI 键盘的舒适区）
 *   3. 收口：音域超界再按八度收、事件排序去重
 */

import { parseJianpu, type ParsedSheet } from './jianpu';
import { parseAbc } from './abc';
import { parseMidiFile } from './midifile';
import { buildScore, type RawEvent, type Score, type Stage } from '../score';
import { detectKey } from '../theory';

export type ImportSource = { kind: 'text'; text: string } | { kind: 'midi'; buf: ArrayBuffer };

export interface ImportResult {
  score: Score;
  warnings: string[];
  /** 识别出的格式（展示用） */
  format: '简谱' | 'ABC' | 'MIDI';
}

/** 自动识别并解析；titleHint 在谱内没有标题时使用（如文件名） */
export function importSheet(
  source: ImportSource,
  id: string,
  stage: Stage,
  titleHint?: string,
): ImportResult {
  let parsed: ParsedSheet;
  let format: ImportResult['format'];
  if (source.kind === 'midi') {
    parsed = parseMidiFile(source.buf);
    format = 'MIDI';
  } else {
    const text = source.text.trim();
    // ABC 的指纹：头字段 X:/K: 行
    if (/^[ \t]*[XTMLQK]\s*:/m.test(text)) {
      parsed = parseAbc(text);
      format = 'ABC';
    } else {
      parsed = parseJianpu(text);
      format = '简谱';
    }
  }

  const midis = parsed.events.filter((e) => e.midi !== null).map((e) => e.midi!);
  const key = parsed.keyPc !== null
    ? { keyPc: parsed.keyPc, tonality: parsed.tonality }
    : detectKey(midis);

  const rawEvents: RawEvent[] = parsed.events.map((e) => ({
    beat: e.beat,
    dur: e.dur,
    midis: e.midi === null ? [] : [e.midi],
  }));

  const centered = centerRegister(rawEvents);

  const score = buildScore(centered, {
    id,
    title: parsed.title || titleHint || '未命名曲谱',
    stage,
    keyPc: key.keyPc,
    tonality: key.tonality,
    beatsPerBar: parsed.beatsPerBar,
    beatUnit: parsed.beatUnit,
    bpm: parsed.bpm,
    group: '我的曲库',
  });
  return { score, warnings: parsed.warnings, format };
}

/** 八度平移：中位音收进 [62, 72]，再保证整体不越出 36–96 */
function centerRegister(events: readonly RawEvent[]): RawEvent[] {
  const midis = events.flatMap((e) => e.midis).sort((a, b) => a - b);
  if (!midis.length) return [...events];
  const median = midis[Math.floor(midis.length / 2)]!;
  let shift = 0;
  while (median + shift < 62) shift += 12;
  while (median + shift > 72) shift -= 12;
  const lo = midis[0]! + shift;
  const hi = midis[midis.length - 1]! + shift;
  if (lo < 36) shift += 12 * Math.ceil((36 - lo) / 12);
  if (hi > 96) shift -= 12 * Math.ceil((hi - 96) / 12);
  if (shift === 0) return events.map((e) => ({ ...e, midis: [...e.midis] }));
  return events.map((e) => ({
    ...e,
    midis: e.midis.map((m) => m + shift),
  }));
}
