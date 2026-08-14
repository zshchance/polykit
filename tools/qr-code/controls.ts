// 控制面板：内容输入、风格预设（含 AI 风格的套用/删除）、码点/定位眼形状、纠错等级、
// 前景/背景色、Logo 形状。预设套用后的各选择器视觉同步（syncControlsFromCfg）也在本模块。
// 依赖方向：依赖 types 与 custom-styles；state（cfg + activeDotEffect 可写引用）、
// scheduleDraw/persist/showStatus 由 main 注入；applyStyle 对外暴露给 style-dialog
// （保存 AI 风格后立即套用）与 upload-panel（经 main 转交 renderLevelRow/logoFitField/textInput）。

import { h } from '@/core/components/element';
import {
  DOT_SHAPES,
  EYE_SHAPES,
  ERROR_LEVELS,
  PRESETS,
  type QrConfig,
  type DotShape,
  type EyeShape,
  type LogoFit,
} from './types';
import {
  loadCustomStyles,
  removeCustomStyle,
  compileDotEffect,
  type DotEffectFn,
} from './custom-styles';

export interface ControlsPanelDeps {
  /** cfg 与码点叠加钩子的可写引用（activeDotEffect 在套用/删除风格时写入，主渲染读取） */
  state: { cfg: QrConfig; activeDotEffect: DotEffectFn | null };
  scheduleDraw(): void;
  persist(): void;
  showStatus(msg: string, isError?: boolean): void;
}

export interface ControlsPanel {
  textInput: HTMLTextAreaElement;
  dotRow: HTMLElement;
  eyeRow: HTMLElement;
  levelContainer: HTMLElement;
  fgInput: HTMLElement;
  bgInput: HTMLElement;
  /** 「Logo 形状」字段（嵌入 upload-panel 的 Logo 区，预设套用后由本模块同步重渲） */
  logoFitField: HTMLElement;
  /** 预设行容器（main 装配进「一键套用风格」区） */
  presetRow: HTMLElement;
  /** 套用一个预设（内置或 AI 风格）：覆盖常规字段 + 挂/清码点钩子 + 同步 + 重绘 */
  applyStyle(id: string, apply: Partial<QrConfig>, dotEffect: DotEffectFn | null): void;
  renderLevelRow(): void;
  rebuildDotRow(): void;
  rebuildEyeRow(): void;
  renderPresetRow(): void;
  renderLogoFitRow(): void;
}

