/**
 * 调用适配层：请求构建（纯函数）+ SSE 流式解析 + 连通性测试。
 *
 * 两种协议：
 * - openai    OpenAI 兼容（OpenAI / DeepSeek / Kimi / GLM / Ollama / 多数中转）
 * - anthropic Anthropic Messages API（需浏览器直连专用头）
 *
 * URL 规范化规则（确定性，测试覆盖，见 docs/ai-framework.md 第 5 节）：
 * - openai：baseUrl 约定含 /v1；路径为裸根时自动补 /v1 → {root}/chat/completions、{root}/models
 * - anthropic：尾部 /v1 先剥掉再统一拼 → {root}/v1/messages、{root}/v1/models
 */

import {
  AIError,
  type AIStreamDelta,
  type ChatMessage,
  type ContentPart,
  type ProviderProtocol,
  type AIProvider,
} from './types';

// ─────────────────────────── URL / 请求构建（纯函数） ───────────────────────────

export interface ProviderEndpoints {
  /** 规整后的根地址（无尾斜杠） */
  root: string;
  chatUrl: string;
  modelsUrl: string;
}

/** 规整 baseUrl 并产出两个端点。非法输入（空/非 http(s) 且非相对路径）返回 null。 */
export function providerEndpoints(baseUrl: string, protocol: ProviderProtocol): ProviderEndpoints | null {
  let s = baseUrl.trim().replace(/\/+$/, '');
  if (!s) return null;
  // 相对路径（如自建代理 {ORIGIN} 替换后为绝对地址；此处的相对路径仅测试场景用）
  if (!/^https?:\/\//i.test(s) && !s.startsWith('/')) return null;
  if (protocol === 'openai') {
    // 忘填 /v1 的兜底：路径为裸根（如 https://api.openai.com）时补 /v1
    const path = s.replace(/^https?:\/\/[^/]+/i, '');
    if (path === '') s += '/v1';
  } else {
    if (s.endsWith('/v1')) s = s.slice(0, -3);
  }
  const root = s;
  return protocol === 'openai'
    ? { root, chatUrl: `${root}/chat/completions`, modelsUrl: `${root}/models` }
    : { root, chatUrl: `${root}/v1/messages`, modelsUrl: `${root}/v1/models` };
}

/** 按协议构建鉴权与直连头（纯函数） */
export function providerHeaders(provider: {
  protocol: ProviderProtocol;
  apiKey: string;
}): Record<string, string> {
  if (provider.protocol === 'anthropic') {
    return {
      'content-type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
      // Anthropic 官方为浏览器直连提供的开关（CORS 支持）
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${provider.apiKey}`,
  };
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  stream?: boolean;
}

/** 统一消息内容 → 文本（纯文本消息取全文；多模态消息不支持 system 化等特殊处理） */
function partsToOpenAI(content: string | ContentPart[]): unknown {
  if (typeof content === 'string') return content;
  return content.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    // openai 系：http(s) 与 data: URL 均可直接传
    return { type: 'image_url', image_url: { url: part.url } };
  });
}

/** data URL → anthropic source（base64 拆分）。非 data URL 且非文本时报错（anthropic 不支持远程图）。 */
function partsToAnthropic(content: string | ContentPart[]): unknown {
  if (typeof content === 'string') return content;
  return content.map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(part.url);
    if (!m) {
      throw new AIError(
        'bad-request',
        'Anthropic 协议的图片输入需为 data: URL（本地图片会自动转换；远程图片请改用 OpenAI 兼容协议）',
      );
    }
    return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
  });
}

/** 构建 chat 请求体（纯函数）。system 提升等协议差异在此吸收。 */
export function buildChatBody(
  protocol: ProviderProtocol,
  modelName: string,
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Record<string, unknown> {
  if (protocol === 'anthropic') {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n\n');
    const rest = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: partsToAnthropic(m.content) }));
    const body: Record<string, unknown> = {
      model: modelName,
      max_tokens: opts.maxTokens ?? 4096, // anthropic 必填
      messages: rest,
    };
    if (system) body.system = system;
    if (typeof opts.temperature === 'number') body.temperature = opts.temperature;
    if (opts.stream) body.stream = true;
    return body;
  }
  return {
    model: modelName,
    messages: messages.map((m) => ({ role: m.role, content: partsToOpenAI(m.content) })),
    ...(typeof opts.temperature === 'number' ? { temperature: opts.temperature } : {}),
    ...(opts.maxTokens != null ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.stream ? { stream: true } : {}),
  };
}

// ─────────────────────────── SSE 解析（纯函数） ───────────────────────────

/**
 * 从缓冲区解析完整的 SSE 事件块（以空行分隔），返回 {事件数组, 剩余缓冲}。
 * 每个事件为其 data: 行拼接后的字符串（不含 "data:" 前缀）。
 */
export function parseSSE(buffer: string): { events: string[]; rest: string } {
  const events: string[] = [];
  let rest = buffer;
  // 兼容 \r\n 与 \n 两种分隔
  for (;;) {
    const idx = rest.search(/\r?\n\r?\n/);
    if (idx < 0) break;
    const block = rest.slice(0, idx);
    rest = rest.slice(idx).replace(/^\r?\n\r?\n/, '');
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data) events.push(data);
  }
  return { events, rest };
}

/** 从一条 SSE data JSON 中提取增量（纯函数，容忍非 JSON）。 */
export function extractDelta(protocol: ProviderProtocol, data: string): AIStreamDelta & { done: boolean } {
  if (protocol === 'anthropic') {
    if (data === '[DONE]') return { done: true };
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return { done: false };
    }
    if (obj.type === 'content_block_delta') {
      const d = obj.delta as Record<string, unknown> | undefined;
      if (!d) return { done: false };
      if (typeof d.text === 'string') return { content: d.text, done: false };
      if (typeof d.thinking === 'string') return { reasoning: d.thinking, done: false };
    }
    if (obj.type === 'message_stop') return { done: true };
    return { done: false };
  }
  // openai 兼容
  if (data === '[DONE]') return { done: true };
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return { done: false };
  }
  const choices = obj.choices as Array<Record<string, unknown>> | undefined;
  const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
  if (!delta) return { done: false };
  const out: AIStreamDelta & { done: boolean } = { done: false };
  if (typeof delta.content === 'string' && delta.content) out.content = delta.content;
  // deepseek 系推理增量
  const reasoning = delta.reasoning_content ?? delta.reasoning;
  if (typeof reasoning === 'string' && reasoning) out.reasoning = reasoning;
  return out;
}

// ─────────────────────────── 网络调用（impure，经依赖注入便于测试） ───────────────────────────

export type FetchLike = typeof fetch;

/**
 * 统一 fetch 入口：非 2xx 读响应体（截断 300 字）抛 AIError('http')；
 * 网络失败（含 CORS 拦截的 TypeError）抛 AIError('network')；中止抛 AIError('aborted')。
 */
async function fetchOrAIError(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<Response> {
  let resp: Response;
  try {
    resp = await fetchImpl(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new AIError('aborted', '已取消');
    }
    throw new AIError(
      'network',
      `网络请求失败（${err instanceof Error ? err.message : String(err)}）。请检查网络、baseUrl 与 CORS 是否放行`,
    );
  }
  if (!resp.ok) {
    let snippet = '';
    try {
      snippet = (await resp.text()).slice(0, 300);
    } catch {
      // 忽略读体失败
    }
    throw new AIError('http', `HTTP ${resp.status}${snippet ? `：${snippet}` : ''}`, resp.status);
  }
  return resp;
}

export interface StreamResult {
  content: string;
  reasoning: string;
}

/**
 * 流式对话。onDelta 在收到每个增量时回调；signal 可中止。
 * 返回聚合后的完整 content / reasoning。
 */
export async function chatStream(
  provider: AIProvider,
  modelName: string,
  messages: ChatMessage[],
  opts: ChatOptions & { onDelta?: (d: AIStreamDelta) => void } = {},
  fetchImpl: FetchLike = fetch,
): Promise<StreamResult> {
  const endpoints = providerEndpoints(provider.baseUrl, provider.protocol);
  if (!endpoints) throw new AIError('bad-request', `供应商「${provider.name}」的 baseUrl 无效：${provider.baseUrl}`);

  const body = buildChatBody(provider.protocol, modelName, messages, { ...opts, stream: true });
  const resp = await fetchOrAIError(
    endpoints.chatUrl,
    {
      method: 'POST',
      headers: providerHeaders(provider),
      body: JSON.stringify(body),
      signal: opts.signal,
    },
    fetchImpl,
  );

  let content = '';
  let reasoning = '';
  let buffer = '';
  const decoder = new TextDecoder();
  const reader = resp.body?.getReader();
  if (!reader) {
    // 服务器未走流式（个别网关忽略 stream 参数）：整包读出
    const j = JSON.parse(await resp.text()) as Record<string, unknown>;
    const extracted = nonStreamText(provider.protocol, j);
    opts.onDelta?.(extracted);
    return extracted;
  }
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSSE(buffer);
    buffer = rest;
    for (const ev of events) {
      const d = extractDelta(provider.protocol, ev);
      if (d.done) continue;
      if (d.content || d.reasoning) opts.onDelta?.(d);
      if (d.content) content += d.content;
      if (d.reasoning) reasoning += d.reasoning;
    }
  }
  // 尾包冲刷：个别服务器最后一段事件后无空行收尾
  if (buffer.trim().length > 0) {
    const { events } = parseSSE(`${buffer}\n\n`);
    for (const ev of events) {
      const d = extractDelta(provider.protocol, ev);
      if (d.done || (!d.content && !d.reasoning)) continue;
      opts.onDelta?.(d);
      if (d.content) content += d.content;
      if (d.reasoning) reasoning += d.reasoning;
    }
  }
  return { content, reasoning };
}

/** 非流式响应体 → 文本（openai choices[0].message / anthropic content 数组拼接） */
function nonStreamText(
  protocol: ProviderProtocol,
  j: Record<string, unknown>,
): { content: string; reasoning: string } {
  if (protocol === 'anthropic') {
    const blocks = (j.content as Array<Record<string, unknown>> | undefined) ?? [];
    const content = blocks
      .filter((b) => b.type === 'text')
      .map((b) => String(b.text ?? ''))
      .join('');
    const reasoning = blocks
      .filter((b) => b.type === 'thinking')
      .map((b) => String(b.thinking ?? ''))
      .join('');
    return { content, reasoning };
  }
  const choices = j.choices as Array<Record<string, unknown>> | undefined;
  const msg = (choices?.[0]?.message ?? {}) as Record<string, unknown>;
  return {
    content: typeof msg.content === 'string' ? msg.content : '',
    reasoning: typeof msg.reasoning_content === 'string' ? msg.reasoning_content : '',
  };
}

/** GET /models，返回模型 id 列表（连通性测试 + 设置页「拉取模型列表」） */
export async function fetchModelIds(
  provider: AIProvider,
  fetchImpl: FetchLike = fetch,
): Promise<string[]> {
  const endpoints = providerEndpoints(provider.baseUrl, provider.protocol);
  if (!endpoints) throw new AIError('bad-request', `baseUrl 无效：${provider.baseUrl}`);
  const resp = await fetchOrAIError(
    endpoints.modelsUrl,
    { method: 'GET', headers: providerHeaders(provider) },
    fetchImpl,
  );
  const j = (await resp.json()) as { data?: Array<{ id?: unknown }> };
  return (j.data ?? [])
    .map((d) => (typeof d.id === 'string' ? d.id : ''))
    .filter((id) => id.length > 0);
}

/** 单模型真实通路探测：max_tokens=1 的极小非流式请求，返回延迟。 */
export async function probeChat(
  provider: AIProvider,
  modelName: string,
  fetchImpl: FetchLike = fetch,
): Promise<number> {
  const endpoints = providerEndpoints(provider.baseUrl, provider.protocol);
  if (!endpoints) throw new AIError('bad-request', `baseUrl 无效：${provider.baseUrl}`);
  const body = buildChatBody(provider.protocol, modelName, [{ role: 'user', content: 'hi' }], {
    maxTokens: 1,
  });
  const started = performance.now();
  await fetchOrAIError(
    endpoints.chatUrl,
    {
      method: 'POST',
      headers: providerHeaders(provider),
      body: JSON.stringify(body),
    },
    fetchImpl,
  );
  return Math.round(performance.now() - started);
}

// ─────────────────────────── 图片生成（OpenAI Images API 兼容） ───────────────────────────

/**
 * 归一化 images/generations 响应为图片地址数组（纯函数）。
 * 兼容 {url} 直链与 {b64_json}（转为 data URL）两种形态；空结果抛错。
 */
export function normalizeImagesResponse(j: unknown): string[] {
  const data = (j as { data?: unknown })?.data;
  if (!Array.isArray(data)) {
    throw new AIError('http', '图片生成响应格式异常（缺少 data 数组）');
  }
  const out: string[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    if (typeof d.url === 'string' && d.url) out.push(d.url);
    else if (typeof d.b64_json === 'string' && d.b64_json) {
      out.push(`data:image/png;base64,${d.b64_json}`);
    }
  }
  if (out.length === 0) {
    throw new AIError('http', '图片生成响应中没有可用图片（url / b64_json 均为空）');
  }
  return out;
}

/**
 * 文生图调用：POST {base}/images/generations（OpenAI Images API 兼容，
 * OpenAI / 多数国产与中转网关均实现此端点）。
 * Anthropic 协议无此端点，明确报错引导用 OpenAI 兼容供应商。
 */
export async function generateImages(
  provider: AIProvider,
  modelName: string,
  prompt: string,
  opts: { n?: number; size?: string; signal?: AbortSignal } = {},
  fetchImpl: FetchLike = fetch,
): Promise<string[]> {
  if (provider.protocol === 'anthropic') {
    throw new AIError(
      'bad-request',
      'Anthropic 协议暂不支持图片生成，请在「AI 接入设置」使用 OpenAI 兼容供应商的生图模型',
    );
  }
  const endpoints = providerEndpoints(provider.baseUrl, provider.protocol);
  if (!endpoints) throw new AIError('bad-request', `baseUrl 无效：${provider.baseUrl}`);
  const resp = await fetchOrAIError(
    `${endpoints.root}/images/generations`,
    {
      method: 'POST',
      headers: providerHeaders(provider),
      body: JSON.stringify({
        model: modelName,
        prompt,
        n: opts.n ?? 1,
        ...(opts.size ? { size: opts.size } : {}),
      }),
      signal: opts.signal,
    },
    fetchImpl,
  );
  const j: unknown = await resp.json();
  return normalizeImagesResponse(j);
}
