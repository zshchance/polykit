import { describe, expect, it } from 'vitest';

import { LyricParseError, findLyricIndex, parseLyrics } from './lyrics';

describe('parseLyrics · LRC', () => {
  it('解析基础 mm:ss.xx 标签并按 start 排序补齐 end', () => {
    const lrc = ['[00:02.00]第一句', '[00:10.50]第二句', '[00:05.00]提前句'].join('\n');
    const lines = parseLyrics(lrc, 30);
    expect(lines.map((l) => l.start)).toEqual([2, 5, 10.5]);
    expect(lines[0]).toMatchObject({ end: 5, text: '第一句' });
    expect(lines[2]).toMatchObject({ end: 30, text: '第二句' }); // 末行补到音频结束
  });

  it('一行多时间标签共享同一句歌词', () => {
    const lines = parseLyrics('[00:01.00][01:00.00]副歌\n', 120);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ start: 1, text: '副歌' });
    expect(lines[1]).toMatchObject({ start: 60, end: 120, text: '副歌' });
  });

  it('忽略元数据行与空行，剥离词级标签', () => {
    const lrc = [
      '[ti:歌名]',
      '[ar:歌手]',
      '[00:01.00]带<00:01.20>词级<00:01.50>标签',
      '',
      '   ',
    ].join('\n');
    const lines = parseLyrics(lrc, 10);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('带词级标签');
  });

  it('兼容无毫秒与冒号毫秒写法', () => {
    const lines = parseLyrics('[00:05]短标签\n[01:02:300]冒号毫秒', 200);
    expect(lines[0]?.start).toBe(5);
    expect(lines[1]?.start).toBeCloseTo(62.3, 6);
  });
});

describe('parseLyrics · SRT', () => {
  it('解析标准 SRT 块', () => {
    const srt = [
      '1',
      '00:00:01,000 --> 00:00:04,500',
      '第一句字幕',
      '',
      '2',
      '00:00:05,000 --> 00:00:08,000',
      '第二句字幕',
    ].join('\n');
    const lines = parseLyrics(srt, 20);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ start: 1, end: 5, text: '第一句字幕' });
    expect(lines[1]).toMatchObject({ start: 5, end: 20, text: '第二句字幕' });
  });

  it('保留块内多行文本并去除 HTML 标签与实体', () => {
    const srt = ['1', '00:00:01,000 --> 00:00:04,000', '<i>斜体行</i>', '第二行 &amp; 收尾'].join(
      '\n',
    );
    const lines = parseLyrics(srt, 10);
    expect(lines[0]?.text).toBe('斜体行 第二行 & 收尾');
  });

  it('跳过时间非法（end<=start）的块', () => {
    const srt = [
      '1',
      '00:00:05,000 --> 00:00:05,000',
      '无效块',
      '',
      '2',
      '00:00:06,000 --> 00:00:08,000',
      '有效块',
    ].join('\n');
    const lines = parseLyrics(srt, 10);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('有效块');
  });
});

describe('parseLyrics · 异常', () => {
  it('空内容 / 全部无法解析时抛 LyricParseError', () => {
    expect(() => parseLyrics('   ', 10)).toThrow(LyricParseError);
    expect(() => parseLyrics('随便一段没有时间轴的文本', 10)).toThrow(LyricParseError);
  });
});

describe('findLyricIndex', () => {
  const lines = parseLyrics('[00:02.00]A\n[00:05.00]B\n[00:09.00]C', 30);
  it('命中行区间', () => {
    expect(findLyricIndex(lines, 1)).toBe(-1); // 首行前
    expect(findLyricIndex(lines, 2)).toBe(0);
    expect(findLyricIndex(lines, 4.9)).toBe(0);
    expect(findLyricIndex(lines, 5)).toBe(1);
    expect(findLyricIndex(lines, 29.5)).toBe(2); // 末行延到音频结束（区间左闭右开）
    expect(findLyricIndex(lines, 100)).toBe(-1); // 超出音频范围（结尾段）无歌词
  });
  it('空数组安全', () => {
    expect(findLyricIndex([], 5)).toBe(-1);
  });
});
