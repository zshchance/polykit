import { describe, it, expect } from 'vitest';
import {
  countWords,
  countChars,
  computeSyncedScrollTop,
  previewTopForLine,
  lineForPreviewTop,
  type SyncAnchor,
} from './utils';
import { parseSessionBlob, isWorthRestoring, normalizeScroll } from './session';
import { stripMarkdownExt, htmlExportFilename, mdExportFilename } from './export/html';
import { isOpenableName } from './io/files';
import { buildOutlineTree, findHeadingSourceLines, type OutlineHeading } from './outline';
import { createMarkdownIt } from './renderer/markdown';

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

describe('previewTopForLine / lineForPreviewTop（锚点插值滚动同步）', () => {
  // 模拟「源码 50 行 → 预览 2400px」、中段一块在预览侧被表格撑高的分布
  const anchors: SyncAnchor[] = [
    { line: 0, top: 0 },
    { line: 10, top: 500 },
    { line: 40, top: 2000 },
    { line: 50, top: 2400 },
  ];

  it('锚点之间分段线性插值（非全局比例）', () => {
    expect(previewTopForLine(5, anchors, 2400)).toBe(250); // 第一段 50px/行
    expect(previewTopForLine(25, anchors, 2400)).toBe(1250); // 第二段 50px/行
    expect(previewTopForLine(45, anchors, 2400)).toBe(2200); // 末段 40px/行
  });

  it('锚点上取精确值，越界钳制到首尾', () => {
    expect(previewTopForLine(10, anchors, 2400)).toBe(500);
    expect(previewTopForLine(-5, anchors, 2400)).toBe(0);
    expect(previewTopForLine(99, anchors, 2400)).toBe(2400);
  });

  it('结果不超过 previewMax', () => {
    expect(previewTopForLine(50, anchors, 2000)).toBe(2000);
    expect(previewTopForLine(99, anchors, 2000)).toBe(2000);
  });

  it('lineForPreviewTop 与 previewTopForLine 互逆（块内进度无损往返）', () => {
    for (const line of [0, 3.5, 10, 25, 39.9, 40, 50]) {
      const top = previewTopForLine(line, anchors, 2400);
      expect(lineForPreviewTop(top, anchors)).toBeCloseTo(line, 6);
    }
  });

  it('lineForPreviewTop 越界钳制到首尾锚点行', () => {
    expect(lineForPreviewTop(-10, anchors)).toBe(0);
    expect(lineForPreviewTop(9999, anchors)).toBe(50);
  });

  it('零跨度锚点不产生 NaN，退化为边界值', () => {
    const dup: SyncAnchor[] = [
      { line: 0, top: 0 },
      { line: 0, top: 0 },
      { line: 10, top: 100 },
    ];
    expect(previewTopForLine(0, dup, 100)).toBe(0);
    expect(lineForPreviewTop(0, dup)).toBe(0);
  });

  it('空锚点表安全返回 0', () => {
    expect(previewTopForLine(5, [], 100)).toBe(0);
    expect(lineForPreviewTop(50, [])).toBe(0);
  });
});

describe('createMarkdownIt（块级源码行戳）', () => {
  const md = createMarkdownIt();

  it('标题/段落/列表等默认渲染路径保留 data-source-line（0 基）', () => {
    const html = md.render('# 标题\n\n段落一\n\n- 甲\n- 乙\n');
    expect(html).toContain('data-source-line="0"'); // h1（第 0 行）
    expect(html).toContain('data-source-line="2"'); // 段落（第 2 行）
    expect(html).toContain('data-source-line="4"'); // 列表（第 4 行）
  });

  it('普通围栏降级路径的 pre 带行戳', () => {
    const html = md.render('```txt\n纯文本\n```\n');
    expect(html).toContain('<pre data-source-line="0"');
  });

  it('mermaid 占位 div 带行戳', () => {
    const html = md.render('前言\n\n```mermaid\ngraph TD\nA-->B\n```\n');
    expect(html).toContain('<div class="md-mermaid" data-source-line="2"');
  });
});

