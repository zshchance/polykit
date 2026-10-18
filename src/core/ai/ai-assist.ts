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
import {
  AIError,
  aiChat,
  aiSettingsUrl,
  appendMessage,
  createConversation,
  hydrateForApi,
  type ChatMessage,
} from './index';

export interface AiRunnerOptions {
  /** 所属工具 slug（会话库分组用） */
  toolSlug: string;
  /** 会话标题；缺省用首条提示词前 50 字 */
  conversationTitle?: string;
  /** 完成回调：原始全文 + 实际使用的模型信息 */
  onDone?: (
    text: string,
    meta: { providerName: string; modelName: string; latencyMs: number },
  ) => void;
  /** 输出区最小高度（Tailwind 类，默认 min-h-20） */
  outputClass?: string;
}

export interface AiRunner {
  /** 嵌入工具 UI 的容器（首次 run 前隐藏） */
  el: HTMLElement;
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

  // —— DOM ——
  const metaLine = h('span', { class: 'text-[11px] text-[var(--fg-muted)]' });
  const outputPre = h('pre', {
    class:
      'max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[var(--fg)]',
    textContent: '',
  });
  const errorBox = h('div', { class: 'hidden rounded-lg border border-[var(--holiday-legal)] px-3 py-2 text-xs leading-relaxed text-[var(--holiday-legal)]' });

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

  const el = h('div', { class: 'hidden space-y-2' }, [
    h('div', { class: 'flex flex-wrap items-center justify-between gap-2' }, [
      h('span', { class: 'text-xs font-medium text-[var(--fg-muted)]', textContent: 'AI 输出' }),
      metaLine,
    ]),
    outputPre,
    h('div', { class: 'flex items-center justify-end gap-2' }, [stopBtn, regenBtn, createCopyButton(() => lastFullText, '复制全文', '已复制 ✓')]),
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
    busy = true;
    lastPrompt = prompt;
    lastFullText = '';
    controller = new AbortController();
    el.classList.remove('hidden');
    errorBox.classList.add('hidden');
    outputPre.textContent = '';
    metaLine.textContent = '生成中…';
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

    try {
      const res = await aiChat({
        messages: [...history, { role: 'user', content: prompt }],
        signal: controller.signal,
        onDelta: (d) => {
          if (d.content) outputPre.textContent += d.content;
          outputPre.scrollTop = outputPre.scrollHeight;
        },
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
      if (err instanceof AIError && err.code === 'aborted') {
        metaLine.textContent = '已停止';
        // 已流出的部分仍算结果：可复制 / 记账
        lastFullText = outputPre.textContent;
        if (convId !== null && lastFullText) {
          await appendMessage(convId, 'assistant', lastFullText).catch(() => undefined);
        }
      } else if (err instanceof AIError && err.code === 'no-model') {
        showError(err.message, true);
        metaLine.textContent = '';
      } else {
        showError(err instanceof Error ? err.message : String(err), false);
        metaLine.textContent = '';
        // 已流出的部分仍可复制
        if (outputPre.textContent) lastFullText = outputPre.textContent;
      }
    } finally {
      busy = false;
      controller = null;
      stopBtn.classList.add('hidden');
      regenBtn.disabled = false;
    }
  }

  return { el, run: (p) => void run(p), isBusy: () => busy, abort: () => controller?.abort() };
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
