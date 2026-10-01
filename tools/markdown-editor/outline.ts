import { h } from '@/core/components/element';

/**
 * 内容大纲：从预览区标题自动构建层级索引，
 * 支持面板开关、节点折叠、当前章节高亮（scroll-spy）与点击定位。
 */

/** 预览区收集到的标题信息 */
export interface OutlineHeading {
  /** 层级 1-6 */
  level: number;
  text: string;
  /** 锚点 id（markdown-it-anchor 生成，同一文档内唯一） */
  id: string;
  el: HTMLElement;
}

export interface OutlineNode {
  heading: OutlineHeading;
  children: OutlineNode[];
}

/**
 * 由扁平标题序列构建层级树。
 * 层级跳变（如 h1 后直接 h3）时挂到最近的祖先下，保证树总能建成。
 */
export function buildOutlineTree(headings: OutlineHeading[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const heading of headings) {
    const node: OutlineNode = { heading, children: [] };
    while (stack.length && stack[stack.length - 1]!.heading.level >= heading.level) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1]!.children.push(node);
    stack.push(node);
  }
  return roots;
}

/**
 * 源文档中 ATX 标题（# .. ######）所在的 0 基行号。
 * 围栏代码块内的 # 不算标题；用于「仅编辑」视图下点击大纲跳到源码行。
 */
