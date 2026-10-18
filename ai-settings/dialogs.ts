/**
 * AI 设置页的两个编辑对话框：供应商（含连通性测试 / 拉取模型列表）与模型。
 * 骨架用 core 的 createDialog；表单为无框架 h() 构建，风格与全站一致。
 */

import { h } from '@/core/components/element';
import { createDialog, type DialogHandle } from '@/core/components/Dialog';
import {
  fetchModelIds,
  genId,
  guessCapabilities,
  type AIModel,
  type AIProvider,
  type ModelCapability,
  type ProviderProtocol,
} from '@/core/ai';
import { showToast } from './toast';

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] outline-none transition-colors focus:border-[var(--accent)]';
const LABEL_CLASS = 'mb-1 block text-xs font-medium text-[var(--fg-muted)]';
const BTN_GHOST =
  'rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]';
const BTN_PRIMARY =
  'rounded-lg px-4 py-1.5 text-xs font-medium text-white bg-[var(--accent)] transition-colors hover:opacity-90';

const PROTOCOL_OPTIONS: Array<{ value: ProviderProtocol; label: string; placeholder: string }> = [
  { value: 'openai', label: 'OpenAI 兼容（OpenAI / DeepSeek / Kimi / GLM / Ollama / 中转）', placeholder: 'https://api.openai.com/v1' },
  { value: 'anthropic', label: 'Anthropic（Claude）', placeholder: 'https://api.anthropic.com' },
];

export interface NewModelDraft {
  name: string;
  capabilities: ModelCapability[];
}

export interface ProviderDialogOptions {
  /** 编辑模式传入；新增模式省略 */
  initial?: AIProvider;
  /** 该供应商已有的模型名（拉取列表时标记已存在） */
  existingModelNames?: string[];
  onSave: (provider: AIProvider, newModels: NewModelDraft[]) => void;
}

