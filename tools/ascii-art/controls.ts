/**
 * 控制面板（buildControls）：Tab 切换、图片/文字流输入、风格预设、
 * 字符画参数、终端外观，以及模式显隐联动。
 *
 * 依赖方向：依赖 core 的 h/on、presets/charsets/settings/image/custom-styles、
 * widgets 控件工厂、ai-style-dialog 与 find-word-panel 两个子模块；
 * 共享状态（state/loadedImage/htmlCopyBtn 等）经 ControlsContext 显式传入
 * （原为 main.ts render() 闭包变量，语义不变）。
 */

import { h } from '@/core/components/element';
import { confirmDialog } from '@/core/components/Dialog';
import { on } from '@/core/utils/dom';

import type { StyleConfig, InputMode } from './types';
import { STYLE_PRESETS, TERMINAL_METAS, getEffectivePresets } from './presets';
import { CHARSET_PRESETS } from './charsets';
import { aspectRatioForHalfBlock } from './settings';
import { loadImage, revokeImage } from './image';
import { removeCustomStyle, isCustomStyleId, type StyleAppearance } from './custom-styles';
import { slider, rangeSlider, checkbox, select } from './widgets';
import { createAiStyleDialog } from './ai-style-dialog';
import { buildFindWordPanel } from './find-word-panel';
import type { ControlsContext } from './controls-context';

