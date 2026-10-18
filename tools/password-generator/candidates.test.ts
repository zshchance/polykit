import { describe, expect, it } from 'vitest';
import { extractCandidates } from './candidates';

describe('extractCandidates', () => {
  it('标准形态：```text 围栏内每行一个', () => {
    const raw = '```text\nOrbit-Nebula!7\n星空-航海-42#\nMyCat@2024Sleep\n```';
    expect(extractCandidates(raw)).toEqual(['Orbit-Nebula!7', '星空-航海-42#', 'MyCat@2024Sleep']);
  });

  it('裸 ``` 围栏也能识别', () => {
    expect(extractCandidates('```\nabc-DEF!9\n```')).toEqual(['abc-DEF!9']);
  });

  it('无围栏时按整段非空行兜底', () => {
    expect(extractCandidates('口令A!2024\n\n口令B#99\n')).toEqual(['口令A!2024', '口令B#99']);
  });

  it('行首编号与列表符剥掉，围栏外引导语不进围栏路径', () => {
    const raw = '这是为你生成的口令：\n```text\n1. Alpha-Beta!3\n2、Gamma-Delta#8\n- Epsilon-Zeta@1\n```';
    expect(extractCandidates(raw)).toEqual(['Alpha-Beta!3', 'Gamma-Delta#8', 'Epsilon-Zeta@1']);
  });

  it('去重 + 限量', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `dup-or-not-${i < 5 ? 'same' : i}`);
    const raw = `\`\`\`text\n${[...lines, 'dup-or-not-same'].join('\n')}\n\`\`\``;
    const out = extractCandidates(raw, 8);
    expect(out.length).toBe(8);
    expect(new Set(out).size).toBe(8);
  });

  it('纯编号行过滤、空行过滤', () => {
    const raw = '```text\n1.\n2.\n\nreal-one!2\n```';
    expect(extractCandidates(raw)).toEqual(['real-one!2']);
  });

  it('全空输入返回空数组', () => {
    expect(extractCandidates('')).toEqual([]);
    expect(extractCandidates('```text\n\n```')).toEqual([]);
  });
});
