/**
 * 图片压缩转换 —— 用户参数本地持久化（localStorage）。
 *
 * 只记参数（格式/画质/最长边/ICO 尺寸/对比模式），**不记图片与输出**
 * （按需求：图片不便序列化且占用配额；刷新后用户重传即可，参数已恢复）。
 *
 * 与项目其它 settings 模块一致：
 *   - 带 version 的 JSON blob
 *   - 逐字段校验（合法才采用，否则默认，保证旧草稿向前兼容）
 *   - 隐私模式 / 配额满 / 存储损坏 → 经 core/utils/storage 统一容错，静默回退，不阻塞功能
 */

import { readJSON, writeJSON } from '@/core/utils/storage';

import {
  DEFAULT_CONFIG,
  FORMAT_OPTIONS,
  clampQuality,
  clampLongEdge,
  normalizeIcoSizes,
  type CompressConfig,
  type OutputFormat,
  type CompareMode,
} from './types';

const STORAGE_KEY = 'image-compress:config';
const CURRENT_VERSION = 1;

interface ConfigBlob {
  version: number;
  config: Partial<CompressConfig>;
}

const FORMAT_IDS = FORMAT_OPTIONS.map((f) => f.id);
const COMPARE_MODES: CompareMode[] = ['original', 'compare', 'output'];

function isOutputFormat(s: unknown): s is OutputFormat {
  return typeof s === 'string' && (FORMAT_IDS as string[]).includes(s);
}

function isCompareMode(s: unknown): s is CompareMode {
  return typeof s === 'string' && (COMPARE_MODES as string[]).includes(s);
}

/**
 * 读取参数；存储损坏 / 字段非法时回退默认。
 * 对每个字段单独校验，合法才采用，否则用默认值。
 */
export function loadConfig(): CompressConfig {
  const parsed = readJSON(STORAGE_KEY) as Partial<ConfigBlob> | null;
  if (!parsed) return { ...DEFAULT_CONFIG };

  const c = parsed.config ?? {};
  return {
    format: isOutputFormat(c.format) ? c.format : DEFAULT_CONFIG.format,
    quality: clampQuality(c.quality),
    maxLongEdge: clampLongEdge(c.maxLongEdge),
    icoSizes: normalizeIcoSizes(c.icoSizes),
    mode: isCompareMode(c.mode) ? c.mode : DEFAULT_CONFIG.mode,
  };
}

/** 持久化参数（隐私模式 / 配额满时静默忽略） */
export function saveConfig(cfg: CompressConfig): void {
  const blob: ConfigBlob = { version: CURRENT_VERSION, config: cfg };
  writeJSON(STORAGE_KEY, blob);
}
