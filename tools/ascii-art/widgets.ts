/**
 * 通用控件工厂（保持控制面板模块简洁）。
 *
 * 职责：离散/连续滑块、复选框、下拉选择等无状态小控件的构造。
 * 依赖方向：仅依赖 core 的 h 元素工厂，不依赖工具内任何状态 —— 从 main.ts 原样搬出。
 */

import { h } from '@/core/components/element';

interface SliderControl {
  row: HTMLElement;
  set: (v: number) => void;
}

/** 离散值滑块（字符宽）。 */
function slider(
  label: string,
  value: number,
  options: number[],
  onChange: (v: number) => void,
): SliderControl & { input: HTMLInputElement } {
  const readout = h('span', {
    class: 'text-xs text-[var(--fg-muted)] tabular-nums',
    textContent: String(value),
  });
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
    row,
    input,
    set: (v: number) => {
      input.value = String(v);
      readout.textContent = String(v);
    },
  };
}

/** 连续值滑块（对比度/亮度）。 */
function rangeSlider(
  label: string,
  value: number,
  min: number,
  max: number,
  onChange: (v: number) => void,
): SliderControl {
  const readout = h('span', {
    class: 'text-xs text-[var(--fg-muted)] tabular-nums',
    textContent: String(value),
  });
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
    set: (v: number) => {
      input.value = String(v);
      readout.textContent = String(v);
    },
  };
}

interface CheckboxControl {
  row: HTMLElement;
  input: HTMLInputElement;
}

function checkbox(
  label: string,
  checked: boolean,
  onChange: (v: boolean) => void,
): CheckboxControl {
  const input = h('input', {
    type: 'checkbox',
    class: 'accent-[var(--accent)]',
  }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const row = h(
    'label',
    { class: 'flex items-center gap-2 text-xs text-[var(--fg)] cursor-pointer' },
    [input, h('span', { textContent: label })],
  );
  return { row, input };
}

interface SelectControl {
  row: HTMLElement;
  set: (v: string) => void;
}

function select(
  label: string,
  options: { value: string; label: string }[],
  value: string,
  onChange: (v: string) => void,
): SelectControl {
  const sel = h(
    'select',
    {
      class:
        'w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs text-[var(--fg)]',
      onchange: () => onChange(sel.value),
    },
    options.map((o) => h('option', { value: o.value, textContent: o.label })),
  ) as HTMLSelectElement;
  sel.value = value;
  const row = h('div', { class: 'space-y-1' }, [
    h('label', { class: 'text-xs text-[var(--fg-muted)]', textContent: label }),
    sel,
  ]);
  return {
    row,
    set: (v: string) => {
      sel.value = v;
    },
  };
}

export { slider, rangeSlider, checkbox, select };
export type { SliderControl, CheckboxControl, SelectControl };
