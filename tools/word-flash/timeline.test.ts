import { describe, expect, it } from 'vitest';

import { cardAt } from './options';
import { autoDuration, computeTimeline } from './timeline';

const rhythm = { pace: 'normal' as const, speed: 1, sync: 'auto' as const };

describe('autoDuration · 字数驱动的时长', () => {
  it('字数越多停留越久', () => {
    const short = autoDuration(2, rhythm);
    const long = autoDuration(18, rhythm);
    expect(long).toBeGreaterThan(short);
  });

  it('倍速越高时长越短', () => {
    const slow = autoDuration(10, { ...rhythm, speed: 0.8 });
    const fast = autoDuration(10, { ...rhythm, speed: 1.6 });
    expect(fast).toBeLessThan(slow);
  });

  it('受档位上下限约束', () => {
    expect(autoDuration(0, { ...rhythm, pace: 'hyper' })).toBeGreaterThanOrEqual(0.16);
    expect(autoDuration(200, { ...rhythm, pace: 'chill' })).toBeLessThanOrEqual(3);
  });
});

describe('computeTimeline · 自动节奏', () => {
  const cards = [{ text: '你好' }, { text: '今天天气不错' }, { text: '出发' }];

  it('starts 为前缀和，total 等于总时长', () => {
    const tl = computeTimeline(rhythm, cards);
    expect(tl.cards).toBe(3);
    expect(tl.starts[0]).toBe(0);
    expect(tl.starts[1]).toBeCloseTo(tl.durations[0]!, 6);
    expect(tl.total).toBeCloseTo(tl.durations.reduce((a, b) => a + b, 0), 6);
    expect(tl.beatSynced).toBe(false);
  });

  it('空卡片返回空时间轴', () => {
    expect(computeTimeline(rhythm, [])).toEqual({
      cards: 0,
      durations: [],
      starts: [],
      total: 0,
      beatSynced: false,
    });
  });
});

describe('computeTimeline · 节拍对齐', () => {
  const cards = [{ text: '一' }, { text: '二' }, { text: '三' }];

  it('鼓点足够时切换点直接落在鼓点上', () => {
    const tl = computeTimeline({ ...rhythm, sync: 'beat' }, cards, [0, 0.5, 1.0, 1.5]);
    expect(tl.beatSynced).toBe(true);
    expect(tl.starts).toEqual([0, 0.5, 1.0]);
    expect(tl.durations).toEqual([0.5, 0.5, 0.5]);
    expect(tl.total).toBeCloseTo(1.5, 6);
  });

  it('首个鼓点不在 0 时整体平移到 0 起播', () => {
    const tl = computeTimeline({ ...rhythm, sync: 'beat' }, cards, [0.8, 1.3, 1.8, 2.3]);
    expect(tl.starts).toEqual([0, 0.5, 1]);
  });

  it('鼓点数量不足时回退自动节奏并标记未对齐', () => {
    const tl = computeTimeline({ ...rhythm, sync: 'beat' }, cards, [0, 0.5]);
    expect(tl.beatSynced).toBe(false);
    expect(tl.starts[0]).toBe(0);
    expect(tl.total).toBeGreaterThan(0);
  });

  it('自动模式下即使有鼓点也不使用对齐', () => {
    const tl = computeTimeline(rhythm, cards, [0, 0.5, 1.0, 1.5]);
    expect(tl.beatSynced).toBe(false);
  });
});

describe('cardAt · 卡片定位', () => {
  const tl = computeTimeline(
    { pace: 'normal', speed: 1, sync: 'beat' },
    [{ text: '一' }, { text: '二' }],
    [0, 0.6, 1.2],
  );

  it('落在正确的卡片与进度', () => {
    const st = cardAt(0.3, tl)!;
    expect(st.index).toBe(0);
    expect(st.p).toBeCloseTo(0.5, 6);
    expect(st.remain).toBeCloseTo(0.3, 6);
  });

  it('边界时刻归入新卡', () => {
    expect(cardAt(0.6, tl)!.index).toBe(1);
  });

  it('超出总时长仍停在末卡', () => {
    const st = cardAt(99, tl)!;
    expect(st.index).toBe(1);
    expect(st.remain).toBe(0);
  });

  it('无卡片返回 null', () => {
    expect(cardAt(0, computeTimeline({ pace: 'normal', speed: 1, sync: 'auto' }, []))).toBeNull();
  });
});
