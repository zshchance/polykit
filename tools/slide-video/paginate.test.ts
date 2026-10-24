import { describe, expect, it } from 'vitest';

import { MAX_PAGES, paginate, pageBudget, splitSentences } from './paginate';

describe('paginate · 基础分页', () => {
  it('空文本返回 0 页', () => {
    expect(paginate('', 160).pages).toHaveLength(0);
    expect(paginate('   \n  \n', 160).pages).toHaveLength(0);
  });

  it('空行分页：连续空行合并为一个分隔', () => {
    const r = paginate('第一页内容\n\n\n\n第二页内容', 160);
    expect(r.pages).toHaveLength(2);
    expect(r.pages[0]!.body).toBe('第一页内容');
    expect(r.pages[1]!.body).toBe('第二页内容');
  });

  it('段内单个换行不分页（同页多行）', () => {
    const r = paginate('第一行\n第二行\n第三行', 160);
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]!.body.split('\n')).toHaveLength(3);
  });

  it('--- / === 单独成行强制分页', () => {
    const r = paginate('A 部分\n---\nB 部分\n===\nC 部分', 160);
    expect(r.pages.map((p) => p.body)).toEqual(['A 部分', 'B 部分', 'C 部分']);
  });

  it('# 前缀行作为页标题（段首）', () => {
    const r = paginate('# 开场白\n大家好\n\n# 结束语\n谢谢观看', 160);
    expect(r.pages).toHaveLength(2);
    expect(r.pages[0]!.title).toBe('开场白');
    expect(r.pages[0]!.body).toBe('大家好');
    expect(r.pages[1]!.title).toBe('结束语');
  });

  it('标题与正文之间隔空行仍归同一页（自然写法容忍）', () => {
    const r = paginate('# 开场白\n\n大家好，欢迎收看。', 160);
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]!.title).toBe('开场白');
    expect(r.pages[0]!.body).toBe('大家好，欢迎收看。');
  });

  it('连续标题行生成纯标题页（标题即隐式分页）', () => {
    const r = paginate('# 第一章\n\n# 第二章\n\n正文内容', 160);
    expect(r.pages).toHaveLength(2);
    expect(r.pages[0]).toEqual({ title: '第一章', body: '' });
    expect(r.pages[1]!.title).toBe('第二章');
    expect(r.pages[1]!.body).toBe('正文内容');
  });
});

describe('paginate · 超长段落拆分', () => {
  it('按句读拆句贪心装页', () => {
    const text = '第一句。第二句。第三句。第四句。第五句。';
    // 预算 12 字：每句 4 字，每页装 3 句
    const r = paginate(text, 12);
    expect(r.pages).toHaveLength(2);
    expect(r.pages[0]!.body).toBe('第一句。第二句。第三句。');
    expect(r.pages[1]!.body).toBe('第四句。第五句。');
  });

  it('单句超过预算按字符硬切', () => {
    const long = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十';
    const r = paginate(long, 30);
    expect(r.pages).toHaveLength(2); // 40 字按 30 预算切成 30 + 10
    for (const p of r.pages) expect(p.body.length).toBeLessThanOrEqual(30);
  });

  it('标题计入预算：带标题页正文预算相应收窄', () => {
    const text = '# 四字标题\n' + '正'.repeat(40);
    const r = paginate(text, 50);
    // 正文预算 = 50 - 4 = 46，40 字正文应装进一页
    expect(r.pages).toHaveLength(1);
  });
});

describe('paginate · 上限保护', () => {
  it('超过 60 页截断并置 truncated', () => {
    const blocks = Array.from({ length: 100 }, (_, i) => `第 ${i + 1} 页内容`);
    const r = paginate(blocks.join('\n\n'), 160);
    expect(r.pages).toHaveLength(MAX_PAGES);
    expect(r.truncated).toBe(true);
  });

  it('未超上限时 truncated 为 false', () => {
    const r = paginate('一页\n\n两页', 160);
    expect(r.truncated).toBe(false);
  });
});

describe('splitSentences', () => {
  it('保留句读符', () => {
    expect(splitSentences('你好。世界！')).toEqual(['你好。', '世界！']);
  });

  it('换行并入前一句结尾', () => {
    expect(splitSentences('第一行\n第二行。')).toEqual(['第一行\n', '第二行。']);
  });

  it('无句读整段为一句', () => {
    expect(splitSentences('一口气说完')).toEqual(['一口气说完']);
  });
});

describe('pageBudget', () => {
  it('按比例给参考预算', () => {
    expect(pageBudget('16:9')).toBe(160);
    expect(pageBudget('9:16')).toBe(110);
    expect(pageBudget('1:1')).toBe(130);
    expect(pageBudget('4:3')).toBe(130);
  });
});