/** 供应商编辑对话框。保存时回调（新增供应商的 id 在此生成）。 */
export function openProviderDialog(opts: ProviderDialogOptions): void {
  const dlg: DialogHandle = createDialog({ label: opts.initial ? '编辑供应商' : '添加供应商' });
  const editing = opts.initial;

  const nameInput = h('input', { type: 'text', class: INPUT_CLASS, value: editing?.name ?? '', placeholder: '如 OpenAI 官方 / 公司中转' });
  const protocolSelect = h(
    'select',
    { class: INPUT_CLASS },
    PROTOCOL_OPTIONS.map((o) =>
      h('option', { value: o.value, textContent: o.label, selected: o.value === (editing?.protocol ?? 'openai') }),
    ),
  );
  const baseUrlInput = h('input', {
    type: 'text',
    class: INPUT_CLASS,
    value: editing?.baseUrl ?? '',
    placeholder: PROTOCOL_OPTIONS[0]!.placeholder,
  });
  const keyInput = h('input', {
    type: 'password',
    class: INPUT_CLASS,
    value: editing?.apiKey ?? '',
    placeholder: 'sk-…（仅保存在本浏览器）',
    autocomplete: 'off',
  });
  const eyeBtn = h('button', {
    type: 'button',
    class: BTN_GHOST,
    textContent: '显示',
    onclick: () => {
      const hide = keyInput.type === 'password';
      keyInput.type = hide ? 'text' : 'password';
      eyeBtn.textContent = hide ? '隐藏' : '显示';
    },
  });
  const enabledCheck = h('input', { type: 'checkbox', checked: editing?.enabled !== false, class: 'accent-[var(--accent)]' });
  const errorLine = h('p', { class: 'hidden text-xs text-[var(--holiday-legal)]' });
  // 拉取模型结果区 + 测试按钮状态
  const pullArea = h('div', { class: 'hidden' });
  const pendingModels: NewModelDraft[] = [];

  // 协议切换 → baseUrl 占位提示跟随
  protocolSelect.addEventListener('change', () => {
    const opt = PROTOCOL_OPTIONS.find((o) => o.value === protocolSelect.value);
    baseUrlInput.placeholder = opt?.placeholder ?? '';
  });

  function collect(): AIProvider | null {
    const name = nameInput.value.trim();
    const baseUrl = baseUrlInput.value.trim();
    if (!name) {
      showError('请填写供应商名称');
      return null;
    }
    if (!/^https?:\/\//i.test(baseUrl) && !baseUrl.includes('{ORIGIN}')) {
      showError('baseUrl 需以 http(s):// 开头（同域代理可用 {ORIGIN} 占位）');
      return null;
    }
    return {
      id: editing?.id ?? genId('p'),
      name,
      protocol: protocolSelect.value as ProviderProtocol,
      baseUrl,
      apiKey: keyInput.value.trim(),
      enabled: enabledCheck.checked,
      addedAt: editing?.addedAt ?? Date.now(),
    };
  }

  function showError(msg: string): void {
    errorLine.textContent = msg;
    errorLine.classList.remove('hidden');
  }

  const testBtn = h('button', {
    type: 'button',
    class: BTN_GHOST,
    textContent: '⚡ 测试连通',
    onclick: () => {
      const p = collect();
      if (!p) return;
      testBtn.disabled = true;
      testBtn.textContent = '测试中…';
      void fetchModelIds(p)
        .then((ids) => showToast(`✓ 连通正常，接口返回 ${ids.length} 个模型`))
        .catch((err: Error) => showToast(`✗ ${err.message}`, 4200))
        .finally(() => {
          testBtn.disabled = false;
          testBtn.textContent = '⚡ 测试连通';
        });
    },
  });

  const pullBtn = h('button', {
    type: 'button',
    class: BTN_GHOST,
    textContent: '⇩ 拉取模型列表',
    onclick: () => {
      const p = collect();
      if (!p) return;
      pullBtn.disabled = true;
      pullBtn.textContent = '拉取中…';
      void fetchModelIds(p)
        .then((ids) => {
          if (ids.length === 0) {
            showToast('接口未返回模型列表（可手动添加）');
            return;
          }
          renderPullList(ids);
        })
        .catch((err: Error) => showToast(`✗ ${err.message}`, 4200))
        .finally(() => {
          pullBtn.disabled = false;
          pullBtn.textContent = '⇩ 拉取模型列表';
        });
    },
  });

  function renderPullList(ids: string[]): void {
    pullArea.classList.remove('hidden');
    pullArea.replaceChildren();
    const existing = new Set(opts.existingModelNames ?? []);
    const checks = ids.map((id) => {
      const inPending = pendingModels.some((m) => m.name === id);
      const disabled = existing.has(id);
      const box = h('input', {
        type: 'checkbox',
        checked: !disabled && !inPending,
        disabled,
        class: 'accent-[var(--accent)]',
      });
      h(
        'label',
        { class: 'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[var(--fg)] hover:bg-[var(--bg)]' },
        [
          box,
          h('span', { class: disabled ? 'text-[var(--fg-muted)] line-through' : '', textContent: id }),
          ...guessCapabilities(id).map((c) =>
            h('span', { class: 'rounded bg-[var(--bg)] px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)]', textContent: c === 'text' ? '文本' : c === 'image' ? '图片输入' : '音频输入' }),
          ),
        ],
      );
      return { id, box };
    });
    const addSelected = h('button', {
      type: 'button',
      class: BTN_PRIMARY,
      textContent: '添加所选',
      onclick: () => {
        let added = 0;
        for (const c of checks) {
          if (!c.box.checked || c.box.disabled) continue;
          if (pendingModels.some((m) => m.name === c.id)) continue;
          pendingModels.push({ name: c.id, capabilities: guessCapabilities(c.id) });
          added++;
        }
        showToast(added > 0 ? `已标记 ${added} 个模型，保存后生效` : '未选择新模型');
        pullArea.replaceChildren(
          h('p', { class: 'text-xs text-[var(--fg-muted)]', textContent: `已标记 ${pendingModels.length} 个待添加模型（保存后生效）` }),
        );
      },
    });
    pullArea.append(
      h('p', { class: LABEL_CLASS, textContent: `接口返回 ${ids.length} 个模型，勾选要添加的（能力标签为猜测，可稍后编辑）：` }),
      h('div', { class: 'max-h-48 overflow-y-auto rounded-lg border border-[var(--border)] p-1' }, checks.map((c) => c.box.closest('label')!)),
      h('div', { class: 'mt-2 text-right' }, [addSelected]),
    );
  }

  const saveBtn = h('button', {
    type: 'button',
    class: BTN_PRIMARY,
    textContent: '保存',
    onclick: () => {
      const p = collect();
      if (!p) return;
      opts.onSave(p, [...pendingModels]);
      dlg.close();
    },
  });

  dlg.body.append(
    h('div', { class: 'space-y-4' }, [
      h('div', {}, [h('label', { class: LABEL_CLASS, textContent: '供应商名称' }), nameInput]),
      h('div', {}, [
        h('label', { class: LABEL_CLASS, textContent: '协议' }),
        protocolSelect,
        h('p', {
          class: 'mt-1 text-[11px] leading-relaxed text-[var(--fg-muted)]',
          textContent: 'OpenAI 兼容协议覆盖绝大多数服务商与自建网关；Anthropic 需官方密钥（自动附加浏览器直连头）。',
        }),
      ]),
      h('div', {}, [h('label', { class: LABEL_CLASS, textContent: 'API 地址（baseUrl）' }), baseUrlInput]),
      h('div', {}, [
        h('label', { class: LABEL_CLASS, textContent: 'API 密钥' }),
        h('div', { class: 'flex gap-2' }, [keyInput, eyeBtn]),
      ]),
      h('label', { class: 'flex items-center gap-2 text-sm text-[var(--fg)]' }, [
        enabledCheck,
        '启用（关闭后不参与路由，密钥保留）',
      ]),
      errorLine,
      h('div', { class: 'flex gap-2' }, [testBtn, pullBtn]),
      pullArea,
      h('div', { class: 'mt-2 flex justify-end gap-2 border-t border-[var(--border)] pt-4' }, [
        h('button', { type: 'button', class: BTN_GHOST, textContent: '取消', onclick: () => dlg.close() }),
        saveBtn,
      ]),
    ]),
  );
  dlg.open();
}

