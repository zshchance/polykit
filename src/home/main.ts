import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { createThemeToggle, initTheme } from '@/core/components/ThemeToggle';
import { createSiteFooter } from '@/core/components/SiteFooter';
import { getRegisteredTools, getCategories } from './registry';
import type { RegisteredTool } from '@/core/types';
import { createSearchBar, searchBarContainer } from './components/SearchBar';
import { createCategoryChips } from './components/CategoryChips';
import { createToolCard } from './components/ToolCard';
import { observeStagger } from './components/stagger';
import { createClock } from './components/Clock';
import { renderCalendar } from './calendar/calendar';
import {
  loadPrefs,
  savePrefs,
  isPinned,
  isStarred,
  togglePin,
  toggleStar,
  applyOrder,
  type HomePrefs,
} from './prefs';
import { sortTools } from './sort';
import { enableDragReorder } from './components/dragReorder';
import { createSettingsPanel } from './components/SettingsPanel';

initTheme();

/**
 * 首页：两栏布局。
 *   - 主栏：Hero + 搜索 + 分类筛选 + 工具卡片网格
 *   - 侧栏（留白区）：万年历（桌面 sticky，移动端堆叠到底部）
 *
 * 状态：
 *   - searchQuery + activeCategory + onlyStarred → 过滤 tools
 *   - prefs（置顶 / 星标 / 排序）→ 过滤后排序 + 渲染
 *
 * 排序：置顶组在前 → 组内按自定义顺序 → registry 兜底（见 sort.ts）。
 * 拖拽排序仅在「无搜索 + 全分类」时启用（过滤下拖拽无意义）。
 */
