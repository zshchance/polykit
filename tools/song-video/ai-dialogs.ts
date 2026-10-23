/**
 * 歌曲生成视频 —— 💡 AI 生成自定义频谱样式 / AI 风格方案（两个三步合一模态）。
 *
 * 骨架参照 quote-card/ai-dialogs.ts：① 描述 → ② 组装提示词（可复制给任意 AI
 * 或 ⚡ 直连流式生成）→ ③ 粘贴回填 → 校验通过后保存即在选择区出现并应用。
 *
 * 两个向导各自的第③步预览是本工具的增强：
 *   - 频谱向导：内嵌「合成频谱演播画布」（正弦+噪声合成 bands，无需真音频，
 *     用当前主题实时演播 AI 代码，保存前即可看到动态效果）；
 *   - 风格向导：色板条 + 将应用的版式选项摘要。
 *
 * 依赖方向：依赖 core 的 h()/复制按钮/AI 运行器与 custom-visualizers /
 * custom-styles 的提示词、解析与校验；选项写入与 UI 刷新由 main.ts 通过
 * createAiDialogs(deps) 显式注入（本模块不直接触碰工具主状态）。
 */

import { h } from '@/core/components/element';
import { createCopyButton } from '@/core/components/CopyButton';
import { createAiRunner, extractCodeBlock } from '@/core/ai/ai-assist';

import {
  COVER_STYLES,
  INTRO_ANIMS,
  LYRIC_MODES,
  OUTRO_ANIMS,
  PROGRESS_BARS,
  VISUALIZERS,
  type Theme,
} from './options';
import type { ParsedStyle } from './custom-styles';
import {
  addCustomVisualizer,
  buildVisualizerPrompt,
  compileVisualizerForPreview,
  dryRunVisualizer,
  invalidateVisualizerCache,
  parseVisualizerAIOutput,
  syntheticBands,
} from './custom-visualizers';
import { addCustomStyle, buildStylePrompt, parseStyleAIOutput } from './custom-styles';

