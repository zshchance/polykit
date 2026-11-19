import { describe, expect, it } from 'vitest';
import { dragRange, pointerTime } from './timeline';

describe('频谱指针坐标', () => {
  const view = { start: 2, end: 6 };
  it('将轨道像素映射到对应视图时间并钳制边界', () => {
    expect(pointerTime(200, 100, 400, view)).toBe(3);
    expect(pointerTime(300, 100, 400, view)).toBe(4);
    expect(pointerTime(900, 100, 400, view)).toBe(6);
    expect(pointerTime(-10, 100, 400, view)).toBe(2);
    expect(pointerTime(100, 100, 0, view)).toBe(2);
  });

  it('同一局部窗口的连续指针位置不会被重新累计', () => {
    const first = pointerTime(700, 100, 1000, view);
    const second = pointerTime(800, 100, 1000, view);
    expect(first).toBeCloseTo(4.4);
    expect(second).toBeCloseTo(4.8);
  });
});

describe('拖拽选区', () => {
  const origin = { start: 1, end: 3 };
  it('整体移动保持长度并遵循音频边界', () => {
    expect(dragRange('move', 4, 2, origin, 10)).toEqual({ start: 3, end: 5 });
    expect(dragRange('move', -10, 2, origin, 10)).toEqual({ start: 0, end: 2 });
    expect(dragRange('move', 100, 2, origin, 10)).toEqual({ start: 8, end: 10 });
  });

  it('首尾调整互不干扰，且保留最小区间', () => {
    expect(dragRange('start', 0.5, 1, origin, 10)).toEqual({ start: 0.5, end: 3 });
    expect(dragRange('start', 4, 1, origin, 10)).toEqual({ start: 2.98, end: 3 });
    expect(dragRange('end', 4.5, 3, origin, 10)).toEqual({ start: 1, end: 4.5 });
    expect(dragRange('end', 0, 3, origin, 10)).toEqual({ start: 1, end: 1.02 });
  });

  it('支持正反向创建，过滤误触产生的极小范围', () => {
    expect(dragRange('create', 6, 2, origin, 10)).toEqual({ start: 2, end: 6 });
    expect(dragRange('create', 2, 6, origin, 10)).toEqual({ start: 2, end: 6 });
    expect(dragRange('create', 2.001, 2, origin, 10)).toBeNull();
  });
});