function renderHome(): void {
  const app = document.getElementById('app')!;
  const tools = getRegisteredTools();
  const categories = getCategories(tools);

  // —— 用户偏好 ——
  let prefs: HomePrefs = loadPrefs();

  /** 修改偏好：落库 + 刷新设置面板统计 + 重渲染 */
  function mutatePrefs(next: HomePrefs): void {
    prefs = next;
    savePrefs(prefs);
    settingsPanel.refresh(prefs);
    rerenderGrid();
  }

  // —— 过滤状态 ——
  let query = '';
  let category = '';
  let onlyStarred = false;

  /** 拖拽是否可用：仅无搜索 + 全分类时 */
  function dragEnabled(): boolean {
    return !query && !category;
  }

  /** 当前过滤后（再按偏好排序）的工具列表 */
  function filtered(): RegisteredTool[] {
    const list = tools.filter((t) => {
      if (category && t.category !== category) return false;
      if (onlyStarred && !isStarred(prefs, t.slug)) return false;
      if (query) {
        const q = query.toLowerCase();
        const hay = [t.name, t.description, ...(t.keywords ?? [])]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return sortTools(list, prefs);
  }

  // ────────── 设置浮层（fixed，由顶栏 ⚙ 按钮触发） ──────────
  const settingsPanel = createSettingsPanel(prefs, (next) => mutatePrefs(next));
  const popover = h(
    'div',
    {
      class: 'fixed right-4 top-16 z-50 hidden',
      'data-settings-popover': '1',
    },
    [settingsPanel.el],
  );
  // 点击浮层外部收起
  document.addEventListener('click', (e) => {
    if (popover.classList.contains('hidden')) return;
    const target = e.target as Node;
    if (popover.contains(target) || settingsBtn.contains(target)) return;
    hidePopover();
  });

  function showPopover(): void {
    popover.classList.remove('hidden');
    settingsBtn.setAttribute('aria-expanded', 'true');
  }
  function hidePopover(): void {
    popover.classList.add('hidden');
    settingsBtn.setAttribute('aria-expanded', 'false');
  }

  // 顶栏「⚙」按钮：与主题切换同款极简图标按钮
  const settingsBtn = h('button', {
    type: 'button',
    class:
      'inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--fg)] hover:bg-[var(--bg-elevated)] transition-colors text-lg',
    title: '我的设置（备份 / 还原）',
    'aria-label': '我的设置',
    'aria-expanded': 'false',
    'aria-haspopup': 'dialog',
    onclick: (e: Event) => {
      e.stopPropagation();
      if (popover.classList.contains('hidden')) showPopover();
      else hidePopover();
    },
  });
  settingsBtn.textContent = '⚙';

  // ────────── 顶部 Hero ──────────
  const hero = h('header', { class: 'mb-8' }, [
    h('div', { class: 'flex items-start justify-between gap-4' }, [
      h('div', {}, [
        h('h1', {
          class: 'text-4xl font-bold tracking-tight text-[var(--fg)]',
          textContent: '即开宝匣',
        }),
        h('p', {
          class: 'mt-2 text-[var(--fg-muted)]',
          textContent: '即开即用，数据不出本地 · 实用与趣味兼得的在线小工具',
        }),
      ]),
      h('div', { class: 'flex items-center gap-2' }, [settingsBtn, createThemeToggle()]),
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

  // ────────── 「只看星标」开关（独立于分类，语义为收藏筛选） ──────────
  const starToggle = h('button', {
    type: 'button',
    class:
      'shrink-0 rounded-full border px-3 py-1 text-sm transition-colors border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--accent)]',
    'aria-pressed': 'false',
    title: '只看星标工具',
    onclick: () => {
      onlyStarred = !onlyStarred;
      starToggle.setAttribute('aria-pressed', String(onlyStarred));
      starToggle.textContent = onlyStarred ? '⭐ 只看星标' : '⭐ 星标';
      starToggle.className = onlyStarred
        ? 'shrink-0 rounded-full border px-3 py-1 text-sm transition-colors border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
        : 'shrink-0 rounded-full border px-3 py-1 text-sm transition-colors border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--accent)]';
      rerenderGrid();
    },
  });
  starToggle.textContent = '⭐ 星标';
  // chips 是 role=tablist（语义独立），星标开关是普通 toggle；
  // 用 flex 容器并排，但 tablist 与 toggle 互不嵌套，避免 ARIA 语义混淆。
  const filterRow = h(
    'div',
    { class: 'flex flex-wrap items-center gap-2' },
    [chips.el, h('span', { class: 'mx-1 h-5 w-px bg-[var(--border)]' }), starToggle],
  );

  // ────────── 工具网格容器（可替换内容） ──────────
  const gridContainer = h('div', {});
  const emptyHint = h('p', {
    class: 'py-16 text-center text-[var(--fg-muted)]',
    textContent: '没有匹配的工具。',
  });

  /** 把卡片包进 relative wrapper（承载拖拽手柄），返回 wrapper */
  function wrapCard(card: HTMLAnchorElement, slug: string, index: number): HTMLElement {
    const wrapper = h('div', { class: 'tool-card-wrap relative h-full' }, [card]) as HTMLElement;
    (wrapper as unknown as { _slug: string; _index: number })._slug = slug;
    (wrapper as unknown as { _slug: string; _index: number })._index = index;
    return wrapper;
  }

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
        class: 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3',
      },
      list.map((t, i) =>
        wrapCard(
          createToolCard(t, {
            index: i,
            pinned: isPinned(prefs, t.slug),
            starred: isStarred(prefs, t.slug),
            onTogglePin: () => mutatePrefs(togglePin(prefs, t.slug)),
            onToggleStar: () => mutatePrefs(toggleStar(prefs, t.slug)),
          }),
          t.slug,
          i,
        ),
      ),
    );
    gridContainer.replaceChildren(grid);
    observeStagger(grid);

    // 拖拽排序：仅无筛选时启用
    if (dragEnabled() && list.length > 1) {
      enableDragReorder(grid, list.map((t) => t.slug), (newSlugs) => {
        mutatePrefs(applyOrder(prefs, newSlugs));
      });
    }
  }

  // ────────── 主栏（搜索+分类+网格） ──────────
  const mainCol = h('div', { class: 'space-y-5' }, [
    searchWrapper,
    filterRow,
    gridContainer,
  ]);

  // ────────── 侧栏：时钟 + 万年历 ──────────
  const calendarCard = h(
    'aside',
    {
      class: 'rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4',
      'aria-label': '万年历',
    },
    [],
  );
  renderCalendar(calendarCard);

  // 侧栏整体：时钟在上、日历在下；sticky 移到外层包裹，避免两元素各自粘连
  const sideCol = h(
    'div',
    { class: 'space-y-4 lg:sticky lg:top-6' },
    [createClock(), calendarCard],
  );

  // ────────── 两栏布局 ──────────
  const layout = h('div', { class: 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]' }, [
    mainCol,
    sideCol,
  ]);

  // 空工具提示
  if (tools.length === 0) {
    app.append(
      hero,
      h('p', {
        class: 'text-[var(--fg-muted)]',
        textContent: '还没有工具。运行 npm run new -- <名称> 创建第一个。',
      }),
      createSiteFooter(),
    );
    return;
  }

  app.append(hero, layout, createSiteFooter());
  // 设置浮层挂到 body 顶层（fixed 定位，脱离布局流）
  document.body.append(popover);
  rerenderGrid();
}

renderHome();