export function buildControls(ctx: ControlsContext): HTMLElement {
  const { state, persist, rerenderPreview } = ctx;
  // 控制面板根元素引用（updateModeVisibility 通过它查 details 做显隐，下方 return 时赋值）
  // eslint-disable-next-line prefer-const -- TDZ 前向声明（函数定义在赋值前），不能合并声明
  let controlsEl: HTMLElement;
  // 找字游戏分组引用（updateModeVisibility 在下方赋值前可能被首次同步调用，需提前声明避免 TDZ；
  // findWordContent/Hint 与 updateFindWordDisabled 已随 find-word-panel.ts 拆出，
  // 面板构建前 updateFindWordDisabled 以 no-op 占位 —— 等价于原面板内「未赋值守卫提前返回」）
  // eslint-disable-next-line prefer-const -- TDZ 前向声明（函数定义在赋值前），不能合并声明
  let findWordDetails: HTMLElement;
  let updateFindWordDisabled: () => void = () => {};
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
  const tabBar = h('div', { class: 'flex gap-1 rounded-lg bg-[var(--bg-elevated)] p-1' }, [
    tabImage,
    tabText,
  ]);

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
  const dropzone = h(
    'div',
    {
      role: 'button',
      tabindex: '0',
      'aria-label': '选择或拖入图片',
      class:
        'cursor-pointer rounded-xl border-2 border-dashed border-[var(--border)] hover:border-[var(--accent)] transition-colors',
      onclick: () => fileInput.click(),
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          fileInput.click();
        }
      },
    },
    [dropHint],
  );

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
    const item = Array.from(e.clipboardData?.items ?? []).find((it) =>
      it.type.startsWith('image/'),
    );
    const f = item?.getAsFile();
    if (f) handleFile(f);
  });

  async function handleFile(file: File): Promise<void> {
    try {
      const img = await loadImage(file);
      if (ctx.loadedImage) revokeImage(ctx.loadedImage);
      ctx.loadedImage = img;
      dropHint.replaceChildren(
        h('div', {
          class: 'text-xs',
          textContent: `✓ ${img.name}（${img.width}×${img.height}）`,
        }),
      );
      rerenderPreview();
    } catch (e) {
      dropHint.replaceChildren(
        h('div', {
          class: 'text-xs text-red-500',
          textContent: e instanceof Error ? e.message : '加载失败',
        }),
      );
    }
  }

  // —— 文字流输入 ——
  const textArea = h('textarea', {
    class:
      'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] font-mono',
    rows: 6,
    placeholder:
      '输入要显示在终端里的文字…\n支持多行，自动换行。\n开启下方「Logo 字符」可把文字放大成大字 banner。',
    oninput: () => {
      state.text = textArea.value;
      persist();
      if (state.mode === 'text') rerenderPreview();
    },
  });
  textArea.value = state.text;

  // Logo 字符开关（文字流子模式）
  const logoChk = checkbox(
    'Logo 字符（把文字放大成大字 banner，支持中文）',
    state.textLogo,
    (v) => {
      state.textLogo = v;
      persist();
      if (state.mode === 'text') rerenderPreview();
      updateModeVisibility();
    },
  );

  // Logo 大小滑动条（仅文字流 + logo 开启时用）
  const logoSizeSlider = rangeSlider('Logo 大小', state.logoSize, 8, 40, (v) => {
    state.logoSize = v;
    persist();
    if (state.mode === 'text' && state.textLogo) rerenderPreview();
  });

  // Logo 同字元素开关：每个字用它自身字符填充（用 p 组成大的 p，用「即」组成大的「即」）
  const logoSelfChk = checkbox(
    '同字元素（每个字用它自身字符组成，而非 █）',
    state.textLogoSelfChar,
    (v) => {
      state.textLogoSelfChar = v;
      persist();
      if (state.mode === 'text' && state.textLogo) rerenderPreview();
    },
  );

  // —— 风格预设选择器（内置 + 自定义，💡 加 AI 风格，✕ 删自定义）——
  const presetGrid = h('div', { class: 'grid grid-cols-3 gap-2' });

  function makePresetButton(p: {
    id: string;
    name: string;
    preview: { bg: string; fg: string };
    config: StyleConfig;
  }): HTMLElement {
    const active = isCurrentPreset(p.config);
    const btn = h(
      'button',
      {
        type: 'button',
        'data-preset': p.id,
        class: `rounded-lg border-2 p-2 text-xs transition-all ${active ? 'border-[var(--accent)]' : 'border-[var(--border)] hover:border-[var(--accent)]/50'}`,
        onclick: () => applyPreset(p.config),
      },
      [
        h('div', {
          class: 'mb-1 h-8 rounded font-mono text-sm flex items-center justify-center',
          style: `background:${p.preview.bg};color:${p.preview.fg};`,
          textContent: '>_',
        }),
        h('div', { class: 'truncate text-[var(--fg-muted)]', textContent: p.name }),
      ],
    );
    // 自定义风格：右下角挂 ✕ 删除（阻止冒泡以免触发选择）
    if (isCustomStyleId(p.id)) {
      const del = h('button', {
        type: 'button',
        'aria-label': `删除自定义风格 ${p.name}`,
        title: '删除此自定义风格',
        class:
          'absolute -right-1.5 -bottom-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] text-[11px] leading-none text-[var(--fg-muted)] hover:bg-red-500/15 hover:text-red-500 transition-colors',
        textContent: '✕',
        onclick: (e: Event) => {
          e.stopPropagation();
          // 统一确认框替代原生 confirm（全站约定不弹原生弹窗）
          void confirmDialog(`确定删除${p.name}吗？此操作不可撤销。`, {
            title: '删除自定义风格',
            danger: true,
            confirmText: '删除',
          }).then((okDel) => {
            if (!okDel) return;
            removeCustomStyle(p.id);
            // 若删的是当前选中的外观，回退默认预设
            if (isCurrentPreset(p.config)) {
              applyPreset(STYLE_PRESETS[0]!.config);
            }
            rebuildPresets();
          });
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
  const halfBlockChk = checkbox(
    '半块高细节（▀ 真彩双色，垂直分辨率翻倍）',
    state.cfg.halfBlock,
    (v) => {
      state.cfg.halfBlock = v;
      if (v) state.cfg.aspectRatio = aspectRatioForHalfBlock(true); // 联动重设
      persist();
      rerenderPreview();
      updateParamReadouts();
    },
  );
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
  const charsetSel = select(
    '字符集',
    CHARSET_PRESETS.map((c) => ({ value: c.chars, label: c.name })),
    state.cfg.charset,
    (v) => {
      state.cfg.charset = v;
      // 字符集只在纯字符灰度模式生效（半块模式用 ▀+双色，不读 charset）。
      // 彩色+半块时改字符集无反应，故自动切回单色灰度：取消彩色 → 联动取消半块。
      if (state.cfg.colorMode) {
        state.cfg.colorMode = false;
        state.cfg.halfBlock = false;
        state.cfg.aspectRatio = aspectRatioForHalfBlock(false);
        colorModeChk.input.checked = false;
        halfBlockChk.input.disabled = true;
        halfBlockChk.input.checked = false;
      }
      persist();
      rerenderPreview();
    },
  );
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
  const terminalSel = select(
    '终端类型',
    TERMINAL_METAS.map((t) => ({ value: t.id, label: t.name })),
    state.cfg.terminal,
    (v) => {
      state.cfg.terminal = v as StyleConfig['terminal'];
      persist();
      rerenderPreview();
    },
  );
  const titleInput = h('input', {
    type: 'text',
    class:
      'w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--fg)]',
    value: state.cfg.title,
    oninput: () => {
      state.cfg.title = titleInput.value;
      persist();
      rerenderPreview();
    },
  });
  const scanChk = checkbox('扫描线', state.cfg.crtScanlines, (v) => {
    state.cfg.crtScanlines = v;
    persist();
    rerenderPreview();
  });
  const glowChk = checkbox('辉光', state.cfg.crtGlow, (v) => {
    state.cfg.crtGlow = v;
    persist();
    rerenderPreview();
  });
  const curveChk = checkbox('屏幕弧度', state.cfg.crtCurve, (v) => {
    state.cfg.crtCurve = v;
    persist();
    rerenderPreview();
  });
  const frameChk = checkbox('显示外框', state.cfg.showFrame, (v) => {
    state.cfg.showFrame = v;
    persist();
    rerenderPreview();
  });

  function updateParamReadouts(): void {
    widthSlider.set(state.cfg.width);
    contrastSlider.set(state.cfg.contrast);
    brightnessSlider.set(state.cfg.brightness);
    halfBlockChk.input.checked = state.cfg.halfBlock;
    halfBlockChk.input.disabled = !state.cfg.colorMode;
    colorModeChk.input.checked = state.cfg.colorMode;
    invertChk.input.checked = state.cfg.invert;
    // halfBlock 变化会影响找字游戏提示行显隐（灰度可真隐藏，半块为显式彩蛋）
    updateFindWordDisabled();
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
    // Logo 大小滑动条 + 同字元素开关：仅文字流 + logo 勾选时显示
    const logoOptsShow = textShow && state.textLogo;
    logoSizeSlider.row.style.display = logoOptsShow ? '' : 'none';
    logoSelfChk.row.style.display = logoOptsShow ? '' : 'none';
    // 字符画参数整区：仅图片模式显示（文字流模式下完全隐藏）
    // controlsEl 在 return 时赋值，初次调用可能尚未赋值，需守护
    if (controlsEl) {
      const charParamsDetails = controlsEl.querySelector('details');
      if (charParamsDetails) charParamsDetails.style.display = imgShow ? '' : 'none';
    }
    // 找字游戏分组：仅图片模式 或 文字流 Logo 模式（有字符画网格）显示
    // findWordDetails 在下方声明，首次调用时尚未赋值，需守护
    if (findWordDetails) findWordDetails.style.display = imgShow || state.textLogo ? '' : 'none';
    // 图片专属参数
    widthSlider.row.style.display = imgShow ? '' : 'none';
    halfBlockChk.row.style.display = imgShow ? '' : 'none';
    colorModeChk.row.style.display = imgShow ? '' : 'none';
    charsetSel.row.style.display = imgShow ? '' : 'none';
    contrastSlider.row.style.display = imgShow ? '' : 'none';
    brightnessSlider.row.style.display = imgShow ? '' : 'none';
    invertChk.row.style.display = imgShow ? '' : 'none';
    // 复制 HTML 按钮：图片模式 或 文字流 logo 模式（这两种都有终端外框 + 字符画）
    const htmlShow = imgShow || state.textLogo;
    if (ctx.htmlCopyBtn) ctx.htmlCopyBtn.style.display = htmlShow ? '' : 'none';
  }

  // 初始化
  updateTabs();
  rebuildPresets();
  updateParamReadouts();
  halfBlockChk.input.disabled = !state.cfg.colorMode;
  updateModeVisibility(); // 同步调用（rAF 在后台标签页会暂停，IAB 常见）

  // —— AI 自定义风格模态（镜像 quote-card 的 openTemplateDialog）——
  // 原定义在 buildControls 内与 applyCustomStyle/rebuildPresets 共享作用域，
  // 拆至 ai-style-dialog.ts 后经参数显式传入 applyCustomStyle / persist。
  const { openStyleDialog } = createAiStyleDialog({ applyCustomStyle, persist });

  // —— 找字游戏分组（find-word-panel.ts 构建，details 回填上方前向声明）——
  const findWordPanel = buildFindWordPanel(ctx);
  findWordDetails = findWordPanel.details;
  updateFindWordDisabled = findWordPanel.updateFindWordDisabled;

  controlsEl = h('div', { class: 'space-y-5' }, [
    tabBar,
    // 图片输入
    h('div', { class: 'space-y-2' }, [
      h('div', { class: 'text-sm font-medium text-[var(--fg)]' }, ['输入']),
      dropzone,
      fileInput,
      textArea,
      logoChk.row,
      logoSizeSlider.row,
      logoSelfChk.row,
    ]),
    // 风格预设
    h('div', { class: 'space-y-2' }, [
      h('div', { class: 'flex items-center justify-between' }, [
        h('span', { class: 'text-sm font-medium text-[var(--fg)]', textContent: '风格预设' }),
        h('button', {
          type: 'button',
          title: '用 AI 生成自定义风格：描述风格 → 生成提示词 → 粘贴 AI 返回的 JSON → 保存',
          'aria-label': '用 AI 生成自定义风格',
          class:
            'inline-flex shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
          textContent: '💡',
          onclick: () => openStyleDialog(),
        }),
      ]),
      presetGrid,
    ]),
    // 字符画参数（默认展开；文字流模式下整区隐藏）
    h('details', { open: true, class: 'group' }, [
      h('summary', {
        class:
          'cursor-pointer select-none text-sm font-medium text-[var(--fg)] marker:text-[var(--fg-muted)] marker:no-underline',
        textContent: '字符画参数',
      }),
      h('div', { class: 'mt-3 space-y-3' }, [
        widthSlider.row,
        colorModeChk.row,
        halfBlockChk.row,
        charsetSel.row,
        contrastSlider.row,
        brightnessSlider.row,
        invertChk.row,
      ]),
    ]),
    // 找字游戏（默认折叠；纯文字流模式整组隐藏）
    findWordDetails,
    // 终端外观（默认折叠）
    h('details', { class: 'group' }, [
      h('summary', {
        class:
          'cursor-pointer select-none text-sm font-medium text-[var(--fg)] marker:text-[var(--fg-muted)] marker:no-underline',
        textContent: '终端外观',
      }),
      h('div', { class: 'mt-3 space-y-3' }, [
        terminalSel.row,
        h('div', { class: 'space-y-1' }, [
          h('label', { class: 'text-xs text-[var(--fg-muted)]', textContent: '标题栏文字' }),
          titleInput,
        ]),
        h('div', { class: 'grid grid-cols-2 gap-2' }, [
          scanChk.row,
          glowChk.row,
          curveChk.row,
          frameChk.row,
        ]),
      ]),
    ]),
  ]);
  // 元素已构造，controlsEl 已赋值；再调一次确保字符画参数区按当前模式显隐
  updateModeVisibility();
  return controlsEl;
}
