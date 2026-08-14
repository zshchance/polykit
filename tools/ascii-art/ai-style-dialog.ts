/**
 * 「用 AI 生成自定义风格」模态（镜像 quote-card 的 openTemplateDialog）。
 *
 * 职责：三步向导（描述风格 → 生成提示词 → 粘贴 AI 返回的 JSON → 保存），
 * 模态挂载/Esc 关闭/overlay 点击关闭。
 *
 * 依赖方向：依赖 core 的 h/CopyButton 与 custom-styles 的提示词构建/解析/保存；
 * 由 controls.ts 以 { applyCustomStyle, persist } 依赖创建工厂（原定义在
 * buildControls 内共享其作用域，现改为显式参数传递，语义不变），
 * 模态开关 dialogEl 状态留在工厂闭包内。
 */

import { h } from '@/core/components/element';
import { createCopyButton } from '@/core/components/CopyButton';
import {
  addCustomStyle,
  buildStylePrompt,
  parseStyleAIOutput,
  type StyleAppearance,
} from './custom-styles';

export interface AiStyleDialogDeps {
  /** 应用自定义风格外观（buildControls 内闭包：只覆盖风格字段并回写参数控件、重渲染）。 */
  applyCustomStyle(appearance: StyleAppearance): void;
  /** 持久化配置。 */
  persist(): void;
}

export interface AiStyleDialog {
  openStyleDialog(): void;
}

export function createAiStyleDialog(deps: AiStyleDialogDeps): AiStyleDialog {
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
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      placeholder:
        '例如：深紫背景配青绿色文字，赛博朋克风，带扫描线和辉光；或：米白纸张色配深棕字，无外框，复古打字机',
    });

    // 步骤 2：生成的提示词
    const promptArea = h('textarea', {
      readonly: true,
      rows: 10,
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-[12px] leading-relaxed text-[var(--fg)] outline-none',
    });
    const step2 = h('div', { class: 'hidden space-y-2' }, [
      h('p', {
        class: 'text-xs text-[var(--fg-muted)]',
        textContent:
          '② 把下面的提示词发给任意 AI（ChatGPT / Claude / GLM 等），让它生成终端风格参数。',
      }),
      promptArea,
      h('div', { class: 'flex justify-end' }, [
        createCopyButton(() => promptArea.value, '📋 复制提示词', '已复制 ✓'),
      ]),
    ]);

    // 步骤 3：粘贴 AI 返回 + 保存
    const pasteInput = h('textarea', {
      rows: 10,
      spellcheck: false,
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-[12px] leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      placeholder: '把 AI 返回的 ```json 代码块整体粘到这里（含名称/背景/文字色注释 + JSON 对象）',
    });
    const step3 = h('div', { class: 'hidden space-y-2' }, [
      h('p', {
        class: 'text-xs text-[var(--fg-muted)]',
        textContent:
          '③ 粘贴 AI 返回的 JSON（含名称/背景/文字色注释），点保存即可在选择器看到 ⭐ 自定义风格。',
      }),
      pasteInput,
      h('div', { class: 'flex items-center justify-end gap-2' }, [
        h('button', {
          type: 'button',
          class:
            'rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--fg-muted)] hover:border-[var(--accent)] transition-colors',
          textContent: '取消',
          onclick: () => closeDialog(),
        }),
        h('button', {
          type: 'button',
          class:
            'rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
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
      deps.applyCustomStyle(parsed.appearance);
      deps.persist();
      flashOk(`已保存「${parsed.name}」并应用`);
      setTimeout(closeDialog, 700);
    }

    const card = h(
      'div',
      {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '用 AI 生成自定义风格',
        class:
          'w-[min(92vw,42rem)] rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-2xl',
      },
      [
        // 标题行
        h('div', { class: 'mb-4 flex items-center justify-between' }, [
          h('h2', {
            class: 'text-base font-semibold text-[var(--fg)]',
            textContent: '💡 用 AI 生成自定义风格',
          }),
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
          h('label', {
            class: 'text-xs font-medium text-[var(--fg-muted)]',
            textContent: '① 描述你想要的终端风格',
          }),
          descInput,
          h('div', { class: 'flex justify-end' }, [
            h('button', {
              type: 'button',
              class:
                'rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
              textContent: '生成 AI 提示词',
              onclick: () => generate(),
            }),
          ]),
        ]),
        step2,
        step3,
        statusRow,
        h('p', {
          class: 'mt-3 text-center text-[11px] text-[var(--fg-muted)]',
          textContent: '数据不出本地 · 仅保存风格参数（配色/终端/CRT 开关）',
        }),
      ],
    );

    dialogEl = mountDialog(card);
    // rAF 在后台标签页会暂停，用 setTimeout 兜底聚焦
    const focusDesc = () => descInput.focus();
    requestAnimationFrame(focusDesc);
    setTimeout(focusDesc, 60);
  }

  return { openStyleDialog };
}
