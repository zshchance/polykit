import { h } from '@/core/components/element';
import type { ViewMode } from './session';
import type { DropRejection, OpenedFile } from './io/files';

/**
 * DOM 构建层：空态欢迎页 + 编辑器外壳。
 * 按钮语言沿用站点工具页（rounded-lg + 站点 CSS 变量 + transition）。
 */

const BTN =
  'inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--fg)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]';
const BTN_ACCENT =
  'inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90';
const BTN_GHOST =
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--fg)]';

const TOOLBAR_SEP = 'h-5 w-px shrink-0 bg-[var(--border)]';

export const MODE_LABELS: Record<ViewMode, string> = {
  split: '分栏',
  editor: '编辑',
  read: '阅读',
};

/* ───────────────────────── 空态欢迎页 ───────────────────────── */

export interface LandingHooks {
  onOpen: () => void;
  onNew: () => void;
  onSample: () => void;
  onDropFile: (file: OpenedFile) => void;
  onDropReject: (r: DropRejection) => void;
}

export interface LandingView {
  root: HTMLElement;
  /** 落件区（拖拽高亮目标，点击等同「打开」） */
  dropzone: HTMLElement;
  /** 底部提示行（拖入不支持文件时给出轻量反馈） */
  hint: HTMLElement;
}

export function buildLanding(hooks: LandingHooks): LandingView {
  const hint = h('p', {
    class: 'min-h-5 text-center text-sm text-[var(--fg-muted)] transition-colors',
    textContent: '内容自动保存在本浏览器，刷新不丢失 · 数据不出本地',
  });

  const dropzone = h(
    'div',
    {
      class:
        'md-dropzone flex w-full max-w-xl cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl bg-[var(--bg-elevated)] px-6 py-14 text-center select-none',
      role: 'button',
      tabindex: '0',
      'aria-label': '拖入或选择 Markdown 文件',
      onclick: hooks.onOpen,
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          hooks.onOpen();
        }
      },
    },
    [
      h('span', { class: 'text-4xl', textContent: '📥' }),
      h('p', {
        class: 'mt-2 text-base font-medium text-[var(--fg)]',
        textContent: '把 Markdown 文件拖到这里',
      }),
      h('p', {
        class: 'text-sm text-[var(--fg-muted)]',
        textContent: '或点击选择文件 · 支持 .md / .markdown / .txt · 单文件 ≤ 10MB',
      }),
    ],
  );

  const root = h(
    'div',
    {
      class: 'md-landing flex min-h-0 flex-1 flex-col items-center justify-center gap-6 py-6',
    },
    [
      h('div', { class: 'flex flex-col items-center gap-2 text-center' }, [
        h('span', { class: 'text-5xl drop-shadow-sm', textContent: '✍️' }),
        h('h2', {
          class: 'mt-1 text-2xl font-semibold tracking-tight',
          textContent: 'Markdown 手札',
        }),
        h('p', {
          class: 'text-sm text-[var(--fg-muted)]',
          textContent: '拖入文件或新建手稿，左侧落笔、右侧成章 —— 即开即写，无需安装',
        }),
      ]),
      dropzone,
      h('div', { class: 'flex flex-wrap items-center justify-center gap-3' }, [
        h('button', {
          type: 'button',
          class: BTN_ACCENT,
          textContent: '📂 打开文件',
          onclick: hooks.onOpen,
        }),
        h('button', {
          type: 'button',
          class: BTN,
          textContent: '✚ 新建空白手稿',
          onclick: hooks.onNew,
        }),
        h('button', {
          type: 'button',
          class: BTN_GHOST,
          textContent: '阅读示例手稿',
          onclick: hooks.onSample,
        }),
      ]),
      hint,
    ],
  );

  return { root, dropzone, hint };
}

/* ───────────────────────── 编辑器外壳 ───────────────────────── */

export interface EditorCallbacks {
  onOpen: () => void;
  onSave: () => void;
  onExport: () => void;
  onModeChange: (mode: ViewMode) => void;
  onClose: () => void;
  onDropFile: (file: OpenedFile) => void;
  onDropReject: (r: DropRejection) => void;
}

export interface EditorShell {
  root: HTMLElement;
  workspace: HTMLElement;
  editorHost: HTMLElement;
  previewPane: HTMLElement;
  preview: HTMLElement;
  divider: HTMLElement;
  modeBtns: Record<ViewMode, HTMLButtonElement>;
  statusbar: {
    file: HTMLElement;
    diskState: HTMLElement;
    words: HTMLElement;
    chars: HTMLElement;
    cursor: HTMLElement;
    render: HTMLElement;
    autosave: HTMLElement;
    notice: HTMLElement;
  };
}

