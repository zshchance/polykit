/**
 * 文字快闪视频 —— 💡 AI 两向导（入场动效 / 风格方案）。
 *
 * 骨架参照 slide-video/ai-dialogs.ts：
 * ① 描述 → ② 组装提示词（可复制给任意 AI 或 ⚡ 直连流式生成）→
 * ③ 粘贴回填 → 校验通过后保存即在选择区出现并应用。
 *
 * 动效向导第③步内嵌演播画布（保存前即可看到动态效果）：用当前主题 /
 * 比例 / 字体，循环演播一张样张卡的入场动效；风格方案向导展示真实样张。
 *
 * 依赖方向：依赖 core 的 h()/复制按钮/AI 运行器与 custom-motions /
 * custom-schemes 的提示词、解析与校验；选项写入与 UI 刷新由 main.ts 通过
 * createAiDialogs(deps) 显式注入。
 */

import { h } from '@/core/components/element';
import { createCopyButton } from '@/core/components/CopyButton';
import { createAiRunner, extractCodeBlock } from '@/core/ai/ai-assist';

import {
  BACKGROUNDS,
  FONTS,
  LAYOUTS,
  MOTIONS,
  type FlashOptions,
  type MotionDraw,
  type Theme,
} from './options';
import type { Card } from './script';
import { drawFrame, drawSampleCard, type RenderInput } from './renderer';
import {
  addCustomScheme,
  buildSchemePrompt,
  parseSchemeAIOutput,
  schemePreviewTheme,
  type ParsedScheme,
} from './custom-schemes';
import {
  addCustomMotion,
  buildMotionPrompt,
  compileMotionForPreview,
  dryRunMotion,
  invalidateMotionCache,
  parseMotionAIOutput,
} from './custom-motions';

/** 三步向导第②步的「⚡ 直接生成」附件（两向导共用）：直连运行器 + 按钮 */
function buildDirectGen(opts: {
  conversationTitle: string;
  getPrompt: () => string;
  fill: (text: string) => void;
  notify: () => void;
}): { btn: HTMLElement; picker: HTMLElement; runnerEl: HTMLElement } {
  const runner = createAiRunner({
    toolSlug: 'word-flash',
    conversationTitle: opts.conversationTitle,
    onDone: (text) => {
      opts.fill(extractCodeBlock(text) ?? text);
      opts.notify();
    },
  });
  const btn = h('button', {
    type: 'button',
    class:
      'rounded-md border border-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-fg)]',
    textContent: '⚡ 直接生成',
    title: '用「AI 接入设置」里配置的模型直接生成，结果自动填入第③步',
    onclick: () => runner.run(opts.getPrompt()),
  });
  return { btn, picker: runner.modelPicker, runnerEl: runner.el };
}

/** createAiDialogs 的依赖（由 main.ts 注入） */
export interface WordFlashAiDialogsDeps {
  /** 当前主题（样张与演播画布用，保证所见即所得） */
  getTheme: () => Theme;
  /** 当前完整选项（演播按当前比例/强调/进度条） */
  getOptions: () => FlashOptions;
  /** 自定义动效保存并应用后：选中该 id 并刷新 chips/预览 */
  onMotionApplied: (id: string) => void;
  /** 风格方案保存后：应用配色（创建/覆盖同名自定义主题）+ 合并选项 + 刷新 UI */
  onSchemeApplied: (scheme: ParsedScheme) => void;
}

export interface WordFlashAiDialogs {
  openMotionDialog: () => void;
  openSchemeDialog: () => void;
}

const SCHEME_SAMPLE: Card = { text: '快闪，就该这么简单', em: true, title: false };
const MOTION_SAMPLE: Card = { text: '文字快闪', em: true, title: false };

/** 当前主题 + 用户覆盖主色后的实际渲染主题 */
function effectiveTheme(theme: Theme, opts: FlashOptions): Theme {
  return opts.accentColor ? { ...theme, accent: opts.accentColor } : theme;
}

/**
 * 启动 rAF 演播循环；返回停止函数。
 * 工具侧代码允许 performance.now（确定性禁令只约束 AI 函数体）。
 */
