/**
 * 全站统一备份 —— 首页 ⚙「我的设置」的导出/恢复（各处分散的导入导出收敛于此）。
 *
 * 一个 JSON 文件携带：
 *   - localStorage 全量（分两桶：AI 大模型配置 / 工具偏好与设置，导出时可分别排除）
 *   - 会话库（可选：conversations + messages + 图片资产，id 原样保留）
 *
 * 多域名迁移沿用 AI 框架的机制（见 docs/ai-framework.md 第 6 节）：导出时把
 * 当前站点根替换为 {ORIGIN} 占位，导入时还原；外部 API 地址（api.openai.com 等）
 * 永不受影响。兼容旧版「首页偏好」备份文件（polykit-home-prefs-*）。
 *
 * 分桶/解析为纯函数（可单测）；localStorage 读写与 IndexedDB 恢复由调用方环境提供。
 */

import {
  exportAllConversations,
  restoreConversations,
  type ConversationsBackup,
} from '@/core/ai/chat-store';
import {
  ORIGIN_TOKEN,
  currentSiteRoot,
  normalizeSiteRoot,
  rewriteOrigin,
  slashlessRoot,
} from '@/core/ai/transfer';

export const BACKUP_FORMAT = 'polykit-backup';

/** AI 大模型配置在 localStorage 里的 key（单列一桶，导出时可排除） */
export const AI_CONFIG_KEY = 'static-toolkit-ai-config';

export interface BackupIncludeOptions {
  /** 工具偏好与设置（含主题、各工具 settings、图片缓存等其余 localStorage） */
  includeTools: boolean;
  /** AI 大模型配置（含 API 密钥） */
  includeAI: boolean;
  /** 会话记录（含图片资产，可能较大） */
  includeConversations: boolean;
}

export interface BackupMeta {
  format: string;
  version: 1;
  exportedAt: string;
  exportedFrom: string;
  includes: BackupIncludeOptions;
}

export interface SiteBackupPayload {
  meta: BackupMeta;
  /** localStorage 快照（已按 includes 过滤；key → 原始字符串值） */
  localStorage: Record<string, string>;
  conversations?: ConversationsBackup;
}

/**
 * 纯函数：把 localStorage 条目分成「AI 配置」与「工具偏好与设置」两桶。
 * tools 桶 = 除 AI 配置 key 外的一切（主题、各工具 settings、偏好……）。
 */
export function splitStorageEntries(
  entries: Array<[string, string]>,
): { tools: Array<[string, string]>; ai: Array<[string, string]> } {
  const tools: Array<[string, string]> = [];
  const ai: Array<[string, string]> = [];
  for (const [k, v] of entries) {
    if (k === AI_CONFIG_KEY) ai.push([k, v]);
    else tools.push([k, v]);
  }
  return { tools, ai };
}

/** 读取 localStorage 全部条目（快照） */
function snapshotEntries(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k === null) continue;
      const v = localStorage.getItem(k);
      if (v !== null) out.push([k, v]);
    }
  } catch {
    // 存储不可用（隐私模式）：返回空快照，调用方提示
  }
  return out;
}

export interface BackupBuildResult {
  json: string;
  stats: { keys: number; conversations: number; messages: number; assets: number };
}