export interface ModelDialogOptions {
  initial?: AIModel;
  providerId: string;
  /** 同供应商下已有模型名（编辑时排除自身），用于查重 */
  existingNames?: string[];
  onSave: (model: AIModel) => void;
}

const CAPABILITY_CHECKS: Array<{ value: ModelCapability; label: string; hint: string }> = [
  { value: 'text', label: '文本对话', hint: '语言大模型基础能力' },
  { value: 'image', label: '图片输入', hint: '视觉理解 / 多模态' },
  { value: 'audio', label: '音频输入', hint: '语音理解' },
];

/** 模型编辑对话框（新增 / 编辑共用） */
export function openModelDialog(opts: ModelDialogOptions): void {
  const dlg = createDialog({ label: opts.initial ? '编辑模型' : '添加模型' });
  const editing = opts.initial;

  const nameInput = h('input', {
    type: 'text',
    class: INPUT_CLASS,
    value: editing?.name ?? '',
    placeholder: '如 gpt-4o-mini / claude-sonnet-4-5 / deepseek-chat',
  });
  const capBoxes = CAPABILITY_CHECKS.map((c) => ({
    value: c.value,
    box: h('input', {
      type: 'checkbox',
      checked: editing ? editing.capabilities.includes(c.value) : c.value === 'text',
      class: 'accent-[var(--accent)]',
    }),
    label: c.label,
    hint: c.hint,
  }));
  const enabledCheck = h('input', { type: 'checkbox', checked: editing?.enabled !== false, class: 'accent-[var(--accent)]' });
  const errorLine = h('p', { class: 'hidden text-xs text-[var(--holiday-legal)]' });

  const saveBtn = h('button', {
    type: 'button',
    class: BTN_PRIMARY,
    textContent: '保存',
    onclick: () => {
      const name = nameInput.value.trim();
      if (!name) {
        errorLine.textContent = '请填写模型名（API 调用时使用的名称）';
        errorLine.classList.remove('hidden');
        return;
      }
      const dup = (opts.existingNames ?? []).some((n) => n === name && n !== editing?.name);
      if (dup) {
        errorLine.textContent = '该供应商下已有同名模型';
        errorLine.classList.remove('hidden');
        return;
      }
      const capabilities = capBoxes.filter((c) => c.box.checked).map((c) => c.value);
      opts.onSave({
        id: editing?.id ?? genId('m'),
        providerId: opts.providerId,
        name,
        capabilities: capabilities.length > 0 ? capabilities : ['text'],
        enabled: enabledCheck.checked,
      });
      dlg.close();
    },
  });

  dlg.body.append(
    h('div', { class: 'space-y-4' }, [
      h('div', {}, [h('label', { class: LABEL_CLASS, textContent: '模型名（API 名称）' }), nameInput]),
      h('div', {}, [
        h('label', { class: LABEL_CLASS, textContent: '能力（决定各工具按需路由到此模型的条件）' }),
        ...capBoxes.map((c) =>
          h('label', { class: 'flex items-center gap-2 py-1 text-sm text-[var(--fg)]' }, [
            c.box,
            h('span', { textContent: c.label }),
            h('span', { class: 'text-xs text-[var(--fg-muted)]', textContent: c.hint }),
          ]),
        ),
      ]),
      h('label', { class: 'flex items-center gap-2 text-sm text-[var(--fg)]' }, [enabledCheck, '启用']),
      errorLine,
      h('div', { class: 'mt-2 flex justify-end gap-2 border-t border-[var(--border)] pt-4' }, [
        h('button', { type: 'button', class: BTN_GHOST, textContent: '取消', onclick: () => dlg.close() }),
        saveBtn,
      ]),
    ]),
  );
  dlg.open();
}