export function findHeadingSourceLines(doc: string): number[] {
  const lines = doc.split('\n');
  const out: number[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceMatch = /^ {0,3}(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      // 开栏与关栏成对识别：同字符、长度 >= 开栏才算关闭
      if (fence === null) fence = fenceMatch[1]!;
      else if (fence[0] === fenceMatch[1]![0] && fenceMatch[1]!.length >= fence.length)
        fence = null;
      continue;
    }
    if (fence === null && /^ {0,3}#{1,6}(\s|$)/.test(line)) out.push(i);
  }
  return out;
}

export interface OutlinePanelHooks {
  /** 点击某个标题项（携带渲染后的标题信息） */
  onActivate(heading: OutlineHeading): void;
}

/**
 * 大纲面板：树形渲染 + 分级样式 + 折叠状态保持 + 当前章节高亮。
 * update() 在每次预览重渲后调用；折叠状态按标题锚点 id 记忆，滚动位置重建后恢复。
 * 面板开合由外层浮动手柄控制（app.ts），面板自身不含关闭按钮。
 */
export class OutlinePanel {
  private readonly listEl: HTMLElement;
  private readonly toggleAllBtn: HTMLButtonElement;
  private readonly collapsed = new Set<string>();
  private itemById = new Map<string, HTMLElement>();
  private parents: OutlineNode[] = [];
  private lastHeadings: OutlineHeading[] = [];
  private activeId: string | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly hooks: OutlinePanelHooks,
  ) {
    this.toggleAllBtn = h('button', {
      type: 'button',
      class: 'text-xs text-[var(--fg-muted)] transition-colors hover:text-[var(--accent)]',
      textContent: '全部收起',
      onclick: () => this.toggleAll(),
    });
    root.append(
      h('div', { class: 'mb-2 flex items-center justify-between gap-1 px-2 pt-1' }, [
        h('span', {
          class: 'text-xs font-semibold tracking-wide text-[var(--fg-muted)]',
          textContent: '内容大纲',
        }),
        this.toggleAllBtn,
      ]),
    );
    this.listEl = h('div', { class: 'flex-1 pb-4' });
    root.append(this.listEl);
  }

  /** 重建大纲树（保留折叠状态与滚动位置） */
  update(headings: OutlineHeading[]): void {
    const scrollTop = this.root.scrollTop;
    this.lastHeadings = headings;
    this.itemById = new Map();
    const tree = buildOutlineTree(headings);
    this.parents = collectParents(tree);

    if (tree.length === 0) {
      this.listEl.replaceChildren(
        h('p', {
          class: 'px-2 py-6 text-center text-xs leading-relaxed text-[var(--fg-muted)]',
          textContent: '暂无标题结构\n用 # 开始一个章节',
        }),
      );
      this.toggleAllBtn.textContent = '全部收起';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const node of tree) frag.append(this.renderNode(node));
    this.listEl.replaceChildren(frag);
    this.root.scrollTop = scrollTop;
    this.paintToggleAllLabel();
    if (this.activeId) this.setActive(this.activeId, { scroll: false });
  }

  /** 高亮当前章节（scroll=false 时不滚动面板，用于重建后恢复） */
  setActive(id: string | null, options: { scroll?: boolean } = {}): void {
    this.activeId = id;
    for (const [itemId, el] of this.itemById) {
      el.classList.toggle('is-active', itemId === id);
    }
    const activeEl = id ? this.itemById.get(id) : undefined;
    if (activeEl && options.scroll !== false && this.root.offsetParent !== null) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }

  private renderNode(node: OutlineNode): HTMLElement {
    const { heading, children } = node;
    const hasChildren = children.length > 0;
    const isCollapsed = hasChildren && this.collapsed.has(heading.id);

    const caret = h('span', {
      class:
        'md-outline-caret inline-flex h-4 w-4 shrink-0 items-center justify-center text-[9px] text-[var(--fg-muted)] transition-transform',
      textContent: hasChildren ? (isCollapsed ? '▸' : '▾') : '',
    });

    const item = h(
      'div',
      {
        class:
          'md-outline-item flex cursor-pointer items-start gap-0.5 rounded-md px-1.5 py-1 text-[13px] leading-snug transition-colors',
        role: 'button',
        tabindex: '0',
        'aria-current': String(this.activeId === heading.id),
        'data-level': String(heading.level),
        style: `margin-left:${(heading.level - 1) * 10}px`,
        onclick: () => this.hooks.onActivate(heading),
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.hooks.onActivate(heading);
          }
        },
      },
      [
        caret,
        h('span', {
          class: 'md-outline-text min-w-0 flex-1 break-all',
          textContent: heading.text,
        }),
      ],
    );
    this.itemById.set(heading.id, item);

    const childrenEl = h('div', { class: hasChildren && isCollapsed ? 'hidden' : '' });
    for (const child of children) childrenEl.append(this.renderNode(child));

    if (hasChildren) {
      const toggle = (): void => {
        if (this.collapsed.has(heading.id)) this.collapsed.delete(heading.id);
        else this.collapsed.add(heading.id);
        // 局部更新，避免整树重建
        childrenEl.classList.toggle('hidden', this.collapsed.has(heading.id));
        caret.textContent = this.collapsed.has(heading.id) ? '▸' : '▾';
        this.paintToggleAllLabel();
      };
      caret.classList.add('cursor-pointer');
      caret.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle();
      });
      item.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const wantCollapsed = e.key === 'ArrowLeft';
          if (wantCollapsed !== this.collapsed.has(heading.id)) toggle();
        }
      });
    }

    return h('div', {}, [item, childrenEl]);
  }

  private toggleAll(): void {
    const anyExpanded = this.parents.some((n) => !this.collapsed.has(n.heading.id));
    if (anyExpanded) this.parents.forEach((n) => this.collapsed.add(n.heading.id));
    else this.collapsed.clear();
    this.update(this.lastHeadings);
  }

  private paintToggleAllLabel(): void {
    const anyExpanded = this.parents.some((n) => !this.collapsed.has(n.heading.id));
    this.toggleAllBtn.textContent = anyExpanded ? '全部收起' : '全部展开';
  }
}

function collectParents(tree: OutlineNode[]): OutlineNode[] {
  const out: OutlineNode[] = [];
  const walk = (nodes: OutlineNode[]): void => {
    for (const n of nodes) {
      if (n.children.length) {
        out.push(n);
        walk(n.children);
      }
    }
  };
  walk(tree);
  return out;
}
