import { describe, expect, it } from 'vitest';

import {
  MAX_CARDS,
  cardBudget,
  parseScript,
  splitLongSentence,
  splitSentences,
} from './script';

describe('parseScript · 切卡规则', () => {
  it('一行一句 = 一张卡，并剥掉句尾的停顿标点', () => {
    const r = parseScript('你好，世界。\n今天天气不错！', 24);
    expect(r.cards.map((c) => c.text)).toEqual(['你好，世界', '今天天气不错！']);
    expect(r.truncated).toBe(false);
  });

  it('一行多句按句读自动拆成多张卡', () => {
    const r = parseScript('今天下雨了。记得带伞。', 24);
    expect(r.cards.map((c) => c.text)).toEqual(['今天下雨了', '记得带伞']);
  });

  it('# 开头是标题卡；空行与 --- 不产生卡片', () => {
    const r = parseScript('# 重点\n\n正文一句\n---\n正文两句', 24);
    expect(r.cards).toHaveLength(3);
    expect(r.cards[0]).toMatchObject({ text: '重点', title: true });
    expect(r.cards[1]).toMatchObject({ text: '正文一句', title: false });
  });

  it('**…** 与【…】整体包裹识别为强调卡，并清除标记', () => {
    const r = parseScript('**快闪，就该这么简单**\n【别眨眼】', 24);
    expect(r.cards[0]).toMatchObject({ text: '快闪，就该这么简单', em: true });
    expect(r.cards[1]).toMatchObject({ text: '别眨眼', em: true });
    expect(r.cards.map((c) => c.text).join()).not.toContain('*');
  });

  it('零散强调标记被清除且不算强调卡', () => {
    const r = parseScript('这**不是**整句强调', 24);
    expect(r.cards[0]).toMatchObject({ text: '这不是整句强调', em: false });
  });

  it('超长句子按预算拆分，每个碎片都不超过预算', () => {
    const r = parseScript('一二三四五六七八九十一二三四五六七八九十', 8);
    expect(r.cards.length).toBeGreaterThan(1);
    for (const c of r.cards) expect([...c.text].length).toBeLessThanOrEqual(8);
  });

  it('连续句读产生的纯标点碎片被丢弃', () => {
    const r = parseScript('真的吗？！\n结束……', 24);
    expect(r.cards.map((c) => c.text)).toEqual(['真的吗？', '结束…']);
  });

  it('文本为空或未提供时返回空列表', () => {
    expect(parseScript('', 24).cards).toEqual([]);
    expect(parseScript('  \n\n  ', 24).cards).toEqual([]);
  });

  it('卡片数超过上限时截断并标记', () => {
    const text = Array.from({ length: MAX_CARDS + 30 }, (_, i) => `第${i}句。`).join('\n');
    const r = parseScript(text, 24);
    expect(r.cards).toHaveLength(MAX_CARDS);
    expect(r.truncated).toBe(true);
  });
});

describe('splitSentences / splitLongSentence', () => {
  it('识别中英文句读并保留标点', () => {
    expect(splitSentences('你好。世界！Why? 结束…')).toEqual([
      '你好。',
      '世界！',
      'Why?',
      ' 结束…',
    ]);
  });

  it('优先在次级标点处断句', () => {
    const out = splitLongSentence('一二三四五六，七八九十', 8);
    expect(out[0]).toBe('一二三四五六，');
    expect(out.join('')).toBe('一二三四五六，七八九十');
  });

  it('无次级标点时按字符硬切（预算下限为 6）', () => {
    const out = splitLongSentence('abcdefghijkl', 6);
    expect(out).toEqual(['abcdef', 'ghijkl']);
  });
});

describe('cardBudget', () => {
  it('竖屏预算最窄，横屏最宽', () => {
    expect(cardBudget('9:16')).toBe(24);
    expect(cardBudget('16:9')).toBe(34);
    expect(cardBudget('1:1')).toBe(28);
  });
});
