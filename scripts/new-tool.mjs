// @ts-check
/**
 * 工具脚手架：npm run new -- <slug> [中文名]
 *
 * v2：基于"模块自发现"注册机制。新建工具 = 建一个含 tool.config.ts 的目录，
 *     首页会自动发现并展示，无需编辑任何注册表。
 *
 * 功能：
 *   1. 创建 tools/<slug>/  含：index.html、tool.config.ts、main.ts、assets/（空）
 *   2. （可选）提示如何调整排序/启用：编辑 src/home/registry-config.ts
 *
 * 示例：
 *   npm run new -- quote-card 金句卡片
 *   npm run new -- fancy-text
 *
 * slug 要求：全小写、kebab-case（如 quote-card、fancy-text）。
 */
import { mkdir, writeFile } from 'node:fs/promises';
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

// —— 1. index.html ——
const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${displayName} · 即开宝匣</title>
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

// —— 2. tool.config.ts（模块自描述配置；首页与 SEO 插件据此自动发现）——
const config = `import type { ToolConfig } from '@/core/types';

/**
 * ${displayName} —— 模块自描述配置。
 * 首页（import.meta.glob）与 SEO 插件会自动读取本文件，无需手动登记。
 *
 * 可选美化素材请放在 ./assets/ 目录下：
 *   - assets/icon.<svg|png>   工具图标
 *   - assets/cover.<svg|png>  卡片首图
 * 文件名固定（icon / cover），扩展名不限。未提供时用下方 icon emoji 兜底。
 */
export default {
  slug: ${JSON.stringify(slug)},
  name: ${JSON.stringify(displayName)},
  description: '待补充一句话描述',
  category: '未分类',
  icon: '🧰',
  keywords: [], // SEO 关键词：默认对用户隐藏，但始终写入 meta/JSON-LD 供 AI/搜索引擎读取
  // card: { accent: '#4f46e5' }, // 可选：卡片强调色（无首图时用于渐变头）
} satisfies ToolConfig;
`;

// —— 3. main.ts（最小可用骨架）——
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

// —— 4. assets/ 占位说明 ——
const assetsReadme = `# ${displayName} 资源目录

把工具的图标与首图放在这里，文件名固定为：
- \`icon.svg\` 或 \`icon.png\` —— 工具图标（首页卡片小图）
- \`cover.svg\` 或 \`cover.png\` —— 卡片首图（首页卡片顶部带状图）

未提供时，首页卡片会用 tool.config.ts 里的 \`icon\` emoji 与 \`card.accent\` 渐变兜底。
`;

await mkdir(resolve(toolDir, 'assets'), { recursive: true });
await writeFile(resolve(toolDir, 'index.html'), html, 'utf8');
await writeFile(resolve(toolDir, 'tool.config.ts'), config, 'utf8');
await writeFile(resolve(toolDir, 'main.ts'), ts, 'utf8');
await writeFile(resolve(toolDir, 'assets/README.md'), assetsReadme, 'utf8');

console.log(`✓ 已创建 tools/${slug}/`);
console.log(`  - index.html`);
console.log(`  - tool.config.ts   （编辑这里：名称/描述/图标/关键词/配色）`);
console.log(`  - main.ts`);
console.log(`  - assets/          （放 icon.* / cover.* 美化素材）`);
console.log(`\n首页会自动发现该工具并展示，无需登记。`);
console.log(`如需调整排序或临时隐藏，编辑 src/home/registry-config.ts 的 modules 字段。`);
console.log(`\n下一步：编辑 tool.config.ts 补全信息 + 在 main.ts 实现功能，然后 npm run dev 预览。`);
