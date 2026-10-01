import { h } from '@/core/components/element';
import { createDialog, confirmDialog } from '@/core/components/Dialog';
import type { Renderer } from './renderer';
import { renderMermaidIn, setMermaidThemePref, reapplyMermaidTheme } from './renderer/mermaid';
import { createCodeMirror, type CodeMirrorHandle } from './editor/codemirror';
import { debounce, computeSyncedScrollTop, countWords, countChars } from './utils';
import {
  openMarkdownFile,
  saveMarkdownFile,
  saveMarkdownAs,
  downloadText,
  enableDragOpen,
  type OpenedFile,
  type DropRejection,
} from './io/files';
import { buildStandaloneHtml, htmlExportFilename, mdExportFilename } from './export/html';
import { saveSession, clearSession, ZERO_SCROLL, type ViewMode, type ScrollState } from './session';
import { buildLanding, buildEditorShell, type EditorShell, type LandingView } from './ui';
import { OutlinePanel, findHeadingSourceLines, type OutlineHeading } from './outline';

type ExportFormat = 'html' | 'md' | 'pdf';

interface FormatOption {
  id: ExportFormat;
  icon: string;
  title: string;
  desc: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    id: 'html',
    icon: '🌐',
    title: '独立网页（.html）',
    desc: '自带样式、图示与公式，双击即可打开，适合直接分享',
  },
  {
    id: 'md',
    icon: '📝',
    title: 'Markdown 源文件（.md）',
    desc: '下载当前手稿原文，适合继续编辑或归档',
  },
  {
    id: 'pdf',
    icon: '🖨️',
    title: 'PDF（经打印）',
    desc: '调起系统打印对话框，选择「存储为 PDF」',
  },
];

/**
 * 手札应用控制器：
 * 空态欢迎页 ↔ 编辑现场两个视图；文件打开/保存/导出（带格式确认）；
 * 防抖实时渲染、比例滚动同步、分栏拖拽、内容大纲（自动维护/跳转/scroll-spy）、
 * 会话记忆（刷新不丢稿）、站点亮暗主题联动（Mermaid/Shiki）。
 */
export class EditorApp {
  private shell: EditorShell | null = null;
  private landing: LandingView | null = null;
  private editor: CodeMirrorHandle | null = null;
  private outlinePanel: OutlinePanel | null = null;

  private fileName = '未命名.md';
  private fileHandle: FileSystemFileHandle | null = null;
  /** 与磁盘文件相比是否有未保存修改（浏览器自动保存不算落盘） */
  private diskDirty = false;
  private mode: ViewMode = 'split';
  private scrollLock = false;
  private lastRenderMs = 0;
  private lastPersistOk = true;
  private lastSavedAt = 0;

  /** 大纲面板是否展开（会话记忆） */
  private outlineVisible = false;
  /** 最近一次渲染收集的标题（供 scroll-spy 与点击定位） */
  private lastHeadings: OutlineHeading[] = [];
  private spyPending = false;

  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly scheduleRender = debounce((doc: string) => void this.renderPreview(doc), 200);
  private readonly scheduleSessionSave = debounce(() => this.persistSession(), 800);

  constructor(
    private readonly content: HTMLElement,
    private readonly renderer: Renderer,
    private readonly welcomeDoc: string,
  ) {
    // 站点可能以暗色启动：先记下主题偏好，首次渲染 Mermaid 时生效
    setMermaidThemePref(this.siteIsDark() ? 'dark' : 'default');
    this.observeSiteTheme();
    this.bindGlobalDragGuard();
    this.bindShortcuts();
    this.bindUnloadFlush();
  }

  /* ───────────────────────── 视图切换 ───────────────────────── */

