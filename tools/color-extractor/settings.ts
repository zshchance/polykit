/**
 * 配色提取器 —— 用户偏好本地持久化（localStorage）。
 *
 * 记住用户上次选择的"提取色数"与"输出格式"，下次打开自动还原，免去重复设置。
 *
 * 设计与项目内其它 settings 模块一致：带 version 的 JSON blob，
 * 损坏/隐私模式时安全回退默认值。
 *
 * 存储形态（JSON）：
 *   { "version": 1, "colorCount": number, "format": OutputFormat }
 */

import type { OutputFormat } from './palette-format';
import { FORMAT_OPTIONS } from './palette-format';

const STORAGE_KEY = 'color-extractor:prefs';
const CURRENT_VERSION = 1;

export const DEFAULT_COLOR_COUNT = 6;
export const MIN_COLOR_COUNT = 2;
export const MAX_COLOR_COUNT = 12;
export const DEFAULT_FORMAT: OutputFormat = 'css-vars';

interface PrefsBlob {
  version: number;
  colorCount: number;
  format: OutputFormat;
}

/** 可被还原的偏好态 */
export interface ColorExtractorPrefs {
  colorCount: number;
  format: OutputFormat;
}

/** 默认偏好 */
export function defaultPrefs(): ColorExtractorPrefs {
  return { colorCount: DEFAULT_COLOR_COUNT, format: DEFAULT_FORMAT };
}

/** 钳制色数到合法区间 */
export function clampColorCount(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_COLOR_COUNT;
  return Math.max(MIN_COLOR_COUNT, Math.min(MAX_COLOR_COUNT, Math.round(n)));
}

/**
 * 读取偏好；存储损坏/为空/字段非法时回退默认值。
 * colorCount 钳到合法区间；format 必须是已知格式。
 */
export function loadPrefs(): ColorExtractorPrefs {
  const def = defaultPrefs();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return def;
    const parsed = JSON.parse(raw) as Partial<PrefsBlob>;
    if (!parsed || typeof parsed !== 'object') return def;

    const colorCount =
      typeof parsed.colorCount === 'number' ? clampColorCount(parsed.colorCount) : def.colorCount;

    const format =
      typeof parsed.format === 'string' &&
      (FORMAT_OPTIONS as readonly { id: OutputFormat }[]).some((f) => f.id === parsed.format)
        ? (parsed.format as OutputFormat)
        : def.format;

    return { colorCount, format };
  } catch {
    return def;
  }
}

/** 持久化偏好（隐私模式 / 配额满时静默忽略） */
export function savePrefs(prefs: ColorExtractorPrefs): void {
  try {
    const blob: PrefsBlob = { version: CURRENT_VERSION, ...prefs };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // 容量满 / 隐私模式禁用 localStorage：静默忽略，不影响功能
  }
}
