/**
 * 会话库纯逻辑核心（无 IndexedDB / DOM 依赖，可单测）。
 *
 * 存储模型（docs/ai-framework.md 第 8 节）：
 * - conversations 元信息（bytes = 文本字节 + 其资产字节，预算与淘汰以此为准）
 * - messages 每条消息一条记录，多模态部分只存资产 id（绝不存 base64 内联）
 * - assets Blob 原生存储 + sha-256 去重 + lastAccessed 供 LRU
 * - usage 按日聚合的调用量
 *
 * 设计要点：**绝不存完整请求体**——每轮请求重发全部历史，按原始日志存会近似
 * 平方级膨胀；上下文永远由 messages 即时拼装（hydrateForApi）。
 */

import type { ChatRole, ContentPart } from './types';

// ─────────────────────────── 存储记录类型 ───────────────────────────

export interface StoredConversation {
  id: string;
  /** 所属工具 slug（如 quote-card），管理界面按此分组 */
  toolSlug: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  /** 近似占用：文本字节 + 引用资产字节（追加时增量维护） */
  bytes: number;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  /** 会话内单调递增序号，[conversationId, seq] 复合索引 */
  seq: number;
  role: ChatRole;
  /** 存储形态：data: 图片转资产引用；http(s) 图片原样保留（远程引用不占本地空间） */
  content: string | StoredPart[];
  usage?: { inputTokens?: number; outputTokens?: number };
  createdAt: number;
}

export type StoredPart =
  | { type: 'text'; text: string }
  | { type: 'image'; assetId: string }
  | { type: 'image'; url: string };

export interface StoredAsset {
  id: string;
  kind: 'image' | 'audio';
  mime: string;
  size: number;
  /** sha-256 十六进制（非安全上下文退化为「长度:前若干字节」） */
  hash: string;
  createdAt: number;
  lastAccessed: number;
}

export interface StoredUsage {
  /** YYYY-MM-DD（本地时区） */
  date: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

// ─────────────────────────── 内容规划：data URL → 资产 ───────────────────────────

export interface PlannedContent {
  /** 存储形态的消息内容 */
  content: string | StoredPart[];
  /** 需要落库为资产的 data URL（按出现顺序） */
  pendingDataUrls: string[];
}

const DATA_URL_RE = /^data:(image\/[a-z+.-]+|audio\/[a-z+.-]+);base64,/i;

/**
 * 把调用层内容规划为存储形态：data: 图片抽出待落资产（消息里只留 assetId 占位
 * 由调用方回填），http(s) 图片原样保留。纯文本直接透传。
 */
export function planStoredContent(content: string | ContentPart[]): PlannedContent {
  if (typeof content === 'string') return { content, pendingDataUrls: [] };
  const parts: StoredPart[] = [];
  const pendingDataUrls: string[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'text', text: part.text });
      continue;
    }
    if (DATA_URL_RE.test(part.url)) {
      parts.push({ type: 'image', assetId: `pending:${pendingDataUrls.length}` });
      pendingDataUrls.push(part.url);
    } else {
      parts.push({ type: 'image', url: part.url });
    }
  }
  return { content: parts, pendingDataUrls };
}

/** 文本字节数（UTF-8），预算估算用 */
export function textBytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** 一条存储形态消息的近似文本字节（资产字节由资产表计入，不在此重复计） */
export function storedMessageBytes(msg: Pick<StoredMessage, 'content'>): number {
  if (typeof msg.content === 'string') return textBytes(msg.content);
  let sum = 0;
  for (const p of msg.content) sum += p.type === 'text' ? textBytes(p.text) : 32;
  return sum;
}

// ─────────────────────────── LRU 淘汰计划（纯函数） ───────────────────────────

