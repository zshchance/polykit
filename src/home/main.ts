import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { createThemeToggle, initTheme } from '@/core/components/ThemeToggle';
import { toolsManifest } from './tools-manifest';
import type { ToolMeta } from '@/core/types';

initTheme();

const base = import.meta.env.BASE_URL;

/** 拼接工具页地址：base + 'tools/' + slug + '/'
 *  路径与 tools/<slug>/ 目录对齐，dev/build 一致，避免 SPA fallback 误命中 */
function toolUrl(slug: string): string {
  return `${base}tools/${slug}/`;
}

/** 按 category 分组 */
function groupByCategory(tools: ToolMeta[]): Map<string, ToolMeta[]> {
  const map = new Map<string, ToolMeta[]>();
  for (const t of tools) {
    const list = map.get(t.category) ?? [];
    list.push(t);
    map.set(t.category, list);
  }
  return map;
}

function renderHome() {
  const app = document.getElementById('app')!;

  // —— 顶部标题栏 ——
  app.append(
    h('header', { class: 'flex items-center justify-between gap-4 mb-10' }, [
      h('div', {}, [
        h('h1', { class: 'text-3xl font-bold tracking-tight', textContent: '静态工具箱' }),
        h('p', { class: 'mt-1 text-[var(--fg-muted)]', textContent: '纯浏览器运行，数据不出本地' }),
      ]),
      createThemeToggle(),
    ]),
  );

  // —— 工具卡片网格（按分类分组）——
  const groups = groupByCategory(toolsManifest);

  if (groups.size === 0) {
    app.append(
      h('p', { class: 'text-[var(--fg-muted)]', textContent: '还没有工具。运行 npm run new -- <名称> 创建第一个。' }),
    );
    return;
  }

  const wrapper = h('div', { class: 'space-y-10' }, []);
  for (const [category, tools] of groups) {
    const grid = h('div', { class: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4' }, [
      ...tools.map((tool) =>
        h('a', {
          href: toolUrl(tool.slug),
          class:
            'group block rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 hover:border-[var(--accent)] transition-colors',
        }, [
          h('div', { class: 'flex items-center gap-3' }, [
            h('span', { class: 'text-2xl', textContent: tool.icon ?? '🧰' }),
            h('h3', { class: 'font-semibold group-hover:text-[var(--accent)] transition-colors', textContent: tool.name }),
          ]),
          h('p', { class: 'mt-2 text-sm text-[var(--fg-muted)]', textContent: tool.description }),
        ]),
      ),
    ]);

    wrapper.append(
      h('section', {}, [
        h('h2', { class: 'mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--fg-muted)]', textContent: category }),
        grid,
      ]),
    );
  }
  app.append(wrapper);
}

renderHome();
