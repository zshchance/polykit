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
 * 入口键用工具目录名，产物路径保持目录结构（如 /static-toolkit/password-generator/）。
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
 * GitHub Pages 部署到子路径 /static-toolkit/。
 * - 生产构建用 /static-toolkit/，否则资源 404。
 * - 本地 dev 用 /，否则 Vite 会去 /static-toolkit/ 找资源。
 * 通过 BASE_URL 环境变量可覆盖（如临时换仓库名）。
 */
const repoName = process.env.BASE_URL?.replace(/^\/|\/$/g, '') ?? 'static-toolkit';
const isProd = process.env.NODE_ENV === 'production';
const base = isProd ? `/${repoName}/` : '/';

export default defineConfig({
  base,
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