describe('parseSessionBlob（会话数据校验）', () => {
  const valid = { version: 1, doc: '# hi', name: '笔记.md', mode: 'read', savedAt: 1710000000000 };
  const zeroScroll = { page: 0, preview: 0, editor: 0 };

  it('合法数据原样通过（outline/scroll 缺省为 false/顶部）', () => {
    expect(parseSessionBlob(valid)).toEqual({
      doc: '# hi',
      name: '笔记.md',
      mode: 'read',
      outline: false,
      scroll: zeroScroll,
      savedAt: 1710000000000,
    });
  });

  it('outline=true 被保留，非布尔值回落 false', () => {
    expect(parseSessionBlob({ ...valid, outline: true })?.outline).toBe(true);
    expect(parseSessionBlob({ ...valid, outline: 'yes' })?.outline).toBe(false);
    expect(parseSessionBlob({ ...valid, outline: 1 })?.outline).toBe(false);
  });

  it('滚动位置被保留并取整', () => {
    const parsed = parseSessionBlob({
      ...valid,
      scroll: { page: 137.4, preview: 820.6, editor: 300 },
    })?.scroll;
    expect(parsed).toEqual({ page: 137, preview: 821, editor: 300 });
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

describe('normalizeScroll（滚动位置规整）', () => {
  it('合法三分量通过并取整', () => {
    expect(normalizeScroll({ page: 10.4, preview: 99.5, editor: 0 })).toEqual({
      page: 10,
      preview: 100,
      editor: 0,
    });
  });

  it('非对象（null/数组/字符串）整体回落顶部', () => {
    expect(normalizeScroll(null)).toEqual({ page: 0, preview: 0, editor: 0 });
    expect(normalizeScroll([1, 2, 3])).toEqual({ page: 0, preview: 0, editor: 0 });
    expect(normalizeScroll('scroll')).toEqual({ page: 0, preview: 0, editor: 0 });
  });

  it('分量缺失/负数/非有限数逐项回落 0，其余保留', () => {
    expect(normalizeScroll({ page: -5, preview: 88, editor: Number.NaN })).toEqual({
      page: 0,
      preview: 88,
      editor: 0,
    });
    expect(normalizeScroll({ preview: 42 })).toEqual({ page: 0, preview: 42, editor: 0 });
    expect(normalizeScroll({ page: '7', preview: true })).toEqual({
      page: 0,
      preview: 0,
      editor: 0,
    });
  });
});

describe('isWorthRestoring（是否值得恢复现场）', () => {
  const base = {
    doc: '',
    name: '未命名.md',
    mode: 'split' as const,
    outline: false,
    scroll: { page: 0, preview: 0, editor: 0 },
    savedAt: 0,
  };

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

describe('buildOutlineTree（大纲层级树构建）', () => {
  const mk = (level: number, text: string): OutlineHeading => ({
    level,
    text,
    id: text,
    el: null as unknown as HTMLElement, // 纯树构建不触碰 DOM
  });
  const shape = (roots: ReturnType<typeof buildOutlineTree>): unknown =>
    roots.map((n) => [n.heading.text, shape(n.children)]);

  it('常规层级：h1 > h2 > h3，同级并列', () => {
    const tree = buildOutlineTree([mk(1, 'a'), mk(2, 'b'), mk(3, 'c'), mk(2, 'd'), mk(1, 'e')]);
    expect(shape(tree)).toEqual([
      [
        'a',
        [
          ['b', [['c', []]]],
          ['d', []],
        ],
      ],
      ['e', []],
    ]);
  });

  it('层级跳变（h1 后直接 h3）：挂到最近祖先', () => {
    const tree = buildOutlineTree([mk(1, 'a'), mk(3, 'c'), mk(2, 'b')]);
    expect(shape(tree)).toEqual([
      [
        'a',
        [
          ['c', []],
          ['b', []],
        ],
      ],
    ]);
  });

  it('空列表与全是根级标题', () => {
    expect(buildOutlineTree([])).toEqual([]);
    const flat = buildOutlineTree([mk(2, 'x'), mk(2, 'y')]);
    expect(shape(flat)).toEqual([
      ['x', []],
      ['y', []],
    ]);
  });
});

describe('findHeadingSourceLines（源码标题行定位）', () => {
  it('识别 ATX 标题的 0 基行号', () => {
    const doc = '引言\n# 一级\n正文\n## 二级\n### 三级\n';
    expect(findHeadingSourceLines(doc)).toEqual([1, 3, 4]);
  });

  it('跳过围栏代码块内的 # 行（``` 与 ~~~ 均识别）', () => {
    const doc = '# 标题\n```ts\n# 这不是标题\nconst a = 1;\n```\n~~~\n# 也不是\n~~~\n## 真标题';
    expect(findHeadingSourceLines(doc)).toEqual([0, 8]);
  });

  it('最多 6 个 # 且允许前导空格，7 个 # 不算', () => {
    expect(findHeadingSourceLines('  ## 二级\n####### 七个')).toEqual([0]);
  });

  it('# 后必须有空格或行尾', () => {
    expect(findHeadingSourceLines('#NoSpace\n# 有空格')).toEqual([1]);
  });
});
