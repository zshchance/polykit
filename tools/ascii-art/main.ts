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
 */

import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { copyText } from '@/core/utils/clipboard';

import type { StyleConfig, InputMode, Rendered } from './types';
import { STYLE_PRESETS, TERMINAL_METAS, getEffectivePresets, setCustomStyleProvider } from './presets';
import { CHARSET_PRESETS } from './charsets';
import { loadCfg, saveCfg, aspectRatioForHalfBlock, type PersistedState } from './settings';
import { loadImage, revokeImage, type LoadedImage } from './image';
import { imageToCells } from './render/image-to-cells';
import { textToLogoCells } from './render/text-to-logo-cells';
import { buildTerminalFrame } from './render/terminal-frame';
import { serializeText } from './serialize/to-text';
import { serializeHtml } from './serialize/to-html';
import { downloadPng, safeFilename } from './export';
import {
  loadCustomStyles, addCustomStyle, removeCustomStyle,
  isCustomStyleId, toStylePreset, buildStylePrompt, parseStyleAIOutput,
  type StyleAppearance,
} from './custom-styles';
import { createCopyButton } from '@/core/components/CopyButton';

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

  // 操作按钮里的「复制彩色 HTML」按钮引用，需在 buildControls（引用它做显隐）
  // 之前声明，避免 TDZ（let 在函数体内整段提升，但初始化前不可访问）。
  let htmlCopyBtn: HTMLElement;

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
  };
  let loadedImage: LoadedImage | null = null;
  let currentCells: Rendered = []; // 图片/logo 模式最新渲染结果（供复制用）
  let renderToken = 0; // 防抖/竞态
  /** logo 模式最新网格宽度（供字号自适应 + 导出 W 用）。0=非网格模式。 */
  let currentGridWidth = 0;

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

  const stage = h('div', {
    class: 'w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-6',
    style: 'min-height:300px;display:flex;align-items:center;justify-content:center;',
  }, [frameWrap]);

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
    if (state.textLogo && currentGridWidth > 0) {
      pre.style.whiteSpace = 'pre';
      pre.style.wordBreak = 'normal';
      const W = Math.max(8, currentGridWidth);
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
      currentGridWidth = 0;
      fitFontSize();
      rerenderImage();
    } else {
      rerenderText();
    }
  }

  function rerenderImage(): void {
    if (!loadedImage) {
      currentCells = [];
      currentGridWidth = 0;
      pre.textContent = '';
      pre.style.color = state.cfg.fg;
      pre.style.opacity = '0.4';
      pre.textContent = '↑ 上传一张图片，生成终端风字符画';
      replaceFrame();
      return;
    }
    pre.style.opacity = '1';

    const token = ++renderToken;
    try {
      const cells = imageToCells(loadedImage.bitmap, {
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
      currentCells = cells;
      currentGridWidth = cells[0]?.length ?? 0;
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
      currentCells = [];
      currentGridWidth = 0;
      if (!state.text.trim()) {
        pre.textContent = '输入要放大的字符（如 即开宝匣）…';
        pre.style.opacity = '0.4';
        fitFontSize();
        replaceFrame();
        return;
      }
      try {
        const cells = textToLogoCells({
          text: state.text,
          glyphHeight: state.logoSize,
          fillChar: '█',
          charGap: 2,
          fg: state.cfg.fg,
          bg: state.cfg.bg,
        });
        currentCells = cells;
        currentGridWidth = cells[0]?.length ?? 0;
        pre.style.opacity = '1';
        fitFontSize();
        renderCellsToPre(cells);
      } catch (e) {
        currentGridWidth = 0;
        pre.textContent = 'Logo 渲染失败：' + (e instanceof Error ? e.message : String(e));
        fitFontSize();
      }
      replaceFrame();
      return;
    }
    // 纯文本模式
    currentCells = [];
    currentGridWidth = 0;
    fitFontSize();
    pre.textContent = state.text || '在这里输入文字…\n支持多行，会自动换行。';
    pre.style.opacity = state.text ? '1' : '0.4';
    replaceFrame();
  }

  /** 把 Cell 网格渲染进 <pre>（彩色模式每 Cell 一个 span，单色直接拼接文本）。 */
  function renderCellsToPre(cells: Rendered): void {
    pre.replaceChildren();
    if (state.cfg.colorMode) {
      // 彩色：每 Cell 一个 span（DOM 节点可能上万，但预览够用）
      const frag = document.createDocumentFragment();
      for (let y = 0; y < cells.length; y++) {
        const row = cells[y]!;
        for (let x = 0; x < row.length; x++) {
          const c = row[x]!;
          const span = document.createElement('span');
          if (c.fg) span.style.color = c.fg;
          if (c.bg) span.style.backgroundColor = c.bg;
          span.textContent = c.ch;
          frag.append(span);
        }
        frag.append(document.createTextNode('\n'));
      }
      pre.append(frag);
    } else {
      // 单色：直接拼接文本（color 由 pre 继承）
      const lines: string[] = [];
      for (const row of cells) {
        lines.push(row.map((c) => c.ch).join(''));
      }
      pre.textContent = lines.join('\n');
      pre.style.color = state.cfg.fg;
    }
  }

  /** 重建终端外框（包住 pre），替换 frameWrap 子节点。 */
  function replaceFrame(): void {
    pre.style.color = state.cfg.fg;
    pre.style.background = 'transparent';
    const frame = buildTerminalFrame(state.cfg, pre);
    frameWrap.replaceChildren(frame);
  }

  // —— 控制面板构建 ——
  const controls = buildControls();
  const actions = buildActions();

  // —— 布局：左控制 + 右预览 ——
  const inputCol = h('div', { class: 'space-y-5 min-w-0' }, [
    controls,
    actions,
  ]);
  const previewCol = h('div', { class: 'space-y-3 min-w-0 order-first lg:order-none lg:sticky lg:top-6' }, [
    h('div', { class: 'text-sm font-medium text-[var(--fg)]' }, ['预览']),
    stage,
  ]);
  const layout = h('div', {
    class: 'grid gap-6 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]',
  }, [inputCol, previewCol]);

  content.append(layout);

  // resize 监听：图片模式字号自适应
  window.addEventListener('resize', fitFontSize);
  // 初次渲染（等 layout 后取 stage 宽度）
  //    rAF 在后台/不可见标签页会暂停（IAB 常见），用 setTimeout 兜底保证渲染
  const firstRender = () => rerenderPreview();
  requestAnimationFrame(firstRender);
  setTimeout(firstRender, 60);

  // —— 控制面板 ——
  function buildControls(): HTMLElement {
    // Tab：图片 / 文字流
    const tabImage = h('button', {
      type: 'button',
      class: 'tab-btn flex-1 rounded-md px-3 py-2 text-sm transition-colors',
      textContent: '🖼️ 图片转字符画',
      onclick: () => switchMode('image'),
    });
    const tabText = h('button', {
      type: 'button',
      class: 'tab-btn flex-1 rounded-md px-3 py-2 text-sm transition-colors',
      textContent: '📝 文字流',
      onclick: () => switchMode('text'),
    });
    const tabBar = h('div', { class: 'flex gap-1 rounded-lg bg-[var(--bg-elevated)] p-1' }, [tabImage, tabText]);

    function updateTabs(): void {
      const active = 'bg-[var(--accent)] text-[var(--accent-fg)]';
      const idle = 'text-[var(--fg-muted)] hover:text-[var(--fg)]';
      tabImage.className = `tab-btn flex-1 rounded-md px-3 py-2 text-sm transition-colors ${state.mode === 'image' ? active : idle}`;
      tabText.className = `tab-btn flex-1 rounded-md px-3 py-2 text-sm transition-colors ${state.mode === 'text' ? active : idle}`;
    }

    // —— 图片输入区（dropzone）——
    const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
    const dropHint = h('div', { class: 'text-center text-sm text-[var(--fg-muted)] py-6' }, [
      h('div', { class: 'text-2xl mb-2', textContent: '📁' }),
      h('div', {}, ['点击选择 / 拖入图片 / ']),
      h('div', {}, ['粘贴 (Ctrl+V) 截图']),
    ]);
    const dropzone = h('div', {
      role: 'button',
      tabindex: '0',
      'aria-label': '选择或拖入图片',
      class: 'cursor-pointer rounded-xl border-2 border-dashed border-[var(--border)] hover:border-[var(--accent)] transition-colors',
      onclick: () => fileInput.click(),
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileInput.click();
        }
      },
    }, [dropHint]);

    fileInput.addEventListener('change', () => {
      const f = (fileInput as HTMLInputElement).files?.[0];
      if (f) handleFile(f);
    });

    on(dropzone, ['dragover', 'dragleave', 'drop'], (e: Event) => {
      e.preventDefault();
      const de = e as DragEvent;
      if (e.type === 'dragover') dropzone.classList.add('dragover');
      if (e.type === 'dragleave' || e.type === 'drop') dropzone.classList.remove('dragover');
      if (e.type === 'drop' && de.dataTransfer?.files?.length) {
        handleFile(de.dataTransfer.files[0]!);
      }
    });

    // 全局粘贴（图片模式时）
    document.addEventListener('paste', (e: ClipboardEvent) => {
      if (state.mode !== 'image') return;
      const item = Array.from(e.clipboardData?.items ?? []).find((it) => it.type.startsWith('image/'));
      const f = item?.getAsFile();
      if (f) handleFile(f);
    });

    async function handleFile(file: File): Promise<void> {
      try {
        const img = await loadImage(file);
        if (loadedImage) revokeImage(loadedImage);
        loadedImage = img;
        dropHint.replaceChildren(
          h('div', { class: 'text-xs', textContent: `✓ ${img.name}（${img.width}×${img.height}）` }),
        );
        rerenderPreview();
      } catch (e) {
        dropHint.replaceChildren(
          h('div', { class: 'text-xs text-red-500', textContent: e instanceof Error ? e.message : '加载失败' }),
        );
      }
    }

    // —— 文字流输入 ——
    const textArea = h('textarea', {
      class: 'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] font-mono',
      rows: 6,
      placeholder: '输入要显示在终端里的文字…\n支持多行，自动换行。\n开启下方「Logo 字符」可把文字放大成大字 banner。',
      oninput: () => {
        state.text = textArea.value;
        persist();
        if (state.mode === 'text') rerenderPreview();
      },
    });
    textArea.value = state.text;

    // Logo 字符开关（文字流子模式）
    const logoChk = checkbox('Logo 字符（把文字放大成大字 banner，支持中文）', state.textLogo, (v) => {
      state.textLogo = v;
      persist();
      if (state.mode === 'text') rerenderPreview();
      updateModeVisibility();
    });

    // Logo 大小滑动条（仅文字流 + logo 开启时用）
    const logoSizeSlider = rangeSlider('Logo 大小', state.logoSize, 8, 40, (v) => {
      state.logoSize = v;
      persist();
      if (state.mode === 'text' && state.textLogo) rerenderPreview();
    });

    // —— 风格预设选择器（内置 + 自定义，💡 加 AI 风格，✕ 删自定义）——
    const presetGrid = h('div', { class: 'grid grid-cols-3 gap-2' });

    function makePresetButton(p: { id: string; name: string; preview: { bg: string; fg: string }; config: StyleConfig }): HTMLElement {
      const active = isCurrentPreset(p.config);
      const btn = h('button', {
        type: 'button',
        'data-preset': p.id,
        class: `rounded-lg border-2 p-2 text-xs transition-all ${active ? 'border-[var(--accent)]' : 'border-[var(--border)] hover:border-[var(--accent)]/50'}`,
        onclick: () => applyPreset(p.config),
      }, [
        h('div', {
          class: 'mb-1 h-8 rounded font-mono text-sm flex items-center justify-center',
          style: `background:${p.preview.bg};color:${p.preview.fg};`,
          textContent: '>_',
        }),
        h('div', { class: 'truncate text-[var(--fg-muted)]', textContent: p.name }),
      ]);
      // 自定义风格：右下角挂 ✕ 删除（阻止冒泡以免触发选择）
      if (isCustomStyleId(p.id)) {
        const del = h('button', {
          type: 'button',
          'aria-label': `删除自定义风格 ${p.name}`,
          title: '删除此自定义风格',
          class: 'absolute -right-1.5 -bottom-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] text-[11px] leading-none text-[var(--fg-muted)] hover:bg-red-500/15 hover:text-red-500 transition-colors',
          textContent: '✕',
          onclick: (e: Event) => {
            e.stopPropagation();
            if (!confirm(`确定删除${p.name}吗？此操作不可撤销。`)) return;
            removeCustomStyle(p.id);
            // 若删的是当前选中的外观，回退默认预设
            if (isCurrentPreset(p.config)) {
              applyPreset(STYLE_PRESETS[0]!.config);
            }
            rebuildPresets();
          },
        });
        return h('div', { class: 'relative' }, [btn, del]);
      }
      return btn;
    }

    function rebuildPresets(): void {
      presetGrid.replaceChildren(...getEffectivePresets().map(makePresetButton));
    }

    // —— 参数控件 ——
    // 字符宽
    const widthSlider = slider('字符宽', state.cfg.width, [60, 80, 100, 120, 160], (v) => {
      state.cfg.width = v;
      persist();
      rerenderPreview();
      updateParamReadouts();
    });
    // 半块模式（随 colorMode 联动禁用）
    const halfBlockChk = checkbox('半块高细节（▀ 真彩双色，垂直分辨率翻倍）', state.cfg.halfBlock, (v) => {
      state.cfg.halfBlock = v;
      if (v) state.cfg.aspectRatio = aspectRatioForHalfBlock(true); // 联动重设
      persist();
      rerenderPreview();
      updateParamReadouts();
    });
    // 彩色模式（关 → halfBlock 联动关）
    const colorModeChk = checkbox('彩色（保留原图颜色）', state.cfg.colorMode, (v) => {
      state.cfg.colorMode = v;
      if (!v) {
        state.cfg.halfBlock = false;
        state.cfg.aspectRatio = aspectRatioForHalfBlock(false);
        halfBlockChk.input.disabled = true;
        halfBlockChk.input.checked = false;
      } else {
        halfBlockChk.input.disabled = false;
      }
      persist();
      rerenderPreview();
      updateParamReadouts();
    });
    // 字符集
    const charsetSel = select('字符集', CHARSET_PRESETS.map((c) => ({ value: c.chars, label: c.name })), state.cfg.charset, (v) => {
      state.cfg.charset = v;
      persist();
      rerenderPreview();
    });
    // 对比度 / 亮度 / 反转
    const contrastSlider = rangeSlider('对比度', state.cfg.contrast, -100, 100, (v) => {
      state.cfg.contrast = v;
      persist();
      rerenderPreview();
      updateParamReadouts();
    });
    const brightnessSlider = rangeSlider('亮度', state.cfg.brightness, -100, 100, (v) => {
      state.cfg.brightness = v;
      persist();
      rerenderPreview();
      updateParamReadouts();
    });
    const invertChk = checkbox('反转明暗', state.cfg.invert, (v) => {
      state.cfg.invert = v;
      persist();
      rerenderPreview();
    });

    // —— 终端外观 ——
    const terminalSel = select('终端类型', TERMINAL_METAS.map((t) => ({ value: t.id, label: t.name })), state.cfg.terminal, (v) => {
      state.cfg.terminal = v as StyleConfig['terminal'];
      persist();
      rerenderPreview();
    });
    const titleInput = h('input', {
      type: 'text',
      class: 'w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--fg)]',
      value: state.cfg.title,
      oninput: () => {
        state.cfg.title = titleInput.value;
        persist();
        rerenderPreview();
      },
    });
    const scanChk = checkbox('扫描线', state.cfg.crtScanlines, (v) => { state.cfg.crtScanlines = v; persist(); rerenderPreview(); });
    const glowChk = checkbox('辉光', state.cfg.crtGlow, (v) => { state.cfg.crtGlow = v; persist(); rerenderPreview(); });
    const curveChk = checkbox('屏幕弧度', state.cfg.crtCurve, (v) => { state.cfg.crtCurve = v; persist(); rerenderPreview(); });
    const frameChk = checkbox('显示外框', state.cfg.showFrame, (v) => { state.cfg.showFrame = v; persist(); rerenderPreview(); });

    function updateParamReadouts(): void {
      widthSlider.set(state.cfg.width);
      contrastSlider.set(state.cfg.contrast);
      brightnessSlider.set(state.cfg.brightness);
      halfBlockChk.input.checked = state.cfg.halfBlock;
      halfBlockChk.input.disabled = !state.cfg.colorMode;
      colorModeChk.input.checked = state.cfg.colorMode;
      invertChk.input.checked = state.cfg.invert;
    }

    function applyPreset(preset: StyleConfig): void {
      // 保留当前 width（用户调过的分辨率不因切风格重置），其余整体替换
      const keepWidth = state.cfg.width;
      state.cfg = { ...preset, width: keepWidth };
      // 钳制
      if (!state.cfg.colorMode) state.cfg.halfBlock = false;
      persist();
      updateParamReadouts();
      charsetSel.set(state.cfg.charset);
      terminalSel.set(state.cfg.terminal);
      titleInput.value = state.cfg.title;
      scanChk.input.checked = state.cfg.crtScanlines;
      glowChk.input.checked = state.cfg.crtGlow;
      curveChk.input.checked = state.cfg.crtCurve;
      frameChk.input.checked = state.cfg.showFrame;
      rebuildPresets();
      rerenderPreview();
    }

    function isCurrentPreset(preset: StyleConfig): boolean {
      // 宽松判断：bg/fg/halfBlock/colorMode/terminal 一致即视为选中
      const c = state.cfg;
      return (
        c.bg === preset.bg &&
        c.fg === preset.fg &&
        c.terminal === preset.terminal &&
        c.showFrame === preset.showFrame &&
        c.crtScanlines === preset.crtScanlines &&
        c.crtGlow === preset.crtGlow &&
        c.crtCurve === preset.crtCurve
      );
    }

    /** 应用自定义风格外观：只覆盖风格字段，保留 width/charset/halfBlock 等图片参数。 */
    function applyCustomStyle(appearance: StyleAppearance): void {
      state.cfg = { ...state.cfg, ...appearance };
      if (!state.cfg.colorMode) state.cfg.halfBlock = false;
      persist();
      updateParamReadouts();
      terminalSel.set(state.cfg.terminal);
      titleInput.value = state.cfg.title;
      scanChk.input.checked = state.cfg.crtScanlines;
      glowChk.input.checked = state.cfg.crtGlow;
      curveChk.input.checked = state.cfg.crtCurve;
      frameChk.input.checked = state.cfg.showFrame;
      rebuildPresets();
      rerenderPreview();
    }

    function switchMode(mode: InputMode): void {
      state.mode = mode;
      persist();
      updateTabs();
      updateModeVisibility();
      rerenderPreview();
    }

    function updateModeVisibility(): void {
      const imgShow = state.mode === 'image';
      const textShow = !imgShow; // 文字流模式
      dropzone.style.display = imgShow ? '' : 'none';
      textArea.style.display = textShow ? '' : 'none';
      logoChk.row.style.display = textShow ? '' : 'none'; // Logo 开关仅文字流
      logoSizeSlider.row.style.display = textShow ? '' : 'none'; // Logo 大小滑动条仅文字流
      // 图片专属参数
      widthSlider.row.style.display = imgShow ? '' : 'none';
      halfBlockChk.row.style.display = imgShow ? '' : 'none';
      colorModeChk.row.style.display = imgShow ? '' : 'none';
      charsetSel.row.style.display = imgShow ? '' : 'none';
      contrastSlider.row.style.display = imgShow ? '' : 'none';
      brightnessSlider.row.style.display = imgShow ? '' : 'none';
      invertChk.row.style.display = imgShow ? '' : 'none';
      // 彩色 HTML 按钮：仅图片模式（文字流纯文本/logo 都是单色，无彩色 HTML）
      if (htmlCopyBtn) htmlCopyBtn.style.display = imgShow ? '' : 'none';
    }

    // 初始化
    updateTabs();
    rebuildPresets();
    updateParamReadouts();
    halfBlockChk.input.disabled = !state.cfg.colorMode;
    updateModeVisibility(); // 同步调用（rAF 在后台标签页会暂停，IAB 常见）

    // —— AI 自定义风格模态（镜像 quote-card 的 openTemplateDialog）——
    // 定义在 buildControls 内，与 applyCustomStyle/rebuildPresets 共享作用域。
    let dialogEl: HTMLElement | null = null;

    function closeDialog(): void {
      if (dialogEl) {
        dialogEl.remove();
        dialogEl = null;
      }
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onDialogEsc);
    }

    function onDialogEsc(e: KeyboardEvent): void {
      if (e.key === 'Escape' && dialogEl) {
        e.preventDefault();
        closeDialog();
      }
    }

    /** 挂载模态：overlay 可点击关闭，内容短则居中、长则可滚动到保存按钮。 */
    function mountDialog(card: HTMLElement): HTMLElement {
      const overlay = h('div', {
        class: 'fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4',
        onclick: (e: Event) => {
          if (e.target === overlay || e.target === wrap) closeDialog();
        },
      });
      const wrap = h('div', { class: 'flex min-h-full justify-center' }, [card]);
      card.classList.add('my-auto');
      overlay.append(wrap);
      document.body.append(overlay);
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', onDialogEsc);
      return overlay;
    }

    function openStyleDialog(): void {
      if (dialogEl) closeDialog();

      const statusRow = h('div', { class: 'min-h-[1.25rem] text-xs' });
      const flashError = (msg: string): void => {
        statusRow.textContent = '⚠ ' + msg;
        statusRow.style.color = 'var(--holiday-legal)';
      };
      const flashOk = (msg: string): void => {
        statusRow.textContent = '✓ ' + msg;
        statusRow.style.color = '#22c55e';
      };

      // 步骤 1：描述
      const descInput = h('textarea', {
        rows: 3,
        class: 'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
        placeholder: '例如：深紫背景配青绿色文字，赛博朋克风，带扫描线和辉光；或：米白纸张色配深棕字，无外框，复古打字机',
      });

      // 步骤 2：生成的提示词
      const promptArea = h('textarea', {
        readonly: true,
        rows: 10,
        class: 'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-[12px] leading-relaxed text-[var(--fg)] outline-none',
      });
      const step2 = h('div', { class: 'hidden space-y-2' }, [
        h('p', { class: 'text-xs text-[var(--fg-muted)]', textContent: '② 把下面的提示词发给任意 AI（ChatGPT / Claude / GLM 等），让它生成终端风格参数。' }),
        promptArea,
        h('div', { class: 'flex justify-end' }, [
          createCopyButton(() => promptArea.value, '📋 复制提示词', '已复制 ✓'),
        ]),
      ]);

      // 步骤 3：粘贴 AI 返回 + 保存
      const pasteInput = h('textarea', {
        rows: 10,
        spellcheck: false,
        class: 'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-[12px] leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]',
        placeholder: '把 AI 返回的 ```json 代码块整体粘到这里（含名称/背景/文字色注释 + JSON 对象）',
      });
      const step3 = h('div', { class: 'hidden space-y-2' }, [
        h('p', { class: 'text-xs text-[var(--fg-muted)]', textContent: '③ 粘贴 AI 返回的 JSON（含名称/背景/文字色注释），点保存即可在选择器看到 ⭐ 自定义风格。' }),
        pasteInput,
        h('div', { class: 'flex items-center justify-end gap-2' }, [
          h('button', {
            type: 'button',
            class: 'rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--fg-muted)] hover:border-[var(--accent)] transition-colors',
            textContent: '取消',
            onclick: () => closeDialog(),
          }),
          h('button', {
            type: 'button',
            class: 'rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
            textContent: '保存并应用',
            onclick: () => save(),
          }),
        ]),
      ]);

      function generate(): void {
        const desc = descInput.value.trim();
        if (!desc) {
          flashError('请先描述你想要的风格');
          descInput.focus();
          return;
        }
        statusRow.textContent = '';
        promptArea.value = buildStylePrompt(desc);
        step2.classList.remove('hidden');
        step3.classList.remove('hidden');
        promptArea.scrollTop = 0;
      }

      function save(): void {
        const parsed = parseStyleAIOutput(pasteInput.value);
        if (!parsed) {
          flashError('没识别到风格——首行应是「// 名称：xxx」，且需含合法 JSON');
          pasteInput.focus();
          return;
        }
        const list = addCustomStyle(parsed.name, parsed.appearance, parsed.preview);
        const saved = list.find((it) => it.name.trim() === parsed.name);
        if (!saved) {
          flashError('保存失败，请重试');
          return;
        }
        applyCustomStyle(parsed.appearance);
        persist();
        flashOk(`已保存「${parsed.name}」并应用`);
        setTimeout(closeDialog, 700);
      }

      const card = h('div', {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '用 AI 生成自定义风格',
        class: 'w-[min(92vw,42rem)] rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-2xl',
      }, [
        // 标题行
        h('div', { class: 'mb-4 flex items-center justify-between' }, [
          h('h2', { class: 'text-base font-semibold text-[var(--fg)]', textContent: '💡 用 AI 生成自定义风格' }),
          h('button', {
            type: 'button',
            'aria-label': '关闭',
            class: 'text-[var(--fg-muted)] hover:text-[var(--fg)] text-lg leading-none',
            textContent: '✕',
            onclick: () => closeDialog(),
          }),
        ]),
        // 步骤 1
        h('div', { class: 'space-y-2' }, [
          h('label', { class: 'text-xs font-medium text-[var(--fg-muted)]', textContent: '① 描述你想要的终端风格' }),
          descInput,
          h('div', { class: 'flex justify-end' }, [
            h('button', {
              type: 'button',
              class: 'rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
              textContent: '生成 AI 提示词',
              onclick: () => generate(),
            }),
          ]),
        ]),
        step2,
        step3,
        statusRow,
        h('p', { class: 'mt-3 text-center text-[11px] text-[var(--fg-muted)]', textContent: '数据不出本地 · 仅保存风格参数（配色/终端/CRT 开关）' }),
      ]);

      dialogEl = mountDialog(card);
      // rAF 在后台标签页会暂停，用 setTimeout 兜底聚焦
      const focusDesc = () => descInput.focus();
      requestAnimationFrame(focusDesc);
      setTimeout(focusDesc, 60);
    }

    return h('div', { class: 'space-y-5' }, [
      tabBar,
      // 图片输入
      h('div', { class: 'space-y-2' }, [
        h('div', { class: 'text-sm font-medium text-[var(--fg)]' }, ['输入']),
        dropzone,
        fileInput,
        textArea,
        logoChk.row,
        logoSizeSlider.row,
      ]),
      // 风格预设
      h('div', { class: 'space-y-2' }, [
        h('div', { class: 'flex items-center justify-between' }, [
          h('span', { class: 'text-sm font-medium text-[var(--fg)]', textContent: '风格预设' }),
          h('button', {
            type: 'button',
            title: '用 AI 生成自定义风格：描述风格 → 生成提示词 → 粘贴 AI 返回的 JSON → 保存',
            'aria-label': '用 AI 生成自定义风格',
            class: 'inline-flex shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
            textContent: '💡',
            onclick: () => openStyleDialog(),
          }),
        ]),
        presetGrid,
      ]),
      // 字符画参数
      h('div', { class: 'space-y-3' }, [
        h('div', { class: 'text-sm font-medium text-[var(--fg)]' }, ['字符画参数']),
        widthSlider.row,
        colorModeChk.row,
        halfBlockChk.row,
        charsetSel.row,
        contrastSlider.row,
        brightnessSlider.row,
        invertChk.row,
      ]),
      // 终端外观
      h('div', { class: 'space-y-3' }, [
        h('div', { class: 'text-sm font-medium text-[var(--fg)]' }, ['终端外观']),
        terminalSel.row,
        h('div', { class: 'space-y-1' }, [
          h('label', { class: 'text-xs text-[var(--fg-muted)]', textContent: '标题栏文字' }),
          titleInput,
        ]),
        h('div', { class: 'grid grid-cols-2 gap-2' }, [
          scanChk.row, glowChk.row, curveChk.row, frameChk.row,
        ]),
      ]),
    ]);
  }

  // —— 操作按钮 ——
  function buildActions(): HTMLElement {
    const textBtn = h('button', {
      type: 'button',
      class: 'inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--fg)] hover:opacity-80 transition-opacity',
      title: '复制字符画纯文本（不含外框）',
      textContent: '复制纯文本',
      onclick: async () => {
        // 图片模式 / 文字流 Logo 模式：复制序列化的字符画；纯文字流：复制原文本
        const text =
          state.mode === 'image' || (state.mode === 'text' && state.textLogo)
            ? serializeText(currentCells, state.cfg.charset)
            : state.text;
        const ok = await copyText(text);
        flash(textBtn, ok ? '已复制 ✓' : '复制失败');
      },
    });

    htmlCopyBtn = h('button', {
      type: 'button',
      class: 'inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--fg)] hover:opacity-80 transition-opacity',
      title: '复制彩色 HTML（字符带色，不含外框）',
      textContent: '复制彩色 HTML',
      onclick: async () => {
        const html = serializeHtml(currentCells);
        const ok = await copyRichHtml(html);
        flash(htmlCopyBtn, ok ? '已复制 ✓' : '复制失败');
      },
    });

    const pngBtn = h('button', {
      type: 'button',
      class: 'inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
      title: '下载 PNG（含终端外框）',
      textContent: '下载 PNG',
      onclick: async () => {
        const frame = frameWrap.firstElementChild as HTMLElement | null;
        if (!frame) return;
        flash(pngBtn, '生成中…');
        // 图片模式：W=cfg.width；文字流 Logo 模式：W=currentGridWidth；纯文字流：0（用预览原样字号）
        const W = state.mode === 'image'
          ? state.cfg.width
          : state.textLogo ? currentGridWidth : 0;
        const name = state.mode === 'image'
          ? (loadedImage?.name ?? '字符画')
          : state.textLogo
            ? ((state.text.split('\n')[0] ?? 'logo') + '-logo')
            : (state.text.split('\n')[0] ?? '文字流');
        const result = await downloadPng(frame, W, safeFilename(name));
        flash(pngBtn, result.ok ? '已下载 ✓' : `失败：${result.reason}`);
      },
    });

    return h('div', { class: 'flex flex-wrap gap-2' }, [textBtn, htmlCopyBtn, pngBtn]);
  }

  function flash(btn: HTMLElement, text: string): void {
    const orig = btn.textContent;
    btn.textContent = text;
    (btn as HTMLButtonElement).disabled = true;
    setTimeout(() => {
      btn.textContent = orig;
      (btn as HTMLButtonElement).disabled = false;
    }, 1500);
  }

  /** 复制富文本 HTML（保留颜色 span），用 ClipboardItem。失败回退纯文本。 */
  async function copyRichHtml(html: string): Promise<boolean> {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const blob = new Blob([html], { type: 'text/html' });
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })]);
        return true;
      }
    } catch {
      // 回退
    }
    // 回退：复制去掉标签的纯文本
    return copyText(html.replace(/<[^>]+>/g, ''));
  }
}

