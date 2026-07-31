import { h } from '@/core/components/element';
import type { HomePrefs } from '../prefs';
import { exportPrefsJSON, importPrefsJSON, prefsExportFilename, emptyPrefs } from '../prefs';
import { showToast } from './toast';

/**
 * 个人设置面板：备份 / 恢复 / 重置 工具偏好（置顶 / 星标 / 排序）。
 *
 * 默认折叠（一个 ⚙ 按钮），展开后三行操作。所有反馈走 toast，不弹原生 alert。
 * 数据仅本批偏好，不含主题等其它本地状态（聚焦、可迁移）。
 */

export interface SettingsPanel {
  el: HTMLElement;
  /** 刷新显示（恢复/重置后调用，刷新统计文案） */
  refresh: (prefs: HomePrefs) => void;
}

export function createSettingsPanel(
  initial: HomePrefs,
  onChange: (prefs: HomePrefs) => void,
): SettingsPanel {
  let prefs = initial;

  // —— 统计文案 ——
  const stats = h('span', {
    class: 'text-xs text-[var(--fg-muted)]',
  });

  function refresh(p: HomePrefs): void {
    prefs = p;
    stats.textContent = `置顶 ${p.pinned.length} · 星标 ${p.starred.length}`;
  }
  refresh(initial);

  // —— 操作：导出 ——
  const exportBtn = h(
    'button',
    {
      type: 'button',
      class:
        'flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
      onclick: () => {
        const json = exportPrefsJSON(prefs);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = prefsExportFilename();
        document.body.append(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast('已导出我的设置');
      },
    },
    ['⬇ 导出我的设置'],
  );

  // —— 操作：从文件恢复 ——
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
      const text = String(reader.result ?? '');
      const imported = importPrefsJSON(text);
      if (!imported) {
        showToast('文件无效或格式不符');
        return;
      }
      onChange(imported);
      showToast('已从文件恢复');
    };
    reader.onerror = () => showToast('读取失败，请重试');
    reader.readAsText(file);
    // 清空 value 以便同名文件可再次选择
    fileInput.value = '';
  });

  const restoreBtn = h(
    'button',
    {
      type: 'button',
      class:
        'flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
      onclick: () => fileInput.click(),
    },
    ['⬆ 从文件恢复'],
  );

  // —— 操作：重置 ——
  const resetBtn = h(
    'button',
    {
      type: 'button',
      class:
        'flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--holiday-legal)] hover:text-[var(--holiday-legal)]',
      onclick: () => {
        if (!window.confirm('确定重置全部个人设置（置顶 / 星标 / 排序）？此操作不可撤销。')) return;
        const cleared = emptyPrefs();
        onChange(cleared);
        showToast('已重置全部设置');
      },
    },
    ['🗑 重置全部'],
  );

  // —— 可折叠展开区 ——
  const body = h(
    'div',
    { class: 'mt-3 hidden space-y-3' },
    [
      stats,
      h('div', { class: 'flex flex-wrap gap-2' }, [exportBtn, restoreBtn, resetBtn]),
      h('p', {
        class: 'text-xs leading-relaxed text-[var(--fg-muted)]',
        textContent:
          '导出把置顶 / 星标 / 排序存为 JSON，可在其它设备或浏览器恢复。数据仅保存在本地。',
      }),
    ],
  );

  const toggleBtn = h(
    'button',
    {
      type: 'button',
      class:
        'flex w-full items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2.5 text-sm text-[var(--fg)] transition-colors hover:border-[var(--accent)]',
      'aria-expanded': 'false',
      onclick: () => {
        const hidden = body.classList.toggle('hidden');
        toggleBtn.setAttribute('aria-expanded', String(!hidden));
        caret.textContent = hidden ? '▸' : '▾';
      },
    },
    [
      h('span', { class: 'flex items-center gap-2' }, [
        h('span', { textContent: '⚙' }),
        h('span', { textContent: '备份 / 还原我的设置' }),
        stats,
      ]),
      ((): HTMLElement => h('span', { class: 'text-[var(--fg-muted)]', textContent: '▸' }))(),
    ],
  );
  const caret = toggleBtn.querySelector('span:last-child') as HTMLElement;

  const el = h('div', {}, [toggleBtn, body, fileInput]);

  return { el, refresh };
}
