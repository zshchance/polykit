/**
 * 终端字符画 —— 主入口。
 *
 * 两玩法（MVP）：
 *   - 图片模式：上传图片 → imageToCells → Cell 网格 → 终端外框渲染
 *   - 文字流：多行文字 → 直接 <pre> 排版 → 终端外框（不走 Cell 管线）
 *
 * 预览字号：
 *   - 图片模式：font-size = stage.clientWidth / cfg.width（严格每行 W 字符）
 *   - 文字流：固定 16px + white-space:pre-wrap（自动换行，无 W 参数）
 *
 * colorMode ↔ halfBlock 联动：关彩色 → halfBlock 自动关（开关禁用 + 钳制）。
 *
 * 模块拆分：本文件只保留「状态 + 渲染管线 + 装配」——
 *   - controls-context.ts  共享上下文（原闭包可变状态的显式载体）
 *   - controls.ts          控制面板（buildControls）
 *   - actions.ts           操作按钮区（buildActions + flash + copyRichHtml）
 *   - find-word-panel.ts   找字游戏面板（buildControls 的子构件）
 *   - ai-style-dialog.ts   AI 自定义风格模态（buildControls 的子构件）
 *   - preview-zoom.ts      预览缩放/拖拽 + 预览工具栏
 *   - widgets.ts           通用控件工厂（slider/rangeSlider/checkbox/select）
 */

import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';

import type { Rendered } from './types';
import { setCustomStyleProvider } from './presets';
import { loadCfg, saveCfg, type PersistedState } from './settings';
import { imageToCells } from './render/image-to-cells';
import { textToLogoCells } from './render/text-to-logo-cells';
import { buildTerminalFrame } from './render/terminal-frame';
import { loadCustomStyles, toStylePreset } from './custom-styles';
import { applyFindWord } from './find-word';
import { getFullToHalfRatio } from './render/canvas-export';
import { buildControls } from './controls';
import { buildActions } from './actions';
import { createPreviewZoom } from './preview-zoom';
import type { ControlsContext } from './controls-context';

// —— 字体声明（工具作用域，不污染全站）——
// family 名 "JetBrains Mono" 与源同名；未来换 subset.woff2 零改动。
const FONT_FACE_STYLE = `
@font-face {
  font-family: "JetBrains Mono";
  src: url("./assets/fonts/JetBrainsMono-Regular.ttf") format("truetype");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
`;

initTheme();

