/**
 * 共享「直连 AI 运行器」组件 —— 各工具把 P1/P2 框架接进 UI 的最小件。
 *
 * 工具侧用法（无需自己写流式渲染/错误分支/会话记账）：
 *   const runner = createAiRunner({
 *     toolSlug: 'password-generator',
 *     conversationTitle: 'AI 口令生成',
 *     onDone: (text) => render(extractSomething(text)),
 *   });
 *   container.append(runner.el);
 *   aiBtnRow.append(runner.modelPicker); // 模型选择下拉（多候选时自动显示，默认第一个）
 *   runner.run(buildXxxPrompt(...));
 *
 * 行为约定（docs/ai-framework.md 第 7 节）：
 * - 未配置模型 → 显示引导去「AI 接入设置」的链接（不弹窗打断）
 * - 流式增量实时渲染，可随时停止；完成后可复制 / 重新生成
 * - 每次运行把 user / assistant 消息记入会话库（复用同一会话形成多轮上下文；
 *   会话库不可用时静默降级为无记忆单次调用）
 * - onDone 收到的是原始全文，工具自行解析（各工具产物形态差异大）
 */

import { h } from '@/core/components/element';
import { createCopyButton } from '@/core/components/CopyButton';
import { copyText } from '@/core/utils/clipboard';
import MarkdownIt from 'markdown-it';
import { ensureAIConfigured } from './ai-config-guard';
import type { RoutedModel } from './router';
import {
  AIError,
  aiChat,
  aiGenerateImage,
  aiSettingsUrl,
  appendMessage,
  createConversation,
  hydrateForApi,
  loadAIConfig,
  resolveCandidates,
  subscribeAIConfig,
  type ChatMessage,
  type ModelCapability,
} from './index';

/**
 * 会话内记住用户在某工具 + 能力组合下手动选过的模型 id（不落 localStorage：
 * 刷新页面即回到「系统默认第一个可用模型」）。弹层类工具反复开关会重建
 * 运行器（如 color-extractor 切玩法、prompt-hub 切卡片），靠它延续选择。
 */
const pinnedModels = new Map<string, string>();

/**
 * 输出区的 Markdown 渲染器：html:false（转义原始 HTML，防注入）、
 * linkify（裸链接成链）、breaks（单换行成 <br>，贴合聊天输出的排版习惯）。
 * 链接强制新标签打开。
 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const defaultLinkOpen = md.renderer.rules.link_open;
md.renderer.rules.link_open = (...args) => {
  const [tokens, idx, options, env, self] = args;
  tokens[idx]!.attrSet('target', '_blank');
  tokens[idx]!.attrSet('rel', 'noopener');
  // link_open 的默认规则始终存在；兜底分支仅为类型完备
  return defaultLinkOpen
    ? defaultLinkOpen(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options);
};

export interface AiRunnerOptions {
  /** 所属工具 slug（会话库分组用） */
  toolSlug: string;
  /** 会话标题；缺省用首条提示词前 50 字 */
  conversationTitle?: string;
  /**
   * 所需模型能力，缺省 ['text']（流式对话）。
   * 传 ['image-gen'] 时走图片生成路径（images/generations，结果为图片网格）；
   * 传 ['video-gen'] / ['audio-gen'] 时走对话式调用（多数生视频/音频网关以
   * 对话接口返回链接），流式展示返回文本。
   */
  need?: ModelCapability[];
  /** 文本完成回调：原始全文 + 实际使用的模型信息 */
  onDone?: (
    text: string,
    meta: { providerName: string; modelName: string; latencyMs: number },
  ) => void;
  /** 图片生成完成回调（need 含 image-gen 时使用） */
  onImages?: (
    images: string[],
    meta: { providerName: string; modelName: string; latencyMs: number },
  ) => void;
}

export interface AiRunner {
  /** 嵌入工具 UI 的容器（首次 run 前隐藏） */
  el: HTMLElement;
  /**
   * 模型选择下拉：按本运行器所需能力列出全部可路由模型（按供应商分组），
   * 插在工具的 AI 按钮旁。默认选中第一个（= 系统默认路由）；用户手动选过后
   * 精确调用该模型。仅一个（或零个）可用模型时自动隐藏。
   */
  modelPicker: HTMLElement;
  /** 发起一次调用（busy 时忽略）。prompt 为本次用户消息全文 */
  run(prompt: string): void;
  isBusy(): boolean;
  abort(): void;
}

