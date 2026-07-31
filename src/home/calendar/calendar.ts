import { h } from '@/core/components/element';
import { getDayInfo, getHolidaysMeta } from './holidays';
import { checkForUpdates, getLastCheckedAt, type UpdateResult } from './update';

/**
 * 万年历月历组件（首页侧栏留白区）。
 *
 * 功能：
 *   - 月历网格（周日起始），上下月导航，"今天"高亮
 *   - 法定假日（休）红色 / 调休上班（班）橙色 / 传统节日（节）点缀
 *   - 点击日期在底部显示当日详情
 *   - "检查更新"按钮：主动联网拉取最新节假日数据（默认离线）
 *   - 数据来源溯源信息
 *
 * 无外部依赖，纯 DOM + CSS 变量，主题自动跟随。
 */

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
const MONTH_LABELS = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
];

/** 当前展示的月份；模块级，组件实例间共享 */
let cursor = new Date();
let cursorDate = new Date(
  cursor.getFullYear(),
  cursor.getMonth(),
  1,
);

/** 选中的日期（点击日格后高亮），null 表示未选 */
let selectedKey: string | null = null;

/** 详情容器与状态指示器的引用（render 后赋值） */
let detailEl: HTMLElement;
let statusEl: HTMLElement;

/** 整个日历根容器（重渲染时整体替换其内容） */
let rootEl: HTMLElement;

/**
 * 渲染日历到指定挂载点。返回的元素可用于布局嵌入。
 */
export function renderCalendar(mount: HTMLElement): HTMLElement {
  rootEl = h('div', { class: 'calendar' });
  mount.append(rootEl);
  redraw();
  return rootEl;
}

/** 全量重绘日历内容 */
function redraw(): void {
  rootEl.replaceChildren(...buildChildren());
}

function buildChildren(): Node[] {
  const today = new Date();

  // —— 标题行：上月 / 年月 / 下月 ——
  const header = h('div', { class: 'flex items-center justify-between mb-3' }, [
    navButton('‹', () => shiftMonth(-1)),
    h('div', { class: 'text-center' }, [
      h('div', {
        class: 'text-base font-semibold',
        textContent: `${cursorDate.getFullYear()} 年 ${MONTH_LABELS[cursorDate.getMonth()]}`,
      }),
      h('button', {
        type: 'button',
        class:
          'text-xs text-[var(--fg-muted)] hover:text-[var(--accent)] transition-colors mt-0.5',
        textContent: '回到今天',
        onclick: () => {
          cursor = new Date();
          cursorDate = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
          selectedKey = dateKey(today);
          redraw();
        },
      }),
    ]),
    navButton('›', () => shiftMonth(1)),
  ]);

  // —— 星期表头 ——
  const weekRow = h(
    'div',
    { class: 'grid grid-cols-7 gap-1 mb-1 text-center text-xs text-[var(--fg-muted)]' },
    WEEK_LABELS.map((w, i) =>
      h('div', {
        class: i === 0 || i === 6 ? 'text-[var(--accent)]' : '',
        textContent: w,
      }),
    ),
  );

  // —— 日期网格 ——
  const grid = h('div', { class: 'grid grid-cols-7 gap-1' }, buildDayCells(today));

  // —— 图例 ——
  const legend = h(
    'div',
    {
      class: 'flex flex-wrap items-center gap-3 mt-3 text-xs text-[var(--fg-muted)]',
    },
    [
      legendDot('var(--holiday-legal)', '休'),
      legendDot('var(--holiday-work)', '班'),
      legendDot('var(--holiday-festival)', '节'),
    ],
  );

  // —— 详情区（点击日期后显示） ——
  detailEl = h('div', {
    class: 'mt-3 min-h-[1.5rem] text-sm text-[var(--fg)]',
    textContent: '点击日期查看详情',
  });

  // —— 数据来源 + 检查更新 ——
  statusEl = h('div', {
    class: 'mt-3 flex items-center justify-between gap-2 text-xs text-[var(--fg-muted)]',
  });
  refreshStatus();

  return [header, weekRow, grid, legend, detailEl, statusEl];
}

function legendDot(color: string, label: string): HTMLElement {
  return h('span', { class: 'inline-flex items-center gap-1' }, [
    h('span', {
      class: 'inline-block h-2.5 w-2.5 rounded-full',
      style: `background:${color}`,
    }),
    h('span', { textContent: label }),
  ]);
}

/** 构造当月日期网格（含上月末与下月初补位，共 42 格） */
function buildDayCells(today: Date): HTMLElement[] {
  const year = cursorDate.getFullYear();
  const month = cursorDate.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay(); // 0=周日
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: HTMLElement[] = [];

  // 前置补位（上月末几天）
  const prevDays = new Date(year, month, 0).getDate();
  for (let i = firstWeekday - 1; i >= 0; i--) {
    cells.push(dayCell(new Date(year, month - 1, prevDays - i), true, today));
  }
  // 当月
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(dayCell(new Date(year, month, d), false, today));
  }
  // 后置补位至 42 格
  let next = 1;
  while (cells.length < 42) {
    cells.push(dayCell(new Date(year, month + 1, next++), true, today));
  }
  return cells;
}

