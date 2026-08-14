/**
 * 配色提取器 —— 用户偏好本地持久化（localStorage）。
 *
 * 记住用户上次选择的"提取色数"与"输出格式"，下次打开自动还原，免去重复设置。
 *
 * 设计与项目内其它 settings 模块一致：带 version 的 JSON blob，
 * 读取经 core/utils/storage 统一容错，损坏/隐私模式时安全回退默认值。
 *
 * 存储形态（JSON）：
 *   { "version": 1, "colorCount": number, "format": OutputFormat }
 */

import { readJSON, writeJSON, removeKey } from '@/core/utils/storage';

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
  const parsed = readJSON(STORAGE_KEY) as Partial<PrefsBlob> | null;
  if (!parsed) return def;

  const colorCount =
    typeof parsed.colorCount === 'number' ? clampColorCount(parsed.colorCount) : def.colorCount;

  const format =
    typeof parsed.format === 'string' &&
    (FORMAT_OPTIONS as readonly { id: OutputFormat }[]).some((f) => f.id === parsed.format)
      ? (parsed.format as OutputFormat)
      : def.format;

  return { colorCount, format };
}

/** 持久化偏好（隐私模式 / 配额满时静默忽略） */
export function savePrefs(prefs: ColorExtractorPrefs): void {
  const blob: PrefsBlob = { version: CURRENT_VERSION, ...prefs };
  writeJSON(STORAGE_KEY, blob);
}

// ─────────────────────────── 上次提取结果持久化 ───────────────────────────
//
// 记住用户上次提取出的主色（仅色值数据，不存图片本身——图片不可序列化且大）。
// 重进页面时恢复色板与多格式输出，用户不必重新上传图。
// 颜色数据很小（一条 ~40 字节），与上方偏好分开存，避免每次调色数滑块都连带读写大字符串。

const COLORS_KEY = 'color-extractor:colors';

/** 可序列化的颜色记录（ExtractedColor 去掉运行期 rgb，只留 hex/ratio/count） */
export interface StoredColor {
  hex: string;
  ratio: number;
  count: number;
}

interface ColorsBlob {
  version: number;
  colors: StoredColor[];
}

/**
 * 读取上次提取结果；无/损坏返回 null。
 * 逐条校验 hex 合法、ratio∈[0,1]、count 为正整数，过滤掉脏数据。
 */
export function loadColors(): StoredColor[] | null {
  const parsed = readJSON(COLORS_KEY) as Partial<ColorsBlob> | null;
  if (!parsed || !Array.isArray(parsed.colors) || parsed.colors.length === 0) return null;
  const valid = parsed.colors.filter(
    (c) =>
      c &&
      typeof c.hex === 'string' &&
      /^#[0-9a-fA-F]{6}$/.test(c.hex) &&
      typeof c.ratio === 'number' &&
      c.ratio >= 0 &&
      c.ratio <= 1 &&
      typeof c.count === 'number' &&
      c.count > 0,
  );
  return valid.length > 0 ? (valid as StoredColor[]) : null;
}

/** 持久化提取结果（隐私模式 / 配额满时静默忽略） */
export function saveColors(colors: StoredColor[]): void {
  const blob: ColorsBlob = { version: CURRENT_VERSION, colors };
  writeJSON(COLORS_KEY, blob);
}

/** 清除提取结果（如用户想从头开始） */
export function clearColors(): void {
  removeKey(COLORS_KEY);
}
