/**
 * AI 接入设置 —— 全站 BYOK 大模型配置入口。
 *
 * 结构：说明卡（隐私承诺）→ 本地存储状态卡 → 供应商列表（顺序=调用优先级，
 * 卡内展开管理模型）→ 能力路由预览 → 配置导出/导入/清空。
 * 数据经 src/core/ai 的 store 读写，其它工具页跨标签页实时同步。
 * 框架设计见 docs/ai-framework.md。
 */

import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { confirmDialog } from '@/core/components/Dialog';
import { downloadText } from '@/core/utils/clipboard';
import {
  clearAIConfig,
  loadAIConfig,
  primaryFor,
  probeChat,
  saveAIConfig,
  subscribeAIConfig,
  genId,
  exportAIConfigJSON,
  importAIConfigJSON,
  currentSiteRoot,
  aiConfigExportFilename,
  type AIConfig,
  type AIModel,
  type AIProvider,
  type ModelCapability,
} from '@/core/ai';
import { openModelDialog, openProviderDialog } from './dialogs';
import { showToast } from './toast';

initTheme();

let config: AIConfig = loadAIConfig();
let expandedProviderId: string | null = null;
const testingModels = new Set<string>(); // 正在探测的模型 id（按钮忙碌态）

// 跨标签页同步：设置页在 A 标签页改配置，B 标签页的其它工具实时生效
void subscribeAIConfig((c) => {
  config = c;
  render();
});

const { content } = renderToolLayout(document.getElementById('app')!, 'AI 接入设置');

// ─────────────────────────── 区块容器 ───────────────────────────

const storageCard = h('section', { class: 'mb-6' });
const providerSection = h('section', { class: 'mb-6' });
const routingCard = h('section', { class: 'mb-6' });
const migrateCard = h('section', {});

content.append(
  h(
    'section',
    {
      class: 'mb-6 rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5',
      'aria-label': '说明',
    },
    [
      h('p', { class: 'text-sm leading-relaxed text-[var(--fg)]', textContent: '在这里配置一次大模型，全站工具的 AI 能力自动引用：按「能力 + 供应商优先级」自动选型，失败自动顺延下一家。' }),
      h('p', {
        class: 'mt-2 text-xs leading-relaxed text-[var(--fg-muted)]',
        textContent:
          '密钥仅保存在本浏览器 localStorage，请求由浏览器直连大模型服务商——本站是纯静态站，没有后端，密钥与对话数据不经过我们。双域名部署互不相通，可用下方「导出/导入」迁移（站内地址自动替换）。',
      }),
    ],
  ),
  storageCard,
  providerSection,
  routingCard,
  migrateCard,
);

// ─────────────────────────── 本地存储状态卡 ───────────────────────────

function localStorageWritable(): boolean {
  try {
    localStorage.setItem('__ai-probe', '1');
    localStorage.removeItem('__ai-probe');
    return true;
  } catch {
    return false;
  }
}

