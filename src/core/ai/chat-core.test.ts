import { describe, expect, it } from 'vitest';
import {
  computeEvictionPlan,
  planStoredContent,
  sanitizeConversation,
  sanitizeMessage,
  storedMessageBytes,
  textBytes,
  type StoredAsset,
  type StoredConversation,
} from './chat-core';

describe('planStoredContent', () => {
  it('纯字符串透传，无待落资产', () => {
    expect(planStoredContent('你好')).toEqual({ content: '你好', pendingDataUrls: [] });
  });

  it('data: 图片抽为待落资产并留占位；http 图片原样保留', () => {
    const out = planStoredContent([
      { type: 'text', text: '看图' },
      { type: 'image', url: 'data:image/png;base64,QUJD' },
      { type: 'image', url: 'https://cdn.example.com/a.png' },
    ]);
    expect(out.pendingDataUrls).toEqual(['data:image/png;base64,QUJD']);
    expect(out.content).toEqual([
      { type: 'text', text: '看图' },
      { type: 'image', assetId: 'pending:0' },
      { type: 'image', url: 'https://cdn.example.com/a.png' },
    ]);
  });

  it('多张 data: 图片按顺序各自占位', () => {
    const out = planStoredContent([
      { type: 'image', url: 'data:image/png;base64,QQ==' },
      { type: 'image', url: 'data:image/jpeg;base64,V0I=' },
    ]);
    expect(out.pendingDataUrls).toEqual(['data:image/png;base64,QQ==', 'data:image/jpeg;base64,V0I=']);
    expect(out.content).toEqual([
      { type: 'image', assetId: 'pending:0' },
      { type: 'image', assetId: 'pending:1' },
    ]);
  });
});

describe('字节估算', () => {
  it('中文按 UTF-8 三字节计', () => {
    expect(textBytes('ab')).toBe(2);
    expect(textBytes('中')).toBe(3);
  });

  it('多模态消息文本部分计字节，资产引用计固定开销', () => {
    const bytes = storedMessageBytes({
      content: [
        { type: 'text', text: '中' },
        { type: 'image', assetId: 'a1' },
      ],
    });
    expect(bytes).toBe(3 + 32);
  });
});

function asset(id: string, size: number, lastAccessed: number): Pick<StoredAsset, 'id' | 'size' | 'lastAccessed'> {
  return { id, size, lastAccessed };
}
function conv(id: string, bytes: number, updatedAt: number): Pick<StoredConversation, 'id' | 'updatedAt' | 'bytes'> {
  return { id, updatedAt, bytes };
}

describe('computeEvictionPlan', () => {
  it('未超预算：零动作', () => {
    const plan = computeEvictionPlan({
      assets: [asset('a1', 1000, 1)],
      conversations: [conv('c1', 2000, 1)],
      referencedAssetIds: new Set(['a1']),
      budgetBytes: 10_000,
    });
    expect(plan).toEqual({ evictAssetIds: [], deleteConversationIds: [], freedBytes: 0 });
  });

  it('超预算：先清最久未访问的孤儿资产（LRU）', () => {
    const plan = computeEvictionPlan({
      assets: [asset('new', 1000, 100), asset('old', 3000, 1), asset('mid', 1000, 50)],
      conversations: [conv('c1', 1000, 1)],
      referencedAssetIds: new Set(), // 全部孤儿
      budgetBytes: 3000,
    });
    // 总 6000 → 清 old(3000) 后达标
    expect(plan.evictAssetIds).toEqual(['old']);
    expect(plan.deleteConversationIds).toEqual([]);
    expect(plan.freedBytes).toBe(3000);
  });

  it('被引用资产不单独清：只能随会话删除', () => {
    const plan = computeEvictionPlan({
      assets: [asset('ref', 5000, 1)],
      conversations: [conv('c1', 6000, 10), conv('c2', 1000, 99)],
      referencedAssetIds: new Set(['ref']),
      budgetBytes: 3000,
    });
    expect(plan.evictAssetIds).toEqual([]);
    // 总 7000（c1.bytes 含 ref）→ 删最旧的 c1（6000）后达标，c2 保留
    expect(plan.deleteConversationIds).toEqual(['c1']);
  });

  it('清完孤儿仍超预算：按 updatedAt 从旧到新删会话', () => {
    const plan = computeEvictionPlan({
      assets: [asset('orphan', 500, 1)],
      conversations: [conv('new', 2000, 100), conv('mid', 2000, 50), conv('old', 2000, 1)],
      referencedAssetIds: new Set(),
      budgetBytes: 4000,
    });
    // 总 6500 → 清孤儿(500) → 6000 → 删 old(2000) → 4000 达标
    expect(plan.evictAssetIds).toEqual(['orphan']);
    expect(plan.deleteConversationIds).toEqual(['old']);
  });

  it('预算极小：清到只剩空', () => {
    const plan = computeEvictionPlan({
      assets: [asset('a', 100, 1)],
      conversations: [conv('c1', 100, 1), conv('c2', 100, 2)],
      referencedAssetIds: new Set(['a']),
      budgetBytes: 0,
    });
    expect(plan.evictAssetIds).toEqual([]);
    expect(new Set(plan.deleteConversationIds)).toEqual(new Set(['c1', 'c2']));
  });
});

describe('记录清洗', () => {
  it('会话：缺 id / toolSlug 拒绝，其余字段回退', () => {
    expect(sanitizeConversation(null)).toBeNull();
    expect(sanitizeConversation({ id: 'c1' })).toBeNull();
    const c = sanitizeConversation({ id: 'c1', toolSlug: 'quote-card', title: 42 });
    expect(c).toMatchObject({ id: 'c1', toolSlug: 'quote-card', title: '未命名会话', messageCount: 0 });
  });

  it('消息：role 白名单，part 形态过滤', () => {
    expect(sanitizeMessage({ id: 'm1', conversationId: 'c1', role: 'hack', content: 'x' })).toBeNull();
    const m = sanitizeMessage({
      id: 'm1',
      conversationId: 'c1',
      role: 'user',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'image', assetId: 'a1' },
        { type: 'image', url: 'https://x/y.png' },
        { type: 'weird' },
      ],
    });
    expect(m?.content).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'image', assetId: 'a1' },
      { type: 'image', url: 'https://x/y.png' },
    ]);
  });
});