  /** 空态欢迎页：未打开任何手稿时的简化页面 */
  showLanding(): void {
    if (!this.landing) {
      this.landing = buildLanding({
        onOpen: () => void this.openFile(),
        onNew: () => void this.newDoc(),
        onSample: () => this.enterEditor(this.welcomeDoc, '欢迎手稿.md'),
        onDropFile: (file) => this.loadFile(file),
        onDropReject: (r) => this.flashLandingHint(this.landing!, r),
      });
      enableDragOpen(
        this.landing.dropzone,
        (file) => this.loadFile(file),
        (r) => this.flashLandingHint(this.landing!, r),
      );
    }
    this.content.replaceChildren(this.landing.root);
    document.title = 'Markdown 手札 · 即开宝匣';
  }

  /** 进入（或返回）编辑现场 */
  enterEditor(
    doc: string,
    name: string,
    opts: { mode?: ViewMode; outline?: boolean; scroll?: ScrollState } = {},
  ): void {
    this.ensureShell();
    this.fileName = name;
    this.fileHandle = null;
    this.diskDirty = doc.trim().length > 0;
    this.editor!.setDoc(doc);
    // 渲染完成（含 Mermaid 图示高度落定）后再还原滚动位置，避免图示撑高导致漂移
    void this.renderPreview(doc).then(() => this.restoreScroll(opts.scroll ?? ZERO_SCROLL));
    this.content.replaceChildren(this.shell!.root);
    this.editor!.measure();
    this.setMode(opts.mode ?? 'split');
    this.setOutlineVisible(opts.outline ?? false);
    this.syncChromeHeights();
    this.persistSession();
    this.updateStatus();
    this.updateFileStatus();
    this.editor!.focus();
  }

  private ensureShell(): void {
    if (this.shell) return;
    this.shell = buildEditorShell({
      onOpen: () => void this.openFile(),
      onSave: () => void this.save(),
      onExport: () => this.openExportDialog(),
      onModeChange: (mode) => this.setMode(mode),
      onToggleOutline: () => this.setOutlineVisible(!this.outlineVisible),
      onClose: () => void this.closeDoc(),
      onDropFile: (file) => this.loadFile(file),
      onDropReject: (r) => this.flashNotice(rejectText(r)),
    });
    this.outlinePanel = new OutlinePanel(this.shell.outline, {
      onActivate: (heading) => this.revealHeading(heading),
    });
    this.editor = createCodeMirror(this.shell.editorHost, '');
    this.editor.onDocChanged((doc) => {
      this.diskDirty = true;
      this.scheduleRender(doc);
      this.scheduleSessionSave();
      this.updateFileStatus();
      this.updateCounts(doc);
    });
    this.editor.onCursor((pos) => {
      this.shell!.statusbar.cursor.textContent = `行 ${pos.line}，列 ${pos.col}`;
    });
    enableDragOpen(this.shell.workspace, (file) => this.loadFile(file));
    this.bindScrollSync();
    this.bindDivider();
    this.bindChromeSync();
    this.bindScrollPriority();
  }

