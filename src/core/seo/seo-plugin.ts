/**
 * SEO 插件（Vite）—— 编译期统一注入 SEO 元信息，并在产物中生成 sitemap/robots。
 *
 * 工作原理：
 *  1. 构建期扫描每个工具目录下的 tool.config.ts，用 esbuild（Vite 自带依赖）转译 TS，
 *     读取其中的纯数据 default export（import type 在转译阶段被安全剥离）。
 *  2. transformIndexHtml 阶段：
 *       - 首页 index.html → 注入站点级 meta + Open Graph + 工具目录 JSON-LD(ItemList)
 *       - 各工具页 index.html → 注入 description/keywords + SoftwareApplication JSON-LD
 *  3. closeBundle 阶段（仅生产构建）：写出 dist/sitemap.xml 与 dist/robots.txt
 *
 * 这样关键词满足需求："默认对用户不可见"（不渲染到可见 UI），
 * 但"始终可被 AI 工具/搜索引擎读取"（写入 meta 与 JSON-LD）。
 */
import type { Plugin, ResolvedConfig } from 'vite';
import { transformSync } from 'esbuild';
import { globSync } from 'glob';
import { resolve, dirname, sep } from 'node:path';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import type { ToolConfig } from '@/core/types';

const SITE_NAME = '静态工具箱';
const SITE_DESC = '纯浏览器运行的在线工具箱：密码生成器等实用工具，数据不出本地。';
const DEFAULT_URL = 'https://example.com';

interface SeoOptions {
  /** 生产环境站点完整根 URL（无尾斜杠），用于 sitemap / canonical / OG。例：https://foo.pages.dev */
  siteUrl?: string;
  /** 站点默认关键词（首页 meta） */
  siteKeywords?: string[];
}

/**
 * 用 esbuild 转译并求值 tool.config.ts 的 default export（纯数据对象）。
 * 仅当源码里是 "export default {...}" 形式时才提取，避免执行任意逻辑。
 */
function readToolConfig(absPath: string): ToolConfig | null {
  const raw = readFileSync(absPath, 'utf8');
  // 转译：剥离 import type 等类型语法，得到 JS 文本
  const transpiled = transformSync(raw, {
    loader: 'ts',
    format: 'esm',
    target: 'es2020',
  }).code;

  // esbuild 会把 "export default {...}" 转成 "var stdin_default = {...}; export { stdin_default as default };"
  // 安全约束：仅当存在 "as default" 导出，且顶层有一个 var = {...} 时才提取。
  if (!/export\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(transpiled)) {
    console.warn(`[seo] ${absPath} 不是 "export default {...}" 纯数据，跳过`);
    return null;
  }

  // 用括号平衡法提取 "var <name> = { ... }" 中的对象字面量（支持嵌套花括号）
  const start = transpiled.search(/var\s+\w+\s*=\s*\{/);
  if (start === -1) {
    console.warn(`[seo] ${absPath} 不是 "export default {...}" 纯数据，跳过`);
    return null;
  }
  const objStart = transpiled.indexOf('{', start);
  const objText = extractBalanced(transpiled, objStart);
  if (!objText) {
    console.warn(`[seo] ${absPath} 对象字面量解析失败，跳过`);
    return null;
  }

  // 用 Function 求值对象字面量（数据源来自仓库内已审计文件，非用户输入）
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(`"use strict"; return (${objText});`);
    return fn() as ToolConfig;
  } catch (e) {
    console.warn(`[seo] 解析 ${absPath} 失败:`, e);
    return null;
  }
}

/** 从 startIdx 处的 '{' 开始，返回括号平衡的完整对象字面量（含外层花括号） */
function extractBalanced(src: string, startIdx: number): string | null {
  if (src[startIdx] !== '{') return null;
  let depth = 0;
  let inStr: string | null = null;
  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === '\\') {
        i++; // 跳过转义字符
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(startIdx, i + 1);
    }
  }
  return null;
}

