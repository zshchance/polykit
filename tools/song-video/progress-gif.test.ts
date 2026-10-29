/**
 * GIF 帧时序单测：循环取帧、负时间/超时长、超帧抽样与总时长守恒。
 */

import { describe, expect, it } from 'vitest';

import { frameIndexAt, sampleFramePlan } from './progress-gif';

describe('frameIndexAt', () => {
  const delays = [0.1, 0.2, 0.3];

  it('按累计时长取帧', () => {
    expect(frameIndexAt(delays, 0.6, 0)).toBe(0);
    expect(frameIndexAt(delays, 0.6, 0.05)).toBe(0);
    expect(frameIndexAt(delays, 0.6, 0.15)).toBe(1);
    expect(frameIndexAt(delays, 0.6, 0.35)).toBe(2);
  });

  it('超过一轮自动循环，负时间也能回绕', () => {
    expect(frameIndexAt(delays, 0.6, 0.65)).toBe(0);
    expect(frameIndexAt(delays, 0.6, -0.05)).toBe(2);
    expect(frameIndexAt(delays, 0.6, 1.95)).toBe(1);
  });

  it('空帧/零时长安全返回 0', () => {
    expect(frameIndexAt([], 0, 5)).toBe(0);
    expect(frameIndexAt(delays, 0, 5)).toBe(0);
    expect(frameIndexAt(delays, 0.6, Number.NaN)).toBe(0);
  });
});

describe('sampleFramePlan', () => {
  const makeDelays = (n: number, ms: number): number[] => Array.from({ length: n }, () => ms);

  it('不超过上限时原样返回', () => {
    const plan = sampleFramePlan(makeDelays(10, 0.1), 48);
    expect(plan.indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(plan.delays).toHaveLength(10);
    expect(plan.delays.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it('超过上限时抽样为首尾必选、下标递增且总时长守恒', () => {
    const delays = makeDelays(60, 0.05);
    const plan = sampleFramePlan(delays, 48);
    expect(plan.delays).toHaveLength(plan.indices.length);
    expect(plan.indices[0]).toBe(0);
    expect(plan.indices[plan.indices.length - 1]).toBe(59);
    expect(new Set(plan.indices).size).toBe(plan.indices.length);
    for (let i = 1; i < plan.indices.length; i++) {
      expect(plan.indices[i]!).toBeGreaterThan(plan.indices[i - 1]!);
    }
    const total = plan.delays.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(3, 6);
    expect(plan.delays.every((d) => d > 0)).toBe(true);
  });

  it('空输入返回空方案', () => {
    expect(sampleFramePlan([], 48)).toEqual({ indices: [], delays: [] });
  });
});