  /**
   * 滚动优先级：页面级「空间释放」优先于内容滚动。
   *
   * 浏览器默认的滚动链是「内层优先」：滚轮在内容区上时先滚 pane，pane 到边界才链到
   * 页面——于是页眉会一直占着屏直到正文全部滚完，页脚同理要等正文回滚到顶才让位。
   * 这里在捕获阶段拦截滚轮，把两个「过渡带」的优先级翻过来：
   * - 向下滚 && 页眉仍占视口（工具栏尚未吸顶）：先滚页面送走页眉；
   * - 向上滚 && 页脚已进视口：先滚页面送走页脚；
   * - 其余情况不干预，走默认链（pane 滚动，触边后自然链到页面）。
   */
  private bindScrollPriority(): void {
    const shell = this.shell!;
    const card = shell.workspace.closest<HTMLElement>('.md-workspace-card');
    if (!card) return;
    const toolbar = shell.root.querySelector<HTMLElement>('.md-toolbar');
    const statusbar = shell.root.querySelector<HTMLElement>('.md-statusbar');
    const footer = document.querySelector<HTMLElement>('#app > footer');
    if (!toolbar || !statusbar) return;

    const onWheel = (e: WheelEvent): void => {
      if (e.deltaY === 0 || e.defaultPrevented) return;
      // 页面本身不可滚（矮内容）时不要拦截，否则 pane 永远滚不动
      if (document.documentElement.scrollHeight <= window.innerHeight + 1) return;
      const factor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      const delta = e.deltaY * factor;
      const down = delta > 0;
      // 工具栏还在文档流位置（未吸顶）= 页眉区仍占据视口
      const headerZone = toolbar.getBoundingClientRect().top > 9;
      const footerVisible = footer
        ? footer.getBoundingClientRect().top < window.innerHeight - 1
        : false;

      if (down && headerZone) {
        // 钳制在沉浸位（工具栏吸顶、页眉恰好离场），大滚轮格也不冲进页脚区
        e.preventDefault();
        const cardTopDoc = card.getBoundingClientRect().top + window.scrollY;
        const immersiveTop = cardTopDoc - 12 - toolbar.offsetHeight - 8;
        const max = Math.max(0, immersiveTop - window.scrollY);
        window.scrollBy({ top: Math.min(delta, max) });
      } else if (!down && footerVisible) {
        // 钳制在沉浸位：状态栏恰好重新钉底（其文档流槽底回到视口底 8px 线上，
        // 页脚随之隐藏）——比「页脚刚离场」更深一档，避免落点半钉不钉
        e.preventDefault();
        const cardDocBottom = card.getBoundingClientRect().bottom + window.scrollY;
        const slotBottomDoc = cardDocBottom + 12 + statusbar.offsetHeight;
        const immersiveBottom = slotBottomDoc - (window.innerHeight - 8);
        const min = Math.min(0, immersiveBottom - window.scrollY);
        window.scrollBy({ top: Math.max(delta, min) });
      }
    };
    // 挂在两个滚动 pane 上（捕获阶段抢在原生滚动之前）
    shell.previewPane.addEventListener('wheel', onWheel, { passive: false, capture: true });
    this.editor!.scrollElement().addEventListener('wheel', onWheel, {
      passive: false,
      capture: true,
    });
    // 页面级滚动（页眉/页脚过渡带位置）同样纳入会话记忆
    window.addEventListener('scroll', () => this.scheduleSessionSave(), { passive: true });
  }

  /**
   * 常驻工具条（吸顶工具栏 + 吸底状态栏）的实际高度写入 CSS 变量：
   * 工作区卡片据此取「一屏高减工具条」、大纲吸顶位据此避开工具栏。
   * 工具栏窄屏会换行变高，故用 ResizeObserver 跟踪而非写死。
   */
  private bindChromeSync(): void {
    const shell = this.shell!;
    const apply = (): void => this.syncChromeHeights();
    new ResizeObserver(apply).observe(shell.root.querySelector('.md-toolbar')!);
    new ResizeObserver(apply).observe(shell.statusbar.cursor.parentElement!);
    window.addEventListener('resize', apply);
  }

  private syncChromeHeights(): void {
    const shell = this.shell;
    if (!shell || !shell.root.isConnected) return;
    const toolbar = shell.root.querySelector<HTMLElement>('.md-toolbar');
    const statusbar = shell.root.querySelector<HTMLElement>('.md-statusbar');
    if (!toolbar || !statusbar) return;
    const toolbarH = toolbar.offsetHeight;
    const statusH = statusbar.offsetHeight;
    const gap = 12; // .md-root 的 gap-3
    // 变量挂在 #app 上：工具链（.md-root）与页脚（margin-bottom 让位）都要读到
    const appRoot = this.content.parentElement ?? shell.root;
    // 大纲吸顶位：视口留白 + 工具栏 + 间距；
    // 卡片高：沉浸位直达视口底（工具栏顶留白 + 工具栏 + 间距以下全是卡片），
    // 状态栏以毛玻璃浮层悬浮在卡片底部之上，正文底部由 pane 内边距让位
    appRoot.style.setProperty('--mdt-sticky-top', `${toolbarH + gap + 8}px`);
    appRoot.style.setProperty('--mdt-status-h', `${statusH}px`);
    appRoot.style.setProperty(
      '--mdt-card-h',
      `${Math.max(window.innerHeight - toolbarH - 8 - gap, 420)}px`,
    );
  }

