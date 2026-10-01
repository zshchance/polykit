import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import githubLight from 'shiki/themes/github-light.mjs';
import githubDark from 'shiki/themes/github-dark.mjs';
import typescript from 'shiki/langs/typescript.mjs';
import javascript from 'shiki/langs/javascript.mjs';
import python from 'shiki/langs/python.mjs';
import bash from 'shiki/langs/bash.mjs';
import json from 'shiki/langs/json.mjs';
import yaml from 'shiki/langs/yaml.mjs';
import css from 'shiki/langs/css.mjs';
import html from 'shiki/langs/html.mjs';
import sql from 'shiki/langs/sql.mjs';
import diff from 'shiki/langs/diff.mjs';
import java from 'shiki/langs/java.mjs';
import c from 'shiki/langs/c.mjs';
import cpp from 'shiki/langs/cpp.mjs';
import go from 'shiki/langs/go.mjs';
import rust from 'shiki/langs/rust.mjs';
import markdown from 'shiki/langs/markdown.mjs';

/**
 * 代码高亮器抽象：同步高亮，未支持语言返回 null（由调用方降级）。
 */
export interface CodeHighlighter {
  highlight(code: string, lang: string): string | null;
}

const LANGS = {
  typescript,
  javascript,
  python,
  bash,
  json,
  yaml,
  css,
  html,
  sql,
  diff,
  java,
  c,
  cpp,
  go,
  rust,
  markdown,
} as const;

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  py: 'python',
  golang: 'go',
  'c++': 'cpp',
  md: 'markdown',
};

/**
 * 创建 Shiki 高亮器。
 * - 使用纯 JS 正则引擎（无 WASM），保证纯静态部署场景兼容
 * - 双主题（github-light/github-dark）输出 CSS 变量，随站点主题切换零重渲染
 * - 仅打包精选语言，控制页面体积
 */
export async function createCodeHighlighter(): Promise<CodeHighlighter> {
  const highlighter: HighlighterCore = await createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: Object.values(LANGS),
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });

  const loaded = new Set<string>(highlighter.getLoadedLanguages());
  return {
    highlight(code: string, lang: string): string | null {
      const resolved = ALIASES[lang] ?? lang;
      if (!loaded.has(resolved)) return null;
      try {
        return highlighter.codeToHtml(code, {
          lang: resolved,
          themes: { light: 'github-light', dark: 'github-dark' },
        });
      } catch {
        return null;
      }
    },
  };
}
