import { describe, expect, it } from 'vitest';
import { computeTimeline } from './options';
import { normalizeSoundEffect, pageSoundCues, schedulePageSounds } from './sound-effects';

describe('pageSoundCues · 翻页音效时间点', () => {
  it('无页面不发声，单页首页翻入也发声', () => {
    expect(pageSoundCues(computeTimeline({ pageDur: 4, flipDur: 0.8, enter: 'fade' }, 0))).toEqual(
      [],
    );
    const cues = pageSoundCues(computeTimeline({ pageDur: 4, flipDur: 0.8, enter: 'fade' }, 1));
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ time: 0, pageIndex: 0 });
  });

  it('首页和每次页间切换都发声，不增加末尾空白音效', () => {
    const cues = pageSoundCues(computeTimeline({ pageDur: 4, flipDur: 0.8, enter: 'fade' }, 4));
    expect(cues.map((c) => c.time)).toEqual([0, 4, 8, 12]);
    expect(cues.map((c) => c.pageIndex)).toEqual([0, 1, 2, 3]);
    const withoutIntro = pageSoundCues(
      computeTimeline({ pageDur: 4, flipDur: 0.8, enter: 'fade' }, 4),
      false,
    );
    expect(withoutIntro.map((c) => c.time)).toEqual([4, 8, 12]);
    expect(
      pageSoundCues(computeTimeline({ pageDur: 4, flipDur: 0.8, enter: 'fade' }, 1), false),
    ).toEqual([]);
  });

  it('使用收窄后的真实翻页时长并保持排序', () => {
    const tl = computeTimeline({ pageDur: 1, flipDur: 1.2, enter: 'fade' }, 3);
    const cues = pageSoundCues(tl);
    expect(cues.map((c) => c.flipDur)).toEqual([tl.flipDur, tl.flipDur, tl.flipDur]);
    expect(cues[0]!.time).toBeLessThan(cues[1]!.time);
    expect(tl.flipDur).toBeLessThan(1.2);
  });
});

describe('首页音效调度', () => {
  it('单页文稿也会立即调度首页翻入音效', () => {
    const starts: { when: number; offset: number }[] = [];
    const ctx = {
      sampleRate: 1000,
      currentTime: 10,
      createBuffer: (_channels: number, length: number, rate: number) => ({
        duration: length / rate,
        getChannelData: () => new Float32Array(length),
      }),
      createGain: () => ({ gain: { value: 0 }, connect: () => {}, disconnect: () => {} }),
      createBufferSource: () => ({
        buffer: null,
        playbackRate: { value: 1 },
        onended: null,
        connect: () => {},
        disconnect: () => {},
        start: (when: number, offset: number) => starts.push({ when, offset }),
        stop: () => {},
      }),
    } as unknown as AudioContext;
    const playback = schedulePageSounds({
      ctx,
      destination: {} as AudioNode,
      timeline: computeTimeline({ pageDur: 4, flipDur: 0.8, enter: 'fade' }, 1),
      effect: 'paper',
      volume: 55,
      when: 10,
      offset: 0,
    });
    expect(starts).toHaveLength(1);
    expect(starts[0]!.when).toBeCloseTo(10.003, 6);
    expect(starts[0]!.offset).toBe(0);
    playback.stop();

    starts.length = 0;
    const disabled = schedulePageSounds({
      ctx,
      destination: {} as AudioNode,
      timeline: computeTimeline({ pageDur: 4, flipDur: 0.8, enter: 'fade' }, 1),
      effect: 'paper',
      volume: 55,
      when: 10,
      offset: 0,
      includeIntro: false,
    });
    expect(starts).toHaveLength(0);
    disabled.stop();
  });
});

describe('音效设置归一化', () => {
  it('接受内置 id，非法值回退无音效', () => {
    expect(normalizeSoundEffect('paper')).toBe('paper');
    expect(normalizeSoundEffect('soft')).toBe('soft');
    expect(normalizeSoundEffect('crisp')).toBe('crisp');
    expect(normalizeSoundEffect('external-file')).toBe('none');
    expect(normalizeSoundEffect(undefined)).toBe('none');
  });
});
