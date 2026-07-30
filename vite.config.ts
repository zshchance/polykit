import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';
import tailwindcss from '@tailwindcss/vite';

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
 * 部署到 Cloudflare Pages（根路径，<project>.pages.dev 或自定义域名）。
 * base 固定为 '/'。各页面内用 import.meta.env.BASE_URL 拼接链接，
 * 可自动跟随 base 变化——若将来改部署到子路径，只改这一处即可。
 */

export default defineConfig({
  base: '/',
  plugins: [tailwindcss()],
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
