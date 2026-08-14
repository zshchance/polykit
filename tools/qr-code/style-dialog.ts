// AI 风格助手对话框：描述 → 生成提示词 → 粘贴 AI 返回代码 → 保存并立即套用。
// 依赖方向：仅依赖 custom-styles 与 core 通用组件；cfg 与 applyStyle 由 main 注入
// （applyStyle 由 controls 面板提供），保存成功后经 applyStyle 回写主面板，不反向 import。

import { h } from '@/core/components/element';
import { createCopyButton } from '@/core/components/CopyButton';
import type { QrConfig } from './types';
import {
  addCustomStyle,
  buildAIPrompt,
  compileDotEffect,
  dryRunCheck,
  parseAIOutput,
  type DotEffectFn,
} from './custom-styles';

export interface StyleDialogDeps {
  /** 主配置：保存风格时用当前前景/背景色兜底 swatch */
  cfg: QrConfig;
  /** 保存成功后立即套用（controls 面板提供：覆盖常规字段 + 挂载码点钩子 + 重绘） */
  applyStyle(id: string, apply: Partial<QrConfig>, dotEffect: DotEffectFn | null): void;
}

export interface StyleDialog {
  /** 💡 入口按钮（挂在「一键套用风格」标题旁，由 main 装配） */
  aiHelpBtn: HTMLElement;
  openStyleHelpDialog(): void;
}

