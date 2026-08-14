/**
 * 名言卡片 —— 💡 AI 生成自定义动画 / 自定义模板（两个三步合一模态）。
 *
 * 从 main.ts 拆出：openHelpDialog（动画）/ openTemplateDialog（模板）+
 * 通用浮层壳 mountDialog 与单实例 guard（dialogEl / closeDialog / onDialogEsc）。
 * 一个模态走完整流程：① 描述 → ② 生成提示词（可复制给 ChatGPT/豆包等）
 * → ③ 粘贴 AI 返回的代码 → dryRun 校验通过后保存即在选择器出现并应用。
 *
 * 依赖方向：依赖 core 的 h()/复制按钮与 custom-animations / custom-templates
 * 的提示词构建、解析与校验；编辑态与重绘/落库/重建选择器等闭包依赖
 * 由 main.ts 通过 createAiDialogs(deps) 显式注入。
 */

import { h } from '@/core/components/element';
import { createCopyButton } from '@/core/components/CopyButton';
import type { QuoteCardState } from './state';
import { addCustomAnim, dryRunCheck, parseAIOutput, buildAIPrompt } from './custom-animations';
import {
  addCustomTemplate,
  dryRunCheck as dryRunTemplateCheck,
  parseTemplateAIOutput,
  buildTemplatePrompt,
} from './custom-templates';

/** createAiDialogs 的依赖（由 main.ts 注入，替代原闭包变量） */
export interface AiDialogsDeps {
  /** 共享编辑态（读 quote 供 dryRun 校验；写 animId / templateId 应用新保存项） */
  state: QuoteCardState;
  /** 卡片画板（动画 dryRun 取真实内容层做校验样本） */
  cardEl: HTMLElement;
  /** 重绘卡片预览 */
  rerenderCard: () => void;
  /** 草稿落库 */
  persistDraft: () => void;
  /** 保存自定义动画后重建动画选择器（原闭包调用 animSelect.rebuild(animOptions(), state.animId)） */
  rebuildAnimSelector: () => void;
  /** 保存自定义模板后重建模板网格 */
  rebuildTemplateGrid: () => void;
}

/** AI 模态 API：两个入口（单实例 guard 内部持有） */
export interface AiDialogs {
  /** 打开「用 AI 生成自定义动画」模态 */
  openHelpDialog: () => void;
  /** 打开「用 AI 生成自定义模板」模态 */
  openTemplateDialog: () => void;
}