/** 组装全站备份（异步：会话库导出需读 IndexedDB） */
export async function buildSiteBackup(
  opts: BackupIncludeOptions,
  siteRoot: string = currentSiteRoot(),
): Promise<BackupBuildResult> {
  const { tools, ai } = splitStorageEntries(snapshotEntries());
  const ls: Record<string, string> = {};
  if (opts.includeTools) for (const [k, v] of tools) ls[k] = v;
  if (opts.includeAI) for (const [k, v] of ai) ls[k] = v;

  let conversations: ConversationsBackup | undefined;
  if (opts.includeConversations) {
    conversations = await exportAllConversations().catch(() => undefined);
  }

  const payload: SiteBackupPayload = {
    meta: {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedFrom: normalizeSiteRoot(siteRoot),
      includes: opts,
    },
    localStorage: ls,
    ...(conversations ? { conversations } : {}),
  };
  // 站内地址 → {ORIGIN} 占位（外部 API 地址不受影响）
  const portable = rewriteOrigin(payload, slashlessRoot(normalizeSiteRoot(siteRoot)), ORIGIN_TOKEN);

  const stats = {
    keys: Object.keys(ls).length,
    conversations: conversations?.items.length ?? 0,
    messages: conversations?.items.reduce((s, it) => s + it.messages.length, 0) ?? 0,
    assets: conversations?.assets.length ?? 0,
  };
  return { json: JSON.stringify(portable, null, 2), stats };
}

export interface BackupPlan {
  includes: BackupIncludeOptions;
  /** 待写回的 localStorage 条目 */
  localStorageWrites: Array<[string, string]>;
  /** 会话恢复数据（有则整体替换现有会话库） */
  conversations?: ConversationsBackup;
  /** 旧版偏好文件兼容：恢复为首页偏好 key */
  legacyPrefs?: Record<string, unknown>;
  /** 跨域名替换说明（有则展示给用户） */
  note: string;
}

/**
 * 解析备份文件为可执行计划（纯函数，无副作用）。
 * 返回 null = 不是可识别的备份文件。兼容旧版首页偏好 JSON。
 */
export function parseSiteBackup(text: string, siteRoot: string): BackupPlan | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  // 旧版首页偏好备份（{version:1, pinned, starred, order}）：整体作为偏好写回
  if (obj.version === 1 && Array.isArray((obj as { pinned?: unknown }).pinned)) {
    return {
      includes: { includeTools: true, includeAI: false, includeConversations: false },
      localStorageWrites: [[ 'static-toolkit-home-prefs', text ]],
      note: '旧版偏好备份：将恢复首页置顶 / 星标 / 排序',
    };
  }

  const meta = obj.meta as Partial<BackupMeta> | undefined;
  if (!meta || meta.format !== BACKUP_FORMAT || meta.version !== 1) return null;

  const to = normalizeSiteRoot(siteRoot);
  let working: unknown = obj;
  working = rewriteOrigin(working, ORIGIN_TOKEN, slashlessRoot(to));
  const from = typeof meta.exportedFrom === 'string' ? normalizeSiteRoot(meta.exportedFrom) : '';
  let note = '';
  if (from && from !== to) {
    working = rewriteOrigin(working, from, to);
    note = `已自动把来自 ${from} 的站内地址替换为当前站点 ${to}`;
  }

  const w = working as SiteBackupPayload;
  const ls = w.localStorage ?? {};
  const writes: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(ls)) {
    if (typeof v === 'string') writes.push([k, v]);
  }
  return {
    includes: w.meta?.includes ?? { includeTools: true, includeAI: false, includeConversations: false },
    localStorageWrites: writes,
    ...(w.conversations ? { conversations: w.conversations } : {}),
    note,
  };
}

/** 执行恢复计划：写回 localStorage + 重建会话库。返回计数（调用方 toast 后建议刷新页面）。 */
export async function applySiteBackup(plan: BackupPlan): Promise<{
  keys: number;
  conversations: number;
  messages: number;
}> {
  for (const [k, v] of plan.localStorageWrites) {
    try {
      localStorage.setItem(k, v);
    } catch {
      // 隐私模式 / 配额满：尽力而为，其余条目继续
    }
  }
  let conversations = 0;
  let messages = 0;
  if (plan.conversations) {
    const r = await restoreConversations(plan.conversations, { clearExisting: true });
    conversations = r.conversations;
    messages = r.messages;
  }
  return { keys: plan.localStorageWrites.length, conversations, messages };
}

/** 备份文件默认名 */
export function backupFilename(date = new Date()): string {
  const d = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `polykit-backup-${d}.json`;
}