  /* ───────────────────────── 文件操作 ───────────────────────── */

  private loadFile(file: OpenedFile): void {
    this.ensureShell();
    this.fileName = file.name;
    this.fileHandle = file.handle;
    this.diskDirty = false;
    this.editor!.setDoc(file.text);
    void this.renderPreview(file.text);
    if (this.landing || !this.shell!.root.isConnected) {
      this.content.replaceChildren(this.shell!.root);
      this.editor!.measure();
      this.syncChromeHeights();
    }
    if (this.mode === 'editor') this.setMode('split');
    this.persistSession();
    this.updateStatus();
    this.updateFileStatus();
    this.flashNotice(`已打开 ${file.name}`);
    this.editor!.focus();
  }

  private async openFile(): Promise<void> {
    const file = await openMarkdownFile();
    if (file) this.loadFile(file);
  }

  private async save(): Promise<void> {
    const result = await saveMarkdownFile(this.fileHandle, this.editor!.getDoc(), this.fileName);
    if (!result) return; // 用户取消
    if (result.handle) this.fileHandle = result.handle;
    this.fileName = result.name;
    this.diskDirty = false;
    this.updateFileStatus();
    this.persistSession();
    this.flashNotice(
      result.via === 'download' ? `已下载 ${result.name}（下载即保存）` : `已保存到 ${result.name}`,
    );
  }

  private async saveAs(): Promise<void> {
    const result = await saveMarkdownAs(this.editor!.getDoc(), this.fileName);
    if (!result) return; // 用户取消
    if (result.handle) this.fileHandle = result.handle;
    this.fileName = result.name;
    this.diskDirty = false;
    this.updateFileStatus();
    this.persistSession();
    this.flashNotice(
      result.via === 'download' ? `已下载 ${result.name}（下载即保存）` : `已另存到 ${result.name}`,
    );
  }

  /** 新建：有未落盘内容时先确认（浏览器副本会被新手稿覆盖） */
  private async newDoc(): Promise<void> {
    if (this.editor && this.editor.getDoc().trim() && this.diskDirty) {
      const ok = await confirmDialog(
        '当前手稿尚未保存到文件，新建后浏览器中的自动保存副本也会被覆盖，将无法找回。仍要新建吗？',
        { title: '新建空白手稿', confirmText: '新建', danger: true },
      );
      if (!ok) return;
    }
    this.enterEditor('', '未命名.md');
  }

  /** 关闭手稿：未落盘时确认；随后清掉会话回到欢迎页 */
  private async closeDoc(): Promise<void> {
    if (this.editor && this.editor.getDoc().trim() && this.diskDirty) {
      const ok = await confirmDialog(
        '这份手稿尚未保存到文件，关闭后浏览器的自动保存副本将一并清除，将无法找回。确定关闭吗？',
        { title: '关闭手稿', confirmText: '关闭', danger: true },
      );
      if (!ok) return;
    }
    clearSession();
    this.showLanding();
  }

  /* ───────────────────────── 导出（先确认格式） ───────────────────────── */

