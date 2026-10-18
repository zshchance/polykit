/**
 * AI 会话库（IndexedDB）——薄存储层。
 *
 * 库 polykit-ai v1，四个 object store：
 *   conversations(id) + by-tool / by-updated 索引
 *   messages(id) + [conversationId, seq] 复合索引
 *   assets(id) + by-hash（去重）/ by-access（LRU）索引，Blob 原生存储
 *   usage(date) 按日聚合
 *
 * 纯逻辑（内容规划 / 淘汰计划 / 记录清洗）在 chat-core.ts；
 * 配额守卫：写入遇 QuotaExceededError → 按预算 LRU 清理 → 重试一次 → 仍失败抛 AIError('quota')。
 */

import { AIError, type ChatMessage, type ChatRole, type ContentPart, type AIConfig } from './types';
import { genId, loadAIConfig, saveAIConfig } from './store';
import {
  computeEvictionPlan,
  planStoredContent,
  storedMessageBytes,
  type EvictionPlan,
  type StoredAsset,
  type StoredConversation,
  type StoredMessage,
  type StoredPart,
  type StoredUsage,
} from './chat-core';
import { toDateKey } from '@/core/utils/date';

const DB_NAME = 'polykit-ai';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openChatDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('conversations')) {
        const s = db.createObjectStore('conversations', { keyPath: 'id' });
        s.createIndex('by-tool', 'toolSlug');
        s.createIndex('by-updated', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('messages')) {
        db.createObjectStore('messages', { keyPath: 'id' }).createIndex('by-conv', [
          'conversationId',
          'seq',
        ]);
      }
      if (!db.objectStoreNames.contains('assets')) {
        const s = db.createObjectStore('assets', { keyPath: 'id' });
        s.createIndex('by-hash', 'hash');
        s.createIndex('by-access', 'lastAccessed');
      }
      if (!db.objectStoreNames.contains('usage')) {
        db.createObjectStore('usage', { keyPath: 'date' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
  });
  return dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 请求失败'));
  });
}

type AssetRow = StoredAsset & { blob: Blob };

async function withStore<T>(
  names: string | string[],
  mode: IDBTransactionMode,
  fn: (stores: Record<string, IDBObjectStore>) => Promise<T> | void,
): Promise<T> {
  const db = await openChatDB();
  const list = Array.isArray(names) ? names : [names];
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(list, mode);
    const stores: Record<string, IDBObjectStore> = {};
    for (const n of list) stores[n] = tx.objectStore(n);
    Promise.resolve(fn(stores)).then((v) => resolve(v as T), reject);
    tx.onabort = () => {
      const err = tx.error;
      if (err && err.name === 'QuotaExceededError') {
        reject(new AIError('quota', '本地存储配额已满，自动清理后仍未释放足够空间'));
      } else {
        reject(err ?? new Error('IndexedDB 事务中止'));
      }
    };
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'));
  });
}

/** 某会话的消息区间（复合索引 [conversationId, seq]，seq 为非负整数） */
function convKeyRange(conversationId: string): IDBKeyRange {
  return IDBKeyRange.bound([conversationId, -1], [conversationId, Number.MAX_SAFE_INTEGER]);
}

function isQuotaError(err: unknown): boolean {
  return (
    err instanceof AIError
      ? err.code === 'quota'
      : err instanceof DOMException && err.name === 'QuotaExceededError'
  );
}

/** 配额守卫：失败先按预算 LRU 清理再重试一次 */
async function withQuotaGuard<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err) {
    if (!isQuotaError(err)) throw err;
    await enforceBudget();
    return await op();
  }
}

// ─────────────────────────── 会话与消息 ───────────────────────────

export async function createConversation(toolSlug: string, title: string): Promise<StoredConversation> {
  const now = Date.now();
  const conv: StoredConversation = {
    id: genId('c'),
    toolSlug,
    title: title.slice(0, 200) || '未命名会话',
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    bytes: 0,
  };
  await withQuotaGuard(() =>
    withStore('conversations', 'readwrite', (s) => {
      s.conversations.put(conv);
    }),
  );
  return conv;
}

