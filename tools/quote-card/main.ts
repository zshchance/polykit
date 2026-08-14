/**
 * 名言卡片 —— 入口：编辑态 + 装配。
 *
 * 从拆分前的「巨型 renderQuoteCard() 闭包」瘦身为：共享编辑态 state（state.ts）、
 * 卡片画板（cardEl / rerenderCard / fitCardToContainer）与各子模块的创建装配。
 * 子模块及依赖方向：
 *   - selectors.ts        通用折叠选择器（宽高比 / 动画 / 清晰度 / 帧率共用）
 *   - template-selector.ts 模板缩略图网格（deps：state + 重绘/落库 + AI 模态入口）
 *   - ai-dialogs.ts       💡 AI 生成动画/模板两个三步模态（deps：state + 画板 + 重建回调）
 *   - editor.ts           左栏编辑表单：搜索/手动输入/随机/清空/保存（deps：state + 历史刷新）
 *   - history-panel.ts    我的名言历史面板（deps：编辑表单的 applyQuote + 输入框）
 *   - export-buttons.ts   导出图片/视频按钮（deps：画板 + state + 当前值访问器）
 * 闭包依赖一律经 createXxx(deps) 显式注入；相互的创建期循环引用
 * （如 AI 模态 ↔ 选择器重建）用惰性箭头转发，仅在用户交互时才求值。
 */
import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { confirmDialog } from '@/core/components/Dialog';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { defaultTemplate, getTemplate, setCustomTemplateProvider } from './templates';
import type { QuoteData } from './templates/types';
import { renderCard } from './card';
import { loadDraft, saveDraft } from './settings';
import { ASPECTS, getAspect, type AspectId } from './aspect';
import { getAnimation, getEffectiveAnimations, setCustomAnimProvider } from './animations';
import {
  loadCustomAnims,
  toAnimEffect,
  removeCustomAnim,
  isCustomAnimId,
} from './custom-animations';
import { loadCustomTemplates, toCardTemplate } from './custom-templates';
import {
  VIDEO_RESOLUTIONS,
  getVideoResolution,
  type VideoResId,
  VIDEO_FPS,
  getVideoFps,
  type VideoFpsId,
} from './video-export';
import type { QuoteCardState } from './state';
import { collapsibleSelect } from './selectors';
import { createTemplateSelector } from './template-selector';
import { createAiDialogs } from './ai-dialogs';
import { createQuoteEditor } from './editor';
import { createHistoryPanel } from './history-panel';
import { createExportRow } from './export-buttons';

initTheme();

/** 默认展示的名言（首次进入页面即有内容） */
const DEFAULT_QUOTE: QuoteData = {
  text: '千里之行，始于足下。',
  author: '老子',
  source: '道德经',
};

