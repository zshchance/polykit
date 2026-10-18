/**
 * AI 配置守卫 —— 全站统一的「未配置引导」模态框（框架级能力，非各工具自实现）。
 *
 * 背景：AI 接入是系统级配置（/ai-settings/，非工具），各工具的 AI 按钮在发起
 * 调用前必须先确认存在可路由模型；未配置时不该各自报错，而是弹出同一套引导。
 *
 * 交互流（用户全程停留在当前工具页）：
 *   1. 工具内点击 AI 功能 → 未配置 → 弹本模态框
 *   2. 「去配置」在新标签打开 /ai-settings/，模态框保持打开等待
 *   3. 用户在设置页完成配置 → 跨标签 storage 事件自动检测 → 模态框切换为
 *      成功态，提供「继续」接续刚才的 AI 调用（也可「关闭」后自行再点）
 *   4. 任意时刻关闭（暂不使用 / Esc / 点背景）→ resolve false，静默放弃本次
 *
 * 用法（工具侧一行，通常由 createAiRunner 自动接入）：
 *   if (!(await ensureAIConfigured())) return;   // false=未配置已引导；true=已配置（含配置完成后点「继续」）
 */

import { h } from '@/core/components/element';
import { createDialog } from '@/core/components/Dialog';
import { aiSettingsUrl, hasRoutableModel, loadAIConfig, subscribeAIConfig } from './index';

/** 是否存在可路由模型（启用的供应商下有启用的模型） */
export function isAIConfigured(): boolean {
  return hasRoutableModel(loadAIConfig());
}

/** 多标签页同时在弹时后到者直接跳过（单例抑制） */
let guideOpen = false;

export function ensureAIConfigured(): Promise<boolean> {
  if (isAIConfigured()) return Promise.resolve(true);
  if (guideOpen) return Promise.resolve(false);
  guideOpen = true;

  return new Promise((resolve) => {
    let settled = false;
    const done = (v: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const dlg = createDialog({
      onClose: () => {
        guideOpen = false;
        unsubscribe?.();
        done(false);
      },
      panelClass: 'max-w-md',
      label: '配置 AI 大模型',
    });
    let unsubscribe: (() => void) | null = null;

    // —— 配置等待态 ——
    const goBtn = h('a', {
      href: aiSettingsUrl(),
      target: '_blank',
      rel: 'noopener',
      class:
        'rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] transition-colors hover:opacity-90',
      textContent: '去配置（新标签页）',
      // 不关闭模态框：保持等待态，配置完成后自动切换成功态
    });
    const laterBtn = h('button', {
      type: 'button',
      class:
        'rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
      textContent: '暂不使用',
      onclick: () => dlg.close(),
    });

    dlg.body.append(
      h('h3', { class: 'text-base font-semibold text-[var(--fg)]', textContent: '🧩 尚未配置 AI 大模型' }),
      h('p', {
        class: 'mt-2 text-sm leading-relaxed text-[var(--fg)]',
        textContent: '这个功能会调用大模型。先在「AI 接入设置」里添加一家供应商（OpenAI / DeepSeek / Kimi / GLM / Anthropic / Ollama 等均可），一次配置、全站工具共用。',
      }),
      h('ul', { class: 'mt-3 space-y-1 text-xs leading-relaxed text-[var(--fg-muted)]' }, [
        h('li', { textContent: '· 密钥仅保存在你的浏览器本地，本站无后端、不经手密钥' }),
        h('li', { textContent: '· 支持多供应商与调用优先级，失败自动顺延' }),
        h('li', { textContent: '· 完成配置后回到本页，这里会自动检测，无需手动刷新' }),
      ]),
      h('div', { class: 'mt-5 flex justify-end gap-2' }, [laterBtn, goBtn]),
    );
    dlg.open();

    // —— 跨标签检测：设置页保存配置 → storage 事件 → 切换成功态 ——
    unsubscribe = subscribeAIConfig(() => {
      if (!isAIConfigured()) return;
      renderSuccessState();
    });

    function renderSuccessState(): void {
      unsubscribe?.();
      unsubscribe = null;
      const continueBtn = h('button', {
        type: 'button',
        class:
          'rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] transition-colors hover:opacity-90',
        textContent: '继续',
        onclick: () => {
          done(true); // 先落定结果再关闭（onClose 的 done(false) 因 settled 不再生效）
          dlg.close();
        },
      });
      const closeBtn = h('button', {
        type: 'button',
        class:
          'rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
        textContent: '关闭',
        onclick: () => dlg.close(),
      });
      dlg.body.replaceChildren(
        h('h3', { class: 'text-base font-semibold text-[var(--fg)]', textContent: '✓ 已检测到可用模型' }),
        h('p', {
          class: 'mt-2 text-sm leading-relaxed text-[var(--fg)]',
          textContent: 'AI 配置已就绪。点「继续」接续刚才的操作，或关闭后自行点击工具里的 AI 功能按钮。',
        }),
        h('div', { class: 'mt-5 flex justify-end gap-2' }, [closeBtn, continueBtn]),
      );
    }
  });
}