export async function appendMessage(
  conversationId: string,
  role: ChatRole,
  content: string | ContentPart[],
  usage?: { inputTokens?: number; outputTokens?: number },
): Promise<StoredMessage> {
  const planned = planStoredContent(content);

  // data: 图片先落资产（sha-256 去重），再回填 assetId
  const assetIds: string[] = [];
  let assetBytes = 0;
  for (const dataUrl of planned.pendingDataUrls) {
    const asset = await putAssetFromDataUrl(dataUrl);
    assetIds.push(asset.id);
    assetBytes += asset.size;
  }

  const storedContent: string | StoredPart[] =
    typeof planned.content === 'string'
      ? planned.content
      : planned.content.map((p) => {
          if (p.type === 'image' && 'assetId' in p && p.assetId.startsWith('pending:')) {
            const idx = Number(p.assetId.slice('pending:'.length));
            return { type: 'image' as const, assetId: assetIds[idx] ?? '' };
          }
          return p;
        });

  return withQuotaGuard(() =>
    withStore(['conversations', 'messages'], 'readwrite', async (s) => {
      const conv = await promisify(
        s.conversations.get(conversationId) as IDBRequest<StoredConversation | undefined>,
      );
      if (!conv) throw new AIError('bad-request', `会话不存在：${conversationId}`);

      const msg: StoredMessage = {
        id: genId('m'),
        conversationId,
        seq: conv.messageCount,
        role,
        content: storedContent,
        ...(usage ? { usage } : {}),
        createdAt: Date.now(),
      };
      s.messages.put(msg);
      conv.messageCount += 1;
      conv.bytes += storedMessageBytes(msg) + assetBytes;
      conv.updatedAt = Date.now();
      s.conversations.put(conv);
      return msg;
    }),
  );
}

export async function listConversations(toolSlug?: string): Promise<StoredConversation[]> {
  return withStore('conversations', 'readonly', async (s) => {
    const rows = toolSlug
      ? await promisify(s.conversations.index('by-tool').getAll(toolSlug) as IDBRequest<StoredConversation[]>)
      : await promisify(s.conversations.getAll() as IDBRequest<StoredConversation[]>);
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  });
}

export async function getMessages(conversationId: string): Promise<StoredMessage[]> {
  return withStore('messages', 'readonly', async (s) => {
    const rows = await promisify(
      s.messages.index('by-conv').getAll(convKeyRange(conversationId)) as IDBRequest<StoredMessage[]>,
    );
    return rows.sort((a, b) => a.seq - b.seq);
  });
}

/**
 * 删除会话（级联消息；资产按引用计数——sha-256 去重的资产可能被多条消息共享，
 * 仅当无其它消息引用时删除）。
 */
export async function deleteConversation(conversationId: string): Promise<void> {
  await withStore(['conversations', 'messages', 'assets'], 'readwrite', async (s) => {
    s.conversations.delete(conversationId);
    const convMsgs = await promisify(
      s.messages.index('by-conv').getAll(convKeyRange(conversationId)) as IDBRequest<StoredMessage[]>,
    );
    for (const m of convMsgs) s.messages.delete(m.id);

    // 候选资产 = 该会话消息引用过的 assetId；再全表核对剩余引用
    const candidates = new Set<string>();
    for (const m of convMsgs) collectAssetIds(m, candidates);
    if (candidates.size === 0) return;
    const survivors = await promisify(s.messages.getAll() as IDBRequest<StoredMessage[]>);
    const stillUsed = new Set<string>();
    for (const m of survivors) collectAssetIds(m, stillUsed);
    for (const id of candidates) {
      if (!stillUsed.has(id)) s.assets.delete(id);
    }
  });
}

function collectAssetIds(msg: StoredMessage, into: Set<string>): void {
  if (typeof msg.content === 'string') return;
  for (const p of msg.content) {
    if (p.type === 'image' && 'assetId' in p) into.add(p.assetId);
  }
}