export function createAiRunner(opts: AiRunnerOptions): AiRunner {
  // —— 状态 ——
  let busy = false;
  let lastPrompt = '';
  let convId: string | null = null;
  let controller: AbortController | null = null;
  let lastFullText = '';
  /** 本轮流式的原始 Markdown 全文（渲染用原始文本，复制也用它） */
  let streamRaw = '';
  /** 本轮思考增量（思考模型 reasoning_content / thinking_delta） */
  let streamReasoning = '';
  /** 正文是否已出现（出现后思考区自动收起，只收一次） */
  let reasoningCollapsed = false;

  function handleStreamDelta(d: { content?: string; reasoning?: string }): void {
    if (d.reasoning) {
      streamReasoning += d.reasoning;
      reasoningDetails.classList.remove('hidden');
      reasoningBody.textContent = streamReasoning;
      reasoningBody.scrollTop = reasoningBody.scrollHeight;
    }
    if (!d.content) return;
    // 首个正文增量到达：思考区收起（用户仍可点开回看），此后只渲染正文
    if (!reasoningCollapsed && streamReasoning) {
      reasoningCollapsed = true;
      reasoningDetails.open = false;
      reasoningSummary.textContent = `💭 思考过程（${streamReasoning.length} 字，点击展开）`;
    }
    streamRaw += d.content;
    outputArea.innerHTML = md.render(streamRaw);
    outputArea.scrollTop = outputArea.scrollHeight;
  }

  // —— DOM ——
  const need = opts.need ?? ['text'];
  const isImageMode = need.length === 1 && need[0] === 'image-gen';
  const metaLine = h('span', { class: 'text-[11px] text-[var(--fg-muted)]' });
  /** 思考过程区（思考模型 reasoning 增量实时流入；正文出现后自动收起，可手动展开） */
  const reasoningSummary = h('summary', {
    class: 'cursor-pointer select-none px-3 py-1.5 text-[11px] font-medium text-[var(--fg-muted)]',
    textContent: '💭 思考中…',
  });
  const reasoningBody = h('div', {
    class:
      'max-h-40 overflow-y-auto whitespace-pre-wrap break-words border-t border-[var(--border)] px-3 py-2 text-[11px] leading-relaxed text-[var(--fg-muted)]',
  });
  const reasoningDetails = h(
    'details',
    { class: 'hidden rounded-lg border border-[var(--border)] bg-[var(--bg)]', open: true },
    [reasoningSummary, reasoningBody],
  );
  /** 流式输出区：Markdown 渲染（样式见 main.css 的 .ai-md） */
  const outputArea = h('div', {
    class:
      'ai-md max-h-64 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5',
  });
  /** 图片生成结果网格（image-gen 模式使用） */
  const imagesWrap = h('div', { class: 'hidden grid gap-3 sm:grid-cols-2' });
  const errorBox = h('div', {
    class:
      'hidden rounded-lg border border-[var(--holiday-legal)] px-3 py-2 text-xs leading-relaxed text-[var(--holiday-legal)]',
  });

  function renderImages(images: string[]): void {
    outputArea.classList.add('hidden');
    imagesWrap.classList.remove('hidden');
    imagesWrap.replaceChildren(
      ...images.map((src) =>
        h('div', { class: 'space-y-1.5' }, [
          h('img', {
            src,
            alt: 'AI 生成图片',
            class: 'w-full rounded-lg border border-[var(--border)]',
          }),
          h('div', { class: 'flex gap-1.5' }, [
            h('a', {
              href: src,
              target: '_blank',
              rel: 'noopener',
              class:
                'rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
              textContent: '打开原图',
            }),
            h('button', {
              type: 'button',
              class:
                'rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
              textContent: '复制图片',
              title: '复制图片链接（data URL 则复制完整数据）',
              onclick: () => {
                void copyText(src).then((ok) => {
                  showToastInline(`${ok ? '已复制 ✓' : '复制失败'}`);
                });
              },
            }),
          ]),
        ]),
      ),
    );
  }

  // 图片模式没有文本流，提示替代：运行器自身没有 toast 依赖，用 errorBox 同款样式的信息条
  function showToastInline(msg: string): void {
    metaLine.textContent = msg;
    setTimeout(() => {
      if (metaLine.textContent === msg) metaLine.textContent = '';
    }, 1500);
  }

  const stopBtn = h('button', {
    type: 'button',
    class:
      'rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
    textContent: '■ 停止',
    onclick: () => controller?.abort(),
  });
  const regenBtn = h('button', {
    type: 'button',
    class:
      'rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
    textContent: '↻ 重新生成',
    onclick: () => run(lastPrompt),
  });

  // —— 模型选择下拉 ——
  // 选项 = 按本运行器所需能力解析出的全部候选（供应商分组，顺序即路由优先级）。
  // 默认选中第一个（不动下拉 = 系统默认路由，候选失败自动顺延）；手动选过后
  // pinnedModelId 生效，调用时精确指定该模型（失败不顺延，错误就地展示）。
  const modelSelect = h('select', {
    'aria-label': '选择 AI 模型',
    class:
      'hidden max-w-[11rem] min-w-0 truncate rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 text-xs text-[var(--fg-muted)] outline-none focus:border-[var(--accent)]',
    title: '选择本次调用使用的模型（默认第一个可用模型）',
  }) as HTMLSelectElement;
  const pinKey = `${opts.toolSlug}|${[...need].sort().join('+')}`;
  /** 用户手动选定的模型 id；null = 跟随系统默认 */
  let pinnedModelId: string | null = null;
  /** 最近一次构建下拉时的候选（change 时反查供应商/模型名用于 title 提示） */
  let pickerCandidates: RoutedModel[] = [];

  function rebuildModelOptions(): void {
    const candidates = resolveCandidates(loadAIConfig(), need);
    pickerCandidates = candidates;
    // 只有一个（或没有）可用模型时下拉没有选择余地，隐藏走默认
    modelSelect.classList.toggle('hidden', candidates.length <= 1);

    // 候选按供应商分段连续排列，逐段生成 optgroup
    const groups: HTMLOptGroupElement[] = [];
    for (const c of candidates) {
      let group = groups[groups.length - 1];
      if (!group || group.label !== c.provider.name) {
        group = document.createElement('optgroup');
        group.label = c.provider.name;
        groups.push(group);
      }
      const opt = document.createElement('option');
      opt.value = c.model.id;
      opt.textContent = c.model.name;
      group.append(opt);
    }
    modelSelect.replaceChildren(...groups);

    // 恢复选择：本实例的手动选择 > 会话记忆 > 默认第一个；选定模型已不可用时回默认
    const desired = pinnedModelId ?? pinnedModels.get(pinKey) ?? null;
    const hit = desired ? candidates.find((c) => c.model.id === desired) : undefined;
    const chosen = hit ?? candidates[0];
    pinnedModelId = hit ? hit.model.id : null;
    if (!hit) pinnedModels.delete(pinKey);
    modelSelect.value = chosen ? chosen.model.id : '';
    modelSelect.title = chosen
      ? `模型：${chosen.provider.name} / ${chosen.model.name}${hit ? '' : '（默认，失败自动顺延）'}`
      : '选择 AI 模型';
  }

  modelSelect.addEventListener('change', () => {
    const id = modelSelect.value;
    pinnedModelId = id || null;
    if (pinnedModelId) pinnedModels.set(pinKey, pinnedModelId);
    const chosen = pickerCandidates.find((c) => c.model.id === id);
    modelSelect.title = chosen
      ? `模型：${chosen.provider.name} / ${chosen.model.name}`
      : '选择 AI 模型';
  });

  rebuildModelOptions();
  // 配置变更（含设置页跨标签页修改）时重建选项；弹层反复开关产生的游离 select
  // 已脱离文档，顺手退订避免监听器累积
  const unsubscribeModels = subscribeAIConfig(() => {
    if (!modelSelect.isConnected) {
      unsubscribeModels();
      return;
    }
    rebuildModelOptions();
  });

  const el = h('div', { class: 'hidden space-y-2' }, [
    h('div', { class: 'flex flex-wrap items-center justify-between gap-2' }, [
      h('span', { class: 'text-xs font-medium text-[var(--fg-muted)]', textContent: 'AI 输出' }),
      metaLine,
    ]),
    reasoningDetails,
    outputArea,
    imagesWrap,
    h('div', { class: 'flex items-center justify-end gap-2' }, [
      stopBtn,
      regenBtn,
      // 图片模式的「全文复制」无意义，仅文本模式显示
      ...(isImageMode ? [] : [createCopyButton(() => lastFullText, '复制全文', '已复制 ✓')]),
    ]),
    errorBox,
  ]);

  function showError(msg: string, withSettingsLink: boolean): void {
    errorBox.classList.remove('hidden');
    errorBox.replaceChildren(
      h('span', { textContent: `✗ ${msg}` }),
      ...(withSettingsLink
        ? [
            ' ',
            h('a', {
              href: aiSettingsUrl(),
              class: 'underline',
              textContent: '去「AI 接入设置」添加供应商与模型 →',
            }),
          ]
        : []),
    );
  }

  async function run(prompt: string): Promise<void> {
    if (busy || !prompt.trim()) return;
    // 配置守卫（框架级统一引导，能力感知）：所需能力无可路由模型时弹统一
    // 引导弹窗（文案随能力定制，如「尚未配置可用的图片生成模型」），本次不发起调用。
    if (!(await ensureAIConfigured(need))) return;
    busy = true;
    lastPrompt = prompt;
    lastFullText = '';
    streamRaw = '';
    streamReasoning = '';
    reasoningCollapsed = false;
    controller = new AbortController();
    el.classList.remove('hidden');
    errorBox.classList.add('hidden');
    outputArea.replaceChildren();
    outputArea.classList.toggle('hidden', isImageMode);
    reasoningDetails.classList.add('hidden');
    reasoningDetails.open = true;
    reasoningSummary.textContent = '💭 思考中…';
    reasoningBody.textContent = '';
    imagesWrap.classList.add('hidden');
    imagesWrap.replaceChildren();
    metaLine.textContent = isImageMode ? '🎨 生成图片中…' : '生成中…';
    stopBtn.classList.remove('hidden');
    regenBtn.disabled = true;

    // 会话库（不可用时静默降级：无记忆单次调用）
    let history: ChatMessage[] = [];
    if (convId === null) {
      const title = opts.conversationTitle ?? prompt.trim().slice(0, 50);
      convId = (await createConversation(opts.toolSlug, title).catch(() => null))?.id ?? null;
    }
    if (convId !== null) {
      history = await hydrateForApi(convId).catch((): ChatMessage[] => []);
      await appendMessage(convId, 'user', prompt).catch(() => undefined);
    }

    if (isImageMode) {
      await runImage(prompt);
      return;
    }

    try {
      const res = await aiChat({
        messages: [...history, { role: 'user', content: prompt }],
        need,
        // 手动选定的模型：精确调用（不顺延其它候选），错误就地展示
        modelId: pinnedModelId ?? undefined,
        signal: controller.signal,
        onDelta: handleStreamDelta,
      });
      lastFullText = res.content;
      metaLine.textContent = `${res.model.providerName} / ${res.model.modelName} · ${res.latencyMs}ms`;
      if (convId !== null) {
        await appendMessage(convId, 'assistant', res.content).catch(() => undefined);
      }
      opts.onDone?.(res.content, {
        providerName: res.model.providerName,
        modelName: res.model.modelName,
        latencyMs: res.latencyMs,
      });
    } catch (err) {
      handleRunError(err);
    } finally {
      finishRun();
    }
  }

  /** 图片生成路径（images/generations，无流式；结果渲染为图片网格） */
  async function runImage(prompt: string): Promise<void> {
    try {
      const res = await aiGenerateImage({
        prompt,
        signal: controller?.signal,
        modelId: pinnedModelId ?? undefined,
      });
      renderImages(res.images);
      metaLine.textContent = `${res.model.providerName} / ${res.model.modelName} · ${res.latencyMs}ms`;
      lastFullText = res.images.join('\n');
      if (convId !== null) {
        await appendMessage(convId, 'assistant', `[生成图片]\n${res.images.join('\n')}`).catch(
          () => undefined,
        );
      }
      opts.onImages?.(res.images, {
        providerName: res.model.providerName,
        modelName: res.model.modelName,
        latencyMs: res.latencyMs,
      });
    } catch (err) {
      handleRunError(err);
    } finally {
      finishRun();
    }
  }

  function handleRunError(err: unknown): void {
    if (err instanceof AIError && err.code === 'aborted') {
      metaLine.textContent = '已停止';
      // 已流出的部分仍算结果：可复制 / 记账
      lastFullText = streamRaw || lastFullText;
      if (convId !== null && lastFullText) {
        void appendMessage(convId, 'assistant', lastFullText).catch(() => undefined);
      }
    } else if (err instanceof AIError && err.code === 'no-model') {
      showError(err.message, true);
      metaLine.textContent = '';
    } else {
      showError(err instanceof Error ? err.message : String(err), false);
      metaLine.textContent = '';
      // 已流出的部分仍可复制
      if (streamRaw) lastFullText = streamRaw;
    }
  }

  function finishRun(): void {
    busy = false;
    controller = null;
    stopBtn.classList.add('hidden');
    regenBtn.disabled = false;
  }

  return {
    el,
    modelPicker: modelSelect,
    run: (p) => void run(p),
    isBusy: () => busy,
    abort: () => controller?.abort(),
  };
}

/**
 * 提取首个 Markdown 代码围栏内容（代码回填类工具共用：AI 直连返回后自动
 * 填入「粘贴 AI 返回」框）。无围栏时返回 null（调用方回退全文）。
 */
export function extractCodeBlock(raw: string): string | null {
  const m = /```[a-zA-Z0-9_-]*[^\S\n]*\n([\s\S]*?)```/.exec(raw);
  return m ? m[1]!.trim() : null;
}

/** 候选结果一键复制按钮（password-generator 等按行取结果的工具用） */
export function createCandidateCopyButton(candidate: string): HTMLButtonElement {
  const btn = h('button', {
    type: 'button',
    class:
      'rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 font-mono text-xs text-[var(--fg)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
    textContent: candidate,
    title: '点击复制',
    onclick: async () => {
      const ok = await copyText(candidate);
      const original = candidate;
      btn.textContent = ok ? '已复制 ✓' : '复制失败';
      setTimeout(() => {
        btn.textContent = original;
      }, 1200);
    },
  });
  return btn;
}
