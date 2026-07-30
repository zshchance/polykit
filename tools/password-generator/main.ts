import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { createCopyButton } from '@/core/components/CopyButton';
import { on } from '@/core/utils/dom';
import {
  generatePassword,
  estimateStrengthBits,
  DEFAULT_OPTIONS,
  type PasswordOptions,
} from './generator';

initTheme();

function renderPasswordGenerator() {
  const { content } = renderToolLayout(document.getElementById('app')!, '密码生成器');

  // —— 状态 ——
  const state: PasswordOptions = { ...DEFAULT_OPTIONS };
  let currentPassword = '';

  // —— 结果显示区 ——
  const output = h('output', {
    class:
      'block w-full break-all rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4 font-mono text-lg min-h-14',
    textContent: '点击生成',
  });

  const strengthLabel = h('span', { class: 'text-sm text-[var(--fg-muted)]', textContent: '' });

  function refreshStrength() {
    const bits = estimateStrengthBits(state);
    let text = '弱';
    let color = '#ef4444';
    if (bits >= 128) {
      text = '极强';
      color = '#22c55e';
    } else if (bits >= 80) {
      text = '强';
      color = '#84cc16';
    } else if (bits >= 50) {
      text = '中等';
      color = '#eab308';
    }
    strengthLabel.textContent = `强度：${text}（约 ${bits} 位熵）`;
    strengthLabel.style.color = color;
  }

  function generate() {
    try {
      currentPassword = generatePassword(state);
      output.textContent = currentPassword;
      output.classList.remove('text-[var(--fg-muted)]');
    } catch (e) {
      output.textContent = (e as Error).message;
      output.classList.add('text-[var(--fg-muted)]');
    }
    refreshStrength();
  }

  // —— 复选框配置 ——
  const checkboxes: { key: keyof Pick<PasswordOptions, 'useLower' | 'useUpper' | 'useDigits' | 'useSymbols'>; label: string; checked: boolean }[] = [
    { key: 'useLower', label: '小写字母 a-z', checked: state.useLower },
    { key: 'useUpper', label: '大写字母 A-Z', checked: state.useUpper },
    { key: 'useDigits', label: '数字 0-9', checked: state.useDigits },
    { key: 'useSymbols', label: '符号 !@#$', checked: state.useSymbols },
  ];

  const checkboxWrap = h('div', { class: 'grid grid-cols-2 gap-2' }, [
    ...checkboxes.map((c) =>
      h('label', { class: 'flex items-center gap-2 text-sm cursor-pointer' }, [
        h('input', {
          type: 'checkbox',
          class: 'h-4 w-4 accent-[var(--accent)]',
          checked: c.checked,
          onchange: (e) => {
            state[c.key] = (e.target as HTMLInputElement).checked;
          },
        }),
        c.label,
      ]),
    ),
  ]);

  // —— 长度滑块 ——
  const lengthValue = h('span', { class: 'font-mono', textContent: String(state.length) });
  const lengthInput = h('input', {
    type: 'range',
    min: '4',
    max: '64',
    value: String(state.length),
    class: 'w-full accent-[var(--accent)]',
    onchange: (e) => {
      state.length = Number((e.target as HTMLInputElement).value);
      lengthValue.textContent = String(state.length);
    },
  });

  // —— "每类至少一个"开关 ——
  const requireEachInput = h('input', {
    type: 'checkbox',
    class: 'h-4 w-4 accent-[var(--accent)]',
    checked: state.requireEachEnabled,
    onchange: (e) => {
      state.requireEachEnabled = (e.target as HTMLInputElement).checked;
    },
  });

  // —— 按钮 ——
  const generateBtn = h(
    'button',
    {
      type: 'button',
      class:
        'rounded-md bg-[var(--accent)] px-4 py-2 text-[var(--accent-fg)] font-medium hover:opacity-90 transition-opacity',
      textContent: '生成密码',
      onclick: generate,
    },
    [],
  );

  // —— 组装 ——
  content.append(
    h('div', { class: 'max-w-2xl space-y-6' }, [
      // 结果区
      h('div', { class: 'space-y-2' }, [
        output,
        h('div', { class: 'flex items-center justify-between' }, [
          strengthLabel,
          createCopyButton(() => currentPassword),
        ]),
      ]),
      // 长度
      h('div', { class: 'space-y-1' }, [
        h('div', { class: 'flex justify-between text-sm' }, [
          h('label', { textContent: '长度', htmlFor: 'len' }),
          lengthValue,
        ]),
        lengthInput,
      ]),
      // 字符类型
      h('div', { class: 'space-y-2' }, [
        h('p', { class: 'text-sm font-medium', textContent: '字符类型' }),
        checkboxWrap,
      ]),
      // 每类至少一个
      h('label', { class: 'flex items-center gap-2 text-sm cursor-pointer' }, [
        requireEachInput,
        '每类字符至少出现一个',
      ]),
      // 操作
      generateBtn,
    ]),
  );

  // 任意选项变化时自动重新生成，保持结果与选项一致
  on(checkboxWrap, ['change'], generate);
  lengthInput.addEventListener('change', generate);
  requireEachInput.addEventListener('change', generate);

  // 初始生成一个
  generate();
}

renderPasswordGenerator();
