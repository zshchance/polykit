/**
 * AI 接入框架门面 —— 各工具唯一需要 import 的入口。
 *
 *   import { aiChat } from '@/core/ai';
 *   const res = await aiChat({ messages: [...], need: ['text'], onDelta: fn });
 *
 * 设计：按能力 + 供应商优先级自动路由，候选失败在「产出首个增量前」自动顺延；
 * 详细约定见 docs/ai-framework.md 第 7 节。
 */

import { chatStream, generateImages } from './http';
import { resolveCandidates } from './router';
import { loadAIConfig } from './store';
import { recordUsage } from './chat-store';
import {
  AIError,
  type AIChatResult,
  type AIStreamDelta,
  type ChatMessage,
  type ModelCapability,
} from './types';

export { AIError } from './types';
export type {
  AIChatResult,
  AIStreamDelta,
  AIConfig,
  AIModel,
  AIProvider,
  ChatMessage,
  ContentPart,
  ModelCapability,
  ProviderProtocol,
} from './types';
export { MODEL_CAPABILITIES, modelCapabilityLabel } from './types';
export { loadAIConfig, saveAIConfig, clearAIConfig, subscribeAIConfig, genId } from './store';
export { emptyAIConfig, sanitizeAIConfig, hasRoutableModel, guessCapabilities } from './schema';
export { resolveCandidates, primaryFor } from './router';
export {
  providerEndpoints,
  providerHeaders,
  buildChatBody,
  parseSSE,
  extractDelta,
  chatStream,
  fetchModelIds,
  probeChat,
  generateImages,
  normalizeImagesResponse,
} from './http';
export {
  ORIGIN_TOKEN,
  currentSiteRoot,
  exportAIConfigJSON,
  importAIConfigJSON,
  aiConfigExportFilename,
} from './transfer';
export {
  createConversation,
  appendMessage,
  listConversations,
  getMessages,
  deleteConversation,
  putAssetFromDataUrl,
  getAssetBlob,
  hydrateForApi,
  exportConversationJSON,
  recordUsage,
  chatStats,
  enforceBudget,
  clearChatData,
  budgetBytesOf,
  saveBudgetMB,
  type ChatStats,
} from './chat-store';
export type {
  StoredConversation,
  StoredMessage,
  StoredAsset,
  StoredUsage,
  StoredPart,
} from './chat-core';

export interface AIChatRequest {
  messages: ChatMessage[];
  /** 所需能力集合，缺省 ['text']（纯文本对话） */
  need?: ModelCapability[];
  /** 指定模型 id 时跳过路由（设置页测试用）；缺省走能力路由 */
  modelId?: string;
  /** 首个增量前失败是否自动顺延下一候选，默认 true */
  fallback?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** 流式增量回调 */
  onDelta?: (d: AIStreamDelta) => void;
}

/** AI 接入设置页地址（系统配置页，非工具页；引导用户跳转用） */
export function aiSettingsUrl(): string {
  return `${import.meta.env.BASE_URL}ai-settings/`;
}

/** 统一调用入口。失败抛 AIError；未配置可用模型时 code='no-model'。 */
export async function aiChat(req: AIChatRequest): Promise<AIChatResult> {
  const config = loadAIConfig();
  const candidates = req.modelId
    ? resolveCandidates(config).filter((c) => c.model.id === req.modelId)
    : resolveCandidates(config, req.need ?? ['text']);
  if (candidates.length === 0) {
    throw new AIError(
      'no-model',
      '尚未配置可用的大模型（或所需能力的模型未启用）。请先在「AI 接入设置」添加供应商与模型',
    );
  }

  const allowFallback = req.fallback !== false;
  let lastErr: unknown = null;

  for (const { provider, model } of candidates) {
    let emitted = false; // 是否已向调用方产出增量（产出后不再顺延，避免重复输出）
    const started = performance.now();
    try {
      const { content, reasoning } = await chatStream(
        provider,
        model.name,
        req.messages,
        {
          temperature: req.temperature,
          maxTokens: req.maxTokens,
          signal: req.signal,
          onDelta: (d) => {
            emitted = true;
            req.onDelta?.(d);
          },
        },
      );
      // 用量记账（fire-and-forget：会话库不可用时静默跳过，不影响调用）
      void recordUsage({ calls: 1 }).catch(() => undefined);
      return {
        content,
        reasoning,
        model: {
          providerId: provider.id,
          providerName: provider.name,
          protocol: provider.protocol,
          modelName: model.name,
        },
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (err) {
      lastErr = err;
      // 已开始输出 / 用户主动中止 / 消息体非法：换一家也一样，立即抛出
      const fatal =
        emitted ||
        (err instanceof AIError && (err.code === 'aborted' || err.code === 'bad-request'));
      if (fatal || !allowFallback) throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new AIError('network', String(lastErr));
}

export interface AIGenerateImageRequest {
  prompt: string;
  /** 指定模型 id 时跳过路由（测试用）；缺省按 ['image-gen'] 能力路由 */
  modelId?: string;
  n?: number;
  size?: string;
  signal?: AbortSignal;
}

/** 图片生成统一入口：按 ['image-gen'] 能力路由，候选失败顺延（与 aiChat 同语义）。 */
export async function aiGenerateImage(req: AIGenerateImageRequest): Promise<{
  images: string[];
  model: { providerName: string; modelName: string };
  latencyMs: number;
}> {
  const config = loadAIConfig();
  const candidates = req.modelId
    ? resolveCandidates(config).filter(
        (c) => c.model.id === req.modelId && c.model.capabilities.includes('image-gen'),
      )
    : resolveCandidates(config, ['image-gen']);
  if (candidates.length === 0) {
    throw new AIError('no-model', '尚未配置可用的图片生成模型。请先在「AI 接入设置」添加并勾选「图片生成」能力');
  }

  let lastErr: unknown = null;
  for (const { provider, model } of candidates) {
    const started = performance.now();
    try {
      const images = await generateImages(provider, model.name, req.prompt, {
        n: req.n,
        size: req.size,
        signal: req.signal,
      });
      void recordUsage({ calls: 1 }).catch(() => undefined);
      return {
        images,
        model: { providerName: provider.name, modelName: model.name },
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (err) {
      lastErr = err;
      if (err instanceof AIError && (err.code === 'aborted' || err.code === 'bad-request')) throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new AIError('network', String(lastErr));
}
