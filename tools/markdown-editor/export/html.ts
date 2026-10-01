/**
 * 导出独立 HTML：当前预览（含 SVG 图示/高亮代码/公式）+ 内联样式，
 * 产物无外部依赖，可直接双击打开或分享。
 *
 * KaTeX 字体按需内联为 data URI（仅当文档含公式时才加载字体模块），
 * 保证导出文件离线打开时公式字形与站内一致。
 */
import previewCss from '../preview.css?raw';
import katexCss from 'katex/dist/katex.min.css?raw';

/** katex/dist/fonts 下的字体文件 → data URI（懒加载，数学文档导出时才拉取） */
const katexFontModules = import.meta.glob<string>(
  '../../../node_modules/katex/dist/fonts/*.woff2',
  { query: '?inline', import: 'default' },
);

let fontsPromise: Promise<Record<string, string>> | null = null;

async function loadKatexFontUris(): Promise<Record<string, string>> {
  fontsPromise ??= (async () => {
    const entries = await Promise.all(
      Object.entries(katexFontModules).map(
        async ([path, load]) => [path.split('/').pop()!, await load()] as const,
      ),
    );
    return Object.fromEntries(entries);
  })();
  return fontsPromise;
}

/** 把 css 里的 url(fonts/xxx.woff2) 替换为内联 data URI */
async function inlineKatexFonts(css: string): Promise<string> {
  const fonts = await loadKatexFontUris();
  return css.replace(/url\((['"]?)(fonts\/[^)'"]+)\1\)/g, (m, _q: string, rel: string) => {
    const file = rel.split('/').pop()!;
    const uri = fonts[file];
    return uri ? `url(${uri})` : m;
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 从渲染后的预览 DOM 提取文档标题（第一个 h1），缺省用文件名去扩展名 */
export function deriveTitle(previewInnerHtml: string, fallback: string): string {
  const probe = document.createElement('article');
  probe.innerHTML = previewInnerHtml;
  const h1 = probe.querySelector('h1');
  return h1?.textContent?.trim() || stripMarkdownExt(fallback) || 'Markdown 手札文档';
}

/** 去掉 Markdown 常见扩展名，保留主干 */
export function stripMarkdownExt(name: string): string {
  return name.replace(/\.(md|markdown|mdown|txt)$/i, '');
}

/**
 * 生成独立 HTML 文档字符串。
 * @param previewInnerHtml 渲染后的预览内部 HTML
 * @param sourceName       源文件名（用于标题与默认导出名）
 */
export async function buildStandaloneHtml(
  previewInnerHtml: string,
  sourceName: string,
): Promise<string> {
  const title = deriveTitle(previewInnerHtml, sourceName);
  // 含公式才内联 KaTeX 样式与字体（无数学文档保持轻量）
  const needsKatex = previewInnerHtml.includes('class="katex"');
  const katexBlock = needsKatex ? `\n${await inlineKatexFonts(katexCss)}\n` : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="generator" content="Markdown 手札 · 即开宝匣">
<title>${escapeHtml(title)}</title>
<style>
body { margin: 0; background: #ffffff; }
${previewCss}
${katexBlock}
</style>
</head>
<body>
<article class="md-preview md-preview--standalone">
${previewInnerHtml}
</article>
</body>
</html>
`;
}

/** 建议的导出文件名 */
export function htmlExportFilename(sourceName: string): string {
  return `${stripMarkdownExt(sourceName) || '未命名'}.html`;
}

/** Markdown 源文件导出名（规范化 .md 扩展） */
export function mdExportFilename(sourceName: string): string {
  return `${stripMarkdownExt(sourceName) || '未命名'}.md`;
}
