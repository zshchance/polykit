import { describe, it, expect } from 'vitest';
import { computeReorder } from './dragReorder';

describe('computeReorder（拖拽重排纯函数）', () => {
  const slugs = ['a', 'b', 'c', 'd', 'e'];

  it('把元素从前往后移', () => {
    expect(computeReorder(slugs, 0, 3)).toEqual(['b', 'c', 'd', 'a', 'e']);
  });

  it('把元素从后往前移', () => {
    expect(computeReorder(slugs, 4, 1)).toEqual(['a', 'e', 'b', 'c', 'd']);
  });

  it('原地不动时返回等值副本', () => {
    const out = computeReorder(slugs, 2, 2);
    expect(out).toEqual(slugs);
    expect(out).not.toBe(slugs);
  });

  it('不修改入参数组（不可变风格）', () => {
    const input = [...slugs];
    computeReorder(input, 1, 3);
    expect(input).toEqual(slugs);
  });
});
