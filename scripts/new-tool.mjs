// @ts-check
/**
 * 工具脚手架：npm run new -- <slug> [中文名]
 *
 * 功能：
 *   1. 创建 tools/<slug>/index.html + main.ts 骨架
 *   2. 在 src/home/tools-manifest.ts 末尾登记一条记录（自动出现在首页）
 *
 * 示例：
 *   npm run new -- quote-card 金句卡片
 *   npm run new -- fancy-text
 *
 * slug 要求：全小写、kebab-case（如 quote-card、fancy-text）。
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const [, , rawSlug, rawName] = process.argv;

if (!rawSlug) {
  console.error('用法: npm run new -- <slug> [中文名]');
  console.error('示例: npm run new -- quote-card 金句卡片');
  process.exit(1);
}

const slug = String(rawSlug).toLowerCase();
if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
  console.error(`slug 非法: "${slug}"。需为全小写字母/数字/连字符，且以字母开头。`);
  process.exit(1);
}

const toolDir = resolve(ROOT, 'tools', slug);
if (existsSync(toolDir)) {
  console.error(`工具已存在: tools/${slug}`);
  process.exit(1);
}

const displayName = rawName || slug;

// —— 1. 生成 index.html ——
const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${displayName} · 静态工具箱</title>
    <script>
      (function () {
        try {
          var s = localStorage.getItem('static-toolkit-theme');
          var dark = s ? s === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
          if (dark) document.documentElement.classList.add('dark');
        } catch (e) {}
      })();
    </script>
  </head>
  <body>
    <div id="app" class="mx-auto max-w-5xl px-4 py-10 min-h-screen"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
`;

// —— 2. 生成 main.ts（最小可用骨架）——
const ts = `import '@/core/styles/main.css';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { h } from '@/core/components/element';

initTheme();

function render() {
  const { content } = renderToolLayout(document.getElementById('app')!, ${JSON.stringify(displayName)});
  // TODO: 在这里实现 ${displayName} 的功能
  content.append(
    h('p', { class: 'text-[var(--fg-muted)]', textContent: '${displayName} —— 待实现' }),
  );
}

render();
`;

await mkdir(toolDir, { recursive: true });
await writeFile(resolve(toolDir, 'index.html'), html, 'utf8');
await writeFile(resolve(toolDir, 'main.ts'), ts, 'utf8');
console.log(`✓ 已创建 tools/${slug}/index.html 和 main.ts`);

// —— 3. 登记到 tools-manifest.ts ——
const manifestPath = resolve(ROOT, 'src/home/tools-manifest.ts');
const manifest = await readFile(manifestPath, 'utf8');

const entry = `  {
    slug: ${JSON.stringify(slug)},
    name: ${JSON.stringify(displayName)},
    description: '待补充描述',
    category: '未分类',
    icon: '🧰',
  },`;

if (manifest.includes(`slug: ${JSON.stringify(slug)}`)) {
  console.log(`ℹ tools-manifest.ts 中已存在 ${slug}，跳过登记`);
} else {
  // 在数组闭合 ] 前插入新条目
  const closingBracket = manifest.lastIndexOf('];');
  if (closingBracket === -1) {
    console.error('× 无法解析 tools-manifest.ts，请手动登记');
    process.exit(1);
  }
  const updated =
    manifest.slice(0, closingBracket) +
    entry + '\n' +
    manifest.slice(closingBracket);
  await writeFile(manifestPath, updated, 'utf8');
  console.log(`✓ 已登记到 src/home/tools-manifest.ts`);
}

console.log(`\n下一步：编辑 tools/${slug}/main.ts 实现功能，然后 npm run dev 预览。`);