function startDemoLoop(
  canvas: HTMLCanvasElement,
  draw: (t: number) => boolean,
  onDead: () => void,
): () => void {
  const ctx = canvas.getContext('2d');
  let raf = 0;
  let alive = true;
  if (!ctx) {
    onDead();
    return () => undefined;
  }
  const t0 = performance.now();
  const loop = (): void => {
    if (!alive) return;
    const t = (performance.now() - t0) / 1000;
    if (!draw(t)) {
      alive = false;
      onDead();
      return;
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => {
    alive = false;
    cancelAnimationFrame(raf);
  };
}

export function createAiDialogs(deps: WordFlashAiDialogsDeps): WordFlashAiDialogs {
  // 单实例 guard：同时只允许一个模态
  let dialogEl: HTMLElement | null = null;
  /** 演播循环停止函数（模态关闭时必须停，防泄漏） */
  let stopPreview: (() => void) | null = null;

  function closeDialog(): void {
    stopPreview?.();
    stopPreview = null;
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

  /** 通用浮层壳：遮罩 + 居中卡片 + Esc/点遮罩关闭 */
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

  /** 状态行 + 就地提示（两向导共用工厂） */
  function makeFlash(): {
    statusRow: HTMLElement;
    flashError: (msg: string) => void;
    flashOk: (msg: string) => void;
  } {
    const statusRow = h('div', { class: 'min-h-[1.25rem] text-xs' });
    const flashError = (msg: string): void => {
      statusRow.textContent = msg ? '⚠ ' + msg : '';
      statusRow.style.color = 'var(--holiday-legal)';
    };
    const flashOk = (msg: string): void => {
      statusRow.textContent = '✓ ' + msg;
      statusRow.style.color = '#22c55e';
    };
    return { statusRow, flashError, flashOk };
  }

  /** 模态卡片头（标题 + 关闭钮）与底部隐私文案（两向导共用工厂） */
  function dialogHead(title: string): HTMLElement {
    return h('div', { class: 'mb-1 flex items-center justify-between gap-2' }, [
      h('span', { class: 'text-sm font-semibold text-[var(--fg)]', textContent: title }),
      h('button', {
        type: 'button',
        'aria-label': '关闭',
        class: 'text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors',
        textContent: '✕',
        onclick: closeDialog,
      }),
    ]);
  }

  const privacyNote = h('p', {
    class: 'mt-3 text-center text-[11px] text-[var(--fg-muted)]',
    textContent: '数据不出本地 · 代码仅在你自己的浏览器运行',
  });

  const textareaCls =
    'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]';
  const monoCls =
    'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]';

  function cancelBtn(): HTMLElement {
    return h('button', {
      type: 'button',
      class:
        'rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--fg-muted)] hover:border-[var(--accent)] transition-colors',
      textContent: '取消',
      onclick: closeDialog,
    });
  }

  function saveBtn(label: string, onclick: () => void): HTMLElement {
    return h('button', {
      type: 'button',
      class:
        'rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
      textContent: label,
      onclick,
    });
  }

  /** 三步布局的①②③骨架（两向导共用：desc → 提示词步骤 → 回填步骤） */
  function wizardSteps(
    title: string,
    descPlaceholder: string,
    onGenerate: (desc: string) => void,
    step2: HTMLElement,
    step3: HTMLElement,
    statusRow: HTMLElement,
  ): { card: HTMLElement; descInput: HTMLTextAreaElement } {
    const descInput = h('textarea', {
      class: textareaCls,
      rows: 3,
      'aria-label': '想要的效果描述',
      placeholder: descPlaceholder,
    }) as HTMLTextAreaElement;
    const card = h(
      'div',
      {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': title,
        class:
          'w-[min(92vw,42rem)] rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-2xl',
      },
      [
        dialogHead(title),
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
              onclick: () => {
                const desc = descInput.value.trim();
                if (!desc) {
                  statusRow.textContent = '⚠ 请先描述你想要的效果。';
                  statusRow.style.color = 'var(--holiday-legal)';
                  descInput.focus();
                  return;
                }
                onGenerate(desc);
              },
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
        privacyNote,
      ],
    );
    return { card, descInput };
  }

  /** 第②步通用内容（说明 + 提示词框 + 复制/直连按钮） */
  function promptStep(opts: {
    hint: string;
    conversationTitle: string;
    fill: (text: string) => void;
    notify: () => void;
  }): { wrap: HTMLElement; promptArea: HTMLTextAreaElement } {
    const promptArea = h('textarea', {
      class: monoCls,
      rows: 10,
      readonly: true,
      'aria-label': '生成的 AI 提示词',
    }) as HTMLTextAreaElement;
    const direct = buildDirectGen({
      conversationTitle: opts.conversationTitle,
      getPrompt: () => promptArea.value,
      fill: opts.fill,
      notify: opts.notify,
    });
    const wrap = h('div', { class: 'hidden space-y-2' }, [
      h('p', {
        class: 'text-xs leading-relaxed text-[var(--fg-muted)]',
        textContent: opts.hint,
      }),
      promptArea,
      h('div', { class: 'flex flex-wrap items-center justify-end gap-2' }, [
        createCopyButton(() => promptArea.value, '📋 复制提示词', '已复制 ✓'),
        direct.picker,
        direct.btn,
      ]),
      direct.runnerEl,
    ]);
    return { wrap, promptArea };
  }

  function revealSteps(
    promptArea: HTMLTextAreaElement,
    step2: HTMLElement,
    step3: HTMLElement,
  ): void {
    step2.classList.remove('hidden');
    step3.classList.remove('hidden');
    promptArea.scrollTop = 0;
  }

  // ══════════ 💡 向导一：AI 生成自定义入场动效 ══════════
  function openMotionDialog(): void {
    if (dialogEl) closeDialog();
    const { statusRow, flashError, flashOk } = makeFlash();

    const pasteInput = h('textarea', {
      class: monoCls,
      rows: 10,
      spellcheck: false,
      'aria-label': '粘贴 AI 返回的代码（含名称注释）',
      placeholder:
        '把 AI 的整段回复粘到这里（代码块首行形如「// 名称：逐行弹跳」，后面是 ```js 代码）。工具会自动识别名称和代码。',
    }) as HTMLTextAreaElement;

    // 演播画布：按当前比例换算尺寸（短边 300，宽度上限 480）
    const baseOpts = deps.getOptions();
    const aspect = { '9:16': 9 / 16, '16:9': 16 / 9, '1:1': 1, '4:3': 4 / 3 }[
      baseOpts.aspect
    ] ?? 9 / 16;
    const demoShort = 300;
    let demoW = Math.round((demoShort * aspect) / 2) * 2;
    let demoH = demoShort;
    if (demoW > 480) {
      demoW = 480;
      demoH = Math.round((demoW / aspect) / 2) * 2;
    }

    const previewCanvas = h('canvas', {
      class: 'hidden mx-auto rounded-lg border border-[var(--border)] bg-black',
      width: demoW,
      height: demoH,
      style: `width:auto;height:${demoH}px;max-width:100%`,
    }) as HTMLCanvasElement;
    const previewNote = h('p', {
      class: 'hidden text-[11px] text-[var(--fg-muted)]',
      textContent: '▲ 样张卡片循环演播（用当前主题 / 比例 / 强调样式）——保存后主预览即应用',
    });

    /** 构建 1 张卡的演播输入（时间轴固定 1.6s 一张） */
    function demoInput(draw: MotionDraw): RenderInput {
      const opts = deps.getOptions();
      const theme = effectiveTheme(deps.getTheme(), opts);
      const timeline = {
        cards: 1,
        durations: [1.6],
        starts: [0],
        total: 1.6,
        beatSynced: false,
      };
      return {
        opts,
        theme,
        cards: [MOTION_SAMPLE],
        timeline,
        customMotion: draw,
        epoch: 0,
      };
    }

    /** 解析 + 编译并开始样张演播；失败红字提示 */
    function runPreview(): boolean {
      stopPreview?.();
      stopPreview = null;
      const parsed = parseMotionAIOutput(pasteInput.value);
      if (!parsed.ok) {
        flashError(parsed.reason);
        return false;
      }
      const compiled = compileMotionForPreview(parsed.code);
      if (!compiled.ok) {
        flashError(compiled.reason);
        return false;
      }
      previewCanvas.classList.remove('hidden');
      previewNote.classList.remove('hidden');
      flashError('');
      const input = demoInput(compiled.draw);
      const ctx2 = previewCanvas.getContext('2d');
      if (!ctx2) return false;
      stopPreview = startDemoLoop(
        previewCanvas,
        (t) => {
          const cycle = t % 2.4; // 演播 1.6s 一张，再静置 0.8s
          drawFrame(ctx2, demoW, demoH, input, Math.min(cycle, input.timeline.total - 0.001));
          return true;
        },
        () => flashError('代码运行中断（守卫已停用）——请检查后重试或重新生成。'),
      );
      return true;
    }

    const step3 = h('div', { class: 'hidden space-y-2' }, [
      h('label', {
        class: 'block text-xs font-medium text-[var(--fg-muted)]',
        textContent: '③ 粘贴 AI 返回的代码（含名称注释）',
      }),
      pasteInput,
      h('div', { class: 'flex flex-wrap items-center gap-2' }, [
        h('button', {
          type: 'button',
          class:
            'rounded-md border border-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-fg)]',
          textContent: '▶ 演播效果',
          title: '用样张卡片循环演播这段动效代码',
          onclick: () => void runPreview(),
        }),
      ]),
      previewCanvas,
      previewNote,
      h('div', { class: 'flex items-center justify-end gap-2' }, [
        cancelBtn(),
        saveBtn('保存并应用', save),
      ]),
    ]);

    function save(): void {
      const parsed = parseMotionAIOutput(pasteInput.value);
      if (!parsed.ok) {
        flashError(parsed.reason);
        pasteInput.focus();
        return;
      }
      // 保存前完整校验：静态扫描 + 编译 + 两帧像素校验
      const check = dryRunMotion(parsed.code);
      if (!check.ok) {
        flashError(check.reason ?? '代码有问题，无法保存。');
        return;
      }
      const items = addCustomMotion(parsed.name, parsed.code);
      const saved = items.find((it) => it.name.trim() === parsed.name.trim());
      if (!saved) {
        flashError('保存失败，请重试。');
        return;
      }
      invalidateMotionCache(saved.id); // 同名覆盖时代码可能已变
      deps.onMotionApplied(saved.id);
      flashOk(`已保存「${saved.name}」并应用，关闭后即可在预览看到效果。`);
      setTimeout(closeDialog, 700);
    }

    const step2 = promptStep({
      hint: '把这段提示词复制到 ChatGPT、豆包、DeepSeek 等 AI 对话，或点「直接生成」走已配置的模型；AI 会返回一段「名称 + 绘制代码」。',
      conversationTitle: 'AI 自定义快闪动效',
      fill: (code) => {
        pasteInput.value = code;
        pasteInput.scrollTop = 0;
        runPreview(); // 直连返回后立即演播，所见即所得
      },
      notify: () => flashOk('AI 已返回并自动填入 ③，正在演播预览——满意后点「保存并应用」'),
    });

    const { card, descInput } = wizardSteps(
      '💡 用 AI 生成自定义入场动效',
      '描述你想要的入场效果，例如：文字像被磁铁吸住一样从下方快速吸附到位，带一点回弹；或：每个字从画面四周飞入并旋转归位，最后整体闪一下主色。',
      (desc) => {
        flashError('');
        step2.promptArea.value = buildMotionPrompt(desc);
        revealSteps(step2.promptArea, step2.wrap, step3);
      },
      step2.wrap,
      step3,
      statusRow,
    );
    dialogEl = mountDialog(card);
    requestAnimationFrame(() => descInput.focus());
  }

  // ══════════ 💡 向导二：AI 生成整套风格方案 ══════════
  function openSchemeDialog(): void {
    if (dialogEl) closeDialog();
    const { statusRow, flashError, flashOk } = makeFlash();

    const pasteInput = h('textarea', {
      class: monoCls,
      rows: 8,
      spellcheck: false,
      'aria-label': '粘贴 AI 返回的 JSON（含名称与配色）',
      placeholder:
        '把 AI 的整段回复粘到这里（形如 ```json { "name": "霓虹脉冲", "bg1": "#0a0618", … } ```）。工具会自动解析并校验。',
    }) as HTMLTextAreaElement;

    const summaryWrap = h('div', { class: 'hidden space-y-2' }, []);
    let lastParsed: ParsedScheme | null = null;

    /** 枚举 id → 展示名（目录来自 options.ts 真实常量） */
    function enumLabel(id: string): string {
      for (const list of [LAYOUTS, BACKGROUNDS, FONTS, MOTIONS]) {
        const hit = (list as readonly { id: string; label: string }[]).find((it) => it.id === id);
        if (hit) return hit.label;
      }
      return id;
    }

    /** 解析并渲染摘要；失败红字提示 */
    function runSummary(): boolean {
      lastParsed = null;
      const parsed = parseSchemeAIOutput(pasteInput.value);
      if (!parsed.ok) {
        summaryWrap.classList.add('hidden');
        flashError(parsed.reason);
        return false;
      }
      const s = parsed.scheme;
      lastParsed = s;
      const chip = (text: string): HTMLElement =>
        h(
          'span',
          {
            class:
              'rounded-full border border-[var(--border)] bg-[var(--bg)] px-2.5 py-0.5 text-xs text-[var(--fg-muted)]',
          },
          [text],
        );
      const swatchBlock = (color: string, label: string): HTMLElement =>
        h('div', { class: 'flex flex-col items-center gap-1' }, [
          h('div', {
            class: 'h-8 w-12 rounded-md border border-[var(--border)]',
            style: `background:${color}`,
          }),
          h('span', { class: 'text-[10px] text-[var(--fg-muted)]', textContent: label }),
        ]);
      const applied: string[] = [];
      if (s.design) {
        applied.push(
          enumLabel(s.design.layout),
          enumLabel(s.design.background),
          enumLabel(s.design.font),
        );
      }
      if (s.motion) applied.push(enumLabel(s.motion));
      const sample = h('canvas', {
        width: 480,
        height: 270,
        class: 'aspect-video w-full rounded-lg border border-[var(--border)] shadow-sm',
      }) as HTMLCanvasElement;
      const sampleCtx = sample.getContext('2d');
      if (sampleCtx) {
        drawSampleCard(sampleCtx, 480, 270, schemePreviewTheme(s), SCHEME_SAMPLE, s.design?.font ?? null);
      }
      summaryWrap.replaceChildren(
        sample,
        h('p', { class: 'text-sm font-medium text-[var(--fg)]', textContent: `方案：${s.name}` }),
        h('div', { class: 'flex items-end gap-2' }, [
          swatchBlock(s.colors.bg1, '背景起'),
          swatchBlock(s.colors.bg2, '背景止'),
          swatchBlock(s.colors.fg, '文字'),
          swatchBlock(s.colors.accent, '主色'),
          h('div', {
            class: 'h-8 flex-1 rounded-md border border-[var(--border)]',
            style: `background:linear-gradient(135deg,${s.colors.bg1},${s.colors.bg2})`,
          }),
        ]),
        applied.length > 0
          ? h('div', { class: 'flex flex-wrap items-center gap-1.5' }, [
              h('span', {
                class: 'text-xs text-[var(--fg-muted)]',
                textContent: '将应用：',
              }),
              ...applied.map(chip),
            ])
          : h('p', {
              class: 'text-xs text-[var(--fg-muted)]',
              textContent: '（方案未指定版式选项，只应用配色）',
            }),
      );
      summaryWrap.classList.remove('hidden');
      flashError('');
      return true;
    }

    const step3 = h('div', { class: 'hidden space-y-2' }, [
      h('label', {
        class: 'block text-xs font-medium text-[var(--fg-muted)]',
        textContent: '③ 粘贴 AI 返回的 JSON',
      }),
      pasteInput,
      h('div', { class: 'flex flex-wrap items-center gap-2' }, [
        h('button', {
          type: 'button',
          class:
            'rounded-md border border-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-fg)]',
          textContent: '🔍 解析预览',
          title: '解析 JSON 并展示真实样张与将应用的选项',
          onclick: () => void runSummary(),
        }),
      ]),
      summaryWrap,
      h('div', { class: 'flex items-center justify-end gap-2' }, [
        cancelBtn(),
        saveBtn('保存并应用', save),
      ]),
    ]);

    function save(): void {
      if (!lastParsed && !runSummary()) return;
      const s = lastParsed!;
      addCustomScheme({
        name: s.name,
        bg1: s.colors.bg1,
        bg2: s.colors.bg2,
        fg: s.colors.fg,
        accent: s.colors.accent,
        ...(s.design ? { design: s.design } : {}),
        ...(s.motion !== undefined ? { motion: s.motion } : {}),
      });
      deps.onSchemeApplied(s);
      flashOk(`已保存「${s.name}」并应用——主题与选项已同步到设置区。`);
      setTimeout(closeDialog, 700);
    }

    const step2 = promptStep({
      hint: '把这段提示词复制到 ChatGPT、豆包、DeepSeek 等 AI 对话，或点「直接生成」走已配置的模型；AI 会返回一个 ```json 风格方案。',
      conversationTitle: 'AI 快闪风格方案',
      fill: (text) => {
        pasteInput.value = text;
        pasteInput.scrollTop = 0;
        runSummary();
      },
      notify: () => flashOk('AI 已返回并自动填入 ③，请核对真实样张后点「保存并应用」'),
    });

    const { card, descInput } = wizardSteps(
      '💡 用 AI 生成整套风格方案',
      '描述你想要的完整视觉风格，例如：深夜电竞霓虹，深蓝紫底、超粗白字、青色主色、流光背景与弹入动效；或：复古报纸风，米白纸底、宋体大标题、红色色带和擦除入场。AI 会同时设计配色、版式、字体与动效。',
      (desc) => {
        flashError('');
        step2.promptArea.value = buildSchemePrompt(desc);
        revealSteps(step2.promptArea, step2.wrap, step3);
      },
      step2.wrap,
      step3,
      statusRow,
    );
    dialogEl = mountDialog(card);
    requestAnimationFrame(() => descInput.focus());
  }

  return { openMotionDialog, openSchemeDialog };
}
