import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { createCopyButton } from '@/core/components/CopyButton';
import { on } from '@/core/utils/dom';
import {
  obfuscate,
  PRESETS,
  matchesPreset,
  type ObfuscateOptions,
  type ObfuscateResult,
} from './obfuscate';
import { loadOptions, saveOptions } from './settings';
import {
  loadHistory,
  addResult,
  removeResult,
  clearHistory,
  type StoredResult,
} from './history';

initTheme();

/** 一次生成几条候选供用户挑选（含随机性，多条提高命中率） */
const CANDIDATE_COUNT = 3;

renderObfuscator();

function renderObfuscator() {
  const { content } = renderToolLayout(document.getElementById('app')!, '文字夹私货');

  // —— 状态：从 localStorage 恢复上次的选项，无记忆则用默认 ——
  const state: ObfuscateOptions = loadOptions();

  // ════════════════════════════════════════════════════════════
  // 顶部说明 + 合规提示
  // ════════════════════════════════════════════════════════════
  const intro = h('p', {
    class: 'text-sm leading-relaxed text-[var(--fg-muted)]',
    textContent:
      '把手机号 / 微信 / QQ / 邮箱等联系方式经多层随机字符变换，让机器正则识别失效、对人仍可读。一次生成多条候选，挑满意的复制。所有数据仅在浏览器处理，不上传。',
  });
  const disclaimer = h('p', {
    class:
      'rounded-md border border-amber-300/40 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300',
    textContent:
      '⚠ 本工具用于在合规前提下让联系方式对自动化采集 / 正则识别失效。请勿用于规避平台规则或欺诈。',
  });

  // ════════════════════════════════════════════════════════════
  // 原文输入
  // ════════════════════════════════════════════════════════════
  const inputArea = h('textarea', {
    class:
      'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)] transition-colors',
    rows: 4,
    placeholder:
      '输入要变换的联系方式，例如：\n13800138000\n微信：AbcDef\nQQ：12345678\n邮箱：hello@example.com\n也可以整段混写：电话13800138000微信AbcDef邮箱test@x.com',
    'aria-label': '原文输入',
  }) as HTMLTextAreaElement;

  // ════════════════════════════════════════════════════════════
  // 变换设置：可见层 + 不可见层
  // ════════════════════════════════════════════════════════════
  /** 所有开关的配置元数据 */
  const SWITCH_META: {
    key: keyof ObfuscateOptions;
    label: string;
    title: string;
  }[] = [
    { key: 'caseShuffle', label: '大小写打乱', title: '字母随机改大写，原值按小写理解' },
    { key: 'digitToWords', label: '数字转中文', title: '数字随机转为 〇一二三… 或 零壹贰…' },
    { key: 'insertHan', label: '穿插汉字', title: '随机穿插可见汉字干扰符（·「」等）' },
    { key: 'insertEmoji', label: '穿插表情', title: '随机穿插 emoji' },
    { key: 'insertSymbol', label: '穿插符号', title: '随机穿插 ★◆※ 等可见符号' },
    { key: 'visibleSeparator', label: '可见分隔符', title: '用全角空格/制表符打断连续数字串' },
    { key: 'zeroWidth', label: '零宽字符', title: '穿插肉眼不可见的 Unicode 字符（可能被平台过滤）' },
    { key: 'homoglyph', label: '同形字替换', title: '拉丁字母替换为视觉相同的西里尔/希腊字母' },
  ];

  /** 创建一个 checkbox + label，绑定到 state */
  function makeSwitch(meta: (typeof SWITCH_META)[number]): HTMLLabelElement {
    const cb = h('input', {
      type: 'checkbox',
      class: 'h-4 w-4 accent-[var(--accent)]',
      checked: state[meta.key],
      onchange: (e: Event) => {
        state[meta.key] = (e.target as HTMLInputElement).checked;
        saveOptions(state);
        refreshPresetHighlight();
      },
    }) as HTMLInputElement;
    // 保存引用以便预设切换时同步勾选态
    cb.dataset.switchKey = meta.key;
    return h('label', { class: 'flex items-center gap-2 text-sm cursor-pointer', title: meta.title }, [
      cb,
      meta.label,
    ]);
  }

  const visibleSwitches = SWITCH_META.slice(0, 6).map(makeSwitch);
  const invisibleSwitches = SWITCH_META.slice(6).map(makeSwitch);

  const visibleGrid = h('div', { class: 'grid grid-cols-2 gap-2 sm:grid-cols-3' }, visibleSwitches);

  const invisibleWarning = h('p', {
    class: 'text-xs leading-relaxed text-amber-600 dark:text-amber-400',
    textContent:
      '⚠ 激进层：部分平台会做规范化（NFKC）或过滤零宽字符后再识别，可能失效。建议同时开启上方可见变换作兜底。',
  });
  const invisibleGrid = h(
    'div',
    { class: 'grid grid-cols-2 gap-2 sm:grid-cols-3' },
    invisibleSwitches,
  );

  // ════════════════════════════════════════════════════════════
  // 预设档位按钮
  // ════════════════════════════════════════════════════════════
  const presetBtns: HTMLButtonElement[] = [];
  /** 预设按钮的公共 class（含高亮态切换） */
  function presetClass(active: boolean): string {
    return (
      'rounded-md border px-3 py-1.5 text-sm transition-colors ' +
      (active
        ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]'
        : 'border-[var(--border)] bg-[var(--bg)] text-[var(--fg-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]')
    );
  }
  const presetRow = h('div', { class: 'flex flex-wrap gap-2' }, [
    ...PRESETS.map((p) => {
      const btn = h('button', {
        type: 'button',
        'data-preset': p.id,
        class: presetClass(matchesPreset(state, p)),
        textContent: p.name,
        title: p.hint,
        onclick: () => applyPreset(p),
      }) as HTMLButtonElement;
      presetBtns.push(btn);
      return btn;
    }),
  ]);

  /** 应用一个预设到 state + 同步所有 checkbox + 刷新高亮 */
  function applyPreset(preset: { options: ObfuscateOptions }): void {
    Object.assign(state, preset.options);
    saveOptions(state);
    syncSwitchesFromState();
    refreshPresetHighlight();
  }

  /** 把 state 同步到所有 checkbox 的勾选态 */
  function syncSwitchesFromState(): void {
    const allCbs = [...visibleSwitches, ...invisibleSwitches].map(
      (label) => label.querySelector('input[type=checkbox]') as HTMLInputElement,
    );
    for (const cb of allCbs) {
      const key = cb.dataset.switchKey as keyof ObfuscateOptions;
      cb.checked = state[key];
    }
  }

  /** 刷新预设按钮高亮：命中哪个就高亮哪个，都不命中则全灭（=自定义） */
  function refreshPresetHighlight(): void {
    for (const btn of presetBtns) {
      const pid = btn.dataset.preset!;
      const preset = PRESETS.find((p) => p.id === pid);
      btn.className = presetClass(preset ? matchesPreset(state, preset) : false);
    }
  }

  // ════════════════════════════════════════════════════════════
  // 生成按钮 + 候选结果区
  // ════════════════════════════════════════════════════════════
  const generateBtn = h('button', {
    type: 'button',
    class:
      'w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
    textContent: '🥷 生成防检测字符',
    onclick: generate,
  });

  /** 候选结果容器（生成前隐藏） */
  const candidatesWrap = h('div', { class: 'space-y-2 hidden' }, []);
  const candidatesLabel = h('p', {
    class: 'text-sm font-medium text-[var(--fg-muted)]',
    textContent: '候选结果（挑选满意的一条复制，复制即记入历史）',
  });

  /** 渲染一条候选：文本 + note + 复制按钮 */
  function renderCandidate(result: ObfuscateResult, index: number): HTMLElement {
    const textCode = h('code', {
      class: 'flex-1 break-all font-mono text-sm text-[var(--fg)]',
      textContent: result.text,
    });
    // note 非空才显示
    const noteEl = result.note
      ? h('p', {
          class: 'mt-1 text-xs leading-relaxed text-[var(--fg-muted)]',
          textContent: result.note,
        })
      : null;

    return h(
      'div',
      {
        class:
          'rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 space-y-1',
      },
      [
        h('div', { class: 'flex items-center gap-2' }, [
          h('span', {
            class: 'shrink-0 text-xs text-[var(--fg-muted)]',
            textContent: `${index + 1}`,
          }),
          textCode,
          // 复制即入历史
          createCopyButton(() => {
            const items = addResult({
              input: inputArea.value,
              output: result.text,
              note: result.note,
            });
            renderHistory(items);
            return result.text;
          }, '复制', '已复制 ✓'),
        ]),
        ...(noteEl ? [noteEl] : []),
      ],
    );
  }

  function generate(): void {
    const input = inputArea.value;
    if (!input.trim()) {
      candidatesWrap.replaceChildren(
        h('p', {
          class: 'py-3 text-center text-sm text-[var(--fg-muted)]',
          textContent: '请先在上方输入要变换的联系方式。',
        }),
      );
      candidatesWrap.classList.remove('hidden');
      return;
    }

    const results: ObfuscateResult[] = [];
    for (let i = 0; i < CANDIDATE_COUNT; i++) {
      results.push(obfuscate(input, state));
    }

    candidatesWrap.replaceChildren(
      candidatesLabel,
      ...results.map((r, i) => renderCandidate(r, i)),
    );
    candidatesWrap.classList.remove('hidden');
  }

  // ════════════════════════════════════════════════════════════
  // 历史记录（可折叠）
  // ════════════════════════════════════════════════════════════
  let historyOpen = false;
  const historyCount = h('span', { textContent: '0' });
  const toggleIndicator = h('span', { class: 'text-xs', textContent: '▶' });
  const historyListWrap = h('div', { class: 'space-y-2' }, []);
  const historyPanel = h('div', { class: 'space-y-3 hidden' }, [historyListWrap]);

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

  /** 渲染历史列表（含每条复制 + 删除 + 全清） */
  function renderHistory(items?: StoredResult[]): void {
    const list = items ?? loadHistory();
    historyCount.textContent = String(list.length);
    historyListWrap.replaceChildren();

    if (list.length === 0) {
      historyListWrap.append(
        h('p', {
          class: 'py-4 text-center text-sm text-[var(--fg-muted)]',
          textContent: '还没有历史记录。复制任意一条候选结果即可记录。',
        }),
      );
      return;
    }

    // 顶部：全部清除
    historyListWrap.append(
      h('div', { class: 'flex justify-end' }, [
        h('button', {
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
        }),
      ]),
    );

    for (const it of list) {
      const noteEl = it.note
        ? h('p', {
            class: 'mt-0.5 text-xs leading-relaxed text-[var(--fg-muted)]',
            textContent: it.note,
          })
        : null;
      historyListWrap.append(
        h(
          'div',
          {
            class:
              'rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 space-y-0.5',
          },
          [
            h('div', { class: 'flex items-center gap-2' }, [
              h('code', {
                class: 'flex-1 break-all font-mono text-sm text-[var(--fg)]',
                textContent: it.output,
              }),
              createCopyButton(() => it.output, '复制', '已复制 ✓'),
              h('button', {
                type: 'button',
                'aria-label': '删除此条',
                class:
                  'shrink-0 rounded-md border border-[var(--border)] px-2 py-1.5 text-sm text-[var(--fg-muted)] hover:text-red-500 hover:border-red-400 transition-colors',
                textContent: '✕',
                onclick: () => renderHistory(removeResult(it.id)),
              }),
            ]),
            ...(noteEl ? [noteEl] : []),
            h('p', {
              class: 'text-[10px] text-[var(--fg-muted)]/70',
              textContent: new Date(it.createdAt).toLocaleString('zh-CN'),
            }),
          ],
        ),
      );
    }

    // 底部隐私提示
    historyListWrap.append(
      h('p', {
        class: 'pt-1 text-center text-xs text-[var(--fg-muted)]',
        textContent: '🔒 全部保存在本地浏览器，不上传任何服务器。',
      }),
    );
  }

  // ════════════════════════════════════════════════════════════
  // 组装卡片
  // ════════════════════════════════════════════════════════════
  const card = h(
    'div',
    {
      class:
        'w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-6 sm:p-8 shadow-sm space-y-6',
    },
    [
      intro,
      disclaimer,
      // 原文输入
      h('div', { class: 'space-y-2' }, [
        h('label', {
          class: 'text-sm font-medium text-[var(--fg-muted)]',
          textContent: '原文（联系方式）',
        }),
        inputArea,
      ]),
      // 可见变换
      h('div', { class: 'space-y-2' }, [
        h('p', {
          class: 'text-sm font-medium',
          textContent: '可见变换（稳健，能扛平台规范化）',
        }),
        visibleGrid,
      ]),
      // 不可见变换
      h('div', { class: 'space-y-2' }, [
        h('p', {
          class: 'text-sm font-medium',
          textContent: '不可见变换（激进，可能被平台过滤）',
        }),
        invisibleWarning,
        invisibleGrid,
      ]),
      // 预设
      h('div', { class: 'space-y-2' }, [
        h('p', {
          class: 'text-sm font-medium text-[var(--fg-muted)]',
          textContent: '一键预设',
        }),
        presetRow,
      ]),
      generateBtn,
      // 分隔
      h('div', { class: 'border-t border-[var(--border)]' }, []),
      // 候选结果
      candidatesWrap,
      // 分隔
      h('div', { class: 'border-t border-[var(--border)]' }, []),
      // 历史
      toggleBtn,
      historyPanel,
    ],
  );

  content.append(h('div', { class: 'flex-1 flex items-center justify-center w-full' }, [card]));

  // ════════════════════════════════════════════════════════════
  // 事件 + 初始化
  // ════════════════════════════════════════════════════════════
  // textarea 不需要持久化内容（按需求，用户每次重新输入即可）；这里只监听
  // 可见/不可见开关的变化已在 makeSwitch 的 onchange 内联处理。

  // 预设按钮区也用事件委托兜底（虽然每个按钮已有 onclick，保持一致性）
  on(presetRow, ['click'], () => {
    // onclick 已处理，这里仅占位确保事件流统一
  });

  // 初始渲染历史
  renderHistory();
}
