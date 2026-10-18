import { h } from '@/core/components/element';
import type { HomePrefs } from '../prefs';
import { emptyPrefs } from '../prefs';
import { downloadText } from '@/core/utils/clipboard';
import { confirmDialog } from '@/core/components/Dialog';
import { showToast } from './toast';
import { aiSettingsUrl, currentSiteRoot, hasRoutableModel, loadAIConfig } from '@/core/ai';
import {
  applySiteBackup,
  backupFilename,
  buildSiteBackup,
  parseSiteBackup,
} from '@/core/backup';

/**
 * 系统设置浮层：全站统一备份 / 恢复 + AI 大模型设置入口 + 偏好重置。
 *
 * 备份是「一个文件带走全部」：工具偏好与设置（localStorage）、AI 大模型配置
 * （含密钥）、可选的对话记录（IndexedDB，含图片资产）——各处分散的导入导出
 * （原首页偏好备份、AI 设置页迁移）统一收敛到这里。跨域名恢复时站内地址自动
 * 替换（{ORIGIN} 占位机制，见 docs/ai-framework.md 第 6 节）。
 */

export interface SettingsPanel {
  /** 浮层根元素（由调用方决定显隐） */
  el: HTMLElement;
  /** 刷新统计文案（恢复/重置后调用） */
  refresh: (prefs: HomePrefs) => void;
}