export function createAiDialogs(deps: AiDialogsDeps): AiDialogs {
  const { state, cardEl, rerenderCard, persistDraft, rebuildAnimSelector, rebuildTemplateGrid } =
    deps;

  // 单实例 guard：同时只允许一个模态。
  let dialogEl: HTMLElement | null = null;

  /** 关闭当前打开的模态 */
  function closeDialog(): void {
    if (!dialogEl) return;
    dialogEl.remove();
    dialogEl = null;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onDialogEsc);
  }

  /** 通用浮层壳：遮罩 + 居中卡片 + Esc/点遮罩关闭。card 由调用方构建。 */
  function mountDialog(card: HTMLElement): HTMLElement {
    // overlay 用 overflow-y-auto 而非纯 flex 居中：小屏（尤其手机）上模态内容比视口高时，
    // 纯居中会把卡片上下都裁掉且无法滚动，底部的「保存并应用」按钮点不到。
    // 改成可滚动容器 + 内容顶部对齐，短屏能下滑看到底部按钮，长屏仍居中（my-auto）。
    const overlay = h('div', {
      class: 'fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4',
      onclick: (e: Event) => {
        // 点遮罩空白处（overlay 本身或 wrap 容器，非卡片）关闭
        if (e.target === overlay || e.target === wrap) closeDialog();
      },
    });
    // 包一层容器：my-auto 让卡片在内容比视口短时垂直居中、比视口高时从顶部开始
    // （margin:auto 在内容溢出时会塌缩为 0，于是卡片贴顶、向下溢出部分可滚动）。
    // 这是「短屏居中 / 长屏可滚」两全的稳健写法，比 items-center 更可靠
    // （items-center 在内容高于容器时会把顶部溢出裁掉、滚不到）。
    const wrap = h('div', { class: 'flex min-h-full justify-center' }, [card]);
    card.classList.add('my-auto');
    overlay.append(wrap);
    document.body.append(overlay);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onDialogEsc);
    return overlay;
  }
  function onDialogEsc(e: KeyboardEvent): void {
    if (e.key === 'Escape' && dialogEl) {
      e.preventDefault();
      closeDialog();
    }
  }

  function openHelpDialog(): void {
    if (dialogEl) closeDialog();

    // —— 三步状态：描述 / 提示词 / 粘代码 各自一块，逐步显现 ——
    const statusRow = h('div', { class: 'min-h-[1.25rem] text-xs' });
    function flashError(msg: string): void {
      statusRow.textContent = '⚠ ' + msg;
      statusRow.style.color = 'var(--holiday-legal)';
    }
    function flashOk(msg: string): void {
      statusRow.textContent = '✓ ' + msg;
      statusRow.style.color = '#22c55e';
    }

    // —— 步骤 1：描述想要的效果 ——
    const descInput = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows: 3,
      'aria-label': '想要的动画效果描述',
      placeholder:
        '描述你想要的文字入场效果，例如：每个字从左边飞入并带轻微旋转，最后稳定；或：整段从模糊到清晰，文字像被聚焦。',
    }) as HTMLTextAreaElement;

    // —— 步骤 2：生成的提示词（点「生成 AI 提示词」后才显示）——
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
          '把这段提示词复制到 ChatGPT、豆包、DeepSeek 等 AI 对话，AI 会返回一段「名称 + 代码」。把 AI 的整段回复粘到下面框里，点保存即可。',
      }),
      promptArea,
      h('div', { class: 'flex items-center justify-end' }, [
        createCopyButton(() => promptArea.value, '📋 复制提示词', '已复制 ✓'),
      ]),
    ]);

    // —— 步骤 3：粘贴 AI 返回的代码（含名称行）+ 保存按钮 ——
    // 与 step2 一样默认隐藏，generate 时才显示。
    const pasteInput = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows: 8,
      spellcheck: false,
      'aria-label': '粘贴 AI 返回的代码（含名称注释）',
      placeholder:
        '把 AI 的整段回复粘到这里（代码块首行形如「// 名称：雪花飘落」，后面是 ```js 代码）。工具会自动识别名称和代码。',
    }) as HTMLTextAreaElement;
    const step3 = h('div', { class: 'hidden space-y-2' }, [
      h('label', {
        class: 'block text-xs font-medium text-[var(--fg-muted)]',
        textContent: '③ 粘贴 AI 返回的代码（含名称注释）',
      }),
      pasteInput,
      // 保存按钮放进 step3，跟随其显隐
      h('div', { class: 'flex items-center justify-end gap-2' }, [
        h('button', {
          type: 'button',
          class:
            'rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--fg-muted)] hover:border-[var(--accent)] transition-colors',
          textContent: '取消',
          onclick: closeDialog,
        }),
        h('button', {
          type: 'button',
          class:
            'rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
          textContent: '保存并应用',
          onclick: save,
        }),
      ]),
    ]);

    function generate(): void {
      const desc = descInput.value.trim();
      if (!desc) {
        flashError('请先描述你想要的效果。');
        descInput.focus();
        return;
      }
      flashError('');
      promptArea.value = buildAIPrompt(desc);
      step2.classList.remove('hidden');
      step3.classList.remove('hidden');
      promptArea.scrollTop = 0;
    }

    /** 取当前卡片内容层做校验样本（没有则造一个） */
    function sampleContent(): HTMLElement {
      const real = cardEl.querySelector('.quote-card-content') as HTMLElement | null;
      if (real) return real;
      const sample = h('div', { class: 'quote-card-content' }, [
        h('div', { textContent: state.quote.text }),
        h('div', { textContent: state.quote.author }),
      ]);
      return sample;
    }

    function save(): void {
      const parsed = parseAIOutput(pasteInput.value);
      if (!parsed.name) {
        flashError('没识别到效果名称——AI 返回的代码块首行应是「// 名称：雪花飘落」这样的注释。');
        pasteInput.focus();
        return;
      }
      if (!parsed.code) {
        flashError('没识别到代码——请把 AI 的整段回复（含 ```js 代码块）粘进来。');
        pasteInput.focus();
        return;
      }
      // 保存前校验（在 content 克隆副本上试跑）：语法错 / 运行时报错 / 未返回
      // Animation / 破坏 DOM 结构 都会拦下并红字提示，不保存。
      const real = sampleContent();
      const check = dryRunCheck(parsed.code, real, state.quote);
      if (!check.ok) {
        flashError(check.reason ?? '代码有问题，无法保存。');
        return;
      }
      const list = addCustomAnim(parsed.name, parsed.code);
      const saved = list.find((it) => it.name.trim() === parsed.name)!;
      state.animId = saved.id;
      rebuildAnimSelector(); // 原：animSelect.rebuild(animOptions(), state.animId)
      rerenderCard(); // 立即应用新效果
      persistDraft();
      flashOk(`已保存「${parsed.name}」并应用，关闭后即可看到效果。`);
      // 稍延迟关闭，让用户看到成功提示
      setTimeout(closeDialog, 700);
    }

    const card = h(
      'div',
      {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '用 AI 生成自定义动画效果',
        class:
          'w-[min(92vw,42rem)] rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-2xl',
      },
      [
        h('div', { class: 'mb-1 flex items-center justify-between gap-2' }, [
          h('span', {
            class: 'text-sm font-semibold text-[var(--fg)]',
            textContent: '💡 用 AI 生成自定义动画',
          }),
          h('button', {
            type: 'button',
            'aria-label': '关闭',
            class: 'text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors',
            textContent: '✕',
            onclick: closeDialog,
          }),
        ]),
        // 步骤 1
        h('div', { class: 'mt-2 space-y-2' }, [
          h('label', {
            class: 'block text-xs font-medium text-[var(--fg-muted)]',
            textContent: '① 描述你想要的效果',
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
        // 步骤 2（生成后显示）
        h('div', { class: 'mt-3' }, [
          h('label', {
            class: 'mb-1 block text-xs font-medium text-[var(--fg-muted)]',
            textContent: '② 复制提示词给 AI',
          }),
          step2,
        ]),
        // 步骤 3（生成后显示，含保存按钮）
        step3,
        statusRow,
        h('p', {
          class: 'mt-3 text-center text-[11px] text-[var(--fg-muted)]',
          textContent: '数据不出本地 · 代码仅在你自己的浏览器运行',
        }),
      ],
    );

    dialogEl = mountDialog(card);
    requestAnimationFrame(() => descInput.focus());
  }

  // ────────── 💡 AI 生成自定义模板（三步合一模态，与动画模态对称）──────────
  // 流程同动画：① 描述想要的风格 → ② 生成提示词（可复制给 ChatGPT/豆包等）
  // → ③ 粘贴 AI 返回的代码（首三行注释声明名称/背景/图标色）→ 保存即在选择器出现并应用。
  // dryRun 在离屏 1080×1080 容器上试渲染，校验产出可见内容 + svg 非空 + 无越界操作。
  function openTemplateDialog(): void {
    if (dialogEl) closeDialog();

    const statusRow = h('div', { class: 'min-h-[1.25rem] text-xs' });
    function flashError(msg: string): void {
      statusRow.textContent = '⚠ ' + msg;
      statusRow.style.color = 'var(--holiday-legal)';
    }
    function flashOk(msg: string): void {
      statusRow.textContent = '✓ ' + msg;
      statusRow.style.color = '#22c55e';
    }

    // —— 步骤 1：描述想要的风格 ——
    const descInput = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows: 3,
      'aria-label': '想要的卡片风格描述',
      placeholder:
        '描述你想要的卡片风格，例如：深蓝星空背景，金色衬线大字，右下角一个抽象山脉 SVG 轮廓，整体高级沉稳；或：莫兰迪色系纸质感，手写体，左上角一束淡彩 SVG 花纹。',
    }) as HTMLTextAreaElement;

    // —— 步骤 2：生成的提示词 ——
    const promptArea = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows: 10,
      readonly: true,
      'aria-label': '生成的 AI 提示词',
    }) as HTMLTextAreaElement;
    const step2 = h('div', { class: 'hidden space-y-2' }, [
      h('p', {
        class: 'text-xs leading-relaxed text-[var(--fg-muted)]',
        textContent:
          '把这段提示词复制到 ChatGPT、豆包、DeepSeek 等 AI 对话，AI 会返回一段「名称 + 背景 + 图标色 + 代码」。把 AI 的整段回复粘到下面框里，点保存即可。',
      }),
      promptArea,
      h('div', { class: 'flex items-center justify-end' }, [
        createCopyButton(() => promptArea.value, '📋 复制提示词', '已复制 ✓'),
      ]),
    ]);

    // —— 步骤 3：粘贴 AI 返回的代码 + 保存 ——
    const pasteInput = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows: 10,
      spellcheck: false,
      'aria-label': '粘贴 AI 返回的代码（含名称/背景/图标色注释）',
      placeholder:
        '把 AI 的整段回复粘到这里（代码块首三行形如「// 名称：星河」「// 背景：...」「// 图标色：...」，后面是 ```js 代码）。工具会自动识别并生成缩略图。',
    }) as HTMLTextAreaElement;
    const step3 = h('div', { class: 'hidden space-y-2' }, [
      h('label', {
        class: 'block text-xs font-medium text-[var(--fg-muted)]',
        textContent: '③ 粘贴 AI 返回的代码（含名称/背景/图标色注释）',
      }),
      pasteInput,
      h('div', { class: 'flex items-center justify-end gap-2' }, [
        h('button', {
          type: 'button',
          class:
            'rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--fg-muted)] hover:border-[var(--accent)] transition-colors',
          textContent: '取消',
          onclick: closeDialog,
        }),
        h('button', {
          type: 'button',
          class:
            'rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
          textContent: '保存并应用',
          onclick: save,
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
      promptArea.value = buildTemplatePrompt(desc);
      step2.classList.remove('hidden');
      step3.classList.remove('hidden');
      promptArea.scrollTop = 0;
    }

    function save(): void {
      const parsed = parseTemplateAIOutput(pasteInput.value);
      if (!parsed.name) {
        flashError('没识别到名称——AI 返回的代码块首行应是「// 名称：星河」这样的注释。');
        pasteInput.focus();
        return;
      }
      if (!parsed.code) {
        flashError('没识别到代码——请把 AI 的整段回复（含 ```js 代码块）粘进来。');
        pasteInput.focus();
        return;
      }
      // dryRun：在离屏 1080×1080 容器上试渲染（须挂载到文档，svg 才有真实 boundingBox）
      const sandbox = h('div', {
        style:
          'position:fixed;left:-99999px;top:0;width:1080px;height:1080px;box-sizing:border-box;',
      });
      document.body.append(sandbox);
      let check: { ok: boolean; reason?: string };
      try {
        check = dryRunTemplateCheck(parsed.code, sandbox, state.quote);
      } finally {
        sandbox.remove();
      }
      if (!check.ok) {
        flashError(check.reason ?? '代码有问题，无法保存。');
        return;
      }
      const list = addCustomTemplate(parsed.name, parsed.code, parsed.background, parsed.iconColor);
      const saved = list.find((it) => it.name.trim() === parsed.name)!;
      state.templateId = saved.id;
      rebuildTemplateGrid();
      rerenderCard(); // 立即应用新模板
      persistDraft();
      flashOk(`已保存「${parsed.name}」并应用，关闭后即可看到效果。`);
      setTimeout(closeDialog, 700);
    }

    const card = h(
      'div',
      {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '用 AI 生成自定义模板',
        class:
          'w-[min(92vw,42rem)] rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-2xl',
      },
      [
        h('div', { class: 'mb-1 flex items-center justify-between gap-2' }, [
          h('span', {
            class: 'text-sm font-semibold text-[var(--fg)]',
            textContent: '💡 用 AI 生成自定义模板',
          }),
          h('button', {
            type: 'button',
            'aria-label': '关闭',
            class: 'text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors',
            textContent: '✕',
            onclick: closeDialog,
          }),
        ]),
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
        h('div', { class: 'mt-3' }, [
          h('label', {
            class: 'mb-1 block text-xs font-medium text-[var(--fg-muted)]',
            textContent: '② 复制提示词给 AI',
          }),
          step2,
        ]),
        step3,
        statusRow,
        h('p', {
          class: 'mt-3 text-center text-[11px] text-[var(--fg-muted)]',
          textContent: '数据不出本地 · 代码仅在你自己的浏览器运行 · 支持 AI 内嵌 SVG 图形',
        }),
      ],
    );

    dialogEl = mountDialog(card);
    requestAnimationFrame(() => descInput.focus());
  }

  return { openHelpDialog, openTemplateDialog };
}
