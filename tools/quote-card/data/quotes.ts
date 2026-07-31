import { secureRandomInt } from '@/core/utils/random';
import bundledQuotes from './quotes.json';

/**
 * 名言数据层。
 *
 * 数据来源（与万年历节假日同构）：
 *   1. bundled：打包进仓库的 quotes.json（公开流传名言策展，离线可用）
 *   2. cache  ：localStorage 里"在线扩充"写入的额外条目
 *
 * 搜索：本地模糊匹配 text/author/category，大小写不敏感。
 * 在线扩充：仅在用户主动点击时联网，失败静默回退本地。
 */

export interface QuoteRecord {
  id: string;
  text: string;
  author: string;
  source: string | null;
  category: string;
  lang: 'zh' | 'en';
}

interface QuotesData {
  version: string;
  source: string;
  quotes: QuoteRecord[];
}

const CACHE_KEY = 'static-toolkit-quotes-extra';
const LAST_CHECK_KEY = 'static-toolkit-quotes-checked-at';

/** 在线扩充数据源（默认指向同站策展文件，隐私中性；可经环境变量覆盖） */
const EXPAND_URL =
  (import.meta.env.VITE_QUOTES_URL as string | undefined) ||
  new URL('./quotes.json', document.baseURI).href;

let mergedQuotes: QuoteRecord[] | null = null;

/** 合并 bundled + 缓存的额外条目（懒加载） */
function loadAll(): QuoteRecord[] {
  if (mergedQuotes) return mergedQuotes;
  const base = (bundledQuotes as QuotesData).quotes;
  let extra: QuoteRecord[] = [];
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as QuoteRecord[];
      if (Array.isArray(parsed)) extra = parsed;
    }
  } catch {
    /* 缓存损坏则忽略 */
  }
  mergedQuotes = [...base, ...extra];
  return mergedQuotes;
}

/** 归一化：小写 + 去空格，便于中英文混搜 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

/**
 * 本地搜索：匹配 text/author/category，按相关度排序，返回 Top N。
 * 空查询返回空数组（不视为"全部"）。
 */
export function searchQuotes(query: string, limit = 8): QuoteRecord[] {
  const q = normalize(query.trim());
  if (!q) return [];
  const all = loadAll();

  // 分级打分：作者/分类精确命中 > 名言包含 > 作者包含
  const scored = all
    .map((item) => {
      const text = normalize(item.text);
      const author = normalize(item.author);
      const cat = normalize(item.category);
      let score = 0;
      if (author === q || cat === q) score += 100;
      if (text.includes(q)) score += 50;
      if (author.includes(q)) score += 30;
      if (cat.includes(q)) score += 20;
      return { item, score };
    })
    .filter((x) => x.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.item);
}

/** 本地随机一条（密码学安全，无偏） */
export function getRandomQuote(): QuoteRecord {
  const all = loadAll();
  return all[secureRandomInt(0, all.length - 1)]!;
}

/** 所有分类（去重，用于 UI 提示） */
export function getCategories(): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const q of loadAll()) {
    if (!seen.has(q.category)) {
      seen.add(q.category);
      list.push(q.category);
    }
  }
  return list;
}

export type ExpandResult =
  | { ok: true; added: number }
  | { ok: false; reason: string };

/**
 * 可选在线扩充：仅用户主动点击时联网拉取更多名言，缓存到 localStorage。
 * 失败静默回退本地，返回结构化结果供 UI 反馈。
 */
export async function expandOnline(): Promise<ExpandResult> {
  try {
    const res = await fetch(EXPAND_URL, { cache: 'no-store' });
    if (!res.ok) return { ok: false, reason: `网络错误（${res.status}）` };
    const data = (await res.json()) as QuotesData;
    if (!Array.isArray(data?.quotes)) return { ok: false, reason: '数据格式无效' };

    // 仅缓存本地没有的新条目（按 id 去重）
    const existing = new Set(loadAll().map((q) => q.id));
    const fresh = data.quotes.filter((q) => q.id && !existing.has(q.id));
    if (fresh.length > 0) {
      const prev = readExtra();
      const merged = [...prev, ...fresh];
      localStorage.setItem(CACHE_KEY, JSON.stringify(merged));
      mergedQuotes = null; // 失效缓存，下次重新合并
    }
    localStorage.setItem(LAST_CHECK_KEY, new Date().toISOString());
    return { ok: true, added: fresh.length };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : '未知错误' };
  }
}

function readExtra(): QuoteRecord[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as QuoteRecord[]) : [];
  } catch {
    return [];
  }
}

/** 上次在线扩充时间（ISO），无则 null */
export function getLastCheckedAt(): string | null {
  return localStorage.getItem(LAST_CHECK_KEY);
}

/** 当前可用名言总数（本地 + 缓存扩充） */
export function getQuoteCount(): number {
  return loadAll().length;
}