  private openExportDialog(): void {
    let selected: ExportFormat = 'html';
    const dlg = createDialog({ panelClass: 'max-w-md', label: '导出手札' });

    const cardList = h('div', { class: 'flex flex-col gap-2' });
    const cards = new Map<ExportFormat, HTMLElement>();

    const paint = (): void => {
      for (const opt of FORMAT_OPTIONS) {
        const el = cards.get(opt.id)!;
        // 选中态只切类（描边/悬停色由 styles.css 的 .md-export-card 规则给出：
        // 站点全局 * { border-color } 会压过 Tailwind 分层工具类，不能依赖类名改边框色）
        el.classList.toggle('is-selected', opt.id === selected);
      }
    };

    for (const opt of FORMAT_OPTIONS) {
      const card = h(
        'div',
        {
          class:
            'md-export-card flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition-colors',
          role: 'radio',
          'aria-checked': String(opt.id === selected),
        },
        [
          h('span', { class: 'mt-0.5 text-xl leading-none', textContent: opt.icon }),
          h('div', { class: 'min-w-0' }, [
            h('p', { class: 'text-sm font-medium text-[var(--fg)]', textContent: opt.title }),
            h('p', {
              class: 'mt-0.5 text-xs leading-relaxed text-[var(--fg-muted)]',
              textContent: opt.desc,
            }),
          ]),
        ],
      );
      card.addEventListener('click', () => {
        selected = opt.id;
        for (const [id, el] of cards) el.setAttribute('aria-checked', String(id === selected));
        paint();
      });
      cards.set(opt.id, card);
      cardList.append(card);
    }
    paint();

    const confirmBtn = h('button', {
      type: 'button',
      class:
        'rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90',
      textContent: '导出',
      onclick: () => {
        dlg.close();
        void this.exportAs(selected);
      },
    });

    dlg.body.append(
      h('h3', { class: 'text-base font-semibold text-[var(--fg)]', textContent: '选择导出格式' }),
      h('p', {
        class: 'mt-1 text-sm text-[var(--fg-muted)]',
        textContent: `将导出「${this.fileName}」`,
      }),
      h('div', { class: 'mt-4', role: 'radiogroup', 'aria-label': '导出格式' }, [cardList]),
      h('div', { class: 'mt-5 flex justify-end gap-2' }, [
        h('button', {
          type: 'button',
          class:
            'rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
          textContent: '取消',
          onclick: () => dlg.close(),
        }),
        confirmBtn,
      ]),
    );
    dlg.open();
  }

  private async exportAs(fmt: ExportFormat): Promise<void> {
    const shell = this.shell!;
    if (fmt === 'md') {
      downloadText(mdExportFilename(this.fileName), this.editor!.getDoc(), 'text/markdown');
      this.flashNotice(`已导出 ${mdExportFilename(this.fileName)}`);
      return;
    }
    if (fmt === 'pdf') {
      if (this.mode === 'editor') this.setMode('read'); // 打印阅读版式
      window.print();
      return;
    }
    // 独立 HTML：以亮色版式导出（暗色站点下临时把图示重渲为亮色，导出后还原）
    const html = await this.withLightMermaid(() =>
      buildStandaloneHtml(shell.preview.innerHTML, this.fileName),
    );
    downloadText(htmlExportFilename(this.fileName), html);
    this.flashNotice(`已导出 ${htmlExportFilename(this.fileName)}`);
  }

  /** 在亮色 Mermaid 环境下执行 fn（站点为暗色且页面有图时切换，完毕后还原） */
  private async withLightMermaid<T>(fn: () => Promise<T>): Promise<T> {
    const dark = this.siteIsDark();
    const hasDiagrams = this.shell!.preview.querySelector('.md-mermaid') !== null;
    if (!dark || !hasDiagrams) return fn();

    setMermaidThemePref('default');
    await reapplyMermaidTheme();
    await renderMermaidIn(this.shell!.preview, { force: true });
    try {
      return await fn();
    } finally {
      setMermaidThemePref('dark');
      await reapplyMermaidTheme();
      await renderMermaidIn(this.shell!.preview, { force: true });
    }
  }

  /* ───────────────────────── 视图模式 ───────────────────────── */

  private setMode(mode: ViewMode): void {
    this.mode = mode;
    this.shell!.workspace.className = `md-workspace mode-${mode}`;
    for (const [m, btn] of Object.entries(this.shell!.modeBtns) as [
      ViewMode,
      HTMLButtonElement,
    ][]) {
      const active = m === mode;
      btn.className = active
        ? 'bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white transition-colors'
        : 'px-3 py-1.5 text-sm text-[var(--fg-muted)] transition-colors hover:text-[var(--fg)]';
      btn.setAttribute('aria-pressed', String(active));
    }
    this.persistSession();
  }

