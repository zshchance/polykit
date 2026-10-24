import { describe, expect, it } from 'vitest';

import { fitText, wrapLines, type MeasureFn } from './text-layout';

/** 假测量：每字符 10px（等宽），字号的缩放由 withFont 在 fitText 测试里另行模拟 */
const measure: MeasureFn = (s: string) => s.length * 10;

describe('wrapLines · CJK 逐字断行', () => {
  it('超宽按字符折行', () => {
    expect(wrapLines('一二三四五六', 25, measure)).toEqual(['一二', '三四', '五六']);
  });

  it('中文闭合标点避免落在行首', () => {
    expect(wrapLines('一二，三四', 20, measure)).toEqual(['一二，', '三四']);
    expect(wrapLines('一二、三四', 20, measure)).toEqual(['一二、', '三四']);
  });

  it('行首空白丢弃', () => {
    // "一二 三四"（含空格 5 单位 × 10px = 50）恰好一行；折行点的空格不进入下一行行首
    expect(wrapLines('一二 三四 五六', 50, measure)).toEqual(['一二 三四', '五六']);
  });
});

describe('wrapLines · 拉丁按词断行', () => {
  it('整词不拆散', () => {
    expect(wrapLines('hello world foo', 50, measure)).toEqual(['hello', 'world', 'foo']);
  });

  it('词能同行则同行', () => {
    expect(wrapLines('ab cd', 50, measure)).toEqual(['ab cd']);
  });
});

describe('wrapLines · 硬换行与超宽原子', () => {
  it('显式 \\n 保留为行界', () => {
    expect(wrapLines('a\nb', 100, measure)).toEqual(['a', 'b']);
  });

  it('单个原子超行宽按字符硬切（长网址）', () => {
    expect(wrapLines('aaaaaaaaaaaaaa', 30, measure)).toEqual(['aaa', 'aaa', 'aaa', 'aaa', 'aa']);
  });

  it('maxWidth ≤ 0 时不折行', () => {
    expect(wrapLines('abc\ndef', 0, measure)).toEqual(['abc', 'def']);
  });
});

describe('fitText · 自动缩字号', () => {
  /** 假字体：宽度 = 字符数 × 字号 × 1（等宽理想字体） */
  const withFont =
    (size: number): MeasureFn =>
    (s: string) =>
      s.length * size;

  it('装得下时不缩', () => {
    const r = fitText('abcdefghij', {
      maxWidth: 100,
      maxHeight: 15, // 一行 10px 字号 × 1.5 行高
      startSize: 10,
      minSize: 4,
      withFont,
    });
    expect(r.fits).toBe(true);
    expect(r.size).toBe(10);
    expect(r.lines).toEqual(['abcdefghij']);
  });

  it('装不下时逐步缩小直至装下', () => {
    const r = fitText('abcdefghij', {
      maxWidth: 50,
      maxHeight: 6, // 一行且行高 ≤ 6 → 字号 ≤ 4
      startSize: 10,
      minSize: 4,
      shrink: 0.8,
      withFont,
    });
    expect(r.fits).toBe(true);
    expect(r.size).toBeLessThanOrEqual(4 + 1e-9);
  });

  it('到 minSize 仍装不下时按 minSize 返回并标记 fits=false', () => {
    const r = fitText('abcdefghijklmnopqrst', {
      maxWidth: 20,
      maxHeight: 6,
      startSize: 10,
      minSize: 8, // 8px 时 20 宽只能装 2 字 → 多行，高度必然超 6
      withFont,
    });
    expect(r.fits).toBe(false);
    expect(r.size).toBe(8);
  });
});
