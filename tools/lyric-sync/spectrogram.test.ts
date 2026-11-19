import { describe, expect, it, vi } from 'vitest';
import { analyzeSamples, normalizeView } from './spectrogram';

describe('频谱视图边界', () => {
  it('将视图限制在有效音频时间内', () => {
    expect(normalizeView(-1, 12, 10)).toEqual({ start: 0, end: 10 });
    expect(normalizeView(3, 8, 10)).toEqual({ start: 3, end: 8 });
    expect(normalizeView(4, 2, 10)).toEqual({ start: 4, end: 4.000001 });
    expect(normalizeView(-1, 10, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('STFT 频谱分析', () => {
  it('输出列主序的时间频率数据，并定位 440Hz 音调', async () => {
    const sampleRate = 8000;
    const samples = new Float32Array(sampleRate * 2);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.7;
    }
    const progress = vi.fn();
    const data = await analyzeSamples(samples, sampleRate, 2, progress);
    expect(data.columns).toBeGreaterThan(20);
    expect(data.rows).toBe(88);
    expect(data.magnitudes.length).toBe(data.columns * data.rows);
    expect(data.times[0]).toBeGreaterThanOrEqual(0);
    expect(data.times[data.columns - 1]).toBeLessThanOrEqual(2);
    expect(progress).toHaveBeenCalled();
    expect(progress.mock.calls.at(-1)?.[0]).toBe(1);
    expect(Math.max(...data.magnitudes)).toBeGreaterThan(150);
    const firstColumn = data.magnitudes.slice(0, data.rows);
    const strongestRow = firstColumn.indexOf(Math.max(...firstColumn));
    expect(strongestRow).toBeGreaterThan(15);
    expect(strongestRow).toBeLessThan(45);
  });

  it('长音频限制列数，避免频谱内存无限增长', async () => {
    const samples = new Float32Array(8000);
    const data = await analyzeSamples(samples, 8000, 3600);
    expect(data.columns).toBeLessThanOrEqual(18_000);
    expect(data.magnitudes.length).toBe(data.columns * data.rows);
  });

  it('异步计算支持取消且让出主线程', async () => {
    const samples = new Float32Array(8000);
    await expect(analyzeSamples(samples, 8000, 1, undefined, () => true)).rejects.toThrow('取消');
  });

  it('拒绝没有采样的输入', async () => {
    await expect(analyzeSamples(new Float32Array(), 8000, 0)).rejects.toThrow('采样');
  });
});