export function buildEditorShell(cb: EditorCallbacks): EditorShell {
  const modeBtns = {} as Record<ViewMode, HTMLButtonElement>;
  const segButtons = (['split', 'editor', 'read'] as const).map((mode) => {
    const btn = h('button', {
      type: 'button',
      class: 'px-3 py-1.5 text-sm text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)]',
      textContent: MODE_LABELS[mode],
      title:
        mode === 'split'
          ? '左编辑右预览'
          : mode === 'editor'
            ? '仅编辑'
            : '沉浸阅读（Typora 风格）',
      onclick: () => cb.onModeChange(mode),
    });
    modeBtns[mode] = btn;
    return btn;
  });

  const fileStat = h('span', {
    class: 'max-w-56 truncate font-medium text-[var(--fg)]',
    textContent: '未命名.md',
  });
  const diskState = h('span', {
    class: 'shrink-0 text-[#d97706] hidden',
    textContent: '● 未保存到文件',
  });
  const words = h('span', { textContent: '0 字' });
  const chars = h('span', { textContent: '0 字符' });
  const cursor = h('span', { textContent: '行 1，列 1' });
  const render = h('span', { class: 'hidden sm:inline', textContent: '' });
  const autosave = h('span', { class: 'hidden sm:inline', textContent: '' });
  const notice = h('span', {
    class: 'font-medium text-[var(--accent)] transition-opacity duration-300 opacity-0',
    textContent: '',
  });

  const editorHost = h('div', { class: 'md-editor-host h-full' });
  const preview = h('article', { class: 'md-preview md-preview--page' });
  const previewPane = h(
    'section',
    {
      class: 'md-preview-pane',
      'aria-label': '预览区',
    },
    [preview],
  );
  const divider = h('div', {
    class: 'md-divider',
    title: '拖动调整分栏比例',
    role: 'separator',
    'aria-orientation': 'vertical',
  });
  const editorPane = h('section', { class: 'md-editor-pane', 'aria-label': '编辑区' }, [
    editorHost,
  ]);
  const workspace = h('main', { class: 'md-workspace mode-split' }, [
    editorPane,
    divider,
    previewPane,
  ]);

  const statusbar = {
    file: fileStat,
    diskState,
    words,
    chars,
    cursor,
    render,
    autosave,
    notice,
  };

  const root = h('div', { class: 'md-root flex min-h-0 flex-1 flex-col gap-3' }, [
    // —— 工具栏 ——
    h('div', { class: 'md-toolbar flex flex-wrap items-center gap-2' }, [
      h('button', {
        type: 'button',
        class: BTN,
        textContent: '📂 打开',
        title: '打开 Markdown 文件（Ctrl/Cmd+O）',
        onclick: cb.onOpen,
      }),
      h('button', {
        type: 'button',
        class: BTN,
        textContent: '💾 保存',
        title: '保存（Ctrl/Cmd+S；未打开过文件时为另存/下载）',
        onclick: cb.onSave,
      }),
      h('button', {
        type: 'button',
        class: BTN_ACCENT,
        textContent: '⬆ 导出',
        title: '选择格式导出（Ctrl/Cmd+E）',
        onclick: cb.onExport,
      }),
      h('span', { class: TOOLBAR_SEP }),
      h(
        'div',
        {
          class:
            'inline-flex overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]',
          role: 'group',
          'aria-label': '视图模式',
        },
        segButtons,
      ),
      h('span', { class: 'flex-1' }),
      h('button', {
        type: 'button',
        class: BTN_GHOST,
        textContent: '✕ 关闭手稿',
        title: '关闭当前手稿，回到欢迎页',
        onclick: cb.onClose,
      }),
    ]),
    // —— 工作区（卡片式容器）——
    h(
      'div',
      {
        class:
          'flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]',
      },
      [workspace],
    ),
    // —— 状态栏 ——
    h(
      'div',
      {
        class:
          'md-statusbar flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-[var(--fg-muted)] select-none',
      },
      [
        h('span', { class: 'flex min-w-0 items-center gap-1.5' }, [fileStat, diskState]),
        words,
        chars,
        cursor,
        render,
        h('span', { class: 'flex-1' }),
        notice,
        autosave,
      ],
    ),
  ]);

  return {
    root,
    workspace,
    editorHost,
    previewPane,
    preview,
    divider,
    modeBtns,
    statusbar,
  };
}
