import { describe, it, expect } from 'vitest';
import { buildScore, JudgeSession, accuracyOf, scoreRange, starsOf } from './score';

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

describe('双手谱面（bassMidis）', () => {
  function twoHandScore() {
    return buildScore(
      [
        { beat: 0, dur: 1, midis: [64], bassMidis: [48] }, // 右手 E4 + 左手 C3
        { beat: 1, dur: 1, midis: [67] }, // 右手 G4（左手按住不响）
        { beat: 2, dur: 1, midis: [], bassMidis: [43] }, // 纯左手 G2
        { beat: 3, dur: 1, midis: [], bassMidis: [] }, // 真·休止符
      ],
      { id: 'th', title: '双手', stage: 'read', keyPc: 0 },
    );
  }

  it('buildScore：左手音拼写与右手分开保存，同拍事件合并', () => {
    const s = twoHandScore();
    expect(s.events.length).toBe(4);
    expect(s.events[0]!.bassSpelled.length).toBe(1);
    expect(s.events[0]!.bassSpelled[0]!.step).toBe(21); // C3 的绝对音级步
    expect(scoreRange(s)).toEqual({ lo: 43, hi: 67 });
  });

  it('exact 判定：双手事件要先后按齐两个音（滚奏也算）', () => {
    const s = new JudgeSession(twoHandScore(), 'exact');
    // 只按右手不算过
    expect(s.feedOn(64).type).toBe('ignore');
    expect(s.stats().progressed).toBe(0);
    // 再按左手，凑齐即命中
    expect(s.feedOn(48).type).toBe('hit');
    expect(s.current()!.midis[0]).toBe(67);
  });

  it('exact 判定：错音记 miss，不破坏已按中的音', () => {
    const s = new JudgeSession(twoHandScore(), 'exact');
    s.feedOn(64); // 右手对
    expect(s.feedOn(50).type).toBe('miss'); // D3 错
    expect(s.feedOn(48).type).toBe('hit'); // 左手 C3 补上，照样过
  });

  it('exact 判定：纯左手事件是目标；真休止符被跳过', () => {
    const s = new JudgeSession(twoHandScore(), 'exact');
    s.feedOn(48);
    s.feedOn(64); // 命中事件 0（顺序颠倒也凑齐）
    s.feedOff(48);
    s.feedOff(64);
    s.feedOn(67); // 命中事件 1
    s.feedOff(67);
    expect(s.current()!.bassMidis[0]).toBe(43); // 纯左手事件成为目标（休止符被跳过）
    s.feedOn(43);
    expect(s.stats().done).toBe(true);
  });

  it('命中后同音按住不重复计，松开后下一事件的同音仍可命中', () => {
    const s = new JudgeSession(
      buildScore(
        [
          { beat: 0, dur: 1, midis: [60] },
          { beat: 1, dur: 1, midis: [60] },
        ],
        { id: 'r', title: 'r', stage: 'read', keyPc: 0 },
      ),
      'exact',
    );
    expect(s.feedOn(60).type).toBe('hit');
    expect(s.feedOn(60).type).toBe('ignore'); // 按住不放不会连中
    s.feedOff(60);
    expect(s.feedOn(60).type).toBe('hit');
    expect(s.stats().done).toBe(true);
  });
});
