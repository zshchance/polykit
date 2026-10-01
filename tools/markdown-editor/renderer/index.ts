import { createMarkdownIt } from './markdown';
import { sanitizeHtml } from './sanitize';
import type { CodeHighlighter } from './highlight';
// KaTeX 样式随渲染管线一并分发（构建时处理字体；测试环境自动忽略）
import 'katex/dist/katex.min.css';

export type { CodeHighlighter } from './highlight';

export interface RendererOptions {
  /** Shiki 代码高亮器；缺省时代码块降级为普通样式 */
  highlighter?: CodeHighlighter;
}

export interface Renderer {
  /** 将 Markdown 源文本渲染为经过消毒的 HTML 片段 */
  render(md: string): string;
}

/**
 * 创建 Markdown 渲染器。
 * 管线：markdown-it（+GFM/KaTeX/Shiki）→ DOMPurify 消毒。
 * Mermaid 围栏输出 `.md-mermaid` 占位符，由上层异步渲染为 SVG。
 */
export function createRenderer(options: RendererOptions = {}): Renderer {
  const md = createMarkdownIt(options.highlighter);
  return {
    render(source: string): string {
      return sanitizeHtml(md.render(source));
    },
  };
}