function renderQuoteCard() {
  const { content } = renderToolLayout(document.getElementById('app')!, '名言卡片');

  // —— 自定义动画效果：先注入 provider 再读草稿 ——
  // 必须在 loadDraft() 之前接好：草稿校验 animId 时用 isValidAnimId，它查
  // getEffectiveAnimations() → 依赖此 provider 能读出自定义效果。否则刷新后
  // 上次选的自定义 animId 会被判非法、回退淡入。provider 每次调用读 localStorage，
  // 增删自定义效果后实时反映。这层间接是为了打破 animations ↔ custom-animations 的 ESM 循环依赖。
  setCustomAnimProvider(() => loadCustomAnims().map(toAnimEffect));

  // —— 自定义模板：同样先注入 provider 再读草稿 ——
  // 必须在 loadDraft() 之前接好：草稿校验 templateId 时用 isValidTemplateId，
  // 它查 getEffectiveTemplates() → 依赖此 provider 能读出自定义模板。否则刷新后
  // 上次选的自定义 templateId 会被判非法、回退默认。与动画侧 provider 完全对称。
  setCustomTemplateProvider(() => loadCustomTemplates().map(toCardTemplate));

  // —— 状态 ——
  // 启动时恢复上次编辑的草稿（内容/落款/出处/模板/宽高比/动画），无草稿则用默认值
  const restored = loadDraft();
  const state: QuoteCardState = {
    quote: restored
      ? {
          text: restored.text || DEFAULT_QUOTE.text,
          author: restored.author || DEFAULT_QUOTE.author,
          source: restored.source,
        }
      : { ...DEFAULT_QUOTE },
    templateId: restored?.templateId ?? defaultTemplate.id,
    aspectId: restored?.aspectId ?? '1:1',
    animId: restored?.animId ?? 'fade',
    videoRes: restored?.videoRes ?? '1080',
    videoFps: restored?.videoFps ?? '60',
  };

  /** 当前宽高比对象 */
  const currentAspect = () => getAspect(state.aspectId);
  /** 当前动画效果 */
  const currentAnim = () => getAnimation(state.animId);
  /** 当前视频分辨率 */
  const currentVideoRes = () => getVideoResolution(state.videoRes);
  /** 当前视频帧率 */
  const currentVideoFps = () => getVideoFps(state.videoFps);

  /** 把当前编辑态落库为草稿（输入/模板/宽高/动画/分辨率/帧率变化时调用） */
  function persistDraft(): void {
    saveDraft({
      text: textInput.value,
      author: authorInput.value,
      source: sourceInput.value.trim() || undefined,
      templateId: state.templateId,
      aspectId: state.aspectId,
      animId: state.animId,
      videoRes: state.videoRes,
      videoFps: state.videoFps,
    });
  }

  // ─────────────────────────── 卡片画板（右栏预览） ───────────────────────────
  // 画板逻辑尺寸由当前宽高比决定（短边 1080），用 transform scale 缩放以适配容器宽度。
  // 导出时临时移除缩放（.exporting），保证高清原图。
  //
  // 缩放 bug 修复：模板用 cssText 设置样式会清掉 surface 的 width/height/transform，
  // 所以每次 rerenderCard 后必须重新 fit（重写 transform）。card.ts 负责 width/height。
  const cardEl = h('div', {
    class: 'quote-card-surface',
    style: `width:${currentAspect().w}px;height:${currentAspect().h}px;transform-origin:top left;box-sizing:border-box;`,
  });

  /** 当前播放中的动画（供视频导出复用；切换时取消旧的） */
  let currentAnimObj: Animation | null = null;

  /** 根据 stage 宽度（及竖版可用高度）计算缩放比例并应用到 surface */
  function fitCardToContainer(): void {
    const a = currentAspect();
    const w = cardStage.clientWidth;
    const scale = w / a.w;
    cardEl.style.transform = `scale(${scale})`;
    // stage 高度跟随缩放后的画板
    cardStage.style.height = `${a.h * scale}px`;
  }

  /** 重绘卡片内容（用当前 state），重新应用缩放，并播放入场动画 */
  function rerenderCard(): void {
    // 取消上一段动画
    currentAnimObj?.cancel();
    renderCard(cardEl, state.quote, getTemplate(state.templateId), currentAspect());
    fitCardToContainer();
    // 构建并播放入场动画（WAAPI）
    const contentEl = cardEl.querySelector('.quote-card-content') as HTMLElement | null;
    if (contentEl) {
      currentAnimObj = currentAnim().build(contentEl, state.quote);
    }
  }

  // 画板外层容器（决定显示宽度，承载缩放后的画板）
  const cardStage = h(
    'div',
    {
      class:
        'w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)]',
    },
    [cardEl],
  );

  // ─────────────────────────── 输入区（左栏，editor.ts） ───────────────────────────
  const editor = createQuoteEditor({
    state,
    rerenderCard,
    persistDraft,
    // 惰性转发：历史面板在下方创建，保存按钮点击时才调用
    renderQuoteHistory: (items) => historyPanelApi.renderQuoteHistory(items),
  });
  const { inputCol, textInput, authorInput, sourceInput } = editor;

  // ────────── 我的名言历史面板（折叠，history-panel.ts）──────────
  const historyPanelApi = createHistoryPanel({
    applyQuote: editor.applyQuote,
    textInput,
    authorInput,
    sourceInput,
  });
  // 历史开关 + 面板挂在左栏末尾（与拆分前 inputCol 子项的最后两项顺序一致）
  inputCol.append(historyPanelApi.historyToggle, historyPanelApi.historyPanel);

  // ────────── 💡 AI 生成模态（ai-dialogs.ts）──────────
  const aiDialogs = createAiDialogs({
    state,
    cardEl,
    rerenderCard,
    persistDraft,
    // 惰性转发：下方两个选择器在 aiDialogs 之后创建，保存成功时才调用
    rebuildAnimSelector: () => animSelect.rebuild(animOptions(), state.animId),
    rebuildTemplateGrid: () => templateSelectorApi.rebuildTemplateGrid(),
  });
  const { openHelpDialog } = aiDialogs;

  // ────────── 模板选择器（template-selector.ts）──────────
  const templateSelectorApi = createTemplateSelector({
    state,
    rerenderCard,
    persistDraft,
    openTemplateDialog: aiDialogs.openTemplateDialog,
  });
  const { templateSelector } = templateSelectorApi;

  // —— 宽高比选择器（折叠，selectors.ts 的 collapsibleSelect）——
  const aspectSelect = collapsibleSelect(
    '宽高比',
    ASPECTS.map((a) => ({ id: a.id, name: a.label })),
    state.aspectId,
    (a) => {
      state.aspectId = a.id as AspectId;
      rerenderCard();
      persistDraft();
    },
  );

  /** 把「内置 + 自定义」效果列表转成选择器选项（id/name） */
  const animOptions = () => getEffectiveAnimations().map((an) => ({ id: an.id, name: an.name }));

  // —— 动画效果选择器（折叠）——
  // 头部右侧挂 💡 一个按钮：点开「描述→生成提示词→粘 AI 代码→保存」三步合一的模态。
  const helpAnimBtn = h('button', {
    type: 'button',
    title: '用 AI 生成自定义动画效果：描述想要的效果 → 生成提示词 → 粘贴 AI 返回的代码 → 保存',
    'aria-label': '用 AI 生成自定义效果',
    class:
      'inline-flex shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
    textContent: '💡',
    onclick: () => openHelpDialog(),
  });

  const animSelect = collapsibleSelect(
    '动画效果',
    animOptions(),
    state.animId,
    (an) => {
      state.animId = an.id;
      rerenderCard(); // 重新播放新动画
      persistDraft();
    },
    {
      actions: [helpAnimBtn],
      canDelete: (id) => isCustomAnimId(id),
      onDelete: (id) => {
        const target = getEffectiveAnimations().find((a) => a.id === id);
        const name = target?.name ?? '此自定义效果';
        // 统一确认框替代原生 confirm（全站约定不弹原生弹窗）
        void confirmDialog(`确定删除${name}吗？此操作不可撤销。`, {
          title: '删除自定义效果',
          danger: true,
          confirmText: '删除',
        }).then((okDel) => {
          if (!okDel) return;
          removeCustomAnim(id);
          // 若删的是当前选中，回退淡入
          if (state.animId === id) {
            state.animId = 'fade';
            rerenderCard();
            persistDraft();
          }
          animSelect.rebuild(animOptions(), state.animId);
        });
      },
    },
  );

  const videoResSelect = collapsibleSelect(
    '视频清晰度',
    VIDEO_RESOLUTIONS.map((r) => ({ id: r.id, name: r.name })),
    state.videoRes,
    (r) => {
      state.videoRes = r.id as VideoResId;
      persistDraft();
    },
  );

  // —— 视频帧率选择器（折叠，仅影响视频导出；离线逐帧渲染，帧率精确不掉帧）——
  const videoFpsSelect = collapsibleSelect(
    '视频帧率',
    VIDEO_FPS.map((f) => ({ id: f.id, name: f.name })),
    state.videoFps,
    (f) => {
      state.videoFps = f.id as VideoFpsId;
      persistDraft();
    },
  );

  // ────────── 导出按钮（export-buttons.ts）──────────
  const exportApi = createExportRow({
    state,
    cardEl,
    currentAspect,
    currentAnim,
    currentVideoRes,
    currentVideoFps,
    rerenderCard,
    fitCardToContainer,
    getCurrentAnimObj: () => currentAnimObj,
  });
  const { exportRow, exportHint } = exportApi;

  // 预览列：移动端置顶（order-first），桌面端在右（order 重置为 0）。
  // 模板仍是网格（视觉重要、常用，自带标题行 + 💡 AI 生成按钮）；宽高比/动画用折叠选择器，界面更干净。
  const previewCol = h(
    'div',
    { class: 'space-y-4 min-w-0 order-first lg:order-none lg:sticky lg:top-6' },
    [
      cardStage,
      // 模板（常用，保持展开网格；templateSelector 内含标题行「模板」+ 💡 + 网格）
      templateSelector,
      // 宽高比（折叠）
      aspectSelect.el,
      // 动画效果（折叠）
      animSelect.el,
      // 视频清晰度（折叠，仅影响视频导出）
      videoResSelect.el,
      // 视频帧率（折叠，仅影响视频导出）
      videoFpsSelect.el,
      // 导出
      exportRow,
      exportHint,
    ],
  );

  // ─────────────────────────── 两栏布局 ───────────────────────────
  // 响应式：移动端单列堆叠，桌面端两栏（输入在左、预览在右）。
  // 顺序策略：移动端把预览放最上方（卡片是主展示，用户先看到成品再编辑），
  // 桌面端恢复"输入左、预览右"。用 order 实现，无需改 DOM 顺序。
  //
  // 关键：网格列必须用 minmax(0,...) 收缩到 0，否则画板 1080px 的固定宽度
  // 会把网格轨道撑到 1080px、撑破窄屏出现横向滚动条（grid 项默认 min-width:auto 不收缩）。
  const layout = h(
    'div',
    { class: 'grid gap-6 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]' },
    [inputCol, previewCol],
  );

  content.append(layout);

  // 初始渲染（rerenderCard 内部已含 fitCardToContainer，自动应用缩放）
  rerenderCard();
  // 窗口缩放时重新适配
  window.addEventListener('resize', fitCardToContainer);
}

renderQuoteCard();
