/**
 * AI 配置校验与清洗（纯函数，无 DOM / storage 依赖，可单测）。
 *
 * load 与 import 共用同一份 sanitize：任何来源（localStorage 损坏数据 / 导入文件）
 * 都经过字段级清洗——非法回退默认、悬空模型丢弃、id 去重、数量护栏。
 * 与全站 settings 模块的「逐字段校验、安全回退」约定一致。
 */

import {
  MODEL_CAPABILITIES,
  type AIConfig,
  type AIModel,
  type AIProvider,
  type ModelCapability,
  type ProviderProtocol,
} from './types';

export const PROVIDER_PROTOCOLS: readonly ProviderProtocol[] = ['openai', 'anthropic'];

/** 数量护栏：防异常导入把 localStorage 撑爆 */
const MAX_PROVIDERS = 50;
const MAX_MODELS = 500;

export function emptyAIConfig(): AIConfig {
  return { version: 1, providers: [], models: [] };
}

function isProtocol(v: unknown): v is ProviderProtocol {
  return v === 'openai' || v === 'anthropic';
}

function cleanCapabilities(v: unknown): ModelCapability[] {
  if (!Array.isArray(v)) return ['text'];
  const out: ModelCapability[] = [];
  for (const c of v) {
    if ((MODEL_CAPABILITIES as readonly string[]).includes(c as string) && !out.includes(c as ModelCapability)) {
      out.push(c as ModelCapability);
    }
  }
  return out.length > 0 ? out : ['text'];
}

function cleanStr(v: unknown, maxLen: number, fallback = ''): string {
  if (typeof v !== 'string') return fallback;
  const s = v.trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

/**
 * 清洗任意来源的配置数据。容忍部分损坏：能救则救，救不了的字段回退默认。
 * 返回 null 表示输入完全不是配置形态（连对象都不是）。
 */
export function sanitizeAIConfig(raw: unknown): AIConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  // —— 供应商：逐个校验，id 重复者丢弃 ——
  const seenProviderIds = new Set<string>();
  const providers: AIProvider[] = [];
  if (Array.isArray(r.providers)) {
    for (const item of r.providers) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const p = item as Record<string, unknown>;
      const id = typeof p.id === 'string' ? p.id : '';
      if (!id || seenProviderIds.has(id) || providers.length >= MAX_PROVIDERS) continue;
      const name = cleanStr(p.name, 60, '未命名供应商');
      const protocol = isProtocol(p.protocol) ? p.protocol : 'openai';
      const baseUrl = cleanStr(p.baseUrl, 500);
      if (!baseUrl) continue; // 没有 baseUrl 的供应商无法调用，丢弃
      providers.push({
        id,
        name,
        protocol,
        baseUrl,
        apiKey: cleanStr(p.apiKey, 500),
        enabled: p.enabled !== false,
        addedAt: typeof p.addedAt === 'number' && p.addedAt >= 0 ? p.addedAt : Date.now(),
      });
      seenProviderIds.add(id);
    }
  }

  // —— 模型：providerId 悬空者丢弃，id 重复者丢弃 ——
  const seenModelIds = new Set<string>();
  const models: AIModel[] = [];
  if (Array.isArray(r.models)) {
    for (const item of r.models) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const m = item as Record<string, unknown>;
      const id = typeof m.id === 'string' ? m.id : '';
      const providerId = typeof m.providerId === 'string' ? m.providerId : '';
      const name = cleanStr(m.name, 200);
      if (!id || !providerId || !name || !seenProviderIds.has(providerId)) continue;
      if (seenModelIds.has(id) || models.length >= MAX_MODELS) continue;
      models.push({
        id,
        providerId,
        name,
        capabilities: cleanCapabilities(m.capabilities),
        enabled: m.enabled !== false,
      });
      seenModelIds.add(id);
    }
  }

  return {
    version: 1,
    providers,
    models,
    ...(typeof r.budgetMB === 'number' && r.budgetMB >= 50 && r.budgetMB <= 5000
      ? { budgetMB: Math.round(r.budgetMB) }
      : {}),
  };
}

/** 判断配置是否已实际可用（至少一条可路由路径：启用的供应商下有启用的模型） */
export function hasRoutableModel(config: AIConfig): boolean {
  const enabledProviders = new Set(config.providers.filter((p) => p.enabled).map((p) => p.id));
  return config.models.some((m) => m.enabled && enabledProviders.has(m.providerId));
}

/**
 * 按模型名猜测能力标签（「拉取模型列表」批量建模型时的默认值，用户可改）。
 * 猜错无妨——只影响路由匹配，不影响调用本身。
 */
export function guessCapabilities(modelName: string): ModelCapability[] {
  const caps: ModelCapability[] = ['text'];
  // 常见视觉命名：gpt-4o / *-vision / *-vl / gemini / claude 3+ / glm-4v / doubao-*-vision ...
  if (
    /(^|[-_.])(4o|omni)([-_.]|$)|vision|^-vl|-vl-|multimodal|glm-4v|qwen.*vl|claude-(3|4|sonnet|opus|haiku)|gemini|doubao.*vision|grok-4/i.test(
      modelName,
    )
  ) {
    caps.push('image');
  }
  // 常见音频理解命名：gpt-4o-audio / *-audio / glm-4-voice / whisper ...
  if (/audio|voice|asr|whisper/i.test(modelName)) caps.push('audio');
  // 生成类命名（猜中的直接标生成能力；生成模型同时保留 text 以便对话式网关调用）
  if (/dall-e|gpt-image|image-?gen|imggen|flux|seedream|seededit|cogview|wanx|ideogram|recraft|stable-?diffusion|sd3|midjourney|mj-|irag/i.test(modelName)) {
    caps.push('image-gen');
  }
  if (/sora|veo[\s-]?\d|kling|runway|pika|hunyuan-?(video)?|vidu|cogvideo|wan-?video|jimeng-?video|seedance|video-?gen/i.test(modelName)) {
    caps.push('video-gen');
  }
  if (/tts|speech|audio-?gen|music|suno|udio|bark|voice-?(gen|clone)|fish-?(audio|speech)/i.test(modelName)) {
    caps.push('audio-gen');
  }
  return caps;
}
