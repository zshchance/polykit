/**
 * AI 接入框架 —— 共享类型。
 *
 * 全站 BYOK（用户自带密钥）大模型配置的唯一类型源：
 * 供应商（provider）持有 baseUrl / apiKey / 协议，模型（model）挂在供应商下并声明能力。
 * 详细设计见 docs/ai-framework.md。
 */

/** 供应协议 */
export type ProviderProtocol = 'openai' | 'anthropic';

/**
 * 模型能力标签。
 * 理解类（输入侧）：
 * - text       文本对话（语言大模型基础能力）
 * - image      图片输入（视觉理解）
 * - audio      音频输入（语音理解）
 * 生成类（输出侧）：
 * - image-gen  图片生成（文生图/改图，走 images/generations 或对话式生图网关）
 * - audio-gen  音频生成（音乐/语音合成；对话式网关）
 * - video-gen  视频生成（对话式网关）
 * 路由规则：模型能力需为请求所需能力集合的超集（见 router.ts）。
 */
export type ModelCapability =
  | 'text'
  | 'image'
  | 'audio'
  | 'image-gen'
  | 'audio-gen'
  | 'video-gen';

export const MODEL_CAPABILITIES: readonly ModelCapability[] = [
  'text',
  'image',
  'audio',
  'image-gen',
  'audio-gen',
  'video-gen',
];

/** 能力标签的中文短名（设置页与引导文案共用；不在表内时原样返回） */
export function modelCapabilityLabel(c: ModelCapability): string {
  const labels: Record<ModelCapability, string> = {
    text: '文本对话',
    image: '图片输入',
    audio: '音频输入',
    'image-gen': '图片生成',
    'audio-gen': '音频生成',
    'video-gen': '视频生成',
  };
  return labels[c];
}

/** 一个大模型供应商（数组顺序即调用优先级，见 AIConfig.providers） */
export interface AIProvider {
  id: string;
  /** 显示名，如 "OpenAI 官方"、"公司中转" */
  name: string;
  protocol: ProviderProtocol;
  /**
   * API 根地址。openai 协议约定含 /v1（路径为裸根时自动补）；
   * 指向本站的地址（如同域代理）用 {ORIGIN} 占位，见 transfer.ts。
   */
  baseUrl: string;
  /** 明文存储（BYOK 固有属性，设置页明示风险，见 docs/ai-framework.md 第 10 节） */
  apiKey: string;
  enabled: boolean;
  addedAt: number;
}

/** 供应商下的一个模型 */
export interface AIModel {
  id: string;
  providerId: string;
  /** API 模型名，如 gpt-4o-mini / claude-sonnet-4-5 */
  name: string;
  capabilities: ModelCapability[];
  enabled: boolean;
}

/** 全局 AI 配置（localStorage 持久化形态） */
export interface AIConfig {
  version: 1;
  /** ★ 数组顺序即供应商调用优先级（第 0 个最优先） */
  providers: AIProvider[];
  models: AIModel[];
  /** 会话库存储预算（MB），缺省 500，夹在 50~5000；超预算按 LRU 自动清理 */
  budgetMB?: number;
}

// ─────────────────────────── 调用层消息类型（http.ts / 各工具共用） ───────────────────────────

export type ChatRole = 'system' | 'user' | 'assistant';

/** 多模态内容片断。Phase 1 支持 text + image（image 需 data: URL 或 http(s) URL） */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string };

export interface ChatMessage {
  role: ChatRole;
  /** 纯文本快捷形式，或多模态片断数组 */
  content: string | ContentPart[];
}

/** 流式增量回调载荷 */
export interface AIStreamDelta {
  content?: string;
  /** 推理过程增量（deepseek reasoning_content / anthropic thinking_delta） */
  reasoning?: string;
}

/** 一次成功调用的结果 */
export interface AIChatResult {
  content: string;
  reasoning: string;
  /** 实际使用的模型（自动路由后回填，便于 UI 展示） */
  model: { providerId: string; providerName: string; protocol: ProviderProtocol; modelName: string };
  latencyMs: number;
}

/** 统一错误。code 语义见 docs/ai-framework.md 第 5 节 */
export type AIErrorCode = 'no-model' | 'bad-request' | 'http' | 'network' | 'aborted' | 'quota';

export class AIError extends Error {
  readonly code: AIErrorCode;
  /** http 时携带状态码 */
  readonly status?: number;
  constructor(code: AIErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'AIError';
    this.code = code;
    this.status = status;
  }
}
