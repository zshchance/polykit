import { h } from '@/core/components/element';
import type { HomePrefs } from '../prefs';
import { exportPrefsJSON, importPrefsJSON, prefsExportFilename, emptyPrefs } from '../prefs';
import { showToast } from './toast';

/**
 * 个人设置浮层：备份 / 恢复 / 重置 工具偏好（置顶 / 星标 / 排序）。
 *
 * 极简化设计：浮层本身只含统计 + 三个操作 + 一句说明，
 * 由首页顶栏「⚙」按钮触发显示/隐藏（fixed 定位，点外部收起）。
 * 主栏不再有大块设置卡片，保持首页极简。
 * 所有反馈走 toast，不弹原生 alert。数据仅本批偏好，可跨设备迁移。
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
    ['⬇ 导出'],
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
    ['⬆ 恢复'],
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
    ['🗑 重置'],
  );

  const el = h(
    'div',
    {
      class:
        'w-60 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-xl',
      role: 'dialog',
      'aria-label': '个人设置',
    },
    [
      h('div', { class: 'flex items-center justify-between' }, [
        h('span', { class: 'text-sm font-medium text-[var(--fg)]', textContent: '我的设置' }),
        stats,
      ]),
      h('div', { class: 'flex gap-2' }, [exportBtn, restoreBtn, resetBtn]),
      h('p', {
        class: 'text-xs leading-relaxed text-[var(--fg-muted)]',
        textContent:
          '导出置顶 / 星标 / 排序为 JSON，可在其它设备或浏览器恢复。数据仅保存在本地。',
      }),
      fileInput,
    ],
  );

  return { el, refresh };
}
