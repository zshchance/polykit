import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';
import tailwindcss from '@tailwindcss/vite';
import { seoPlugin } from './src/core/seo/seo-plugin';
import { registryConfig } from './src/home/registry-config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const r = (p: string) => resolve(__dirname, p);

/**
 * 扫描 tools/<name>/index.html，生成 MPA 入口表。
 * 每个工具自动成为一个独立页面，新增工具无需改任何配置。
 * 入口键用工具目录名，产物路径保持目录结构（如 /tools/password-generator/）。
 */
function scanToolInputs(): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const file of globSync('tools/*/index.html', { cwd: r('.') })) {
    // file 形如 "tools/password-generator/index.html"
    const name = file.split('/')[1];
    inputs[name] = r(file);
  }
  return inputs;
}

/**
 * base 路径：构建时由环境变量 BASE_PATH 决定，支持双平台部署。
 *
 * - Cloudflare Pages（根路径）：不设 BASE_PATH，默认 '/'。
 * - GitHub Pages（子路径）：Actions 注入 BASE_PATH=/<repo>/，如 '/static-toolkit/'。
 *
 * 应用代码统一用 import.meta.env.BASE_URL 拼接链接，会自动等于此处的 base，
 * 无需关心部署在哪。规范化：确保首尾都带斜杠（如 'static-toolkit' → '/static-toolkit/'）。
 */
function resolveBase(): string {
  const raw = process.env.BASE_PATH;
  if (!raw) return '/';
  let b = raw.trim();
  if (!b.startsWith('/')) b = `/${b}`;
  if (!b.endsWith('/')) b = `${b}/`;
  return b;
}

export default defineConfig({
  base: resolveBase(),
  // 多页面应用：禁用 SPA history fallback，
  // 避免未知路径（如 /password-generator/）误返回根 index.html。dev/build 路径对齐。
  appType: 'mpa',
  plugins: [
    tailwindcss(),
    seoPlugin({
      // 生产站点根 URL（用于 sitemap/canonical/OG）。
      // 部署后可在 CI 通过 SITE_URL 环境变量覆盖，或在此处直接写死。
      siteUrl: process.env.SITE_URL,
      siteKeywords: registryConfig.seo.siteKeywords,
    }),
  ],
  define: {
    // 关键词可见性编译期开关：默认 false（用户不可见），但始终写入 meta/JSON-LD
    __SEO_SHOW_KEYWORDS__: JSON.stringify(registryConfig.seo.showKeywordsInline),
  },
  resolve: {
    alias: {
      '@': r('./src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        // 根首页：仓库根目录的 index.html
        home: r('index.html'),
        // 所有工具页
        ...scanToolInputs(),
      },
    },
  },
});