export function createStyleDialog(deps: StyleDialogDeps): StyleDialog {
  const { cfg, applyStyle } = deps;

  // 交互同名言卡片的动效 AI：单实例 guard，三步逐步显现。
  let styleDialogEl: HTMLElement | null = null;

  function closeStyleDialog(): void {
    if (!styleDialogEl) return;
    styleDialogEl.remove();
    styleDialogEl = null;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onStyleDialogEsc);
  }
  function onStyleDialogEsc(e: KeyboardEvent): void {
    if (e.key === 'Escape' && styleDialogEl) {
      e.preventDefault();
      closeStyleDialog();
    }
  }
  function mountStyleDialog(card: HTMLElement): HTMLElement {
    const overlay = h('div', {
      class: 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4',
      onclick: (e: Event) => {
        if (e.target === overlay) closeStyleDialog();
      },
    });
    overlay.append(card);
    document.body.append(overlay);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onStyleDialogEsc);
    return overlay;
  }

  function openStyleHelpDialog(): void {
    if (styleDialogEl) closeStyleDialog();

    const statusRow = h('div', { class: 'min-h-[1.25rem] text-xs' });
    function flashError(msg: string): void {
      statusRow.textContent = msg ? '⚠ ' + msg : '';
      statusRow.style.color = 'var(--holiday-legal)';
    }
    function flashOk(msg: string): void {
      statusRow.textContent = '✓ ' + msg;
      statusRow.style.color = '#22c55e';
    }

    // 步骤 1：描述想要的风格
    const descInput = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows: 3,
      'aria-label': '想要的二维码风格描述',
      placeholder:
        '描述你想要的码点效果，例如：落雪效果，每个码点顶部像积了一层白雪；或：深蓝渐变底配金色圆点，像星空；或：每个码点带右下角高光，像有立体感。',
    }) as HTMLTextAreaElement;

    // 步骤 2：生成的提示词（点「生成」后才显示）
    const promptArea = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows: 8,
      readonly: true,
      'aria-label': '生成的 AI 提示词',
    }) as HTMLTextAreaElement;
    const step2 = h('div', { class: 'hidden space-y-2' }, [
      h('p', {
        class: 'text-xs leading-relaxed text-[var(--fg-muted)]',
        textContent:
          '把这段提示词复制到 ChatGPT、豆包、DeepSeek 等 AI 对话，AI 会返回一段「名称 + 配色 + 代码」。把 AI 的整段回复粘到下面框里，点保存即可。',
      }),
      promptArea,
      h('div', { class: 'flex items-center justify-end' }, [
        createCopyButton(() => promptArea.value, '📋 复制提示词', '已复制 ✓'),
      ]),
    ]);

    // 步骤 3：粘贴 AI 返回的代码 + 保存
    const pasteInput = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows: 8,
      spellcheck: false,
      'aria-label': '粘贴 AI 返回的代码（含名称注释）',
      placeholder:
        '把 AI 的整段回复粘到这里（代码块首行形如「// 名称：冬日落雪」，其后可选「// 配色: ...」行，再后是 ```js 代码）。工具会自动识别。',
    }) as HTMLTextAreaElement;
    const step3 = h('div', { class: 'hidden space-y-2' }, [
      h('label', {
        class: 'block text-xs font-medium text-[var(--fg-muted)]',
        textContent: '③ 粘贴 AI 返回的代码（含名称注释）',
      }),
      pasteInput,
      h('div', { class: 'flex items-center justify-end gap-2' }, [
        h('button', {
          type: 'button',
          class:
            'rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--fg-muted)] hover:border-[var(--accent)] transition-colors',
          textContent: '取消',
          onclick: closeStyleDialog,
        }),
        h('button', {
          type: 'button',
          class:
            'rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
          textContent: '保存并应用',
          onclick: saveStyle,
        }),
      ]),
    ]);

    function generate(): void {
      const desc = descInput.value.trim();
      if (!desc) {
        flashError('请先描述你想要的风格。');
        descInput.focus();
        return;
      }
      flashError('');
      promptArea.value = buildAIPrompt(desc);
      step2.classList.remove('hidden');
      step3.classList.remove('hidden');
      promptArea.scrollTop = 0;
    }

    function saveStyle(): void {
      const parsed = parseAIOutput(pasteInput.value);
      if (!parsed.name) {
        flashError('没识别到风格名称——AI 返回的代码块首行应是「// 名称：冬日落雪」这样的注释。');
        pasteInput.focus();
        return;
      }
      if (!parsed.code) {
        flashError('没识别到代码——请把 AI 的整段回复（含 ```js 代码块）粘进来。');
        pasteInput.focus();
        return;
      }
      // 保存前在离屏 canvas 试跑，拦截语法/运行时错误
      const check = dryRunCheck(parsed.code);
      if (!check.ok) {
        flashError(check.reason ?? '代码有问题，无法保存。');
        return;
      }
      // 保存：名称 + 配色 + 码点代码。swatch 由配色推一个色条。
      const list = addCustomStyle({
        name: parsed.name,
        apply: parsed.apply,
        dotEffectCode: parsed.code,
        swatch: [parsed.apply.fgColor || cfg.fgColor, parsed.apply.bgColor || cfg.bgColor],
      });
      // addCustomStyle 同名覆盖，刚保存的必在列表首位；仍做回退防御
      const saved = list.find((it) => it.name.trim() === parsed.name);
      if (!saved) {
        flashError('保存后未在列表中找到该风格，请重试');
        return;
      }
      // 立即套用：配色 + 码点钩子
      let effect: DotEffectFn | null = null;
      try {
        effect = compileDotEffect(saved.dotEffectCode);
      } catch {
        // dryRun 已过，理论上不会到这；保险起见降级
      }
      applyStyle(saved.id, saved.apply, effect);
      flashOk(`已保存「${parsed.name}」并应用。`);
      setTimeout(closeStyleDialog, 700);
    }

    const card = h(
      'div',
      {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '用 AI 生成自定义二维码风格',
        class:
          'w-[min(92vw,42rem)] rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-2xl',
      },
      [
        h('div', { class: 'mb-1 flex items-center justify-between gap-2' }, [
          h('span', {
            class: 'text-sm font-semibold text-[var(--fg)]',
            textContent: '💡 用 AI 生成自定义码点风格',
          }),
          h('button', {
            type: 'button',
            'aria-label': '关闭',
            class: 'text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors',
            textContent: '✕',
            onclick: closeStyleDialog,
          }),
        ]),
        // 步骤 1
        h('div', { class: 'mt-2 space-y-2' }, [
          h('label', {
            class: 'block text-xs font-medium text-[var(--fg-muted)]',
            textContent: '① 描述你想要的风格',
          }),
          descInput,
          h('div', { class: 'flex items-center justify-end' }, [
            h('button', {
              type: 'button',
              class:
                'rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
              textContent: '生成 AI 提示词',
              onclick: generate,
            }),
          ]),
        ]),
        // 步骤 2
        h('div', { class: 'mt-3' }, [
          h('label', {
            class: 'mb-1 block text-xs font-medium text-[var(--fg-muted)]',
            textContent: '② 复制提示词给 AI',
          }),
          step2,
        ]),
        // 步骤 3
        step3,
        statusRow,
        h('p', {
          class: 'mt-3 text-center text-[11px] text-[var(--fg-muted)]',
          textContent: '数据不出本地 · 代码仅在你自己的浏览器运行',
        }),
      ],
    );

    styleDialogEl = mountStyleDialog(card);
    requestAnimationFrame(() => descInput.focus());
  }

  // —— AI 风格助手：💡 按钮 + 三步模态（描述 → 生成提示词 → 粘代码保存）——
  const aiHelpBtn = h('button', {
    type: 'button',
    title: '用 AI 生成自定义码点风格：描述想要的效果 → 生成提示词 → 粘贴 AI 返回的代码 → 保存',
    'aria-label': '用 AI 生成自定义风格',
    class:
      'text-base leading-none text-[var(--fg-muted)] hover:text-[var(--accent)] transition-colors',
    textContent: '💡',
    onclick: () => openStyleHelpDialog(),
  });

  return { aiHelpBtn, openStyleHelpDialog };
}