function renderStorageCard(): void {
  const writable = localStorageWritable();
  const bar = h('div', {
    class: 'h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg)]',
  });
  const usageText = h('span', { class: 'text-xs text-[var(--fg-muted)]', textContent: '查询存储配额…' });
  const persistBtn = h('button', {
    type: 'button',
    class:
      'rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
    textContent: '申请持久化',
    onclick: () => {
      void navigator.storage?.persist?.().then((ok) => {
        showToast(ok ? '✓ 已获得持久化许可，数据不会被浏览器自动清理' : '浏览器暂未授予持久化（多访问几次本站可提高通过率）', 3600);
      });
    },
  });

  storageCard.replaceChildren(
    h('div', { class: 'rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5' }, [
      h('div', { class: 'flex flex-wrap items-center justify-between gap-3' }, [
        h('h2', { class: 'text-sm font-semibold text-[var(--fg)]', textContent: '本地存储状态' }),
        persistBtn,
      ]),
      h('div', { class: 'mt-3 flex items-center gap-3' }, [bar, usageText]),
      h('p', {
        class: 'mt-2 text-xs leading-relaxed text-[var(--fg-muted)]',
        textContent: writable
          ? '配置存于 localStorage（上限 5 MB，本配置远小于此）。将来的对话历史会存 IndexedDB（容量为磁盘比例配额），此处先展示用量。'
          : '⚠ 当前处于隐私模式或已禁用本地存储：配置无法保存，刷新后丢失。',
      }),
    ]),
  );

  if (!writable) return;
  void navigator.storage?.estimate?.().then(({ usage = 0, quota = 0 }) => {
    const pct = quota > 0 ? Math.min(100, (usage / quota) * 100) : 0;
    bar.append(h('div', { class: 'h-full rounded-full bg-[var(--accent)]', style: `width:${Math.max(pct, 1)}%` }));
    usageText.textContent = `${fmtBytes(usage)} / ${fmtBytes(quota)}`;
  });
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

// ─────────────────────────── 供应商列表 ───────────────────────────

const BTN_ICON =
  'rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--fg-muted)]';

function renderProviders(): void {
  const addBtn = h('button', {
    type: 'button',
    class:
      'rounded-lg px-4 py-1.5 text-xs font-medium text-white bg-[var(--accent)] transition-colors hover:opacity-90',
    textContent: '＋ 添加供应商',
    onclick: () =>
      openProviderDialog({
        onSave: (provider, newModels) => {
          config.providers.push(provider);
          for (const m of newModels) {
            config.models.push({
              id: genId('m'),
              providerId: provider.id,
              name: m.name,
              capabilities: m.capabilities,
              enabled: true,
            });
          }
          expandedProviderId = provider.id;
          persist();
          showToast(`已添加供应商「${provider.name}」${newModels.length > 0 ? `及 ${newModels.length} 个模型` : ''}`);
        },
      }),
  });

  providerSection.replaceChildren(
    h('div', { class: 'mb-3 flex items-center justify-between' }, [
      h('div', {}, [
        h('h2', { class: 'text-sm font-semibold text-[var(--fg)]', textContent: '供应商与模型' }),
        h('p', { class: 'mt-0.5 text-xs text-[var(--fg-muted)]', textContent: '列表顺序即调用优先级：排在前面的供应商先用，失败自动顺延。' }),
      ]),
      addBtn,
    ]),
  );

  if (config.providers.length === 0) {
    providerSection.append(
      h('div', {
        class: 'rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--fg-muted)]',
        textContent: '还没有供应商。点右上角「添加供应商」，填入服务商给的 API 地址与密钥即可。',
      }),
    );
    return;
  }

  config.providers.forEach((provider, idx) => {
    providerSection.append(providerCard(provider, idx));
  });
}

function providerCard(provider: AIProvider, idx: number): HTMLElement {
  const models = config.models.filter((m) => m.providerId === provider.id);
  const expanded = expandedProviderId === provider.id;

  const enabledBox = h('input', {
    type: 'checkbox',
    checked: provider.enabled,
    class: 'accent-[var(--accent)]',
    title: provider.enabled ? '已启用（点击停用）' : '已停用（点击启用）',
  });
  // 阻止冒泡：点击开关不应触发展开/收起
  enabledBox.addEventListener('click', (e) => e.stopPropagation());
  enabledBox.addEventListener('change', () => {
    provider.enabled = enabledBox.checked;
    persist();
  });

  const header = h(
    'div',
    {
      class: 'flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2',
      onclick: () => {
        expandedProviderId = expanded ? null : provider.id;
        render();
      },
    },
    [
      h('span', {
        class: 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--accent)] text-xs text-[var(--accent)]',
        textContent: String(idx + 1),
        title: `调用优先级第 ${idx + 1} 位`,
      }),
      h('span', {
        class: `text-sm font-medium ${provider.enabled ? 'text-[var(--fg)]' : 'text-[var(--fg-muted)] line-through'}`,
        textContent: provider.name,
      }),
      h('span', {
        class: 'rounded-full bg-[var(--bg)] px-2 py-0.5 text-[10px] text-[var(--fg-muted)]',
        textContent: provider.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容',
      }),
      enabledBox,
      h('span', { class: 'ml-auto flex items-center gap-1.5' }, [
        // 上移/下移（stopPropagation：不触发展开）
        h('button', {
          type: 'button',
          class: BTN_ICON,
          textContent: '↑',
          title: '提高优先级',
          disabled: idx === 0,
          onclick: (e: Event) => {
            e.stopPropagation();
            [config.providers[idx - 1]!, config.providers[idx]!] = [config.providers[idx]!, config.providers[idx - 1]!];
            persist();
          },
        }),
        h('button', {
          type: 'button',
          class: BTN_ICON,
          textContent: '↓',
          title: '降低优先级',
          disabled: idx === config.providers.length - 1,
          onclick: (e: Event) => {
            e.stopPropagation();
            [config.providers[idx + 1]!, config.providers[idx]!] = [config.providers[idx]!, config.providers[idx + 1]!];
            persist();
          },
        }),
        h('button', {
          type: 'button',
          class: BTN_ICON,
          textContent: '编辑',
          onclick: (e: Event) => {
            e.stopPropagation();
            openProviderDialog({
              initial: provider,
              existingModelNames: models.map((m) => m.name),
              onSave: (updated, newModels) => {
                config.providers[idx] = updated;
                for (const m of newModels) {
                  config.models.push({ id: genId('m'), providerId: updated.id, name: m.name, capabilities: m.capabilities, enabled: true });
                }
                persist();
                showToast('已保存供应商配置');
              },
            });
          },
        }),
        h('button', {
          type: 'button',
          class: `${BTN_ICON} hover:border-[var(--holiday-legal)] hover:text-[var(--holiday-legal)]`,
          textContent: '删除',
          onclick: (e: Event) => {
            e.stopPropagation();
            void confirmDialog(`确定删除供应商「${provider.name}」及其 ${models.length} 个模型？密钥将一并清除。`, {
              title: '删除供应商',
              danger: true,
              confirmText: '删除',
            }).then((ok) => {
              if (!ok) return;
              config.providers = config.providers.filter((p) => p.id !== provider.id);
              config.models = config.models.filter((m) => m.providerId !== provider.id);
              if (expandedProviderId === provider.id) expandedProviderId = null;
              persist();
              showToast('已删除');
            });
          },
        }),
      ]),
    ],
  );

  const meta = h('p', { class: 'mt-2 truncate font-mono text-xs text-[var(--fg-muted)]' }, [
    provider.baseUrl,
    h('span', {
      class: 'ml-2 font-sans',
      textContent: provider.apiKey ? `· 密钥已设置（${provider.apiKey.slice(0, 3)}…）` : '· 未设置密钥',
    }),
    h('span', { class: 'ml-2 font-sans', textContent: `· ${models.length} 个模型` }),
  ]);

  const cardChildren: HTMLElement[] = [header, meta];
  if (expanded) cardChildren.push(modelsArea(provider, models));
  return h(
    'div',
    { class: 'mb-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4' + (provider.enabled ? '' : ' opacity-70') },
    cardChildren,
  );
}

