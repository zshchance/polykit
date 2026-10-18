/**
 * 配置导出/导入与多域名迁移。
 *
 * 双域名部署（Cloudflare Pages / GitHub Pages）是两个独立 origin，配置互不可见。
 * 迁移策略（见 docs/ai-framework.md 第 6 节）：
 * 1. 站内地址在配置中以 {ORIGIN} 占位符存储（第一道防线，天然可移植）；
 * 2. 导出文件头带 exportedFrom（来源站点根）；导入时只把「旧站前缀」精确替换为
 *    当前站点根（第二道防线）——api.openai.com 等外部 URL 永不受影响；
 * 3. 密钥可选剔除（includeKeys=false 导出脱敏版）。
 *
 * 站点根 = location.origin + Vite BASE_URL（GitHub Pages 子路径部署时含 /repo）。
 * 核心替换为纯函数（rewriteOrigin / applyOriginToken），siteRoot 由调用方注入，便于单测。
 */

import { emptyAIConfig, sanitizeAIConfig } from './schema';
import type { AIConfig } from './types';

/** 站内地址占位符：配置里凡可能指向本站的 URL 用它存储 */
export const ORIGIN_TOKEN = '{ORIGIN}';

export const EXPORT_FORMAT = 'polykit-ai-config';

export interface ExportMeta {
  format: string;
  version: 1;
  exportedAt: string;
  /** 导出来源站点根（含 BASE_URL），导入时作为替换锚点 */
  exportedFrom: string;
  includeKeys: boolean;
}

export interface ExportFile {
  meta: ExportMeta;
  config: AIConfig;
}

/** 当前站点根（origin + BASE_URL，规范为单一尾斜杠，如 https://x.pages.dev/ 或 https://u.github.io/repo/） */
export function currentSiteRoot(): string {
  const base = import.meta.env.BASE_URL || '/';
  const path = base === '/' ? '' : `/${base.replace(/^\/+|\/+$/g, '')}`;
  return `${location.origin}${path}/`;
}

/** 规范化站点根：确保以单个 / 结尾、无协议大小写差异干扰 */
export function normalizeSiteRoot(root: string): string {
  const s = root.trim();
  if (!/^https?:\/\//i.test(s)) return s; // 非法形态原样返回，交由调用方判断
  const noTrail = s.replace(/\/+$/, '');
  return `${noTrail}/`;
}

/** 去掉尾斜杠（占位符路径用：内容中的路径斜杠原样保留，如 {ORIGIN}/api/proxy） */
function slashless(root: string): string {
  return root.replace(/\/+$/, '');
}

/**
 * 递归遍历 JSON 结构，把字符串叶子中的 from 全量替换为 to。
 * 只替换完整前缀出现处（from 由调用方保证带协议头），普通文本不受影响。
 * from 为空或与 to 相同时原样返回（零拷贝短路）。
 */
export function rewriteOrigin(node: unknown, from: string, to: string): unknown {
  if (!from || from === to) return node;
  if (typeof node === 'string') {
    return node.split(from).join(to);
  }
  if (Array.isArray(node)) return node.map((n) => rewriteOrigin(n, from, to));
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([k, v]) => [k, rewriteOrigin(v, from, to)]),
    );
  }
  return node;
}

/**
 * 导出为 JSON 字符串。
 * - 当前站点根出现处替换为 {ORIGIN}（导入到任何域名都自动还原）；
 * - includeKeys=false 时密钥置空（脱敏分享版）。
 */
export function exportAIConfigJSON(config: AIConfig, siteRoot: string, includeKeys: boolean): string {
  const portable = rewriteOrigin(config, slashless(normalizeSiteRoot(siteRoot)), ORIGIN_TOKEN);
  const sanitized = sanitizeAIConfig(portable) ?? emptyAIConfig();
  const file: ExportFile = {
    meta: {
      format: EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedFrom: normalizeSiteRoot(siteRoot),
      includeKeys,
    },
    config: includeKeys
      ? sanitized
      : {
          ...sanitized,
          providers: sanitized.providers.map((p) => ({ ...p, apiKey: '' })),
        },
  };
  return JSON.stringify(file, null, 2);
}

export interface ImportOutcome {
  config: AIConfig;
  /** 提示信息（如「已将旧站点地址替换为当前域名」），无则空串 */
  note: string;
}

/**
 * 从导出文件 JSON 导入。
 * - 替换 {ORIGIN} → 当前站点根；
 * - 若文件带 exportedFrom 且不同于当前站点根，精确替换旧站前缀；
 * - 走 sanitizeAIConfig 清洗；完全非法返回 null（调用方提示「文件无效」）。
 */
export function importAIConfigJSON(text: string, siteRoot: string): ImportOutcome | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const file = parsed as Partial<ExportFile>;
  if (!file.meta || file.meta.format !== EXPORT_FORMAT || file.meta.version !== 1) return null;

  const to = normalizeSiteRoot(siteRoot);
  let working: unknown = file.config ?? {};
  // 第一道：占位符还原（无斜杠锚点 ↔ 无斜杠站点根，内容路径斜杠保持）
  working = rewriteOrigin(working, ORIGIN_TOKEN, slashless(to));
  // 第二道：旧站前缀精确替换（exportedFrom 带 / 结尾，天然只匹配完整 URL 前缀）
  const from = typeof file.meta.exportedFrom === 'string' ? normalizeSiteRoot(file.meta.exportedFrom) : '';
  let replaced = false;
  if (from && from !== to) {
    working = rewriteOrigin(working, from, to);
    replaced = true;
  }
  const config = sanitizeAIConfig(working);
  if (!config) return null;
  const note = replaced
    ? `已自动把配置中来自 ${from} 的地址替换为当前站点 ${to}`
    : '';
  return { config, note };
}

/** 导出文件默认名（带日期，供下载） */
export function aiConfigExportFilename(includeKeys: boolean): string {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `polykit-ai-config${includeKeys ? '' : '-no-keys'}-${date}.json`;
}