  /* ───────────────────────── 渲染管线 ───────────────────────── */

  private async renderPreview(doc: string): Promise<void> {
    if (!this.shell) return;
    const started = performance.now();
    this.shell.preview.innerHTML = this.renderer.render(doc);
    await renderMermaidIn(this.shell.preview);
    this.lastRenderMs = performance.now() - started;
    this.shell.statusbar.render.textContent =
      this.lastRenderMs > 0 ? `渲染 ${this.lastRenderMs.toFixed(0)}ms` : '';
    this.refreshOutline();
  }

  /* ───────────────────────── 内容大纲 ───────────────────────── */

  /** 展开 / 收起大纲面板（浮动手柄 + 工具栏按钮同步状态，随会话记忆） */
  private setOutlineVisible(visible: boolean): void {
    if (!this.shell) return;
    this.outlineVisible = visible;
    this.shell.outline.classList.toggle('is-open', visible);
    this.shell.outline.parentElement?.setAttribute('data-open', String(visible));
    const floatBtn = this.shell.outlineFloatBtn;
    floatBtn.textContent = visible ? '‹' : '›';
    floatBtn.setAttribute('aria-expanded', String(visible));
    floatBtn.setAttribute('aria-label', visible ? '收起大纲' : '展开大纲');
    floatBtn.title = visible ? '收起大纲' : '展开大纲';
    this.shell.outlineBtn.setAttribute('aria-pressed', String(visible));
    this.shell.outlineBtn.classList.toggle('outline-active', visible);
    if (visible) {
      this.refreshOutline();
    }
    this.persistSession();
  }

  /** 从预览区重建大纲（每次渲染后调用；面板收起时仅更新数据） */
  private refreshOutline(): void {
    if (!this.shell) return;
    const preview = this.shell.preview;
    // 跳过空标题（无锚点 id，无法定位）
    this.lastHeadings = Array.from(
      preview.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'),
    ).flatMap((el) => {
      const text = el.textContent?.trim() ?? '';
      if (!text || !el.id) return [];
      return [{ level: Number(el.tagName[1]), text, id: el.id, el }];
    });
    this.outlinePanel?.update(this.lastHeadings);
    if (this.outlineVisible) this.updateActiveHeading();
  }

  /** 滚动 spy：rAF 合帧，找视口顶之上最后一个标题 */
  private queueSpy(): void {
    if (this.spyPending || !this.outlineVisible) return;
    this.spyPending = true;
    requestAnimationFrame(() => {
      this.spyPending = false;
      this.updateActiveHeading();
    });
  }

  private updateActiveHeading(): void {
    if (!this.shell || !this.outlineVisible) return;
    const paneTop = this.shell.previewPane.getBoundingClientRect().top;
    let active: OutlineHeading | null = null;
    for (const heading of this.lastHeadings) {
      if (heading.el.getBoundingClientRect().top - paneTop <= 96) active = heading;
      else break;
    }
    this.outlinePanel?.setActive(active ? active.id : null);
  }

  /** 点击大纲项：滚动到对应章节（编辑视图跳源码行，其余滚动预览） */
  private revealHeading(heading: OutlineHeading): void {
    if (this.mode === 'editor') {
      // 预览区隐藏时按「第 N 个标题 ↔ 源码第 N 个 ATX 标题行」对位（setext 标题会错位，此时不跳）
      const srcLines = findHeadingSourceLines(this.editor!.getDoc());
      const index = this.lastHeadings.indexOf(heading);
      const line = index >= 0 ? srcLines[index] : undefined;
      if (line !== undefined) this.editor!.revealLine(line + 1);
      return;
    }
    const pane = this.shell!.previewPane;
    const offset = heading.el.getBoundingClientRect().top - pane.getBoundingClientRect().top;
    pane.scrollTo({ top: pane.scrollTop + offset - 12, behavior: 'smooth' });
  }