function render() {
  // 注入字体声明（工具作用域 style）
  const fontStyle = document.createElement('style');
  fontStyle.textContent = FONT_FACE_STYLE;
  document.head.append(fontStyle);

  const { content } = renderToolLayout(document.getElementById('app')!, '终端字符画');

  // —— state ——
  // provider 注入必须在 loadCfg 前：自定义风格通过 provider 注入 getEffectivePresets
  setCustomStyleProvider(() => loadCustomStyles().map(toStylePreset));
  const restored = loadCfg();
  const state: PersistedState = {
    cfg: restored.cfg,
    mode: restored.mode,
    text: restored.text,
    textLogo: restored.textLogo,
    logoSize: restored.logoSize,
    textLogoSelfChar: restored.textLogoSelfChar,
    findWord: restored.findWord,
  };
  // 首次访问（无保存配置）时，图片模式默认关闭辉光（默认复古预设带辉光，用户反馈过亮）
  // 有保存配置则尊重用户之前的选择，不覆盖
  const isFirstVisit = !localStorage.getItem('ascii-art:cfg');
  if (isFirstVisit && state.mode === 'image') {
    state.cfg.crtGlow = false;
  }
  let renderToken = 0; // 防抖/竞态

  // —— 共享上下文：收拢原 render() 闭包里的可变状态与前向引用，
  // 供 controls.ts / actions.ts / find-word-panel.ts 显式访问 ——
  const ctx: ControlsContext = {
    state,
    loadedImage: null,
    currentCells: [], // 图片/logo 模式最新渲染结果（供复制用）
    currentGridWidth: 0, // logo 模式最新网格宽度（供字号自适应 + 导出 W 用）。0=非网格模式。
    persist,
    rerenderPreview,
    updatePlainTextHint,
  };

  function persist(): void {
    saveCfg(state);
  }

  // —— 预览区构建 ——
  // stage 是预览容器，frameWrap 包住终端外框（每次重渲染替换 frameWrap 子节点）
  const pre = h('pre', {
    style: [
      'margin:0;',
      'white-space:pre;',
      'overflow:hidden;',
      'font-family:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;',
      'line-height:1;',
    ].join(''),
  });

  const frameWrap = h('div', { class: 'flex justify-center' });

  const stage = h(
    'div',
    {
      class:
        'w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-6',
      style: 'min-height:300px;display:flex;align-items:center;justify-content:center;',
    },
    [frameWrap],
  );

  // —— 预览缩放 + 拖动 + 预览工具栏（preview-zoom.ts，transform 仅视觉层不影响导出）——
  const previewZoom = createPreviewZoom(frameWrap);

  /**
   * 字号自适应：
   *   - 图片模式：font-size = stageWidth / cfg.width（严格每行 W 字符）
   *   - 文字流 + Logo 模式：font-size = stageWidth / currentGridWidth（严格每行网格宽字符）
   *   - 文字流纯文本：固定 16px + pre-wrap 自动换行
   */
  function fitFontSize(): void {
    const stageWidth = stage.clientWidth - 48; // 去掉 stage padding（左右各 24）
    // 网格模式（图片 / logo）：按列数算字号，严格不换行
    if (state.mode === 'image') {
      pre.style.whiteSpace = 'pre';
      pre.style.wordBreak = 'normal';
      const W = Math.max(8, state.cfg.width);
      pre.style.fontSize = `${Math.max(2, Math.floor(stageWidth / W))}px`;
      return;
    }
    // 文字流
    if (state.textLogo && ctx.currentGridWidth > 0) {
      pre.style.whiteSpace = 'pre';
      pre.style.wordBreak = 'normal';
      const W = Math.max(8, ctx.currentGridWidth);
      pre.style.fontSize = `${Math.max(2, Math.floor(stageWidth / W))}px`;
      return;
    }
    // 纯文本
    pre.style.fontSize = '16px';
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.wordBreak = 'break-all';
  }

  // —— 重渲染预览 ——
  function rerenderPreview(): void {
    if (state.mode === 'image') {
      ctx.currentGridWidth = 0;
      fitFontSize();
      rerenderImage();
    } else {
      rerenderText();
    }
  }

  function rerenderImage(): void {
    if (!ctx.loadedImage) {
      ctx.currentCells = [];
      ctx.currentGridWidth = 0;
      // 占位提示用固定大字号（不走字符画的 stageWidth/width 自适应公式，
      // 否则默认 width=100 时字号仅 ~4px，提示文字看不清）
      pre.style.fontSize = '18px';
      pre.style.whiteSpace = 'pre-wrap';
      pre.style.wordBreak = 'normal';
      pre.style.color = state.cfg.fg;
      pre.style.opacity = '0.5';
      pre.style.padding = '24px';
      pre.style.textAlign = 'center';
      pre.textContent = '等待上传图片';
      replaceFrame();
      // 有图后会在下方恢复字符画的字号/对齐样式
      return;
    }
    // 有图：恢复字符画渲染所需的严格排版样式
    pre.style.padding = '';
    pre.style.textAlign = '';
    pre.style.opacity = '1';
    pre.style.opacity = '1';

    const token = ++renderToken;
    try {
      let cells = imageToCells(ctx.loadedImage.bitmap, {
        width: state.cfg.width,
        halfBlock: state.cfg.halfBlock,
        charset: state.cfg.charset,
        aspectRatio: state.cfg.aspectRatio,
        contrast: state.cfg.contrast,
        brightness: state.cfg.brightness,
        invert: state.cfg.invert,
        colorMode: state.cfg.colorMode,
        fg: state.cfg.fg,
        bg: state.cfg.bg,
      });
      if (token !== renderToken) return; // 被新的渲染抢占
      cells = maybeApplyFindWord(cells);
      ctx.currentCells = cells;
      ctx.currentGridWidth = gridMaxWidth(cells);
      fitFontSize();
      renderCellsToPre(cells);
      replaceFrame();
    } catch (e) {
      pre.textContent = '渲染失败：' + (e instanceof Error ? e.message : String(e));
      replaceFrame();
    }
  }

  function rerenderText(): void {
    if (state.textLogo) {
      // Logo 字符模式：文字 → 点阵大字 → Cell 网格
      ctx.currentCells = [];
      ctx.currentGridWidth = 0;
      if (!state.text.trim()) {
        pre.textContent = '输入要放大的字符（如 即开宝匣）…';
        pre.style.opacity = '0.4';
        fitFontSize();
        replaceFrame();
        return;
      }
      try {
        let cells = textToLogoCells({
          text: state.text,
          glyphHeight: state.logoSize,
          fillChar: '█',
          charGap: 2,
          fg: state.cfg.fg,
          bg: state.cfg.bg,
          selfChar: state.textLogoSelfChar,
        });
        cells = maybeApplyFindWord(cells);
        ctx.currentCells = cells;
        ctx.currentGridWidth = gridMaxWidth(cells);
        pre.style.opacity = '1';
        fitFontSize();
        renderCellsToPre(cells);
      } catch (e) {
        ctx.currentGridWidth = 0;
        pre.textContent = 'Logo 渲染失败：' + (e instanceof Error ? e.message : String(e));
        fitFontSize();
      }
      replaceFrame();
      return;
    }
    // 纯文本模式
    ctx.currentCells = [];
    ctx.currentGridWidth = 0;
    fitFontSize();
    pre.textContent = state.text || '在这里输入文字…\n支持多行，会自动换行。';
    pre.style.opacity = state.text ? '1' : '0.4';
    replaceFrame();
  }

  /**
   * 若开启找字游戏且有隐藏文字，把隐藏字点阵叠到 cells 上（返回新网格）。
   * 在 renderCellsToPre 前调用，下游（复制/HTML/PNG）透明带隐藏字。
   */
  function maybeApplyFindWord(cells: Rendered): Rendered {
    const fw = state.findWord;
    if (!fw.enabled) return cells;
    if (!fw.text.trim()) return cells;
    return applyFindWord(cells, fw, state.cfg.fg);
  }

  /** 非点阵找字 + 隐藏字含全角时，「复制纯文本」会错位（CSS 压缩只对预览/HTML/PNG）→ 显示提示。 */
  function updatePlainTextHint(): void {
    if (!ctx.plainTextHint) return;
    const fw = state.findWord;
    const show = fw.enabled && !fw.dotMatrix && hasFullWidthChar(fw.text);
    ctx.plainTextHint.style.display = show ? '' : 'none';
  }

  /** 字符串里是否含全角字符（CJK/全角符号）。 */
  function hasFullWidthChar(s: string): boolean {
    for (const ch of Array.from(s)) {
      const cp = ch.codePointAt(0) ?? 0;
      if (
        (cp >= 0x1100 && cp <= 0x115f) ||
        (cp >= 0x2e80 && cp <= 0x9fff) ||
        (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6)
      )
        return true;
    }
    return false;
  }

  /**
   * 把 Cell 网格渲染进 <pre>。
   * - 彩色模式（colorMode）：每 Cell 一个 span（带 fg/bg）。
   * - 单色模式：带 fg/bg 的 Cell 产 span（find-word 高亮凸显），无色 Cell 拼文本（性能：多数 cell 不产 span）。
   * - 全角标记 Cell（c.w）：产 span + inline-block + scaleX(ratio) + width:ratio em，压回半角列宽。
   *   ratio = 半角 advance / 全角 advance（等宽字体 ≈0.6，运行时测量）。
   *   仅 find-word 非点阵模式植入的全角字置 c.w，半块 ▀/点阵 █ 不带 → 绝不误压。
   */
  function renderCellsToPre(cells: Rendered): void {
    pre.replaceChildren();
    const frag = document.createDocumentFragment();
    for (let y = 0; y < cells.length; y++) {
      const row = cells[y]!;
      if (state.cfg.colorMode) {
        // 彩色：每 Cell 一个 span
        for (let x = 0; x < row.length; x++) {
          frag.append(makeCellSpan(row[x]!));
        }
      } else {
        // 单色：带色 Cell 产 span，无色拼文本
        for (let x = 0; x < row.length; x++) {
          const c = row[x]!;
          if (c.fg || c.bg || c.w) {
            frag.append(makeCellSpan(c));
          } else {
            frag.append(document.createTextNode(c.ch));
          }
        }
      }
      frag.append(document.createTextNode('\n'));
    }
    pre.append(frag);
    if (!state.cfg.colorMode) pre.style.color = state.cfg.fg;
  }

  /** 造一个 Cell 的 span：带 fg/bg + 全角压缩（c.w）。 */
  function makeCellSpan(c: { ch: string; fg?: string; bg?: string; w?: boolean }): HTMLSpanElement {
    const span = document.createElement('span');
    if (c.fg) span.style.color = c.fg;
    if (c.bg) span.style.backgroundColor = c.bg;
    if (c.w) {
      // 全角字压回半角列宽：inline-block + scaleX(ratio) + 固定宽度（行高 1，纵向不拉）。
      // ratio = 半角/全角 advance 比（JBM 等宽字体半角为 0.6em，中文全角 1em → ≈0.6）。
      // 关键：普通列（空格/█）宽 = 半角 advance，压缩字列必须同宽，否则每列宽不一致 →
      // 网格位置随字数单调累积、字形内部横向扭曲（同字元素走形的结构性根因）。
      const ratio = getFullToHalfRatio();
      span.style.display = 'inline-block';
      span.style.transform = `scaleX(${ratio})`;
      span.style.width = `${ratio}em`;
      span.style.transformOrigin = 'left center';
    }
    span.textContent = c.ch;
    return span;
  }

  /** 重建终端外框（包住 pre），替换 frameWrap 子节点。 */
  function replaceFrame(): void {
    pre.style.color = state.cfg.fg;
    pre.style.background = 'transparent';
    const frame = buildTerminalFrame(state.cfg, pre);
    frameWrap.replaceChildren(frame);
  }

  // —— 控制面板构建 ——
  const controls = buildControls(ctx);
  const actions = buildActions(ctx, frameWrap);

  // —— 布局：左控制 + 右预览 ——
  const inputCol = h('div', { class: 'space-y-5 min-w-0' }, [controls, actions]);
  // 预览区：始终 sticky 吸顶。
  //   大屏：右侧悬浮（lg:top-6），滚动参数区时预览始终可见。
  //   小屏：顶部吸顶（top-0），预览区最高不超过可视区域一半（50vh）+ 内部滚动，
  //         下方参数区始终可见可操作。
  const previewCol = h(
    'div',
    {
      class:
        'space-y-3 min-w-0 order-first lg:order-none sticky top-0 lg:top-6 z-10 bg-[var(--bg)] py-2 max-h-[50vh] lg:max-h-none overflow-auto lg:overflow-visible',
    },
    [previewZoom.buildPreviewToolbar(), stage],
  );
  const layout = h(
    'div',
    {
      class:
        'grid gap-6 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] items-start',
    },
    [inputCol, previewCol],
  );

  content.append(layout);

  // resize 监听：图片模式字号自适应
  window.addEventListener('resize', fitFontSize);
  // 初次渲染（等 layout 后取 stage 宽度）
  //    rAF 在后台/不可见标签页会暂停（IAB 常见），用 setTimeout 兜底保证渲染
  const firstRender = () => rerenderPreview();
  requestAnimationFrame(firstRender);
  setTimeout(firstRender, 60);
}

/**
 * 网格最大行宽（列数）。
 * 图片模式各行恒等宽（max 无副作用）；多行 Logo 各行宽可能不同（短行左侧留白），
 * 取 max 保证 fitFontSize 按最宽行算字号，避免宽行横向溢出。
 */
function gridMaxWidth(cells: Rendered): number {
  let max = 0;
  for (const row of cells) {
    if (row.length > max) max = row.length;
  }
  return max;
}

render();