// —— 控件工厂（保持 main.ts 简洁）——

function on(el: Element, events: string[], handler: (e: Event) => void): void {
  for (const ev of events) el.addEventListener(ev, handler as EventListener);
}

interface SliderControl {
  row: HTMLElement;
  set: (v: number) => void;
}

/** 离散值滑块（字符宽）。 */
function slider(label: string, value: number, options: number[], onChange: (v: number) => void): SliderControl & { input: HTMLInputElement } {
  const readout = h('span', { class: 'text-xs text-[var(--fg-muted)] tabular-nums', textContent: String(value) });
  const input = h('input', {
    type: 'range',
    min: String(options[0]),
    max: String(options[options.length - 1]),
    step: '1',
    value: String(value),
    class: 'w-full',
    style: 'accent-color:var(--accent);',
    oninput: () => {
      const v = Number(input.value);
      readout.textContent = String(v);
      onChange(v);
    },
  }) as HTMLInputElement;
  const row = h('div', { class: 'space-y-1' }, [
    h('div', { class: 'flex items-center justify-between' }, [
      h('label', { class: 'text-xs text-[var(--fg-muted)]', textContent: label }),
      readout,
    ]),
    input,
  ]);
  return {
    row, input,
    set: (v: number) => { input.value = String(v); readout.textContent = String(v); },
  };
}

