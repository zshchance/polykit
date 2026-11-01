import { describe, expect, it } from 'vitest';

import { detectBeatTimes } from './beat';

/** 合成一段「每拍一次短促低频脉冲」的信号 */
function synth(rate: number, pulseTimes: number[], duration = 2.2): Float32Array {
  const len = Math.floor(rate * duration);
  const data = new Float32Array(len);
  const pulseLen = Math.floor(rate * 0.07);
  for (const t of pulseTimes) {
    const start = Math.floor(t * rate);
    for (let i = 0; i < pulseLen && start + i < len; i++) {
      const env = 1 - i / pulseLen;
      data[start + i] += Math.sin((2 * Math.PI * 160 * i) / rate) * env;
    }
  }
  return data;
}

describe('detectBeatTimes', () => {
  it('识别出规律脉冲的鼓点位置', () => {
    const rate = 4000;
    const beats = detectBeatTimes(synth(rate, [0.3, 0.8, 1.3, 1.8]), rate);
    expect(beats.length).toBeGreaterThanOrEqual(3);
    expect(Math.abs(beats[0]! - 0.3)).toBeLessThan(0.08);
    // 相邻鼓点间隔应接近 0.5s
    for (let i = 1; i < beats.length; i++) {
      expect(Math.abs(beats[i]! - beats[i - 1]! - 0.5)).toBeLessThan(0.12);
    }
  });

  it('静音返回空数组', () => {
    expect(detectBeatTimes(new Float32Array(4000), 4000)).toEqual([]);
  });

  it('过密候选按最短间隔合并成一拍', () => {
    const rate = 4000;
    const beats = detectBeatTimes(synth(rate, [0.4, 0.46]), rate);
    expect(beats.length).toBeLessThanOrEqual(1);
  });

  it('非法采样率安全返回', () => {
    expect(detectBeatTimes(new Float32Array(100), 0)).toEqual([]);
  });
});