export interface EvictionInput {
  /** 全部资产（含未被任何消息引用的孤儿） */
  assets: Array<Pick<StoredAsset, 'id' | 'size' | 'lastAccessed'>>;
  /** 全部会话（bytes 已含其资产字节） */
  conversations: Array<Pick<StoredConversation, 'id' | 'updatedAt' | 'bytes'>>;
  /** 仍被消息引用的资产 id（这些只能随会话删除，不能单独清） */
  referencedAssetIds: ReadonlySet<string>;
  budgetBytes: number;
}

export interface EvictionPlan {
  /** 第一步：删除未被引用的资产（LRU，最久未访问先删） */
  evictAssetIds: string[];
  /** 第二步：整会话删除（updatedAt 最旧先删，连带其消息与资产） */
  deleteConversationIds: string[];
  freedBytes: number;
}

/**
 * 预算淘汰计划：先清孤儿资产（LRU），再删最旧会话，直到总占用 ≤ 预算。
 * 被引用资产只能随所属会话一起走——绝不产生悬空 assetId。
 */
export function computeEvictionPlan(input: EvictionInput): EvictionPlan {
  // 会话 bytes 已含被引用资产字节；孤儿资产单独累加，避免双计
  let referencedBytes = 0;
  for (const a of input.assets) {
    if (input.referencedAssetIds.has(a.id)) referencedBytes += a.size;
  }
  const total =
    input.conversations.reduce((s, c) => s + c.bytes, 0) +
    (input.assets.reduce((s, a) => s + a.size, 0) - referencedBytes);

  let current = total;
  const plan: EvictionPlan = { evictAssetIds: [], deleteConversationIds: [], freedBytes: 0 };
  if (current <= input.budgetBytes) return plan;

  const orphans = input.assets
    .filter((a) => !input.referencedAssetIds.has(a.id))
    .sort((a, b) => a.lastAccessed - b.lastAccessed);
  for (const a of orphans) {
    if (current <= input.budgetBytes) break;
    plan.evictAssetIds.push(a.id);
    current -= a.size;
    plan.freedBytes += a.size;
  }

  const convs = [...input.conversations].sort((a, b) => a.updatedAt - b.updatedAt);
  for (const c of convs) {
    if (current <= input.budgetBytes) break;
    plan.deleteConversationIds.push(c.id);
    current -= c.bytes;
    plan.freedBytes += c.bytes;
  }
  return plan;
}

// ─────────────────────────── 记录清洗（读取/导入共用） ───────────────────────────

export function sanitizeConversation(raw: unknown): StoredConversation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.toolSlug !== 'string') return null;
  return {
    id: r.id,
    toolSlug: r.toolSlug,
    title: typeof r.title === 'string' ? r.title.slice(0, 200) : '未命名会话',
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
    messageCount: typeof r.messageCount === 'number' && r.messageCount >= 0 ? r.messageCount : 0,
    bytes: typeof r.bytes === 'number' && r.bytes >= 0 ? r.bytes : 0,
  };
}

export function sanitizeMessage(raw: unknown): StoredMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.conversationId !== 'string') return null;
  const role = r.role === 'user' || r.role === 'assistant' || r.role === 'system' ? r.role : null;
  if (!role) return null;
  let content: StoredMessage['content'];
  if (typeof r.content === 'string') {
    content = r.content;
  } else if (Array.isArray(r.content)) {
    const parts: StoredPart[] = [];
    for (const p of r.content) {
      if (!p || typeof p !== 'object') continue;
      const pp = p as Record<string, unknown>;
      if (pp.type === 'text' && typeof pp.text === 'string') parts.push({ type: 'text', text: pp.text });
      else if (pp.type === 'image' && typeof pp.assetId === 'string') parts.push({ type: 'image', assetId: pp.assetId });
      else if (pp.type === 'image' && typeof pp.url === 'string') parts.push({ type: 'image', url: pp.url });
    }
    content = parts;
  } else {
    return null;
  }
  return {
    id: r.id,
    conversationId: r.conversationId,
    seq: typeof r.seq === 'number' ? r.seq : 0,
    role,
    content,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
  };
}