function modelsArea(provider: AIProvider, models: AIModel[]): HTMLElement {
  const rows = models.map((model) => {
    const enabledBox = h('input', { type: 'checkbox', checked: model.enabled, class: 'accent-[var(--accent)]' });
    enabledBox.addEventListener('change', () => {
      model.enabled = enabledBox.checked;
      persist();
    });
    const testing = testingModels.has(model.id);
    return h('div', {
      class: 'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2',
    }, [
      enabledBox,
      h('span', { class: `text-sm ${model.enabled ? 'text-[var(--fg)]' : 'text-[var(--fg-muted)] line-through'}`, textContent: model.name }),
      ...model.capabilities.map((c) => h('span', {
        class: 'rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)]',
        textContent: capLabel(c),
      })),
      h('span', { class: 'ml-auto flex gap-1.5' }, [
        h('button', {
          type: 'button',
          class: BTN_ICON,
          textContent: testing ? '测试中…' : '测试',
          disabled: testing,
          onclick: () => {
            testingModels.add(model.id);
            render();
            void probeChat(provider, model.name)
              .then((ms) => showToast(`✓ ${model.name} 可用（${ms}ms）`))
              .catch((err: Error) => showToast(`✗ ${model.name}：${err.message}`, 4200))
              .finally(() => {
                testingModels.delete(model.id);
                render();
              });
          },
        }),
        h('button', {
          type: 'button',
          class: BTN_ICON,
          textContent: '编辑',
          onclick: () =>
            openModelDialog({
              initial: model,
              providerId: provider.id,
              existingNames: models.map((m) => m.name),
              onSave: (updated) => {
                const i = config.models.indexOf(model);
                if (i >= 0) config.models[i] = updated;
                persist();
              },
            }),
        }),
        h('button', {
          type: 'button',
          class: `${BTN_ICON} hover:border-[var(--holiday-legal)] hover:text-[var(--holiday-legal)]`,
          textContent: '删',
          title: '删除模型',
          onclick: () => {
            config.models = config.models.filter((m) => m.id !== model.id);
            persist();
          },
        }),
      ]),
    ]);
  });

  return h('div', { class: 'mt-3 space-y-2 border-t border-[var(--border)] pt-3' }, [
    ...rows,
    h('button', {
      type: 'button',
      class: BTN_ICON,
      textContent: '＋ 添加模型',
      onclick: () =>
        openModelDialog({
          providerId: provider.id,
          existingNames: models.map((m) => m.name),
          onSave: (model) => {
            config.models.push(model);
            persist();
          },
        }),
    }),
  ]);
}

function capLabel(c: ModelCapability): string {
  return c === 'text' ? '文本' : c === 'image' ? '图片输入' : '音频输入';
}

// ─────────────────────────── 能力路由预览 ───────────────────────────