export function createControlsPanel(deps: ControlsPanelDeps): ControlsPanel {
  const { state, scheduleDraw, persist, showStatus } = deps;
  const cfg = state.cfg;

  // 1. 内容输入
  const textInput = h('textarea', {
    class:
      'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
    rows: 3,
    placeholder: '输入网址或文本，如 https://example.com',
  }) as HTMLTextAreaElement;
  textInput.value = cfg.text;
  textInput.addEventListener('input', () => {
    cfg.text = textInput.value;
    scheduleDraw();
    persist();
  });

  // 2. 码点形状选择（容器可重建，便于预设套用后同步视觉态）
  const dotRow = h('div', { class: 'flex flex-wrap gap-2' });
  function rebuildDotRow(): void {
    dotRow.replaceChildren(
      ...shapeRow(DOT_SHAPES, cfg.dotShape, (id) => {
        cfg.dotShape = id as DotShape;
        activePresetId = null;
        cfg.activeStyleId = null;
        rebuildDotRow();
        renderPresetRow();
        scheduleDraw();
        persist();
      }).childNodes,
    );
  }

  // 3. 定位眼形状
  const eyeRow = h('div', { class: 'flex flex-wrap gap-2' });
  function rebuildEyeRow(): void {
    eyeRow.replaceChildren(
      ...shapeRow(EYE_SHAPES, cfg.eyeShape, (id) => {
        cfg.eyeShape = id as EyeShape;
        activePresetId = null;
        cfg.activeStyleId = null;
        rebuildEyeRow();
        renderPresetRow();
        scheduleDraw();
        persist();
      }).childNodes,
    );
  }

  // 4. 纠错等级 —— 用 levelContainer + renderLevelRow（定义在下方，需在 Logo 自动升级后重渲）
  //    此处先不创建，统一交给下方的 levelContainer。

  // 5. 前景 / 背景色（保留 picker/text 引用，便于预设套用后同步）
  let fgPicker: HTMLInputElement;
  let fgText: HTMLInputElement;
  let bgPicker: HTMLInputElement;
  let bgText: HTMLInputElement;
  const fgInput = colorInput(
    '码点颜色',
    cfg.fgColor,
    (v) => {
      cfg.fgColor = v;
      activePresetId = null;
      cfg.activeStyleId = null;
      renderPresetRow();
      scheduleDraw();
      persist();
    },
    (p, t) => {
      fgPicker = p;
      fgText = t;
    },
  );
  const bgInput = colorInput(
    '背景颜色',
    cfg.bgColor,
    (v) => {
      cfg.bgColor = v;
      activePresetId = null;
      cfg.activeStyleId = null;
      renderPresetRow();
      scheduleDraw();
      persist();
    },
    (p, t) => {
      bgPicker = p;
      bgText = t;
    },
  );

  // 纠错行需要在 Logo 自动升级后重渲高亮：用一个固定容器，重渲时换其内容
  const levelContainer = h('div', { class: 'flex flex-wrap gap-2' });
  function renderLevelRow(): void {
    levelContainer.replaceChildren(
      ...ERROR_LEVELS.map((lv) =>
        h('button', {
          type: 'button',
          'aria-pressed': String(lv.id === cfg.errorLevel),
          class: [
            'rounded-md px-3 py-1.5 text-sm border transition-all duration-150',
            lv.id === cfg.errorLevel
              ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)]'
              : 'bg-[var(--bg-elevated)] text-[var(--fg-muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
          ].join(' '),
          title: lv.desc,
          textContent: lv.name,
          onclick: () => {
            cfg.errorLevel = lv.id;
            renderLevelRow();
            scheduleDraw();
            persist();
          },
        }),
      ),
    );
  }

  // 预设模板：点击即套用（覆盖码点/眼/颜色/Logo形状），不动内容与纠错
  // AI 风格（自定义）追加在内置预设之后，带 ⭐ 前缀和删除按钮，额外携带码点叠加钩子。
  const presetRow = h('div', { class: 'flex flex-wrap gap-2' });
  let activePresetId: string | null = cfg.activeStyleId;
  let customStyles = loadCustomStyles();

  /** 套用一个预设（内置或自定义通用）：覆盖常规字段 + 同步控件 + 重绘。
   *  dotEffect 传 null 表示清除码点钩子（内置预设无钩子）；传函数表示挂载（AI 风格）。 */
  function applyStyle(id: string, apply: Partial<QrConfig>, dotEffect: DotEffectFn | null): void {
    activePresetId = id;
    cfg.activeStyleId = id;
    Object.assign(cfg, apply);
    state.activeDotEffect = dotEffect;
    syncControlsFromCfg();
    renderPresetRow();
    scheduleDraw();
    persist();
  }

  function renderPresetRow(): void {
    // 自定义列表每次重读，确保 AI 新增/删除后实时反映
    customStyles = loadCustomStyles();
    const items: Array<{
      id: string;
      name: string;
      swatch: [string, string];
      isCustom: boolean;
    }> = [
      ...PRESETS.map((p) => ({ id: p.id, name: p.name, swatch: p.swatch, isCustom: false })),
      ...customStyles.map((s) => ({
        id: s.id,
        name: '⭐ ' + s.name,
        swatch: s.swatch,
        isCustom: true,
      })),
    ];
    presetRow.replaceChildren(
      ...items.map((it) => {
        const isActive = it.id === activePresetId;
        // 外层用 div 容器（避免 button 嵌套 button 的非法 DOM）：
        // 内含一个套用主体 button + （仅 AI 风格）一个独立删除 button。
        const wrapper = h('div', {
          class: [
            'group flex items-center gap-0.5 rounded-lg border px-2.5 py-1.5 text-xs transition-all duration-150',
            isActive
              ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]/40'
              : 'border-[var(--border)] hover:border-[var(--accent)]',
          ].join(' '),
        });
        const main = h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(isActive),
            title: it.name,
            class: 'flex items-center gap-2 bg-transparent outline-none',
            onclick: () => {
              if (it.isCustom) {
                // AI 风格：套用 apply + 挂载其码点钩子（编译失败则降级为仅配色）
                const style = customStyles.find((s) => s.id === it.id);
                if (!style) return;
                let effect: DotEffectFn | null = null;
                if (style.dotEffectCode) {
                  try {
                    effect = compileDotEffect(style.dotEffectCode);
                  } catch {
                    showStatus('该风格的码点效果代码有误，已仅套用配色', true);
                  }
                }
                applyStyle(style.id, style.apply, effect);
              } else {
                // 内置预设：套用 apply + 清除码点钩子
                const p = PRESETS.find((x) => x.id === it.id);
                if (!p) return;
                applyStyle(p.id, p.apply, null);
              }
            },
          },
          [
            // 色条预览：前→背两小格
            h(
              'span',
              {
                class: 'flex overflow-hidden rounded border border-[var(--border)]',
                style: 'width:22px;height:14px;',
              },
              [
                h('span', { style: `flex:1;background:${it.swatch[0]};` }),
                h('span', { style: `flex:1;background:${it.swatch[1]};` }),
              ],
            ),
            h('span', { class: 'text-[var(--fg)]', textContent: it.name }),
          ],
        );
        wrapper.append(main);
        // AI 风格额外挂一个删除小 ✕（独立 button，点 ✕ 不触发套用）
        if (it.isCustom) {
          const del = h('button', {
            type: 'button',
            'aria-label': `删除风格 ${it.name}`,
            title: '删除该 AI 风格',
            class:
              'ml-0.5 rounded text-[var(--fg-muted)] hover:text-[var(--holiday-legal)] transition-colors text-sm leading-none',
            textContent: '✕',
            onclick: (e: Event) => {
              e.stopPropagation();
              customStyles = removeCustomStyle(it.id);
              // 若删的正是激活项，清掉钩子与高亮
              if (activePresetId === it.id) {
                activePresetId = null;
                cfg.activeStyleId = null;
                state.activeDotEffect = null;
                persist();
                scheduleDraw();
              }
              renderPresetRow();
            },
          });
          wrapper.append(del);
        }
        return wrapper;
      }),
    );
  }

  // Logo 形状选择：圆角（默认）/ 直角
  const logoFitRow = h('div', { class: 'flex gap-2' });
  function renderLogoFitRow(): void {
    logoFitRow.replaceChildren(
      ...[
        { id: 'rounded' as LogoFit, name: '圆角（推荐）' },
        { id: 'square' as LogoFit, name: '直角' },
      ].map((it) =>
        h('button', {
          type: 'button',
          'aria-pressed': String(it.id === cfg.logoFit),
          class: [
            'rounded-md px-3 py-1.5 text-xs border transition-all duration-150',
            it.id === cfg.logoFit
              ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)]'
              : 'bg-[var(--bg-elevated)] text-[var(--fg-muted)] border-[var(--border)] hover:border-[var(--accent)]',
          ].join(' '),
          textContent: it.name,
          onclick: () => {
            cfg.logoFit = it.id;
            renderLogoFitRow();
            scheduleDraw();
            persist();
          },
        }),
      ),
    );
  }

  /** 套用预设后，把各独立选择器（点/眼/颜色）的视觉态同步到 cfg 的新值 */
  function syncControlsFromCfg(): void {
    // 重新构建点/眼行（闭包 selectedId 已是参数，重渲染即可）
    rebuildDotRow();
    rebuildEyeRow();
    // 颜色输入框
    if (fgPicker) fgPicker.value = cfg.fgColor || '#ffffff';
    if (fgText) fgText.value = cfg.fgColor;
    if (bgPicker) bgPicker.value = cfg.bgColor || '#ffffff';
    if (bgText) bgText.value = cfg.bgColor;
    renderLogoFitRow();
  }

  const logoFitField = field('Logo 形状', logoFitRow);

  return {
    textInput,
    dotRow,
    eyeRow,
    levelContainer,
    fgInput,
    bgInput,
    logoFitField,
    presetRow,
    applyStyle,
    renderLevelRow,
    rebuildDotRow,
    rebuildEyeRow,
    renderPresetRow,
    renderLogoFitRow,
  };
}

