import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { createCopyButton } from '@/core/components/CopyButton';
import { copyText } from '@/core/utils/clipboard';
import { on } from '@/core/utils/dom';
import { secureRandomInt } from '@/core/utils/random';
import {
  generatePassword,
  estimateStrengthBits,
  CHARSETS,
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
import { loadOptions, saveOptions } from './settings';
import {
  buildAIPrompt,
  PROMPT_STYLES,
  type PromptStyleId,
} from './ai-prompt';

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
  // 启动时恢复上次记忆的选项（长度/字符类型等），无记忆则用默认值
  const state: PasswordOptions = loadOptions();
  let currentPassword = '';
  // 当前密码生成时的强度（用于复制时写入历史，避免复制时 state 已变化导致强度算错）
  let currentStrengthBits = 0;
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
  let refreshBtn: HTMLButtonElement;
  let generateBtn: HTMLButtonElement;
  const historyListWrap = h('div', { class: 'space-y-2' }, []);

  /** 把最终密码渲染为纯文本：所有字符同一颜色（统一 --fg，不做字符级强调色） */
  function renderFinal(value: string): void {
    output.textContent = value;
  }

  /** 动画期间禁用/恢复主要操作按钮 */
  function setControlsDisabled(disabled: boolean): void {
    if (copyBtn) copyBtn.disabled = disabled;
    if (refreshBtn) refreshBtn.disabled = disabled;
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
      currentStrengthBits = 0;
      refreshStrength(0);
      return;
    }
    currentPassword = final;
    // 记录生成时的强度，供「复制时才保存历史」使用——
    // 避免用户先调整选项再复制，导致写入历史的强度与实际密码不符。
    currentStrengthBits = estimateStrengthBits(state);
    output.classList.remove('text-[var(--fg-muted)]');
    refreshStrength(currentStrengthBits);
    playScrambleAnimation(final);
    // 注意：这里不再立即写入历史。
    // 历史只在用户点击「复制」按钮时才写入（addPassword 会按 value 去重），
    // 避免用户随手生成却没采用的密码污染历史。
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

  // —— 长度滑块 + 可点击直输数字 ——
  // 点「数字」把它替换成 <input type=number>，回车/失焦落库并重生成，Esc 还原。
  // 这样既保留滑块拖拽的直观，又允许用户直接输入想要的精确长度。
  const lengthValue = h(
    'span',
    {
      class:
        'font-mono cursor-text rounded px-1 -mx-1 select-none hover:bg-[var(--bg)] transition-colors',
      textContent: String(state.length),
      title: '点击直接输入长度（4-64）',
      tabindex: '0',
      role: 'button',
      'aria-label': '点击编辑密码长度',
    },
    [],
  );

  /** 把数字 span 替换为输入框并聚焦，供用户直接输入长度 */
  function enterLengthEdit(): void {
    if (lengthValue.parentElement && lengthValue.parentElement.querySelector('input[data-len-edit]')) {
      return; // 已在编辑态，避免重复创建
    }
    const editInput = h('input', {
      type: 'number',
      'data-len-edit': '',
      min: '4',
      max: '64',
      value: String(state.length),
      class:
        'w-16 font-mono rounded border border-[var(--accent)] bg-[var(--bg)] px-1 py-0 text-center text-[var(--fg)] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
    }) as HTMLInputElement;

    /** 落库：校验 4-64 区间，合法则更新 state + 滑块 + 重生成；不合法回退原值 */
    let committed = false; // 防止 Esc 还原后 blur 再触发一次 commit
    const commit = (): void => {
      if (committed) return;
      committed = true;
      const raw = Number(editInput.value);
      const clamped = !Number.isFinite(raw)
        ? state.length
        : Math.max(4, Math.min(64, Math.round(raw)));
      state.length = clamped;
      lengthValue.textContent = String(clamped);
      lengthInput.value = String(clamped);
      editInput.replaceWith(lengthValue);
      saveOptions(state);
      generate();
    };

    editInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        // 还原：丢弃输入，把 span 换回，不触发重生成。
        // 先置 committed 再 replaceWith，避免移除输入框触发的 blur 重新落库。
        committed = true;
        editInput.replaceWith(lengthValue);
      }
    });
    editInput.addEventListener('blur', () => commit());

    lengthValue.replaceWith(editInput);
    editInput.focus();
    editInput.select();
  }

  lengthValue.addEventListener('click', enterLengthEdit);
  lengthValue.addEventListener('keydown', (e: KeyboardEvent) => {
    // 键盘可达性：聚焦后按 Enter/Space 也进入编辑
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      enterLengthEdit();
    }
  });

  const lengthInput = h('input', {
    type: 'range',
    min: '4',
    max: '64',
    value: String(state.length),
    class: 'w-full accent-[var(--accent)]',
    // 拖拽过程中（input 事件连续触发）实时刷新数字，体验更跟手
    oninput: (e) => {
      lengthValue.textContent = String((e.target as HTMLInputElement).value);
    },
    // 拖拽结束（change）才落库 state + 重新生成，避免拖拽中途频繁生成/写存储
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
  // 主「复制」按钮：与通用 CopyButton 视觉一致，但点击成功后才会把当前密码
  // 写入历史（addPassword 按 value 去重，已存在则不重复保存、仅置顶）。
  // 这样「生成记录」只收录用户真正采用（复制走）的密码，避免随手生成却没用的密码污染历史。
  copyBtn = h(
    'button',
    {
      type: 'button',
      class:
        'inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
      textContent: '复制',
      onclick: async () => {
        const value = currentPassword;
        if (!value) return; // 当前无有效密码（如生成失败态），不复制也不保存
        const ok = await copyText(value);
        copyBtn.textContent = ok ? '已复制 ✓' : '复制失败';
        copyBtn.disabled = true;
        setTimeout(() => {
          copyBtn.textContent = '复制';
          copyBtn.disabled = false;
        }, 1500);
        // 仅在复制成功、且该密码尚未保存时才写入历史。
        // addPassword 自带 value 去重：已存在则移到最前并刷新元数据，不会产生重复条目。
        if (ok) {
          const items = addPassword({
            value,
            length: value.length,
            strengthBits: currentStrengthBits,
          });
          renderHistory(items);
        }
      },
    },
    [],
  );
  // 刷新按钮：在结果区与「复制」并排，点一下按当前设置重新生成一个密码。
  // 视觉用次要边框样式，区别于主操作色的「复制」；只重新生成，不写历史（沿用 generate 的约定）。
  refreshBtn = h(
    'button',
    {
      type: 'button',
      title: '重新生成一个密码',
      'aria-label': '重新生成密码',
      class:
        'inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
      textContent: '↻ 换一个',
      onclick: generate,
    },
    [],
  );
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

  // ────────── 💡 用 AI 生成口令（提示词生成器）──────────
  // 一条「好记优先」的辅助路径：用户描述需求/主题 → 选风格与长度 → 工具组装提示词 →
  // 复制给自己的 AI 对话（ChatGPT/豆包/DeepSeek 等）→ AI 直接返回可用口令，无需回填本程序。
  // 工具本身只生成提示词文本，不联网、不上传；AI 产出的口令会过第三方服务，强度弱于
  // 主生成器，故模态里给出安全提示：重要账号请用上面的「生成密码」（本地密码学随机）。
  let dialogEl: HTMLElement | null = null;

  function closeDialog(): void {
    if (!dialogEl) return;
    dialogEl.remove();
    dialogEl = null;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onDialogEsc);
  }
  function onDialogEsc(e: KeyboardEvent): void {
    if (e.key === 'Escape' && dialogEl) {
      e.preventDefault();
      closeDialog();
    }
  }

  /** 通用浮层壳：遮罩 + 居中卡片 + Esc/点遮罩关闭。card 由调用方构建。 */
  function mountDialog(card: HTMLElement): HTMLElement {
    const overlay = h('div', {
      class: 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4',
      onclick: (e: Event) => {
        if (e.target === overlay) closeDialog();
      },
    });
    overlay.append(card);
    document.body.append(overlay);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onDialogEsc);
    return overlay;
  }

  function openAIDialog(): void {
    if (dialogEl) closeDialog();

    // 局部状态：默认风格取第一个预设；「携带页面设置」默认开启
    let style: PromptStyleId = PROMPT_STYLES[0]!.id;
    let includePageSettings = true;

    const statusRow = h('div', { class: 'min-h-[1.25rem] text-xs' });
    function flashOk(msg: string): void {
      statusRow.textContent = '✓ ' + msg;
      statusRow.style.color = '#22c55e';
    }

    // ① 描述 / 主题
    const descInput = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows: 3,
      'aria-label': '需求或主题描述',
      placeholder: '可选。描述你的需求或主题，例如：围绕「星空」给我好记的密码；或：我要给家庭 WiFi 设密码、希望家人能记住。',
    }) as HTMLTextAreaElement;

    // ② 风格（按钮组，单选）
    const styleBtns: HTMLButtonElement[] = [];
    const styleRow = h('div', { class: 'flex flex-wrap gap-2' }, [
      ...PROMPT_STYLES.map((s) => {
        const btn = h('button', {
          type: 'button',
          'data-style': s.id,
          class:
            'rounded-md border px-3 py-1.5 text-sm transition-colors ' +
            (s.id === style
              ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]'
              : 'border-[var(--border)] bg-[var(--bg)] text-[var(--fg-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]'),
          textContent: s.name,
          title: s.hint,
          onclick: () => {
            style = s.id;
            // 切换高亮态
            for (const b of styleBtns) {
              const active = b.getAttribute('data-style') === style;
              b.className =
                'rounded-md border px-3 py-1.5 text-sm transition-colors ' +
                (active
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]'
                  : 'border-[var(--border)] bg-[var(--bg)] text-[var(--fg-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]');
            }
          },
        }) as HTMLButtonElement;
        styleBtns.push(btn);
        return btn;
      }),
    ]);

    // ③ 携带页面设置（默认勾选）
    // 勾选时把主页面当前的长度 / 字符类型勾选 / 每类至少一个作为硬性约束注入提示词；
    // 取消勾选则提示词完全不提长度与字符限制，交给 AI 自由发挥。
    // 长度只在主页面有一处，这里不重复出现，避免两个长度互相打架。
    /** 概括当前会带入哪些设置，开关下方实时展示（打开对话框时按当前 state 快照生成） */
    function describePageSettings(): string {
      const types: string[] = [];
      if (state.useLower) types.push('小写');
      if (state.useUpper) types.push('大写');
      if (state.useDigits) types.push('数字');
      if (state.useSymbols) types.push('符号');
      const typeText = types.length > 0 ? types.join('/') : '（无字符类型被选中）';
      const eachText = state.requireEachEnabled ? '、每类至少一个' : '';
      return `将带入：长度 ${state.length}、${typeText}${eachText}`;
    }
    const pageSettingsSummary = h('p', {
      class: 'text-xs text-[var(--fg-muted)]',
      textContent: describePageSettings(),
    });
    const includeSettingsInput = h('input', {
      type: 'checkbox',
      class: 'h-4 w-4 accent-[var(--accent)]',
      checked: true,
      onchange: (e) => {
        includePageSettings = (e.target as HTMLInputElement).checked;
        // 取消勾选时，带入预览不再相关，置灰提示；勾选时恢复
        pageSettingsSummary.textContent = includePageSettings
          ? describePageSettings()
          : '未勾选：长度与字符组成由 AI 自由决定。';
      },
    }) as HTMLInputElement;
    const includeSettingsRow = h('div', { class: 'space-y-1' }, [
      h('label', { class: 'flex items-center gap-2 text-sm cursor-pointer' }, [
        includeSettingsInput,
        '携带页面当前设置（长度、字符类型、每类至少一个）',
      ]),
      pageSettingsSummary,
    ]);

    // ④ 生成的提示词（点「生成」后才显示）+ 复制
    const promptArea = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows: 9,
      readonly: true,
      'aria-label': '生成的 AI 提示词',
    }) as HTMLTextAreaElement;
    const promptWrap = h('div', { class: 'hidden space-y-2' }, [
      h('p', {
        class: 'text-xs leading-relaxed text-[var(--fg-muted)]',
        textContent: '把这段提示词复制到 ChatGPT、豆包、DeepSeek 等 AI 对话，AI 会直接返回几个可用口令。选一个你喜欢的即可，无需再回填本工具。',
      }),
      promptArea,
      h('div', { class: 'flex items-center justify-end' }, [
        createCopyButton(() => promptArea.value, '📋 复制提示词', '已复制 ✓'),
      ]),
    ]);

    function generatePrompt(): void {
      const desc = descInput.value.trim();
      promptArea.value = buildAIPrompt({
        description: desc,
        style,
        // 携带设置时取当前主页面 state 的快照；否则传 undefined，AI 自由发挥
        pageOptions: includePageSettings ? { ...state } : undefined,
      });
      promptWrap.classList.remove('hidden');
      promptArea.scrollTop = 0;
      flashOk('提示词已生成，复制后发给 AI 即可。');
    }

    const card = h('div', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '用 AI 生成口令',
      class:
        'w-[min(92vw,42rem)] rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-2xl',
    }, [
      h('div', { class: 'mb-1 flex items-center justify-between gap-2' }, [
        h('span', { class: 'text-sm font-semibold text-[var(--fg)]', textContent: '💡 用 AI 生成口令' }),
        h('button', {
          type: 'button',
          'aria-label': '关闭',
          class: 'text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors',
          textContent: '✕',
          onclick: closeDialog,
        }),
      ]),
      h('div', { class: 'mt-2 space-y-2' }, [
        h('label', { class: 'block text-xs font-medium text-[var(--fg-muted)]', textContent: '① 描述需求或主题（可选）' }),
        descInput,
      ]),
      h('div', { class: 'mt-3 space-y-2' }, [
        h('label', { class: 'block text-xs font-medium text-[var(--fg-muted)]', textContent: '② 风格' }),
        styleRow,
      ]),
      h('div', { class: 'mt-3 space-y-2' }, [
        h('label', { class: 'block text-xs font-medium text-[var(--fg-muted)]', textContent: '③ 携带页面设置' }),
        includeSettingsRow,
      ]),
      h('div', { class: 'mt-3 flex items-center justify-end' }, [
        h('button', {
          type: 'button',
          class: 'rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
          textContent: '生成提示词',
          onclick: generatePrompt,
        }),
      ]),
      h('div', { class: 'mt-3' }, [promptWrap]),
      statusRow,
      h('p', {
        class: 'mt-2 rounded-md bg-[var(--bg)] px-3 py-2 text-[11px] leading-relaxed text-[var(--fg-muted)]',
        textContent: '安全提示：AI 生成的口令会经过第三方服务、且非密码学随机，适合低敏感场景。重要账号请用上方「生成密码」（本地密码学随机，数据不出本机）。',
      }),
    ]);

    dialogEl = mountDialog(card);
    requestAnimationFrame(() => descInput.focus());
  }

  const aiBtn = h(
    'button',
    {
      type: 'button',
      title: '用 AI 生成口令：描述需求 → 生成提示词 → 复制给 AI 直接拿口令',
      'aria-label': '用 AI 生成口令',
      class:
        'w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
      onclick: () => openAIDialog(),
    },
    ['💡 用 AI 生成口令'],
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
      h('div', { class: 'flex items-center justify-between gap-2' }, [
        strengthLabel,
        h('div', { class: 'flex items-center gap-2' }, [copyBtn, refreshBtn]),
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
    aiBtn,
    // 分隔
    h('div', { class: 'border-t border-[var(--border)]' }, []),
    // 历史
    toggleBtn,
    historyPanel,
  ]);

  // 外层：垂直 + 水平居中
  content.append(h('div', { class: 'flex-1 flex items-center justify-center w-full' }, [card]));

  // 任意选项变化时：自动重新生成 + 记忆当前选项（长度/字符类型等）。
  // 控件的直接 onchange 已先改写 state，这里的 change 事件随后触发，落库的是最新值。
  on(checkboxWrap, ['change'], () => {
    saveOptions(state);
    generate();
  });
  lengthInput.addEventListener('change', () => {
    saveOptions(state);
    generate();
  });
  requireEachInput.addEventListener('change', () => {
    saveOptions(state);
    generate();
  });

  // 初始生成一个
  generate();
}

renderPasswordGenerator();