  /* ───────────────────────── 滚动同步 / 分栏拖拽 ───────────────────────── */

  private bindScrollSync(): void {
    const shell = this.shell!;
    const editorScroll = this.editor!.scrollElement();
    editorScroll.addEventListener('scroll', () => {
      this.scheduleSessionSave(); // 滚动也是要记忆的「浏览位置」
      if (this.mode !== 'split' || this.scrollLock) return;
      const srcMax = editorScroll.scrollHeight - editorScroll.clientHeight;
      const dstMax = shell.previewPane.scrollHeight - shell.previewPane.clientHeight;
      shell.previewPane.scrollTop = computeSyncedScrollTop(editorScroll.scrollTop, srcMax, dstMax);
    });
    shell.previewPane.addEventListener('scroll', () => {
      this.queueSpy(); // 大纲高亮跟随（任何视图下预览滚动都要跟踪）
      this.scheduleSessionSave(); // 同上
      if (this.mode !== 'split' || this.scrollLock) return;
      const dst = editorScroll;
      const srcMax = shell.previewPane.scrollHeight - shell.previewPane.clientHeight;
      const dstMax = dst.scrollHeight - dst.clientHeight;
      const target = computeSyncedScrollTop(shell.previewPane.scrollTop, srcMax, dstMax);
      this.scrollLock = true;
      dst.scrollTop = target;
      requestAnimationFrame(() => (this.scrollLock = false));
    });
  }

