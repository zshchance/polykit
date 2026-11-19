import { describe, expect, it } from 'vitest';
import {
  linesInRange,
  LyricParseError,
  parseLyrics,
  serializeLyrics,
  suggestLineRange,
} from './lyrics';

describe('LRC 可编辑歌词', () => {
  it('解析多时间戳、元数据和结束时间', () => {
    const doc = parseLyrics(
      '[ti:示例]\n[ar:歌手]\n[00:06.00]第二句\n[00:01.00][00:10.50]重复句',
      'sample.lrc',
      20,
    );
    expect(doc.metadata).toMatchObject({ ti: '示例', ar: '歌手' });
    expect(doc.lines.map((line) => line.start)).toEqual([1, 6, 10.5]);
    expect(doc.lines.map((line) => line.end)).toEqual([6, 10.5, 20]);
    expect(doc.lines[0]?.text).toBe('重复句');
    expect(new Set(doc.lines.map((line) => line.id)).size).toBe(3);
  });

  it('offset 只应用一次，无音频时末句补四秒', () => {
    const doc = parseLyrics('[offset:500]\n[00:01.00]第一句\n[00:03.00]第二句', 'x.lrc');
    expect(doc.lines.map((line) => line.start)).toEqual([1.5, 3.5]);
    expect(doc.lines[1]?.end).toBe(7.5);
    const output = serializeLyrics(doc);
    expect(output).toContain('[offset:0]');
    expect(parseLyrics(output, 'x.lrc').lines.map((line) => line.start)).toEqual([1.5, 3.5]);
  });

  it('剥离词级标签并保留普通文本', () => {
    const doc = parseLyrics('[00:01.00]Hello <00:01.50>world <test>', 'x.lrc');
    expect(doc.lines[0]?.text).toBe('Hello world <test>');
  });

  it('负偏移与相同时间戳得到明确错误', () => {
    expect(() => parseLyrics('[offset:-2000]\n[00:01.00]错误', 'x.lrc')).toThrow(LyricParseError);
    expect(() => parseLyrics('[00:01.00][00:01.00]重复', 'x.lrc')).toThrow(LyricParseError);
  });
});

describe('SRT 可编辑字幕', () => {
  it('保留结束时间、间隙、多行文本和稳定排序', () => {
    const doc = parseLyrics(
      [
        '2',
        '00:00:05,000 --> 00:00:06,250',
        '第二句',
        '',
        '1',
        '00:00:01,000 --> 00:00:03,500',
        '<i>第一行</i>',
        '第二行 &amp; 收尾',
      ].join('\n'),
      'subtitle.srt',
      60,
    );
    expect(doc.lines[0]).toMatchObject({ start: 1, end: 3.5, text: '第一行\n第二行 & 收尾' });
    expect(doc.lines[1]).toMatchObject({ start: 5, end: 6.25 });
  });

  it('SRT 往返不改变独立时间或换行', () => {
    const original = parseLyrics(
      '1\n00:00:01,234 --> 00:00:02,345\n甲\n乙\n\n2\n00:00:05.006 --> 00:00:06.007\n丙',
      'a.srt',
    );
    const output = serializeLyrics(original);
    expect(output).toContain('00:00:01,234 --> 00:00:02,345');
    expect(output).toContain('甲\n乙');
    expect(parseLyrics(output, 'a.srt').lines).toEqual(original.lines);
  });

  it('LRC 与 SRT 可转换，SRT 有毫秒精度', () => {
    const doc = parseLyrics('[00:01.239]转换', 'x.lrc', 5);
    const output = serializeLyrics(doc, 'srt');
    expect(output).toContain('00:00:01,239 --> 00:00:05,000');
    expect(output.startsWith('1\n')).toBe(true);
  });
});

describe('异常与区间选择', () => {
  it('拒绝空内容、无效格式和空导出', () => {
    expect(() => parseLyrics('', 'x.lrc')).toThrow(LyricParseError);
    expect(() => parseLyrics('纯文本', 'x.lrc')).toThrow(LyricParseError);
    expect(() => parseLyrics('1\n00:00:01,000 --> 00:00:01,000\n无效', 'x.srt')).toThrow();
    expect(() =>
      serializeLyrics({ format: 'lrc', fileName: 'x', metadata: {}, lines: [] }),
    ).toThrow();
  });

  it('按 ID 选择所有相交歌词，不选仅接触边界的行', () => {
    const doc = parseLyrics(
      '1\n00:00:01,000 --> 00:00:03,000\n甲\n\n2\n00:00:03,000 --> 00:00:05,000\n乙\n\n3\n00:00:05,000 --> 00:00:07,000\n丙',
      'x.srt',
    );
    expect(linesInRange(doc.lines, 2.9, 5)).toEqual(['lyric-1', 'lyric-2']);
    expect(linesInRange(doc.lines, 7, 8)).toEqual([]);
  });
});

describe('新增句建议时间', () => {
  const lines = [
    { id: 'a', start: 0, end: 2, text: '一' },
    { id: 'b', start: 2, end: 4, text: '二' },
    { id: 'c', start: 9, end: 12, text: '三' },
  ];

  it('空列表从播放头开始给 2 秒占位', () => {
    expect(suggestLineRange([], -1, 3.4, 120)).toEqual({ start: 3.4, end: 5.4 });
  });

  it('句间空隙决定新句长度，最长 4 秒', () => {
    expect(suggestLineRange(lines, 1, 0, 120)).toEqual({ start: 4, end: 8 });
  });

  it('空隙不足 0.5 秒时允许轻微重叠', () => {
    const tight = [
      { id: 'a', start: 0, end: 2, text: '一' },
      { id: 'b', start: 2.1, end: 4, text: '二' },
    ];
    expect(suggestLineRange(tight, 0, 0, 120)).toEqual({ start: 2, end: 2.5 });
  });

  it('末尾追加默认顺延 2 秒', () => {
    expect(suggestLineRange(lines, 2, 0, 120)).toEqual({ start: 12, end: 14 });
  });

  it('不越出音频末尾', () => {
    expect(suggestLineRange(lines, 2, 0, 12.5)).toEqual({ start: 12, end: 12.5 });
    expect(suggestLineRange([], -1, 130, 120)).toEqual({ start: 119.98, end: 120 });
  });
});
