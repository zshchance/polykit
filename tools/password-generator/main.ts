import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { createCopyButton } from '@/core/components/CopyButton';
import { on } from '@/core/utils/dom';
import { secureRandomInt } from '@/core/utils/random';
import {
  generatePassword,
  estimateStrengthBits,
  CHARSETS,
  DEFAULT_OPTIONS,
  type PasswordOptions,
} from './generator';
import {
  loadHistory,
  addPassword,
  removePassword,
  clearHistory,
  HISTORY_MAX,
  type StoredPassword,
} from './history';

initTheme();

/** 候选字符集拼接（按当前选项），用于逐字变幻动画时取随机字符 */
function candidateChars(opts: PasswordOptions): string {
  const pools: string[] = [];
  if (opts.useLower) pools.push(CHARSETS.lower);
  if (opts.useUpper) pools.push(CHARSETS.upper);
  if (opts.useDigits) pools.push(CHARSETS.digits);
  if (opts.useSymbols) pools.push(CHARSETS.symbols);
  return pools.join('') || CHARSETS.lower;
}

function renderPasswordGenerator() {
  const { content } = renderToolLayout(document.getElementById('app')!, '密码生成器');

  // —— 状态 ——
  const state: PasswordOptions = { ...DEFAULT_OPTIONS };
  let currentPassword = '';
  // 动画相关定时器（统一管理，便于取消重入）
  let scrambleTimers: number[] = [];

  function clearScrambleTimers(): void {
    scrambleTimers.forEach((t) => {
      clearTimeout(t);
      clearInterval(t);
    });
    scrambleTimers = [];
  }

  // —— 结果显示区（output 内可能含每字符 span）——
  const output = h('output', {
    class:
      'block w-full break-all rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-4 font-mono text-lg min-h-14 transition-opacity',
    textContent: '点击生成',
  });

  const strengthLabel = h('span', { class: 'text-sm text-[var(--fg-muted)]', textContent: '' });

  function refreshStrength(bits?: number) {
    const b = bits ?? estimateStrengthBits(state);
    let text = '弱';
    let color = '#ef4444';
    if (b >= 128) {
      text = '极强';
      color = '#22c55e';
    } else if (b >= 80) {
      text = '强';
      color = '#84cc16';
    } else if (b >= 50) {
      text = '中等';
      color = '#eab308';
    }
    strengthLabel.textContent = `强度：${text}（约 ${b} 位熵）`;
    strengthLabel.style.color = color;
  }

  // —— 控件引用（先声明，generate / 动画在它们初始化后才会被调用）——
  let copyBtn: HTMLButtonElement;
  let generateBtn: HTMLButtonElement;
  const historyListWrap = h('div', { class: 'space-y-2' }, []);

  /** 把最终密码渲染为纯文本：所有字符同一颜色（统一 --fg，不做字符级强调色） */
  function renderFinal(value: string): void {
    output.textContent = value;
  }

  /** 动画期间禁用/恢复主要操作按钮 */
  function setControlsDisabled(disabled: boolean): void {
    if (copyBtn) copyBtn.disabled = disabled;
    if (generateBtn) generateBtn.disabled = disabled;
  }

  /** 逐字随机变幻动画：先滚乱码，再从左到右逐位锁定 */
  function playScrambleAnimation(final: string): void {
    clearScrambleTimers();
    const chars = candidateChars(state);
    const len = final.length;
    output.classList.add('scrambling');
    setControlsDisabled(true);

    // 已锁定位的下标集合
    const locked = new Set<number>();

    // 滚动乱码阶段：每帧刷新所有未锁定位的随机字符
    const rolling = window.setInterval(() => {
      const spans: HTMLElement[] = [];
      for (let i = 0; i < len; i++) {
        const ch = locked.has(i) ? final[i]! : chars[secureRandomInt(0, chars.length - 1)]!;
        spans.push(
          h(
            'span',
            { class: locked.has(i) ? 'pw-locked-char' : 'pw-rolling-char', textContent: ch },
            [],
          ),
        );
      }
      output.replaceChildren(...spans);
    }, 45);
    scrambleTimers.push(rolling);

    // 滚动约 650ms 后，开始从左到右逐位锁定（每 ~35ms 锁一位）
    const lockStart = 650;
    const lockStep = 35;
    for (let i = 0; i < len; i++) {
      const t = window.setTimeout(() => {
        locked.add(i);
      }, lockStart + i * lockStep);
      scrambleTimers.push(t);
    }

    // 全部锁定后收尾：渲染最终着色态并恢复控件
    const finishAt = lockStart + len * lockStep + 60;
    scrambleTimers.push(
      window.setTimeout(() => {
        clearInterval(rolling);
        output.classList.remove('scrambling');
        renderFinal(final);
        setControlsDisabled(false);
      }, finishAt),
    );
  }

  function generate() {
    clearScrambleTimers();
    let final: string;
    try {
      final = generatePassword(state);
    } catch (e) {
      output.replaceChildren();
      output.textContent = (e as Error).message;
      output.classList.add('text-[var(--fg-muted)]');
      currentPassword = '';
      refreshStrength(0);
      return;
    }
    currentPassword = final;
    output.classList.remove('text-[var(--fg-muted)]');
    refreshStrength();
    playScrambleAnimation(final);
    // 写入历史（用同步算出的强度，避免动画期间 state 变化）
    const items = addPassword({
      value: final,
      length: final.length,
      strengthBits: estimateStrengthBits(state),
    });
    renderHistory(items);
  }

  // —— 复选框配置 ——
  const checkboxes: {
    key: keyof Pick<PasswordOptions, 'useLower' | 'useUpper' | 'useDigits' | 'useSymbols'>;
    label: string;
    checked: boolean;
  }[] = [
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
  copyBtn = createCopyButton(() => currentPassword);
  generateBtn = h(
    'button',
    {
      type: 'button',
      class:
        'w-full rounded-md bg-[var(--accent)] px-4 py-2.5 text-[var(--accent-fg)] font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed',
      textContent: '生成密码',
      onclick: generate,
    },
    [],
  );

  // ────────── 历史记录面板 ──────────
  const historyCount = h('span', { class: 'font-mono text-[var(--fg-muted)]', textContent: '0' });
  const toggleIndicator = h('span', { class: 'text-xs', textContent: '▶' });
  let historyOpen = false;
  const historyPanel = h('div', { class: 'space-y-3' }, []);
  historyPanel.classList.add('hidden'); // 默认折叠

  const toggleBtn = h(
    'button',
    {
      type: 'button',
      class:
        'flex w-full items-center justify-between rounded-md px-2 py-2 text-sm text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--bg)] transition-colors',
      'aria-expanded': 'false',
      onclick: () => {
        historyOpen = !historyOpen;
        historyPanel.classList.toggle('hidden', !historyOpen);
        toggleBtn.setAttribute('aria-expanded', String(historyOpen));
        toggleIndicator.textContent = historyOpen ? '▼' : '▶';
      },
    },
    [h('span', {}, ['历史记录（', historyCount, '）']), toggleIndicator],
  );

  historyPanel.append(historyListWrap);

  /** 渲染历史列表（含每条快捷复制 + 删除 + 全清） */
  function renderHistory(items?: StoredPassword[]): void {
    const list = items ?? loadHistory();
    historyCount.textContent = String(list.length);
    historyListWrap.replaceChildren();

    if (list.length === 0) {
      historyListWrap.append(
        h('p', {
          class: 'py-4 text-center text-sm text-[var(--fg-muted)]',
          textContent: '还没有历史记录。',
        }),
      );
      return;
    }

    // 顶部：全部清除
    historyListWrap.append(
      h('div', { class: 'flex justify-end' }, [
        h(
          'button',
          {
            type: 'button',
            class:
              'text-xs text-[var(--fg-muted)] hover:text-red-500 transition-colors underline-offset-2 hover:underline',
            textContent: '全部清除',
            onclick: () => {
              if (confirm('确定清除全部历史记录吗？此操作不可撤销。')) {
                clearHistory();
                renderHistory([]);
              }
            },
          },
          [],
        ),
      ]),
    );

    for (const it of list) {
      historyListWrap.append(
        h('div', {
          class:
            'flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2',
        }, [
          h('code', {
            class: 'flex-1 break-all font-mono text-sm text-[var(--fg)]',
            textContent: it.value,
          }),
          // 每条快捷复制
          createCopyButton(() => it.value, '复制', '已复制 ✓'),
          // 单条删除
          h(
            'button',
            {
              type: 'button',
              'aria-label': '删除此条',
              class:
                'shrink-0 rounded-md border border-[var(--border)] px-2 py-1.5 text-sm text-[var(--fg-muted)] hover:text-red-500 hover:border-red-400 transition-colors',
              textContent: '✕',
              onclick: () => {
                renderHistory(removePassword(it.id));
              },
            },
            [],
          ),
        ]),
      );
    }

    // 底部隐私提示
    historyListWrap.append(
      h('p', {
        class: 'pt-1 text-center text-xs text-[var(--fg-muted)]',
        textContent: `仅存于本浏览器，清除浏览器数据即消失（上限 ${HISTORY_MAX} 条）`,
      }),
    );
  }

  renderHistory();

  // ────────── 组装：居中卡片 ──────────
  const card = h('div', {
    class:
      'w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-6 sm:p-8 shadow-sm space-y-6',
  }, [
    // 结果区
    h('div', { class: 'space-y-2' }, [
      h('label', {
        class: 'text-sm font-medium text-[var(--fg-muted)]',
        textContent: '生成结果',
      }),
      output,
      h('div', { class: 'flex items-center justify-between gap-2' }, [strengthLabel, copyBtn]),
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
    // 分隔
    h('div', { class: 'border-t border-[var(--border)]' }, []),
    // 历史
    toggleBtn,
    historyPanel,
  ]);

  // 外层：垂直 + 水平居中
  content.append(h('div', { class: 'flex-1 flex items-center justify-center w-full' }, [card]));

  // 任意选项变化时自动重新生成，保持结果与选项一致
  on(checkboxWrap, ['change'], generate);
  lengthInput.addEventListener('change', generate);
  requireEachInput.addEventListener('change', generate);

  // 初始生成一个
  generate();
}

renderPasswordGenerator();