/** 形状/等级选择行：一组胶囊按钮，选中高亮 */
function shapeRow(
  items: { id: string; name: string }[],
  selectedId: string,
  onSelect: (id: string) => void,
): HTMLElement {
  const wrap = h('div', { class: 'flex flex-wrap gap-2' });
  function render(): void {
    wrap.replaceChildren(
      ...items.map((it) =>
        h('button', {
          type: 'button',
          'aria-pressed': String(it.id === selectedId),
          class: [
            'rounded-md px-3 py-1.5 text-sm border transition-all duration-150',
            it.id === selectedId
              ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)]'
              : 'bg-[var(--bg-elevated)] text-[var(--fg-muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
          ].join(' '),
          textContent: it.name,
          onclick: () => {
            selectedId = it.id; // 闭包变量更新，下次 render 用新值
            render();
            onSelect(it.id);
          },
        }),
      ),
    );
  }
  render();
  return wrap;
}

/**
 * 颜色输入：色块 + hex 文本框。
 * onReady 回调把内部 picker/text 元素交出，便于预设套用后同步显示值。
 */
function colorInput(
  label: string,
  value: string,
  onChange: (v: string) => void,
  onReady?: (picker: HTMLInputElement, text: HTMLInputElement) => void,
): HTMLElement {
  const picker = h('input', {
    type: 'color',
    value: value || '#ffffff',
    class: 'h-8 w-10 cursor-pointer rounded border border-[var(--border)] bg-transparent',
  }) as HTMLInputElement;
  const text = h('input', {
    type: 'text',
    value,
    placeholder: '#000000 或留空透明',
    class:
      'w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 font-mono text-xs text-[var(--fg)] outline-none focus:border-[var(--accent)]',
  }) as HTMLInputElement;
  picker.addEventListener('input', () => {
    text.value = picker.value;
    onChange(picker.value);
  });
  text.addEventListener('change', () => {
    const v = text.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v) || v === '') {
      if (v) picker.value = v;
      onChange(v);
    } else {
      text.value = value; // 非法还原
    }
  });
  if (onReady) onReady(picker, text);
  return h('div', { class: 'space-y-1' }, [
    h('label', {
      class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]',
      textContent: label,
    }),
    h('div', { class: 'flex items-center gap-2' }, [picker, text]),
  ]);
}

/** 带 label 的小字段 */
export function field(label: string, control: HTMLElement): HTMLElement {
  return h('div', { class: 'space-y-1.5' }, [
    h('div', {
      class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]',
      textContent: label,
    }),
    control,
  ]);
}