/** 三步向导第②步的「⚡ 直接生成」附件（两个对话框共用）：直连运行器 + 按钮 */
function buildDirectGen(opts: {
  conversationTitle: string;
  getPrompt: () => string;
  fill: (text: string) => void;
  notify: () => void;
}): { btn: HTMLElement; picker: HTMLElement; runnerEl: HTMLElement } {
  const runner = createAiRunner({
    toolSlug: 'song-video',
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
export interface SongVideoAiDialogsDeps {
  /** 当前渲染主题（频谱演播画布用，保证所见即所得） */
  getTheme: () => Theme;
  /** 自定义频谱保存并应用后：选中该 id 并刷新 chips/预览 */
  onVisualizerApplied: (id: string) => void;
  /** 风格方案保存后：应用配色（创建/覆盖同名自定义主题）+ 合并版式选项 + 刷新 UI */
  onStyleApplied: (style: ParsedStyle) => void;
}

/** AI 模态 API：两个入口（单实例 guard 内部持有） */
export interface SongVideoAiDialogs {
  /** 打开「用 AI 生成自定义频谱样式」模态 */
  openVisualizerDialog: () => void;
  /** 打开「用 AI 生成整套风格方案」模态 */
  openStyleDialog: () => void;
}

// ─────────────────────────── 合成频谱演播画布 ───────────────────────────

/** 演播画布尺寸（16:9 小画布，足可观察效果） */
const DEMO_W = 480;
const DEMO_H = 270;
/** 演播画布里的封面盘几何（对齐 renderer.layoutOf 横版比例） */
const DEMO_LAYOUT = { coverCx: DEMO_W / 2, coverCy: DEMO_H * 0.36, coverR: DEMO_H * 0.17 };

/** 演播底图：主题渐变 + 封面盘占位圆（频谱画在其上，接近真实画面层次） */
function drawDemoBase(ctx: CanvasRenderingContext2D, theme: Theme): void {
  const g = ctx.createLinearGradient(0, 0, DEMO_W * 0.35, DEMO_H);
  g.addColorStop(0, theme.bg[0]);
  g.addColorStop(1, theme.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, DEMO_W, DEMO_H);
  ctx.save();
  ctx.beginPath();
  ctx.arc(DEMO_LAYOUT.coverCx, DEMO_LAYOUT.coverCy, DEMO_LAYOUT.coverR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(128,128,128,0.18)';
  ctx.fill();
  ctx.strokeStyle = theme.muted;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/**
 * 启动演播循环；返回停止函数。draw 返回 false（守卫已放弃）时停止并提示。
 * 工具侧代码允许 performance.now（确定性禁令只约束 AI 函数体）。
 */
function startDemoLoop(
  canvas: HTMLCanvasElement,
  draw: (frame: {
    ctx: CanvasRenderingContext2D;
    bands: Uint8Array;
    t: number;
  }) => boolean,
  onDead: () => void,
): () => void {
  const ctx = canvas.getContext('2d');
  let raf = 0;
  let alive = true;
  const bands = new Uint8Array(64);
  const t0 = performance.now();
  if (!ctx) {
    onDead();
    return () => undefined;
  }
  const loop = (): void => {
    if (!alive) return;
    const t = (performance.now() - t0) / 1000;
    syntheticBands(64, t, bands);
    if (!draw({ ctx, bands, t })) {
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

export function createAiDialogs(deps: SongVideoAiDialogsDeps): SongVideoAiDialogs {
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

  /** 通用浮层壳：遮罩 + 居中卡片 + Esc/点遮罩关闭（同 quote-card：短屏居中/长屏可滚） */
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
  function onDialogEsc(e: KeyboardEvent): void {
    if (e.key === 'Escape' && dialogEl) {
      e.preventDefault();
      closeDialog();
    }
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

  // ══════════ 💡 向导一：AI 生成自定义频谱样式 ══════════
  function openVisualizerDialog(): void {
    if (dialogEl) closeDialog();
    const { statusRow, flashError, flashOk } = makeFlash();

    // —— 步骤 1：描述 ——
    const descInput = h('textarea', {
      class: textareaCls,
      rows: 3,
      'aria-label': '想要的频谱效果描述',
      placeholder:
        '描述你想要的频谱效果，例如：底部一圈流动的粒子光带，随低频鼓点炸开涟漪；或：环绕封面的放射线，随节奏呼吸并缓慢旋转。',
    }) as HTMLTextAreaElement;

    // —— 步骤 2：提示词 + ⚡ 直连 ——
    const promptArea = h('textarea', {
      class: monoCls,
      rows: 10,
      readonly: true,
      'aria-label': '生成的 AI 提示词',
    }) as HTMLTextAreaElement;
    const direct = buildDirectGen({
      conversationTitle: 'AI 自定义频谱样式',
      getPrompt: () => promptArea.value,
      fill: (code) => {
        pasteInput.value = code;
        pasteInput.scrollTop = 0;
        runPreview(); // 直连返回后立即演播，所见即所得
      },
      notify: () => flashOk('AI 已返回并自动填入 ③，正在演播预览——满意后点「保存并应用」'),
    });
    const step2 = h('div', { class: 'hidden space-y-2' }, [
      h('p', {
        class: 'text-xs leading-relaxed text-[var(--fg-muted)]',
        textContent:
          '把这段提示词复制到 ChatGPT、豆包、DeepSeek 等 AI 对话，或点「直接生成」走已配置的模型；AI 会返回一段「名称 + 绘制代码」。',
      }),
      promptArea,
      h('div', { class: 'flex flex-wrap items-center justify-end gap-2' }, [
        createCopyButton(() => promptArea.value, '📋 复制提示词', '已复制 ✓'),
        direct.picker,
        direct.btn,
      ]),
      direct.runnerEl,
    ]);

    // —— 步骤 3：粘贴 + 合成频谱演播 + 保存 ——
    const pasteInput = h('textarea', {
      class: monoCls,
      rows: 10,
      spellcheck: false,
      'aria-label': '粘贴 AI 返回的代码（含名称注释）',
      placeholder:
        '把 AI 的整段回复粘到这里（代码块首行形如「// 名称：极光幕帘」，后面是 ```js 代码）。工具会自动识别名称和代码。',
    }) as HTMLTextAreaElement;

    const previewCanvas = h('canvas', {
      class: 'hidden w-full rounded-lg border border-[var(--border)] bg-black',
      width: DEMO_W,
      height: DEMO_H,
    }) as HTMLCanvasElement;
    const previewNote = h('p', {
      class: 'hidden text-[11px] text-[var(--fg-muted)]',
      textContent: '▲ 合成频谱演播（正弦模拟音乐能量，用当前配色主题）——保存后可在右侧预览用真实音乐检验',
    });

    /** 解析 + 编译并开始演播；失败红字提示。返回是否成功 */
    function runPreview(): boolean {
      stopPreview?.();
      stopPreview = null;
      const parsed = parseVisualizerAIOutput(pasteInput.value);
      if (!parsed.ok) {
        flashError(parsed.reason);
        return false;
      }
      const compiled = compileVisualizerForPreview(parsed.code);
      if (!compiled.ok) {
        flashError(compiled.reason);
        return false;
      }
      const theme = deps.getTheme();
      previewCanvas.classList.remove('hidden');
      previewNote.classList.remove('hidden');
      flashError('');
      const draw = compiled.draw;
      const wave = new Uint8Array(2048).fill(128);
      stopPreview = startDemoLoop(
        previewCanvas,
        ({ ctx, bands, t }) => {
          drawDemoBase(ctx, theme);
          return draw({
            ctx,
            W: DEMO_W,
            H: DEMO_H,
            S: DEMO_H,
            bands,
            wave,
            t,
            dur: 180,
            theme,
            layout: DEMO_LAYOUT,
          });
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
          title: '用合成频谱数据实时演播这段代码',
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

    function generate(): void {
      const desc = descInput.value.trim();
      if (!desc) {
        flashError('请先描述你想要的效果。');
        descInput.focus();
        return;
      }
      flashError('');
      promptArea.value = buildVisualizerPrompt(desc);
      step2.classList.remove('hidden');
      step3.classList.remove('hidden');
      promptArea.scrollTop = 0;
    }

    function save(): void {
      const parsed = parseVisualizerAIOutput(pasteInput.value);
      if (!parsed.ok) {
        flashError(parsed.reason);
        pasteInput.focus();
        return;
      }
      // 保存前完整校验：静态扫描 + 编译 + 离屏画布像素校验（一帧必须画出可见内容）
      const check = dryRunVisualizer(parsed.code);
      if (!check.ok) {
        flashError(check.reason ?? '代码有问题，无法保存。');
        return;
      }
      const items = addCustomVisualizer(parsed.name, parsed.code);
      const saved = items.find((it) => it.name.trim() === parsed.name.trim());
      if (!saved) {
        flashError('保存失败，请重试。');
        return;
      }
      invalidateVisualizerCache(saved.id); // 同名覆盖时代码可能已变
      deps.onVisualizerApplied(saved.id);
      flashOk(`已保存「${saved.name}」并应用，关闭后即可在预览看到效果。`);
      setTimeout(closeDialog, 700);
    }

    const card = h(
      'div',
      {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '用 AI 生成自定义频谱样式',
        class:
          'w-[min(92vw,42rem)] rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-2xl',
      },
      [
        dialogHead('💡 用 AI 生成自定义频谱样式'),
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

    dialogEl = mountDialog(card);
    requestAnimationFrame(() => descInput.focus());
  }

  // ══════════ 💡 向导二：AI 生成整套风格方案 ══════════
  function openStyleDialog(): void {
    if (dialogEl) closeDialog();
    const { statusRow, flashError, flashOk } = makeFlash();

    const descInput = h('textarea', {
      class: textareaCls,
      rows: 3,
      'aria-label': '想要的视频风格描述',
      placeholder:
        '描述你想要的整套风格，例如：赛博朋克霓虹夜店，深紫背景 + 青粉霓虹主色，镜像频谱 + 滚动歌词；或：民谣清晨感，奶油色浅底配暖棕，声波曲线 + 单行歌词。',
    }) as HTMLTextAreaElement;

    const promptArea = h('textarea', {
      class: monoCls,
      rows: 10,
      readonly: true,
      'aria-label': '生成的 AI 提示词',
    }) as HTMLTextAreaElement;
    const direct = buildDirectGen({
      conversationTitle: 'AI 风格方案',
      getPrompt: () => promptArea.value,
      fill: (text) => {
        pasteInput.value = text;
        pasteInput.scrollTop = 0;
        runSummary();
      },
      notify: () => flashOk('AI 已返回并自动填入 ③，请核对色板后点「保存并应用」'),
    });
    const step2 = h('div', { class: 'hidden space-y-2' }, [
      h('p', {
        class: 'text-xs leading-relaxed text-[var(--fg-muted)]',
        textContent:
          '把这段提示词复制到 ChatGPT、豆包、DeepSeek 等 AI 对话，或点「直接生成」走已配置的模型；AI 会返回一个 ```json 风格方案。',
      }),
      promptArea,
      h('div', { class: 'flex flex-wrap items-center justify-end gap-2' }, [
        createCopyButton(() => promptArea.value, '📋 复制提示词', '已复制 ✓'),
        direct.picker,
        direct.btn,
      ]),
      direct.runnerEl,
    ]);

    const pasteInput = h('textarea', {
      class: monoCls,
      rows: 8,
      spellcheck: false,
      'aria-label': '粘贴 AI 返回的 JSON（含名称与配色）',
      placeholder:
        '把 AI 的整段回复粘到这里（形如 ```json { "name": "霓虹夜店", "bg1": "#0b1026", … } ```）。工具会自动解析并校验。',
    }) as HTMLTextAreaElement;

    // 摘要预览区：色板 + 将应用的版式选项
    const summaryWrap = h('div', { class: 'hidden space-y-2' }, []);
    let lastParsed: ParsedStyle | null = null;

    /** 枚举 id → 展示名（目录来自 options.ts 真实常量） */
    function enumLabel(id: string): string {
      for (const list of [VISUALIZERS, LYRIC_MODES, PROGRESS_BARS, INTRO_ANIMS, OUTRO_ANIMS, COVER_STYLES]) {
        const hit = list.find((it) => it.id === id);
        if (hit) return hit.label;
      }
      return id;
    }

    /** 解析并渲染摘要；失败红字提示。返回是否成功 */
    function runSummary(): boolean {
      lastParsed = null;
      const parsed = parseStyleAIOutput(pasteInput.value);
      if (!parsed.ok) {
        summaryWrap.classList.add('hidden');
        flashError(parsed.reason);
        return false;
      }
      const s = parsed.style;
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
      if (s.visualizer) applied.push(enumLabel(s.visualizer));
      if (s.lyricMode) applied.push(enumLabel(s.lyricMode));
      if (s.progressBar) applied.push(enumLabel(s.progressBar));
      if (s.introAnim) applied.push(enumLabel(s.introAnim));
      if (s.outroAnim) applied.push(enumLabel(s.outroAnim));
      if (s.coverStyle) applied.push(enumLabel(s.coverStyle));
      summaryWrap.replaceChildren(
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
                textContent: '将应用版式：',
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
          title: '解析 JSON 并展示色板与将应用的选项',
          onclick: () => void runSummary(),
        }),
      ]),
      summaryWrap,
      h('div', { class: 'flex items-center justify-end gap-2' }, [
        cancelBtn(),
        saveBtn('保存并应用', save),
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
      promptArea.value = buildStylePrompt(desc);
      step2.classList.remove('hidden');
      step3.classList.remove('hidden');
      promptArea.scrollTop = 0;
    }

    function save(): void {
      if (!lastParsed && !runSummary()) return; // 先解析出摘要（失败已红字提示）
      const s = lastParsed!;
      addCustomStyle({
        name: s.name,
        bg1: s.colors.bg1,
        bg2: s.colors.bg2,
        fg: s.colors.fg,
        accent: s.colors.accent,
        ...(s.visualizer !== undefined ? { visualizer: s.visualizer } : {}),
        ...(s.lyricMode !== undefined ? { lyricMode: s.lyricMode } : {}),
        ...(s.progressBar !== undefined ? { progressBar: s.progressBar } : {}),
        ...(s.introAnim !== undefined ? { introAnim: s.introAnim } : {}),
        ...(s.outroAnim !== undefined ? { outroAnim: s.outroAnim } : {}),
        ...(s.coverStyle !== undefined ? { coverStyle: s.coverStyle } : {}),
      });
      deps.onStyleApplied(s);
      flashOk(`已保存「${s.name}」并应用——主题与版式已同步到设置区。`);
      setTimeout(closeDialog, 700);
    }

    const card = h(
      'div',
      {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '用 AI 生成整套风格方案',
        class:
          'w-[min(92vw,42rem)] rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-2xl',
      },
      [
        dialogHead('💡 用 AI 生成整套风格方案'),
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
        privacyNote,
      ],
    );

    dialogEl = mountDialog(card);
    requestAnimationFrame(() => descInput.focus());
  }

  return { openVisualizerDialog, openStyleDialog };
}
