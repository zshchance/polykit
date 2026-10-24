import { describe, expect, it } from 'vitest';
import { curlMotion } from './page-curl';

describe('拟物卷页运动曲线', () => {
  it('起页与落页端点没有颤动或回弹残留', () => {
    expect(curlMotion(0)).toEqual({ tremor: 0, settle: 0 });
    expect(curlMotion(1).tremor).toBeCloseTo(0, 10);
    expect(curlMotion(1).settle).toBeCloseTo(0, 10);
  });

  it('中段存在克制的确定性强弱变化', () => {
    const a = curlMotion(0.42);
    expect(a).toEqual(curlMotion(0.42));
    expect(Math.abs(a.tremor)).toBeGreaterThan(0);
    expect(Math.abs(a.tremor)).toBeLessThan(2.3);
    expect(Math.abs(curlMotion(0.9).settle)).toBeLessThanOrEqual(5);
  });
});