  private bindDivider(): void {
    const shell = this.shell!;
    const divider = shell.divider;
    let dragging = false;
    divider.addEventListener('pointerdown', (e) => {
      dragging = true;
      divider.classList.add('active');
      divider.setPointerCapture(e.pointerId);
    });
    divider.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = shell.workspace.getBoundingClientRect();
      const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0.15), 0.85);
      const editorPane = shell.workspace.querySelector<HTMLElement>('.md-editor-pane');
      if (editorPane) editorPane.style.flexBasis = `${ratio * 100}%`;
      shell.previewPane.style.flexBasis = `${(1 - ratio) * 100}%`;
    });
    const stop = () => {
      dragging = false;
      divider.classList.remove('active');
    };
    divider.addEventListener('pointerup', stop);
    divider.addEventListener('pointercancel', stop);
  }

  /* ───────────────────────── 会话记忆 ───────────────────────── */

  private persistSession(): void {
    if (!this.shell || !this.shell.root.isConnected) return;
    // 三条滚动带的实时位置一并入会话（浏览位置记忆）
    const scroll: ScrollState = {
      page: Math.max(0, Math.round(window.scrollY)),
      preview: Math.max(0, Math.round(this.shell.previewPane.scrollTop)),
      editor: Math.max(0, Math.round(this.editor!.scrollElement().scrollTop)),
    };
    this.lastPersistOk = saveSession(
      this.editor!.getDoc(),
      this.fileName,
      this.mode,
      this.outlineVisible,
      scroll,
    );
    if (this.lastPersistOk) {
      this.lastSavedAt = Date.now();
      this.shell.statusbar.autosave.textContent = `自动保存 · ${formatClock(this.lastSavedAt)}`;
    } else {
      this.shell.statusbar.autosave.textContent = '自动保存失败（存储不可用）';
    }
  }

  /** 卸载前立即落一次会话（防抖可能还没触发） */
  private bindUnloadFlush(): void {
    window.addEventListener('pagehide', () => {
      this.scheduleSessionSave.cancel();
      this.persistSession();
    });
    window.addEventListener('beforeunload', (e) => {
      // 仅当「自动保存失败 + 有未落盘内容」才拦：正常刷新都有会话兜底
      if (!this.lastPersistOk && this.diskDirty && this.editor?.getDoc().trim()) {
        e.preventDefault();
      }
    });
  }

  /** 还原上次浏览位置：按当前视图挑滚动分量，页面级（过渡带）最后还原 */
  private restoreScroll(scroll: ScrollState): void {
    if (!this.shell || !this.shell.root.isConnected) return;
    if (this.mode === 'editor') {
      this.editor!.scrollElement().scrollTop = scroll.editor;
    } else {
      // 分栏/阅读：恢复预览位置，滚动同步链会把编辑器带过去
      this.shell.previewPane.scrollTop = scroll.preview;
    }
    if (scroll.page > 0) window.scrollTo(0, scroll.page);
  }

  /* ───────────────────────── 状态栏 / 提示 ───────────────────────── */

  private updateFileStatus(): void {
    if (!this.shell) return;
    document.title = `${this.diskDirty ? '*' : ''}${this.fileName} · Markdown 手札`;
    this.shell.statusbar.file.textContent = this.fileName;
    this.shell.statusbar.diskState.classList.toggle('hidden', !this.diskDirty);
  }

  private updateCounts(doc: string): void {
    if (!this.shell) return;
    this.shell.statusbar.words.textContent = `${countWords(doc)} 字`;
    this.shell.statusbar.chars.textContent = `${countChars(doc)} 字符`;
  }

  private updateStatus(): void {
    if (!this.shell) return;
    this.updateCounts(this.editor!.getDoc());
    this.shell.statusbar.cursor.textContent = '行 1，列 1';
  }

  /** 状态栏轻提示：出现 2.6s 后淡出 */
  private flashNotice(text: string): void {
    if (!this.shell) return;
    const el = this.shell.statusbar.notice;
    el.textContent = text;
    el.classList.remove('opacity-0');
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => el.classList.add('opacity-0'), 2600);
  }

  /** 欢迎页落件反馈：临时改写提示行，2.6s 后复原 */
  private flashLandingHint(landing: LandingView, r: DropRejection): void {
    landing.hint.textContent = rejectText(r);
    landing.hint.classList.add('text-[var(--holiday-work)]');
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      landing.hint.textContent = '内容自动保存在本浏览器，刷新不丢失 · 数据不出本地';
      landing.hint.classList.remove('text-[var(--holiday-work)]');
    }, 2600);
  }

  /* ───────────────────────── 站点主题联动 / 快捷键 / 全局拖拽 ───────────────────────── */

  private siteIsDark(): boolean {
    return document.documentElement.classList.contains('dark');
  }

  /** 站点主题切换（右上角按钮改 <html> 的 class）→ Mermaid 重渲染；Shiki 走 CSS 变量 */
  private observeSiteTheme(): void {
    new MutationObserver(() => {
      setMermaidThemePref(this.siteIsDark() ? 'dark' : 'default');
      void (async () => {
        await reapplyMermaidTheme();
        if (this.shell?.preview.querySelector('.md-mermaid')) {
          await renderMermaidIn(this.shell.preview, { force: true });
        }
      })();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  private bindShortcuts(): void {
    window.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'o') {
        e.preventDefault();
        void this.openFile();
      } else if (key === 's') {
        e.preventDefault();
        void (e.shiftKey ? this.saveAs() : this.save());
      } else if (key === 'e') {
        e.preventDefault();
        if (this.shell?.root.isConnected) this.openExportDialog();
      }
    });
  }

  /** 拖到页面任意空白处也不让浏览器直接打开文件（交给落件区/工作区处理） */
  private bindGlobalDragGuard(): void {
    const hasFiles = (e: DragEvent): boolean =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files');
    document.addEventListener('dragover', (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    document.addEventListener('drop', (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
  }
}

function rejectText(r: DropRejection): string {
  if (r.reason === 'too-large') return '文件超过 10MB，暂不支持打开';
  if (r.reason === 'not-markdown') return '只支持打开 .md / .markdown / .txt 文件';
  return '没有读取到文件';
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