// ─────────────────────────── 资产 ───────────────────────────

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    // TS 新版 Uint8Array<ArrayBufferLike> 与 BufferSource 的泛型差异，双转型绕过
    const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // 非安全上下文退化指纹：长度 + 首部字节（去重弱化但可用）
  const head = Array.from(bytes.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `weak:${bytes.length}:${head}`;
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const m = /^data:([a-z/+.-]+);base64,(.*)$/i.exec(dataUrl);
  if (!m) throw new AIError('bad-request', '仅支持 base64 data URL 资产');
  const mime = m[1]!.toLowerCase();
  const bin = atob(m[2]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime };
}

/** data URL → Blob 资产，sha-256 去重（命中则更新 lastAccessed） */
export async function putAssetFromDataUrl(dataUrl: string): Promise<StoredAsset> {
  const { bytes, mime } = dataUrlToBytes(dataUrl);
  const hash = await sha256Hex(bytes);
  return withQuotaGuard(() =>
    withStore('assets', 'readwrite', async (s) => {
      const hit = await promisify(s.assets.index('by-hash').get(hash) as IDBRequest<AssetRow | undefined>);
      if (hit) {
        hit.lastAccessed = Date.now();
        s.assets.put(hit);
        const { blob: _blob, ...meta } = hit;
        return meta;
      }
      const now = Date.now();
      const meta: StoredAsset = {
        id: genId('a'),
        kind: mime.startsWith('audio/') ? 'audio' : 'image',
        mime,
        size: bytes.length,
        hash,
        createdAt: now,
        lastAccessed: now,
      };
      s.assets.put({ ...meta, blob: new Blob([bytes as unknown as BlobPart], { type: mime }) });
      return meta;
    }),
  );
}

/** 取资产 Blob（顺带 touch lastAccessed，供 LRU） */
export async function getAssetBlob(assetId: string): Promise<Blob | null> {
  return withStore('assets', 'readwrite', async (s) => {
    const row = await promisify(s.assets.get(assetId) as IDBRequest<AssetRow | undefined>);
    if (!row) return null;
    row.lastAccessed = Date.now();
    s.assets.put(row);
    return row.blob;
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Blob 读取失败'));
    reader.readAsDataURL(blob);
  });
}

// ─────────────────────────── 上下文拼装 / 导出 ───────────────────────────

/** 会话 → 调用层消息（资产还原为 data URL）。上下文永远即时拼装，不存请求体。 */
export async function hydrateForApi(conversationId: string): Promise<ChatMessage[]> {
  const messages = await getMessages(conversationId);
  const cache = new Map<string, string>();
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    const parts: ContentPart[] = [];
    for (const p of m.content) {
      if (p.type === 'text') {
        parts.push({ type: 'text', text: p.text });
      } else if ('url' in p) {
        parts.push({ type: 'image', url: p.url });
      } else {
        let url = cache.get(p.assetId);
        if (url === undefined) {
          const blob = await getAssetBlob(p.assetId);
          url = blob ? await blobToDataUrl(blob) : '';
          cache.set(p.assetId, url);
        }
        if (url) parts.push({ type: 'image', url });
      }
    }
    out.push({ role: m.role, content: parts });
  }
  return out;
}

/** 单会话导出为自包含 JSON（资产转 data URL，可作配额兜底备份） */
export async function exportConversationJSON(conversationId: string): Promise<string | null> {
  const conv = await withStore('conversations', 'readonly', (s) =>
    promisify(s.conversations.get(conversationId) as IDBRequest<StoredConversation | undefined>),
  );
  if (!conv) return null;
  const messages = await getMessages(conversationId);
  const cache = new Map<string, string>();
  async function assetDataUrl(assetId: string): Promise<string> {
    let url = cache.get(assetId);
    if (url === undefined) {
      const blob = await getAssetBlob(assetId);
      url = blob ? await blobToDataUrl(blob) : '';
      cache.set(assetId, url);
    }
    return url;
  }
  const payload = {
    meta: { format: 'polykit-ai-conversation', version: 1, exportedAt: new Date().toISOString() },
    conversation: conv,
    messages: await Promise.all(
      messages.map(async (m) => {
        if (typeof m.content === 'string') return m;
        const content = await Promise.all(
          m.content.map(async (p) =>
            p.type === 'image' && !('url' in p)
              ? { type: 'image', dataUrl: await assetDataUrl(p.assetId) }
              : p,
          ),
        );
        return { ...m, content };
      }),
    ),
  };
  return JSON.stringify(payload, null, 2);
}