/** 单个日期格 */
function dayCell(date: Date, dimmed: boolean, today: Date): HTMLElement {
  const key = dateKey(date);
  const info = getDayInfo(date);
  const isToday = key === dateKey(today);
  const isSelected = key === selectedKey;
  const dow = date.getDay();

  // 样式类拼装
  const classes = [
    'calendar-day',
    'relative',
    'flex',
    'flex-col',
    'items-center',
    'justify-center',
    'aspect-square',
    'rounded-lg',
    'text-sm',
    'cursor-pointer',
    'transition-all',
    'select-none',
  ];
  if (dimmed) classes.push('opacity-30');
  if (isToday) classes.push('ring-2', 'ring-[var(--accent)]');
  if (isSelected) classes.push('bg-[var(--accent)]/10');

  // 文字颜色：法定调休优先，其次周末，否则常规
  let dayColor = 'var(--fg)';
  if (info?.type === 'workday') dayColor = 'var(--holiday-work)';
  else if (info?.type === 'legal') dayColor = 'var(--holiday-legal)';
  else if (dow === 0 || dow === 6) dayColor = 'var(--accent)';

  const children: (Node | string)[] = [
    h('span', { class: 'font-medium', style: `color:${dayColor}`, textContent: String(date.getDate()) }),
  ];
  // 节假日标记小角标
  if (info) {
    const tagColor =
      info.type === 'legal'
        ? 'var(--holiday-legal)'
        : info.type === 'workday'
          ? 'var(--holiday-work)'
          : 'var(--holiday-festival)';
    const tagText = info.type === 'legal' ? '休' : info.type === 'workday' ? '班' : '•';
    children.push(
      h('span', {
        class: 'calendar-tag text-[10px] leading-none mt-0.5',
        style: `color:${tagColor}`,
        textContent: tagText,
      }),
    );
  }

  return h(
    'button',
    {
      type: 'button',
      class: classes.join(' '),
      title: info?.name ?? '',
      onclick: () => {
        selectedKey = key;
        showDetail(date, info);
        redraw();
      },
    },
    children,
  );
}

/** 显示点击日期的详情 */
function showDetail(date: Date, info: ReturnType<typeof getDayInfo>): void {
  const ds = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  detailEl.replaceChildren(
    info
      ? h('span', {}, [
          h('span', { class: 'font-medium', textContent: ds + ' ' }),
          h(
            'span',
            {
              class: 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs',
              style: `background:var(--holiday-${info.type}-bg);color:var(--holiday-${info.type})`,
            },
            [document.createTextNode(typeLabel(info.type) + ' · ' + info.name)],
          ),
        ])
      : h('span', { textContent: `${ds}（普通日）` }),
  );
}

function typeLabel(t: 'legal' | 'workday' | 'festival'): string {
  return t === 'legal' ? '休' : t === 'workday' ? '班' : '节';
}

/** 月份导航按钮 */
function navButton(glyph: string, onClick: () => void): HTMLButtonElement {
  return h('button', {
    type: 'button',
    class:
      'flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] text-lg leading-none hover:bg-[var(--bg-elevated)] hover:border-[var(--accent)] transition-colors',
    textContent: glyph,
    onclick: onClick,
  });
}

function shiftMonth(delta: number): void {
  cursorDate = new Date(cursorDate.getFullYear(), cursorDate.getMonth() + delta, 1);
  selectedKey = null;
  redraw();
}

/** 渲染状态行（数据来源 + 检查更新按钮） */
function refreshStatus(): void {
  const meta = getHolidaysMeta();
  const last = getLastCheckedAt();
  const lastText = last ? ` · 上次检查 ${new Date(last).toLocaleDateString('zh-CN')}` : '';

  const updateBtn = h('button', {
    type: 'button',
    class:
      'inline-flex items-center gap-1 px-2 py-1 rounded border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors',
    textContent: '检查更新',
    onclick: async () => {
      updateBtn.textContent = '检查中…';
      updateBtn.disabled = true;
      const result: UpdateResult = await checkForUpdates();
      updateBtn.textContent = '检查更新';
      updateBtn.disabled = false;
      const msg = result.ok
        ? result.updated
          ? `✓ 已更新到 ${result.version}`
          : `✓ 已是最新（${result.version}）`
        : `× ${result.reason}，使用本地数据`;
      flashStatus(msg);
      refreshStatus();
      redraw();
    },
  });

  statusEl.replaceChildren(
    h('span', {
      class: 'truncate',
      title: meta.source,
      textContent: `数据：v${meta.version}${lastText}`,
    }),
    updateBtn,
  );
}

/** 临时提示（替代 alert） */
function flashStatus(msg: string): void {
  const tip = h('div', {
    class:
      'mt-2 rounded-md bg-[var(--bg-elevated)] border border-[var(--border)] px-2 py-1 text-xs text-[var(--fg)]',
    textContent: msg,
  });
  statusEl.parentElement?.append(tip);
  setTimeout(() => tip.remove(), 3500);
}

/** 日期 → YYYY-MM-DD */
function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
