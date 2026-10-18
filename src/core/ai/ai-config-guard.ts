/**
 * AI 配置守卫 —— 全站统一的「未配置引导」模态框（框架级能力，非各工具自实现）。
 *
 * 背景：AI 接入是系统级配置（/ai-settings/，非工具），各工具的 AI 按钮在发起
 * 调用前必须先确认存在可路由模型；未配置时不该各自报错，而是弹出同一套引导。
 *
 * 用法（工具侧一行）：
 *   if (!(await ensureAIConfigured())) return;   // 未配置：已弹统一引导，本次放弃
 *
 * 语义：已配置 → true；未配置 → 弹模态框，「去配置」在新标签打开设置页
 * （保留当前页表单内容），模态框关闭后 resolve false。
 */

import { h } from '@/core/components/element';
import { createDialog } from '@/core/components/Dialog';
import { aiSettingsUrl, hasRoutableModel, loadAIConfig } from './index';

/** 是否存在可路由模型（启用的供应商下有启用的模型） */
export function isAIConfigured(): boolean {
  return hasRoutableModel(loadAIConfig());
}

/**
 * 统一配置引导模态框。多标签页同时在弹时后到者直接跳过（单例抑制）。
 */
let guideOpen = false;

export function ensureAIConfigured(): Promise<boolean> {
  if (isAIConfigured()) return Promise.resolve(true);
  if (guideOpen) return Promise.resolve(false);
  guideOpen = true;

  return new Promise((resolve) => {
    const dlg = createDialog({
      onClose: () => {
        guideOpen = false;
        resolve(false);
      },
      panelClass: 'max-w-md',
      label: '配置 AI 大模型',
    });

    const goBtn = h('a', {
      href: aiSettingsUrl(),
      target: '_blank',
      rel: 'noopener',
      class:
        'rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] transition-colors hover:opacity-90',
      textContent: '去配置（新标签打开）',
      onclick: () => {
        // 不关当前页：配置完回来重试即可（用户已填的表单内容保留）
        dlg.close();
      },
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
        h('li', { textContent: '· 配置完成后回到本页，点重试即可' }),
      ]),
      h('div', { class: 'mt-5 flex justify-end gap-2' }, [laterBtn, goBtn]),
    );
    dlg.open();
  });
}
