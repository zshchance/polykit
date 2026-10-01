import { describe, it, expect } from 'vitest';
import { countWords, countChars, computeSyncedScrollTop } from './utils';
import { parseSessionBlob, isWorthRestoring } from './session';
import { stripMarkdownExt, htmlExportFilename, mdExportFilename } from './export/html';
import { isOpenableName } from './io/files';

describe('countWords（Typora 风格字数统计）', () => {
  it('CJK 每字计一', () => {
    expect(countWords('你好世界')).toBe(4);
  });

  it('拉丁按词计数', () => {
    expect(countWords('hello world foo')).toBe(3);
  });

  it('中英混排分别统计后求和', () => {
    expect(countWords('你好 hello 世界 world')).toBe(6);
  });

  it('假名/谚文按 CJK 处理', () => {
    expect(countWords('あア한글')).toBe(4);
  });

  it('空串与纯空白为 0', () => {
    expect(countWords('')).toBe(0);
    expect(countWords(' \n\t ')).toBe(0);
  });
});

describe('countChars（不含空白）', () => {
  it('剔除所有空白后计数', () => {
    expect(countChars('a b\nc\td')).toBe(4);
    expect(countChars('你好 世 界')).toBe(4);
    expect(countChars('')).toBe(0);
  });
});

describe('computeSyncedScrollTop（比例滚动同步）', () => {
  it('源不可滚动时回到顶部', () => {
    expect(computeSyncedScrollTop(120, 0, 500)).toBe(0);
  });

  it('按比例映射并夹取到目标范围', () => {
    expect(computeSyncedScrollTop(50, 100, 200)).toBe(100);
    expect(computeSyncedScrollTop(-10, 100, 200)).toBe(0);
    expect(computeSyncedScrollTop(999, 100, 200)).toBe(200);
  });

  it('目标不可滚动时收敛为 0', () => {
    expect(computeSyncedScrollTop(50, 100, 0)).toBe(0);
  });
});

describe('parseSessionBlob（会话数据校验）', () => {
  const valid = { version: 1, doc: '# hi', name: '笔记.md', mode: 'read', savedAt: 1710000000000 };

  it('合法数据原样通过', () => {
    expect(parseSessionBlob(valid)).toEqual({
      doc: '# hi',
      name: '笔记.md',
      mode: 'read',
      savedAt: 1710000000000,
    });
  });

  it('非法 mode 回落 split，空名回落 未命名.md', () => {
    const parsed = parseSessionBlob({ ...valid, mode: 'dual', name: '  ' });
    expect(parsed?.mode).toBe('split');
    expect(parsed?.name).toBe('未命名.md');
  });

  it('缺字段/类型错/版本不符/非对象一律作废', () => {
    expect(parseSessionBlob(null)).toBeNull();
    expect(parseSessionBlob('x')).toBeNull();
    expect(parseSessionBlob([1, 2])).toBeNull();
    expect(parseSessionBlob({ ...valid, version: 2 })).toBeNull();
    expect(parseSessionBlob({ ...valid, doc: 42 })).toBeNull();
    expect(parseSessionBlob({ ...valid, savedAt: Number.NaN })).toBeNull();
    expect(parseSessionBlob({ ...valid, name: 7 })).toBeNull();
  });
});

describe('isWorthRestoring（是否值得恢复现场）', () => {
  const base = { doc: '', name: '未命名.md', mode: 'split' as const, savedAt: 0 };

  it('空白且未命名 → 不恢复（回欢迎页）', () => {
    expect(isWorthRestoring(base)).toBe(false);
    expect(isWorthRestoring({ ...base, doc: '   \n  ' })).toBe(false);
  });

  it('有内容或打开过文件 → 恢复', () => {
    expect(isWorthRestoring({ ...base, doc: 'x' })).toBe(true);
    expect(isWorthRestoring({ ...base, name: '我的手稿.md' })).toBe(true);
  });
});

describe('导出文件名', () => {
  it('剥离 Markdown 扩展名', () => {
    expect(stripMarkdownExt('笔记.md')).toBe('笔记');
    expect(stripMarkdownExt('a.Markdown')).toBe('a');
    expect(stripMarkdownExt('a.b.mdown')).toBe('a.b');
    expect(stripMarkdownExt('无扩展')).toBe('无扩展');
  });

  it('HTML/MD 导出名切换扩展并兜底未命名', () => {
    expect(htmlExportFilename('手稿.md')).toBe('手稿.html');
    expect(mdExportFilename('手稿.txt')).toBe('手稿.md');
    expect(htmlExportFilename('')).toBe('未命名.html');
    expect(mdExportFilename('')).toBe('未命名.md');
  });
});

describe('isOpenableName（可打开的扩展名）', () => {
  it('接受 md 系与 txt', () => {
    expect(isOpenableName('a.md')).toBe(true);
    expect(isOpenableName('b.MARKDOWN')).toBe(true);
    expect(isOpenableName('c.mdown')).toBe(true);
    expect(isOpenableName('d.txt')).toBe(true);
  });

  it('拒绝其他类型与伪装扩展', () => {
    expect(isOpenableName('a.html')).toBe(false);
    expect(isOpenableName('a.md.exe')).toBe(false);
    expect(isOpenableName('md')).toBe(false);
  });
});