// ─────────────────────────── 用量 / 统计 / 清理 ───────────────────────────

export async function recordUsage(delta: {
  calls?: number;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<void> {
  const date = toDateKey(new Date());
  await withStore('usage', 'readwrite', async (s) => {
    const row: StoredUsage =
      (await promisify(s.usage.get(date) as IDBRequest<StoredUsage | undefined>)) ?? {
        date,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
    row.calls += delta.calls ?? 0;
    row.inputTokens += delta.inputTokens ?? 0;
    row.outputTokens += delta.outputTokens ?? 0;
    s.usage.put(row);
  });
}

export interface ChatStats {
  conversations: number;
  messages: number;
  assets: number;
  assetBytes: number;
  convBytes: number;
  todayCalls: number;
}

export async function chatStats(): Promise<ChatStats> {
  return withStore(['conversations', 'messages', 'assets', 'usage'], 'readonly', async (s) => {
    const convs = await promisify(s.conversations.getAll() as IDBRequest<StoredConversation[]>);
    const msgs = await promisify(s.messages.count() as IDBRequest<number>);
    const assets = await promisify(s.assets.getAll() as IDBRequest<AssetRow[]>);
    const usage = await promisify(
      s.usage.get(toDateKey(new Date())) as IDBRequest<StoredUsage | undefined>,
    );
    return {
      conversations: convs.length,
      messages: msgs,
      assets: assets.length,
      assetBytes: assets.reduce((sum, a) => sum + a.size, 0),
      convBytes: convs.reduce((sum, c) => sum + c.bytes, 0),
      todayCalls: usage?.calls ?? 0,
    };
  });
}

/** 预算字节数（配置 budgetMB，缺省 500MB，夹在 50MB~5GB） */
export function budgetBytesOf(config: Pick<AIConfig, 'budgetMB'> | undefined): number {
  const mb = typeof config?.budgetMB === 'number' ? config.budgetMB : 500;
  return Math.min(5000, Math.max(50, mb)) * 1024 * 1024;
}

/** 按预算执行 LRU 清理：孤儿资产 → 最旧会话（连带其消息与独占资产）。 */
export async function enforceBudget(budgetOverrideBytes?: number): Promise<EvictionPlan> {
  const budget = budgetOverrideBytes ?? budgetBytesOf(loadAIConfig());
  return withStore(['conversations', 'messages', 'assets'], 'readwrite', async (s) => {
    const convs = await promisify(s.conversations.getAll() as IDBRequest<StoredConversation[]>);
    const assets = await promisify(s.assets.getAll() as IDBRequest<AssetRow[]>);
    const msgs = await promisify(s.messages.getAll() as IDBRequest<StoredMessage[]>);

    const referenced = new Set<string>();
    for (const m of msgs) collectAssetIds(m, referenced);

    const plan = computeEvictionPlan({
      assets: assets.map(({ blob: _b, ...meta }) => meta),
      conversations: convs,
      referencedAssetIds: referenced,
      budgetBytes: budget,
    });

    for (const id of plan.evictAssetIds) s.assets.delete(id);

    const deletedConvIds = new Set(plan.deleteConversationIds);
    const survivingRefs = new Set<string>();
    for (const m of msgs) {
      if (!deletedConvIds.has(m.conversationId)) collectAssetIds(m, survivingRefs);
    }
    for (const convId of deletedConvIds) {
      s.conversations.delete(convId);
      const convMsgs = await promisify(
        s.messages.index('by-conv').getAll(convKeyRange(convId)) as IDBRequest<StoredMessage[]>,
      );
      for (const m of convMsgs) s.messages.delete(m.id);
      // 随会话删除而不再被引用的资产一并清理
      const owned = new Set<string>();
      for (const m of convMsgs) collectAssetIds(m, owned);
      for (const assetId of owned) {
        if (!survivingRefs.has(assetId)) s.assets.delete(assetId);
      }
    }
    return plan;
  });
}

/** 清空全部会话数据（不动 localStorage 里的供应商配置与密钥） */
export async function clearChatData(): Promise<void> {
  await withStore(['conversations', 'messages', 'assets', 'usage'], 'readwrite', (s) => {
    s.conversations.clear();
    s.messages.clear();
    s.assets.clear();
    s.usage.clear();
  });
}

/** 设置页保存预算（写回 localStorage 配置，随配置一同导出/导入） */
export function saveBudgetMB(mb: number): void {
  const config = loadAIConfig();
  config.budgetMB = Math.min(5000, Math.max(50, Math.round(mb)));
  saveAIConfig(config);
}

// ─────────────────────────── 全站备份：会话库整体导出 / 恢复 ───────────────────────────

/** 备份资产：元信息 + dataUrl（Blob 不可序列化） */
export interface BackupAsset extends StoredAsset {
  dataUrl: string;
}

export interface ConversationsBackup {
  format: 'polykit-ai-conversations';
  version: 1;
  /** 全库资产一次列出（sha-256 去重后本就无冗余） */
  assets: BackupAsset[];
  items: Array<{ conversation: StoredConversation; messages: StoredMessage[] }>;
}

/** 导出全部会话（含消息与资产，id 原样保留，供全站备份携带） */
export async function exportAllConversations(): Promise<ConversationsBackup> {
  const cache = new Map<string, string>();
  async function assetDataUrl(row: AssetRow): Promise<string> {
    let url = cache.get(row.id);
    if (url === undefined) {
      url = await blobToDataUrl(row.blob);
      cache.set(row.id, url);
    }
    return url;
  }
  return withStore(['conversations', 'messages', 'assets'], 'readonly', async (s) => {
    const convs = await promisify(s.conversations.getAll() as IDBRequest<StoredConversation[]>);
    const assets = await promisify(s.assets.getAll() as IDBRequest<AssetRow[]>);
    const backupAssets: BackupAsset[] = [];
    for (const a of assets) {
      const { blob: _b, ...meta } = a;
      backupAssets.push({ ...meta, dataUrl: await assetDataUrl(a) });
    }
    const items: ConversationsBackup['items'] = [];
    for (const c of convs) {
      const msgs = await promisify(
        s.messages.index('by-conv').getAll(convKeyRange(c.id)) as IDBRequest<StoredMessage[]>,
      );
      items.push({ conversation: c, messages: msgs.sort((a, b) => a.seq - b.seq) });
    }
    return { format: 'polykit-ai-conversations', version: 1, assets: backupAssets, items };
  });
}

/**
 * 从备份恢复会话库（默认先清空现有数据；id / 资产引用原样还原）。
 * 返回恢复计数。备份结构非法时抛错（由调用方提示「文件无效」）。
 */
export async function restoreConversations(
  backup: unknown,
  opts: { clearExisting?: boolean } = {},
): Promise<{ conversations: number; messages: number; assets: number }> {
  const b = backup as Partial<ConversationsBackup>;
  if (!b || b.format !== 'polykit-ai-conversations' || b.version !== 1 || !Array.isArray(b.items)) {
    throw new AIError('bad-request', '会话备份格式无效');
  }
  const { clearExisting = true } = opts;
  return withStore(['conversations', 'messages', 'assets'], 'readwrite', async (s) => {
    if (clearExisting) {
      s.conversations.clear();
      s.messages.clear();
      s.assets.clear();
    }
    for (const a of (b.assets ?? []) as BackupAsset[]) {
      if (typeof a?.id !== 'string' || typeof a?.dataUrl !== 'string') continue;
      const { bytes, mime } = dataUrlToBytes(a.dataUrl);
      const { dataUrl: _d, ...meta } = a;
      s.assets.put({ ...meta, mime, size: bytes.length, blob: new Blob([bytes as unknown as BlobPart], { type: mime }) });
    }
    let messages = 0;
    for (const item of b.items!) {
      const conv = item?.conversation;
      if (!conv || typeof conv.id !== 'string') continue;
      s.conversations.put(conv);
      for (const m of item.messages ?? []) {
        if (!m || m.conversationId !== conv.id) continue;
        s.messages.put(m);
        messages++;
      }
    }
    return { conversations: b.items!.length, messages, assets: (b.assets ?? []).length };
  });
}
