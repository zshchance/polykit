/**
 * 找字游戏控制面板（独立 details 分组，默认折叠）。
 *
 * 职责：隐藏文字 / 随机种子 / 点阵开关 / 字符大小 / 分布 / 杂色 / 仅替换非空白等控件，
 * 以及开关 off 时分组内控件的禁用态（opacity + pointer-events）。
 *
 * 依赖方向：依赖 core 的 h、widgets 的 checkbox/rangeSlider、find-word 的 randomSeed；
 * 由 controls.ts 在原 buildControls 的同一时点调用构建，并通过 ControlsContext
 * 读写共享状态（原为 buildControls 闭包变量，语义不变）。
 */

import { h } from '@/core/components/element';
import { checkbox, rangeSlider } from './widgets';
import { randomSeed } from './find-word';
import type { ControlsContext } from './controls-context';

export interface FindWordPanel {
  /** 找字游戏 <details> 分组（controls 装配进面板，updateModeVisibility 按模式显隐）。 */
  details: HTMLElement;
  /** 开关 off → 分组内其余控件禁用；点阵关 → 隐藏字符大小；提示行按半块模式显隐。 */
  updateFindWordDisabled(): void;
}

export function buildFindWordPanel(ctx: ControlsContext): FindWordPanel {
  const { state, persist, rerenderPreview, updatePlainTextHint } = ctx;
  // —— 找字游戏分组（独立 details，默认折叠）——
  // 开关 off 时，分组内其余控件整体禁用（opacity + pointer-events）。
  // 半块真彩模式下隐藏字为显式彩蛋 → 提示行可见。
  // findWordContent/findWordHint：先声明后赋值（updateFindWordDisabled 内有未赋值守卫，
  // 与原 buildControls 内的 TDZ 前向声明语义一致）
  let findWordContent: HTMLElement;
  let findWordHint: HTMLElement;
  // eslint-disable-next-line prefer-const -- TDZ 前向声明（函数定义在赋值前），不能合并声明
  findWordHint = h('p', {
    class: 'text-[11px] text-[var(--fg-muted)]',
    textContent: '💡 半块真彩模式下隐藏字为显式彩蛋，关闭「彩色」切灰度可真隐藏',
  });
  // eslint-disable-next-line prefer-const -- TDZ 前向声明（函数定义在赋值前），不能合并声明
  findWordContent = h('div', { class: 'mt-3 space-y-3' });

  const fwEnabledChk = checkbox(
    '开启找字游戏（把一句话藏进字符画）',
    state.findWord.enabled,
    (v) => {
      state.findWord.enabled = v;
      persist();
      updateFindWordDisabled();
      rerenderPreview();
    },
  );
  const fwText = h('textarea', {
    rows: 2,
    class:
      'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
    placeholder: '一句话，每个字按顺序藏进画面（如：我爱字符画）',
    oninput: () => {
      state.findWord.text = fwText.value;
      persist();
      updatePlainTextHint();
      rerenderPreview();
    },
  });
  fwText.value = state.findWord.text;
  const fwSeedInput = h('input', {
    type: 'text',
    class:
      'w-20 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs font-mono text-[var(--fg)] outline-none focus:border-[var(--accent)]',
    value: state.findWord.seed,
    onchange: () => {
      const v = fwSeedInput.value.trim();
      state.findWord.seed = v || randomSeed();
      fwSeedInput.value = state.findWord.seed;
      persist();
      rerenderPreview();
    },
  });
  const fwDice = h('button', {
    type: 'button',
    title: '随机一个种子（同种子→同位置）',
    'aria-label': '随机种子',
    class:
      'inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-sm text-[var(--fg-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors',
    textContent: '🎲',
    onclick: () => {
      state.findWord.seed = randomSeed();
      fwSeedInput.value = state.findWord.seed;
      persist();
      rerenderPreview();
    },
  });
  // 点阵字符开关：true=每字栅格化成 █ 点阵；false=每字作为单个字符（全角压缩）。
  const fwDotMatrixChk = checkbox(
    '点阵字符（关闭则每字单个字符植入）',
    state.findWord.dotMatrix,
    (v) => {
      state.findWord.dotMatrix = v;
      persist();
      updateFindWordDisabled();
      rerenderPreview();
    },
  );
  const fwGlyphSlider = rangeSlider('字符大小', state.findWord.glyphSize, 4, 16, (v) => {
    state.findWord.glyphSize = v;
    persist();
    rerenderPreview();
  });
  fwGlyphSlider.row
    .querySelector('label')
    ?.append(document.createTextNode('（行数，显示时纵向拉长）'));
  const fwSpreadSlider = rangeSlider('分布程度', state.findWord.spread, 0, 100, (v) => {
    state.findWord.spread = v;
    persist();
    rerenderPreview();
  });
  fwSpreadSlider.row
    .querySelector('label')
    ?.append(document.createTextNode('（0 紧挨 / 100 分散）'));
  const fwColorSlider = rangeSlider('杂色', state.findWord.colorContrast, 0, 100, (v) => {
    state.findWord.colorContrast = v;
    persist();
    rerenderPreview();
  });
  fwColorSlider.row
    .querySelector('label')
    ?.append(document.createTextNode('（0 融入 / 100 对比）'));

  // 仅替换非空白字符：隐藏字只盖到原 Cell 非空的格子，融入图片实际内容
  const fwNonBlankChk = checkbox(
    '仅替换非空白（隐藏字只盖到画面已有的字符上）',
    state.findWord.nonBlankOnly === true,
    (v) => {
      state.findWord.nonBlankOnly = v;
      persist();
      rerenderPreview();
    },
  );

  findWordContent.append(
    // 注意：开启开关不放这里——开关须始终可点击（disabled 状态用 opacity+pointer-events
    // 遮住 findWordContent，开关在外层才不会被挡）
    h('div', { class: 'space-y-1' }, [
      h('label', { class: 'text-xs text-[var(--fg-muted)]', textContent: '隐藏文字' }),
      fwText,
    ]),
    h('div', { class: 'space-y-1' }, [
      h('label', { class: 'text-xs text-[var(--fg-muted)]', textContent: '随机种子' }),
      h('div', { class: 'flex items-center gap-2' }, [fwSeedInput, fwDice]),
    ]),
    fwDotMatrixChk.row,
    fwGlyphSlider.row,
    fwSpreadSlider.row,
    fwColorSlider.row,
    fwNonBlankChk.row,
    findWordHint,
  );

  /** 开关 off → 分组内其余控件禁用；点阵关 → 隐藏字符大小；提示行按半块模式显隐。 */
  function updateFindWordDisabled(): void {
    // 首次同步调用时 findWordContent/Hint 尚未赋值（let undefined），需守护
    if (!findWordContent || !findWordHint) return;
    const disabled = !state.findWord.enabled;
    findWordContent.style.opacity = disabled ? '0.5' : '';
    findWordContent.style.pointerEvents = disabled ? 'none' : '';
    // 字符大小仅点阵模式有意义（非点阵每字单字符，无大小概念）→ 关点阵时隐藏
    fwGlyphSlider.row.style.display = state.findWord.dotMatrix ? '' : 'none';
    // 提示行：仅半块真彩模式显示（灰度模式可真隐藏，无需提示）
    findWordHint.style.display = state.cfg.halfBlock ? '' : 'none';
    // 纯文本错位提示（非点阵 + 含全角时显示）
    updatePlainTextHint();
  }
  updateFindWordDisabled();

  const findWordDetails = h('details', { class: 'group' }, [
    h('summary', {
      class:
        'cursor-pointer select-none text-sm font-medium text-[var(--fg)] marker:text-[var(--fg-muted)] marker:no-underline',
      textContent: '🔍 找字游戏',
    }),
    // 开关放在 findWordContent 外层，始终可点击（disabled 仅遮 content 区）
    h('div', { class: 'mt-3' }, [fwEnabledChk.row]),
    findWordContent,
  ]);

  return { details: findWordDetails, updateFindWordDisabled };
}
