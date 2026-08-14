import { describe, it, expect } from 'vitest';
import { extractPalette, type Pixel } from './extractor';

/** 构造纯色像素块 */
function solid(n: number, r: number, g: number, b: number): Pixel[] {
  return Array.from({ length: n }, () => ({ r, g, b, a: 255 }));
}

describe('extractPalette（中位切分）', () => {
  it('空像素数组返回空色板', () => {
    expect(extractPalette([], 5)).toEqual([]);
  });

  it('全透明像素返回空色板（低于 minAlpha 被忽略）', () => {
    const pixels: Pixel[] = solid(100, 12, 34, 56).map((p) => ({ ...p, a: 0 }));
    expect(extractPalette(pixels, 5)).toEqual([]);
  });

  it('单一纯色返回恰好一个颜色，占比 1', () => {
    const out = extractPalette(solid(64, 200, 30, 40), 5);
    expect(out).toHaveLength(1);
    expect(out[0]!.hex).toBe('#C81E28');
    expect(out[0]!.ratio).toBeCloseTo(1);
  });

  it('红蓝双色各半：两种颜色都被提取，占比之和约等于 1', () => {
    const pixels = [...solid(100, 255, 0, 0), ...solid(100, 0, 0, 255)];
    const out = extractPalette(pixels, 2);
    expect(out.length).toBeGreaterThanOrEqual(2);
    const hexes = out.map((c) => c.hex);
    expect(hexes).toContain('#FF0000');
    expect(hexes).toContain('#0000FF');
    const sum = out.reduce((acc, c) => acc + c.ratio, 0);
    expect(sum).toBeCloseTo(1, 1);
    // 各占一半（合并后应恢复真实占比）
    const red = out.find((c) => c.hex === '#FF0000')!;
    expect(red.ratio).toBeGreaterThan(0.4);
  });

  it('占比高的颜色排在前（按占比降序）', () => {
    // 3/4 红 + 1/4 蓝，色距远不会被合并
    const pixels = [...solid(300, 255, 0, 0), ...solid(100, 0, 0, 255)];
    const out = extractPalette(pixels, 2);
    expect(out[0]!.hex).toBe('#FF0000');
    expect(out[0]!.ratio).toBeGreaterThan(out[1]!.ratio);
  });

  it('目标色数被钳制到 [1, 16]', () => {
    expect(extractPalette(solid(8, 1, 2, 3), 0)).toHaveLength(1);
    expect(extractPalette(solid(8, 1, 2, 3), 99)).toHaveLength(1);
  });

  it('确定性：同样输入两次调用结果一致', () => {
    const pixels = [
      ...solid(50, 10, 20, 30),
      ...solid(50, 200, 210, 220),
      ...solid(50, 90, 5, 130),
    ];
    const a = extractPalette(pixels, 4);
    const b = extractPalette(pixels, 4);
    expect(a.map((c) => c.hex)).toEqual(b.map((c) => c.hex));
  });
});
