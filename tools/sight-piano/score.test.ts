import { describe, it, expect } from 'vitest';
import { buildScore, JudgeSession, accuracyOf, starsOf } from './score';

function melodyScore() {
  return buildScore(
    [
      { beat: 0, dur: 1, midis: [60] },
      { beat: 1, dur: 1, midis: [] }, // 休止符自动跳过
      { beat: 2, dur: 1, midis: [64] },
      { beat: 3, dur: 1, midis: [67] },
    ],
    { id: 't', title: '测试', stage: 'read', keyPc: 0 },
  );
}

function chordScore() {
  return buildScore(
    [
      { beat: 0, dur: 4, midis: [48, 52, 55], label: 'C' },
      { beat: 4, dur: 4, midis: [53, 57, 60], label: 'F' },
    ],
    { id: 'c', title: '和弦', stage: 'chord', keyPc: 0 },
  );
}

describe('buildScore', () => {
  it('排序、拼写、总长按小节取整', () => {
    const s = buildScore(
      [
        { beat: 2, dur: 1, midis: [64] },
        { beat: 0, dur: 1, midis: [60] },
      ],
      { id: 'x', title: 'x', stage: 'read', keyPc: 0, beatsPerBar: 4 },
    );
    expect(s.events[0]!.midis[0]).toBe(60);
    expect(s.events[0]!.spelled[0]!.step).toBe(28);
    expect(s.totalBeats).toBe(4);
  });
});

describe('JudgeSession · exact（识谱/琶音）', () => {
  it('命中推进、休止符跳过、错音记 miss 不推进', () => {
    const s = new JudgeSession(melodyScore(), 'exact');
    expect(s.current()!.midis[0]).toBe(60); // 第一个目标是 60（休止符被跳过）

    expect(s.feedOn(61).type).toBe('miss');
    expect(s.stats().misses).toBe(1);
    expect(s.current()!.midis[0]).toBe(60);

    const hit = s.feedOn(60);
    expect(hit.type).toBe('hit');
    expect(s.current()!.midis[0]).toBe(64); // 越过休止符

    // 同音按住不松不会重复命中
    expect(s.feedOn(60).type).toBe('ignore');
  });

  it('弹完后 done', () => {
    const s = new JudgeSession(melodyScore(), 'exact');
    s.feedOn(60);
    s.feedOff(60);
    s.feedOn(64);
    s.feedOff(64);
    s.feedOn(67);
    expect(s.stats().done).toBe(true);
    expect(s.feedOn(60).type).toBe('ignore');
    expect(accuracyOf(s.stats())).toBe(1);
    expect(starsOf(s.stats())).toBe(3);
  });

  it('评星：正确率分档', () => {
    const s = new JudgeSession(melodyScore(), 'exact');
    s.feedOn(61); // miss
    s.feedOn(60);
    s.feedOff(60);
    s.feedOn(64);
    s.feedOff(64);
    s.feedOn(67);
    const st = s.stats();
    expect(st.done).toBe(true);
    expect(accuracyOf(st)).toBeCloseTo(0.75, 5);
    expect(starsOf(st)).toBe(1);
    expect(starsOf({ ...st, done: false })).toBe(0);
  });
});

describe('JudgeSession · chord（和弦走向）', () => {
  it('按齐目标音高类才算命中，与八度无关', () => {
    const s = new JudgeSession(chordScore(), 'chord');
    expect(s.feedOn(48).type).toBe('ignore'); // C
    expect(s.feedOn(64).type).toBe('ignore'); // E（高八度也算）
    const hit = s.feedOn(55); // G
    expect(hit.type).toBe('hit');
    expect(s.current()!.label).toBe('F');
  });

  it('多余的音记 miss 但不打断，松掉后还能凑齐', () => {
    const s = new JudgeSession(chordScore(), 'chord');
    s.feedOn(48);
    expect(s.feedOn(49).type).toBe('miss'); // C# 多余
    s.feedOff(49);
    s.feedOn(52);
    expect(s.feedOn(55).type).toBe('hit');
  });

  it('演奏模式 advanceMissed：未命中强推并断连击', () => {
    const s = new JudgeSession(chordScore(), 'chord');
    const ev = s.advanceMissed();
    expect(ev!.label).toBe('C');
    expect(s.current()!.label).toBe('F');
    expect(s.stats().misses).toBe(1);
    expect(s.advanceMissed()).not.toBeNull();
    expect(s.stats().done).toBe(true);
    expect(s.advanceMissed()).toBeNull();
  });
});