export function createSettingsPanel(
  initial: HomePrefs,
  onChange: (prefs: HomePrefs) => void,
): SettingsPanel {

  // —— 统计文案 ——
  const stats = h('span', {
    class: 'text-xs text-[var(--fg-muted)]',
  });

  // —— 系统级入口：AI 大模型设置（全站工具共用的框架能力，非工具，不进卡片网格） ——
  const aiStatus = h('span', { class: 'text-[10px] text-[var(--fg-muted)]', textContent: '未配置' });
  function refreshAiStatus(): void {
    const cfg = loadAIConfig();
    const ok = hasRoutableModel(cfg);
    aiStatus.textContent = ok
      ? `已启用 ${cfg.providers.filter((p) => p.enabled).length} 家供应商`
      : '未配置';
    aiStatus.className = ok
      ? 'text-[10px] text-[var(--accent)]'
      : 'text-[10px] text-[var(--fg-muted)]';
  }
  refreshAiStatus();

  const aiEntry = h(
    'a',
    {
      href: aiSettingsUrl(),
      class:
        'flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
      'aria-label': 'AI 大模型设置（系统配置页）',
    },
    [
      h('span', { textContent: '🧩 AI 大模型设置' }),
      h('span', { class: 'flex items-center gap-1.5' }, [aiStatus, '→']),
    ],
  );

  // —— 备份内容点选 ——
  const toolsBox = h('input', { type: 'checkbox', checked: true, class: 'accent-[var(--accent)]' });
  const aiBox = h('input', { type: 'checkbox', checked: true, class: 'accent-[var(--accent)]' });
  const convsBox = h('input', { type: 'checkbox', class: 'accent-[var(--accent)]' });
  const checkRow = (label: string, box: HTMLInputElement, hint?: string) =>
    h('label', { class: 'flex cursor-pointer items-center gap-2 text-xs text-[var(--fg)]' }, [
      box,
      h('span', {}, [label, ...(hint ? [h('span', { class: 'ml-1 text-[10px] text-[var(--fg-muted)]', textContent: hint })] : [])]),
    ]);

  // —— 导出（全站统一备份） ——
  const exportBtn = h('button', {
    type: 'button',
    class:
      'flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50',
    textContent: '⬇ 导出备份',
    onclick: () => {
      exportBtn.disabled = true;
      exportBtn.textContent = '导出中…';
      void buildSiteBackup({
        includeTools: toolsBox.checked,
        includeAI: aiBox.checked,
        includeConversations: convsBox.checked,
      })
        .then(({ json, stats: s }) => {
          downloadText(json, backupFilename(), 'application/json');
          const parts = [`${s.keys} 项设置`];
          if (convsBox.checked) parts.push(`${s.conversations} 个会话 / ${s.messages} 条消息`);
          showToast(`已导出备份（${parts.join(' · ')}）${aiBox.checked ? '，含密钥请妥善保管' : ''}`, 3600);
        })
        .catch((err: Error) => showToast(`✗ 导出失败：${err.message}`, 3600))
        .finally(() => {
          exportBtn.disabled = false;
          exportBtn.textContent = '⬇ 导出备份';
        });
    },
  });

  // —— 恢复 ——
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'hidden',
  }) as HTMLInputElement;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const plan = parseSiteBackup(String(reader.result ?? ''), currentSiteRoot());
      if (!plan) {
        showToast('文件无效或不是本站备份', 3200);
        return;
      }
      const summary = [
        `${plan.localStorageWrites.length} 项设置`,
        plan.conversations ? `${plan.conversations.items.length} 个会话` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      void confirmDialog(
        `将恢复 ${summary}${plan.conversations ? '（现有会话记录会被替换）' : ''}。确定继续？${plan.note ? `\n\n${plan.note}` : ''}`,
        { title: '恢复备份', confirmText: '恢复' },
      ).then((ok) => {
        if (!ok) return;
        void applySiteBackup(plan)
          .then((r) => {
            showToast(`已恢复 ${r.keys} 项设置${r.conversations ? `、${r.conversations} 个会话` : ''}，即将刷新页面…`, 3200);
            setTimeout(() => location.reload(), 1000);
          })
          .catch((err: Error) => showToast(`✗ 恢复失败：${err.message}`, 3600));
      });
    };
    reader.onerror = () => showToast('读取失败，请重试');
    reader.readAsText(file);
    fileInput.value = '';
  });

  const restoreBtn = h('button', {
    type: 'button',
    class:
      'flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
    textContent: '⬆ 恢复',
    onclick: () => fileInput.click(),
  });

  // —— 重置（仅首页偏好） ——
  const resetBtn = h('button', {
    type: 'button',
    class:
      'flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--holiday-legal)] hover:text-[var(--holiday-legal)]',
    textContent: '🗑 重置',
    title: '仅重置首页置顶 / 星标 / 排序偏好',
    onclick: () => {
      void confirmDialog('确定重置全部个人设置（置顶 / 星标 / 排序）？此操作不可撤销。', {
        title: '重置设置',
        danger: true,
        confirmText: '重置',
      }).then((okDel) => {
        if (!okDel) return;
        const cleared = emptyPrefs();
        onChange(cleared);
        showToast('已重置全部设置');
      });
    },
  });

  const el = h(
    'div',
    {
      class: 'w-72 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-xl',
      role: 'dialog',
      'aria-label': '我的设置',
    },
    [
      h('div', { class: 'flex items-center justify-between' }, [
        h('span', { class: 'text-sm font-medium text-[var(--fg)]', textContent: '我的设置' }),
        stats,
      ]),
      aiEntry,
      h('div', { class: 'space-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5' }, [
        h('div', { class: 'text-[10px] font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '备份内容' }),
        checkRow('工具偏好与设置', toolsBox),
        checkRow('AI 大模型配置', aiBox, '含密钥'),
        checkRow('对话记录', convsBox, '含图片，可能较大'),
      ]),
      h('div', { class: 'flex gap-2' }, [exportBtn, restoreBtn, resetBtn]),
      h('p', {
        class: 'text-xs leading-relaxed text-[var(--fg-muted)]',
        textContent: '备份为一个 JSON 文件，可在其它设备或域名恢复；站内地址自动替换为当前域名，对话记录整体替换。数据仅保存在本地。',
      }),
      fileInput,
    ],
  );

  function refresh(p: HomePrefs): void {
    stats.textContent = `置顶 ${p.pinned.length} · 星标 ${p.starred.length}`;
    refreshAiStatus();
  }
  refresh(initial);

  return { el, refresh };
}