/** 连续值滑块（对比度/亮度）。 */
function rangeSlider(label: string, value: number, min: number, max: number, onChange: (v: number) => void): SliderControl {
  const readout = h('span', { class: 'text-xs text-[var(--fg-muted)] tabular-nums', textContent: String(value) });
  const input = h('input', {
    type: 'range',
    min: String(min),
    max: String(max),
    step: '1',
    value: String(value),
    class: 'w-full',
    style: 'accent-color:var(--accent);',
    oninput: () => {
      const v = Number(input.value);
      readout.textContent = String(v);
      onChange(v);
    },
  }) as HTMLInputElement;
  const row = h('div', { class: 'space-y-1' }, [
    h('div', { class: 'flex items-center justify-between' }, [
      h('label', { class: 'text-xs text-[var(--fg-muted)]', textContent: label }),
      readout,
    ]),
    input,
  ]);
  return {
    row,
    set: (v: number) => { input.value = String(v); readout.textContent = String(v); },
  };
}

interface CheckboxControl {
  row: HTMLElement;
  input: HTMLInputElement;
}

function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void): CheckboxControl {
  const input = h('input', { type: 'checkbox', class: 'accent-[var(--accent)]' }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const row = h('label', { class: 'flex items-center gap-2 text-xs text-[var(--fg)] cursor-pointer' }, [
    input,
    h('span', { textContent: label }),
  ]);
  return { row, input };
}

interface SelectControl {
  row: HTMLElement;
  set: (v: string) => void;
}

function select(label: string, options: { value: string; label: string }[], value: string, onChange: (v: string) => void): SelectControl {
  const sel = h('select', {
    class: 'w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--fg)]',
    onchange: () => onChange(sel.value),
  }, options.map((o) => h('option', { value: o.value, textContent: o.label }))) as HTMLSelectElement;
  sel.value = value;
  const row = h('div', { class: 'space-y-1' }, [
    h('label', { class: 'text-xs text-[var(--fg-muted)]', textContent: label }),
    sel,
  ]);
  return {
    row,
    set: (v: string) => { sel.value = v; },
  };
}

render();
