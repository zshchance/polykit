/**
 * AI 配置存储层：localStorage CRUD + 跨页订阅。
 *
 * 薄壳设计——校验清洗逻辑全在 schema.ts（纯函数），本模块只做：
 * 读写经 core/utils/storage 容错、变更后通知订阅者、storage 事件跨标签页同步。
 * MPA 架构下「设置页改配置 → 其它工具页实时生效」靠 storage 事件实现。
 */

import { readJSON, writeJSON, removeKey } from '@/core/utils/storage';
import { emptyAIConfig, sanitizeAIConfig } from './schema';
import type { AIConfig } from './types';

const STORAGE_KEY = 'static-toolkit-ai-config';

type Listener = (config: AIConfig) => void;
const listeners = new Set<Listener>();

/** 生成实体 id：优先 crypto.randomUUID（需安全上下文），否则时间戳+随机数回退 */
export function genId(prefix: string): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 读取配置；未配置/损坏/隐私模式安全回退为空配置 */
export function loadAIConfig(): AIConfig {
  const raw = readJSON(STORAGE_KEY);
  if (!raw) return emptyAIConfig();
  return sanitizeAIConfig(raw) ?? emptyAIConfig();
}

/** 持久化配置并通知订阅者（本页 + 跨标签页）。返回是否写入成功。 */
export function saveAIConfig(config: AIConfig): boolean {
  const ok = writeJSON(STORAGE_KEY, config);
  if (ok) notify(config);
  return ok;
}

/** 清空全部 AI 配置（设置页「清空」按钮） */
export function clearAIConfig(): void {
  removeKey(STORAGE_KEY);
  notify(emptyAIConfig());
}

/** 订阅配置变更（含其它标签页的变更，经 storage 事件桥接）。返回取消订阅函数 */
export function subscribeAIConfig(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(config: AIConfig): void {
  for (const fn of listeners) fn(config);
}

// —— 跨标签页同步：storage 事件只在「其它」标签页修改时触发，本页已在 saveAIConfig 里通知 ——
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    notify(loadAIConfig());
  });
}
