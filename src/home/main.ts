import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { createThemeToggle, initTheme } from '@/core/components/ThemeToggle';
import { getRegisteredTools, getCategories } from './registry';
import type { RegisteredTool } from '@/core/types';
import { createSearchBar, searchBarContainer } from './components/SearchBar';
import { createCategoryChips } from './components/CategoryChips';
import { createToolCard } from './components/ToolCard';
import { observeStagger } from './components/stagger';
import { renderCalendar } from './calendar/calendar';

initTheme();

/**
 * 首页：两栏布局。
 *   - 主栏：Hero + 搜索 + 分类筛选 + 工具卡片网格
 *   - 侧栏（留白区）：万年历（桌面 sticky，移动端堆叠到底部）
 *
 * 状态：searchQuery + activeCategory → 过滤 tools → 渲染网格。
 */
function renderHome(): void {
  const app = document.getElementById('app')!;
  const tools = getRegisteredTools();
  const categories = getCategories(tools);

  // —— 过滤状态 ——
  let query = '';
  let category = '';

  /** 当前过滤后的工具列表 */
  function filtered(): RegisteredTool[] {
    return tools.filter((t) => {
      if (category && t.category !== category) return false;
      if (query) {
        const q = query.toLowerCase();
        const hay = [t.name, t.description, ...(t.keywords ?? [])]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  // ────────── 顶部 Hero ──────────
  const hero = h('header', { class: 'mb-8' }, [
    h('div', { class: 'flex items-start justify-between gap-4' }, [
      h('div', {}, [
        h('h1', {
          class: 'text-4xl font-bold tracking-tight text-[var(--fg)]',
          textContent: '静态工具箱',
        }),
        h('p', {
          class: 'mt-2 text-[var(--fg-muted)]',
          textContent: '纯浏览器运行，数据不出本地 · 安全实用的在线小工具',
        }),
      ]),
      createThemeToggle(),
    ]),
  ]);

  // ────────── 搜索栏 ──────────
  const searchBar = createSearchBar();
  const searchWrapper = searchBarContainer(searchBar.el);
  searchBar.onChange((q) => {
    query = q;
    rerenderGrid();
  });

  // ────────── 分类胶囊 ──────────
  const chips = createCategoryChips(categories);
  chips.onChange((c) => {
    category = c;
    rerenderGrid();
  });

  // ────────── 工具网格容器（可替换内容） ──────────
  const gridContainer = h('div', {});
  const emptyHint = h('p', {
    class: 'py-16 text-center text-[var(--fg-muted)]',
    textContent: '没有匹配的工具。',
  });

  function rerenderGrid(): void {
    const list = filtered();
    gridContainer.replaceChildren();

    if (list.length === 0) {
      gridContainer.append(emptyHint);
      return;
    }

    const grid = h(
      'div',
      {
        class:
          'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3',
      },
      list.map((t, i) => createToolCard(t, i)),
    );
    gridContainer.replaceChildren(grid);
    observeStagger(grid);
  }

  // ────────── 主栏（搜索+分类+网格） ──────────
  const mainCol = h('div', { class: 'space-y-5' }, [
    searchWrapper,
    chips.el,
    gridContainer,
  ]);

  // ────────── 侧栏：万年历 ──────────
  const calendarCard = h(
    'aside',
    {
      class:
        'rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 lg:sticky lg:top-6',
      'aria-label': '万年历',
    },
    [],
  );
  renderCalendar(calendarCard);

  // ────────── 两栏布局 ──────────
  const layout = h('div', { class: 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]' }, [
    mainCol,
    calendarCard,
  ]);

  // 空工具提示
  if (tools.length === 0) {
    app.append(
      hero,
      h('p', {
        class: 'text-[var(--fg-muted)]',
        textContent: '还没有工具。运行 npm run new -- <名称> 创建第一个。',
      }),
    );
    return;
  }

  app.append(hero, layout);
  rerenderGrid();
}

renderHome();
