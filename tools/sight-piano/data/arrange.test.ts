import { describe, it, expect } from 'vitest';
import { arrangeLeftHand } from './arrange';
import { buildScore, isGrand, scoreRange } from '../score';

/** C 大调 4/4 旋律：I 级小节 + V 级倾向小节 */
const C_MELODY = [
  { beat: 0, dur: 1, midi: 60 }, // C
  { beat: 1, dur: 1, midi: 64 }, // E
  { beat: 2, dur: 1, midi: 67 }, // G
  { beat: 3, dur: 1, midi: 64 },
  { beat: 4, dur: 1, midi: 62 }, // D
  { beat: 5, dur: 1, midi: 71 }, // B
  { beat: 6, dur: 1, midi: 67 }, // G
  { beat: 7, dur: 1, midi: 62 },
];

describe('arrangeLeftHand 自动配左手', () => {
  const base = { keyPc: 0, tonality: 'major' as const, beatsPerBar: 4, totalBeats: 8 };

  it('whole：每小节一个根音全音符，首尾是主和弦', () => {
    const lh = arrangeLeftHand(C_MELODY, { ...base, style: 'whole' });
    expect(lh.length).toBe(2);
    expect(lh[0]!.dur).toBe(4);
    expect(lh[0]!.bassMidis![0]! % 12).toBe(0); // C 根音
    expect(lh[1]!.bassMidis![0]! % 12).toBe(7); // G（第二小节 D B G D 属功能）
  });

  it('broken：每拍一个音，音高取自根/五/八', () => {
    const lh = arrangeLeftHand(C_MELODY, { ...base, style: 'broken' });
    expect(lh.length).toBe(8);
    const first = lh[0]!.bassMidis![0]!;
    for (const e of lh.slice(0, 4)) {
      const interval = (e.bassMidis![0]! - first) % 12;
      expect([0, 7]).toContain(interval);
    }
    expect(lh.every((e) => e.dur === 1)).toBe(true);
  });

  it('alberti：八分音符 1-8-5-8 循环', () => {
    const lh = arrangeLeftHand(C_MELODY, { ...base, style: 'alberti' });
    expect(lh.length).toBe(16);
    expect(lh.every((e) => e.dur === 0.5)).toBe(true);
    const root = lh[0]!.bassMidis![0]!;
    expect(lh[1]!.bassMidis![0]).toBe(root + 12);
    expect(lh[2]!.bassMidis![0]).toBe(root + 7);
  });

  it('左手音域收在 F2–E3，且每个事件带和弦标签与 bassPc', () => {
    const lh = arrangeLeftHand(C_MELODY, { ...base, style: 'broken' });
    for (const e of lh) {
      const m = e.bassMidis![0]!;
      expect(m).toBeGreaterThanOrEqual(41);
      expect(m).toBeLessThanOrEqual(64);
    }
    expect(lh[0]!.label).toBeTruthy();
    expect(lh[0]!.bassPc).toBeDefined();
  });

  it('小调旋律：含 #7 时偏向和声小调 V（大三）', () => {
    // a 小调旋律，第二小节全是 E G# B（V 和弦音）
    const amMelody = [
      { beat: 0, dur: 2, midi: 69 }, // A
      { beat: 2, dur: 2, midi: 72 }, // C
      { beat: 4, dur: 1, midi: 64 }, // E
      { beat: 5, dur: 1, midi: 68 }, // G#
      { beat: 6, dur: 1, midi: 71 }, // B
      { beat: 7, dur: 1, midi: 64 },
    ];
    const lh = arrangeLeftHand(amMelody, {
      keyPc: 9,
      tonality: 'minor',
      beatsPerBar: 4,
      totalBeats: 8,
      style: 'whole',
    });
    expect(lh[0]!.bassMidis![0]! % 12).toBe(9); // A
    expect(lh[1]!.label).toBe('E'); // 大三 V（不是 Em）
  });

  it('与旋律合并后经 buildScore 成为大谱表双手谱', () => {
    const rh = C_MELODY.map((e) => ({ beat: e.beat, dur: e.dur, midis: [e.midi] }));
    const lh = arrangeLeftHand(C_MELODY, { ...base, style: 'broken' });
    const score = buildScore([...rh, ...lh], {
      id: 't',
      title: 't',
      stage: 'read',
      keyPc: 0,
    });
    expect(isGrand(score)).toBe(true);
    // 同拍合并：8 个事件（不是 16 个）
    expect(score.events.length).toBe(8);
    const r = scoreRange(score)!;
    expect(r.lo).toBeLessThanOrEqual(48);
    expect(r.hi).toBeGreaterThanOrEqual(71);
  });
});