export function seoPlugin(options: SeoOptions = {}): Plugin {
  let config: ResolvedConfig;
  let tools: (ToolConfig & { dir: string })[] = [];

  /** 在 buildStart 收集一次工具配置（dev/build 都需要） */
  function collectTools(): (ToolConfig & { dir: string })[] {
    const root = config.root;
    const files = globSync('tools/*/tool.config.ts', { cwd: root });
    const list: (ToolConfig & { dir: string })[] = [];
    for (const rel of files) {
      const abs = resolve(root, rel);
      const cfg = readToolConfig(abs);
      if (!cfg) continue;
      const slug = rel.split('/')[1];
      list.push({ ...cfg, slug: cfg.slug || slug, dir: dirname(rel) });
    }
    list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    return list;
  }

  return {
    name: 'static-toolkit-seo',
    enforce: 'post',

    configResolved(c) {
      config = c;
    },

    // dev 与 build 都会进入；收集工具清单供后续注入
    buildStart() {
      tools = collectTools();
    },

    // 统一 HTML 注入入口
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const isHome = ctx.path === '/' || ctx.path === '/index.html';
        return isHome
          ? injectHome(html, tools, options)
          : injectTool(html, ctx.path, tools, options);
      },
    },

    // 生产构建结束后产出 sitemap / robots
    closeBundle() {
      if (config.command !== 'build') return;
      const outDir = resolve(config.root, config.build.outDir);
      const siteUrl = (options.siteUrl || DEFAULT_URL).replace(/\/$/, '');
      const base = config.base || '/';

      writeSitemap(outDir, siteUrl, base, tools);
      writeRobots(outDir, siteUrl);
    },
  };
}

// ─────────────────────────── 首页注入 ───────────────────────────

function injectHome(
  html: string,
  tools: ToolConfig[],
  options: SeoOptions,
): string {
  const keywords = (options.siteKeywords ?? []).concat(
    tools.flatMap((t) => t.keywords ?? []),
  );
  const tags = [
    `<meta name="description" content="${escape(SITE_DESC)}" />`,
    `<meta name="keywords" content="${escape(keywords.join(', '))}" />`,
    `<meta property="og:title" content="${escape(SITE_NAME)}" />`,
    `<meta property="og:description" content="${escape(SITE_DESC)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta name="twitter:card" content="summary" />`,
  ];

  // ItemList：把所有工具作为结构化数据，利于搜索引擎/AI 理解站点
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: SITE_NAME,
    description: SITE_DESC,
    itemListElement: tools.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      description: t.description,
    })),
  };
  tags.push(
    `<script type="application/ld+json">${JSON.stringify(itemList)}</script>`,
  );

  return injectIntoHead(html, tags.join('\n    '));
}

// ─────────────────────────── 工具页注入 ───────────────────────────

function injectTool(
  html: string,
  pagePath: string,
  tools: (ToolConfig & { dir: string })[],
  _options: SeoOptions,
): string {
  // pagePath 形如 /tools/password-generator/index.html
  const slug = pagePath.split('/')[2];
  const tool = tools.find((t) => t.slug === slug);
  if (!tool) return html;

  const desc = tool.description;
  const kws = tool.keywords ?? [];
  const tags = [
    `<meta name="description" content="${escape(desc)}" />`,
    kws.length ? `<meta name="keywords" content="${escape(kws.join(', '))}" />` : '',
  ].filter(Boolean);

  // SoftwareApplication 结构化数据
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: tool.name,
    description: tool.description,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any (Web Browser)',
    keywords: kws.join(', '),
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
  };
  tags.push(`<script type="application/ld+json">${JSON.stringify(schema)}</script>`);

  return injectIntoHead(html, tags.join('\n    '));
}

// ─────────────────────────── sitemap / robots ───────────────────────────

function writeSitemap(
  outDir: string,
  siteUrl: string,
  base: string,
  tools: ToolConfig[],
): void {
  const urls: string[] = [];
  const norm = (p: string) => p.replace(/\/+/g, '/');

  // 首页
  urls.push(
    `  <url>\n    <loc>${siteUrl}${norm(base)}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>`,
  );
  // 各工具页
  for (const t of tools) {
    const loc = `${siteUrl}${norm(base + 'tools/' + t.slug + '/')}`;
    urls.push(
      `  <url>\n    <loc>${loc}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`,
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join(
    '\n',
  )}\n</urlset>\n`;

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'sitemap.xml'), xml, 'utf8');
}

function writeRobots(outDir: string, siteUrl: string): void {
  const txt = `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'robots.txt'), txt, 'utf8');
}

// ─────────────────────────── 工具函数 ───────────────────────────

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 把标签注入到 </head> 前（无 head 则插到开头） */
function injectIntoHead(html: string, tags: string): string {
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `    ${tags}\n  </head>`);
  }
  return `${tags}\n${html}`;
}

/** 跨平台：确保相对分隔符是正斜杠（导出给其他模块用） */
export function toPosix(p: string): string {
  return p.split(sep).join('/');
}

export default seoPlugin;
