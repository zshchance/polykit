import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import anchor from 'markdown-it-anchor';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import type { CodeHighlighter } from './highlight';

type MarkdownItInstance = InstanceType<typeof MarkdownIt>;

/**
 * 生成 CJK 友好的标题锚点 id：保留 Unicode 字母/数字/连字符，空格转 "-"，去除标点。
 */
export function slugifyId(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '');
}

/**
 * 给顶层块 token 盖源码行戳（data-source-line，0 基）：
 * 分栏滚动同步据此建立「预览块 ↔ 源码行」锚点表，替代全局比例映射
 * （表格/图示让预览高度分布不均，比例映射会随篇幅累积错位）。
 */
function stampSourceLines(md: MarkdownItInstance): void {
  md.core.ruler.push('fmd_source_line', (state) => {
    for (const token of state.tokens) {
      // 只要块级开标签/独立 token（map 是 0 基 [起始行, 结束行)）；inline 与闭标签跳过
      if (token.map && token.nesting !== -1 && token.type !== 'inline') {
        token.attrSet('data-source-line', String(token.map[0]));
      }
    }
    return true;
  });
}

/** 把源码行戳注入 Shiki 输出的根 <pre>（其根节点恒为带属性的 <pre>） */
function stampShikiPre(html: string, line: number): string {
  return html.replace('<pre ', `<pre data-source-line="${line}" `);
}

/**
 * 围栏渲染策略：
 * - ```mermaid → 图示占位符（由 Mermaid 异步渲染为 SVG）
 * - 已知语言 → Shiki 双主题高亮
 * - 其余 → 普通 pre>code 降级
 * 三条路径都带 data-source-line 戳（默认渲染器不经过这里，token 属性会丢）。
 */
function applyFenceRule(md: MarkdownItInstance, highlighter?: CodeHighlighter): void {
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx]!;
    const lang = (token.info || '').trim().split(/\s+/)[0]!.toLowerCase();
    const code = token.content;
    const line = token.map?.[0] ?? 0;

    if (lang === 'mermaid') {
      // 图源码以转义文本承载：data-* 属性值中的 "-->" 会被 DOMPurify 按 mXSS 风险剥离
      return `<div class="md-mermaid" data-source-line="${line}">${md.utils.escapeHtml(code)}</div>\n`;
    }

    const highlighted = highlighter?.highlight(code, lang || 'text');
    if (highlighted) return stampShikiPre(highlighted, line);

    const escaped = md.utils.escapeHtml(code);
    const cls = lang ? ` class="language-${md.utils.escapeHtml(lang)}"` : '';
    return `<pre data-source-line="${line}"><code${cls}>${escaped}</code></pre>\n`;
  };
}

/**
 * 组装 Markdown 解析器：
 * - CommonMark + GFM（表格/删除线内建，html:false 阻断内嵌 HTML）
 * - 任务列表、脚注、标题锚点（CJK slug）
 * - 数学公式：KaTeX（texmath，`$...$` 行内 / `$$...$$` 块级）
 * - 代码高亮：Shiki（可选注入，缺省降级为普通代码块）
 * - 删除线输出 <del>（Typora 同款；markdown-it 默认为 <s>）
 */
export function createMarkdownIt(highlighter?: CodeHighlighter): MarkdownItInstance {
  const md: MarkdownItInstance = new MarkdownIt({ html: false, linkify: true, typographer: true });
  md.use(taskLists, { enabled: false })
    .use(footnote)
    .use(anchor, { slugify: slugifyId })
    .use(texmath, {
      engine: katex,
      delimiters: 'dollars',
      katexOptions: { throwOnError: false, strict: false },
    });

  md.renderer.rules.s_open = () => '<del>';
  md.renderer.rules.s_close = () => '</del>';

  applyFenceRule(md, highlighter);
  stampSourceLines(md);
  return md;
}