function renderRouting(): void {
  const needs: Array<{ label: string; need: ModelCapability[] }> = [
    { label: '文本对话（语言大模型）', need: ['text'] },
    { label: '图片理解（多模态）', need: ['text', 'image'] },
    { label: '音频理解', need: ['text', 'audio'] },
  ];
  routingCard.replaceChildren(
    h('div', { class: 'rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5' }, [
      h('h2', { class: 'text-sm font-semibold text-[var(--fg)]', textContent: '路由预览' }),
      h('p', { class: 'mt-0.5 mb-3 text-xs text-[var(--fg-muted)]', textContent: '各工具发起 AI 调用时将实际使用的首选模型：' }),
      ...needs.map(({ label, need }) => {
        const hit = primaryFor(config, need);
        return h('div', { class: 'flex flex-wrap items-center justify-between gap-2 py-1 text-sm' }, [
          h('span', { class: 'text-[var(--fg-muted)]', textContent: label }),
          hit
            ? h('span', { class: 'text-[var(--fg)]' }, [
                h('span', { class: 'text-[var(--accent)]', textContent: hit.provider.name }),
                ` / ${hit.model.name}`,
              ])
            : h('span', { class: 'text-xs text-[var(--fg-muted)]', textContent: '未配置' }),
        ]);
      }),
    ]),
  );
}

// ─────────────────────────── 导出 / 导入 / 清空 ───────────────────────────

function renderMigrate(): void {
  const includeKeysBox = h('input', { type: 'checkbox', checked: true, class: 'accent-[var(--accent)]' });
  const exportBtn = h('button', {
    type: 'button',
    class: 'rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
    textContent: '⬇ 导出配置',
    onclick: () => {
      if (config.providers.length === 0) {
        showToast('当前没有可导出的配置');
        return;
      }
      const includeKeys = includeKeysBox.checked;
      const json = exportAIConfigJSON(config, currentSiteRoot(), includeKeys);
      downloadText(json, aiConfigExportFilename(includeKeys), 'application/json');
      showToast(includeKeys ? '已导出（含密钥，请妥善保管文件）' : '已导出脱敏版（不含密钥）', 3200);
    },
  });

  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'hidden' }) as HTMLInputElement;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const outcome = importAIConfigJSON(String(reader.result ?? ''), currentSiteRoot());
      if (!outcome) {
        showToast('文件无效或格式不符', 3200);
        return;
      }
      const proceed = (): void => {
        config = outcome.config;
        saveAIConfig(config);
        render();
        showToast(
          `已导入 ${config.providers.length} 个供应商、${config.models.length} 个模型${outcome.note ? `；${outcome.note}` : ''}`,
          4200,
        );
      };
      // 导入会整体覆盖现有配置：已有配置时先确认
      if (config.providers.length > 0) {
        void confirmDialog(
          `导入将覆盖当前 ${config.providers.length} 个供应商、${config.models.length} 个模型的配置，确定继续？`,
          { title: '导入配置', danger: true, confirmText: '覆盖导入' },
        ).then((ok) => {
          if (ok) proceed();
        });
      } else {
        proceed();
      }
    };
    reader.onerror = () => showToast('读取失败，请重试');
    reader.readAsText(file);
    fileInput.value = '';
  });

  const importBtn = h('button', {
    type: 'button',
    class: 'rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
    textContent: '⬆ 导入配置',
    onclick: () => fileInput.click(),
  });

  const clearBtn = h('button', {
    type: 'button',
    class:
      'rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--holiday-legal)] hover:text-[var(--holiday-legal)]',
    textContent: '🗑 清空全部',
    onclick: () => {
      void confirmDialog('确定清空全部供应商、模型与密钥？此操作不可撤销（可先导出备份）。', {
        title: '清空 AI 配置',
        danger: true,
        confirmText: '清空',
      }).then((ok) => {
        if (!ok) return;
        clearAIConfig();
        config = loadAIConfig();
        expandedProviderId = null;
        render();
        showToast('已清空全部 AI 配置');
      });
    },
  });

  migrateCard.replaceChildren(
    h('div', { class: 'rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5' }, [
      h('h2', { class: 'text-sm font-semibold text-[var(--fg)]', textContent: '备份与迁移' }),
      h('p', {
        class: 'mt-0.5 mb-3 text-xs leading-relaxed text-[var(--fg-muted)]',
        textContent: '导出的 JSON 可在另一域名（如 GitHub Pages ↔ Cloudflare Pages）或另一台设备导入：指向旧站点的地址会自动替换为当前域名，外部 API 地址保持不变。',
      }),
      h('div', { class: 'flex flex-wrap items-center gap-3' }, [
        exportBtn,
        h('label', { class: 'flex items-center gap-1.5 text-xs text-[var(--fg-muted)]' }, [includeKeysBox, '包含 API 密钥']),
        importBtn,
        clearBtn,
      ]),
      fileInput,
    ]),
  );
}

// ─────────────────────────── 装配 ───────────────────────────

function persist(): void {
  saveAIConfig(config);
  render();
}

function render(): void {
  renderStorageCard();
  renderProviders();
  renderRouting();
  renderMigrate();
}

render();
