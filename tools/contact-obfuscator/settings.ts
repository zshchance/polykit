/**
 * 设置持久化 —— 记忆用户上次的变换选项。
 *
 * 范式照搬 password-generator/settings.ts：顶层带 version 的 JSON blob + 逐字段校验
 * 回退默认，读写经 core/utils/storage 统一容错。校验保证向前兼容（未来加新开关，
 * 旧数据缺字段时取默认值，不报错）。
 */

import { readJSON, writeJSON } from '@/core/utils/storage';

import { DEFAULT_OPTIONS, type ObfuscateOptions } from './obfuscate';

export { DEFAULT_OPTIONS } from './obfuscate';
export type { ObfuscateOptions } from './obfuscate';

const STORAGE_KEY = 'contact-obfuscator:options';
const CURRENT_VERSION = 1;

interface OptionsBlob {
  version: number;
  options: ObfuscateOptions;
}

/** ObfuscateOptions 的全部布尔键（用于逐字段校验） */
const OPTION_KEYS: (keyof ObfuscateOptions)[] = [
  'caseShuffle',
  'digitToWords',
  'insertHan',
  'insertEmoji',
  'insertSymbol',
  'visibleSeparator',
  'emailObfuscate',
  'zeroWidth',
  'homoglyph',
  'leetReplace',
  'digitToRoman',
  'shuffleWords',
  'base64Encode',
  'keywordDisguise',
];

/** 读取记忆的选项；存储损坏/为空时返回默认值（可见层全开、不可见层全关） */
export function loadOptions(): ObfuscateOptions {
  const parsed = readJSON(STORAGE_KEY) as Partial<OptionsBlob> | null;
  if (!parsed) return { ...DEFAULT_OPTIONS };
  const o = parsed.options;
  if (!o || typeof o !== 'object') return { ...DEFAULT_OPTIONS };

  // 逐字段校验：布尔值才采用，否则取默认
  const result = { ...DEFAULT_OPTIONS };
  const resultRec = result as unknown as Record<string, unknown>;
  const oRec = o as unknown as Record<string, unknown>;
  for (const key of OPTION_KEYS) {
    const v = oRec[key];
    if (typeof v === 'boolean') {
      resultRec[key] = v;
    }
  }
  return result;
}

/** 持久化当前选项（隐私模式 / 配额满时静默忽略） */
export function saveOptions(opts: ObfuscateOptions): void {
  const blob: OptionsBlob = { version: CURRENT_VERSION, options: { ...opts } };
  writeJSON(STORAGE_KEY, blob);
}

// ════════════════════════════════════════════════════════════════
// 用户输入的联系方式持久化（刷新页面后还原输入框内容）
// ════════════════════════════════════════════════════════════════

const INPUT_KEY = 'contact-obfuscator:input';

interface InputBlob {
  version: number;
  input: string;
}

/** 读取上次输入的联系方式；存储损坏/为空时返回空串 */
export function loadInput(): string {
  const parsed = readJSON(INPUT_KEY) as Partial<InputBlob> | null;
  if (!parsed) return '';
  return typeof parsed.input === 'string' ? parsed.input : '';
}

/** 持久化当前输入（隐私模式 / 配额满时静默忽略） */
export function saveInput(input: string): void {
  const blob: InputBlob = { version: CURRENT_VERSION, input };
  writeJSON(INPUT_KEY, blob);
}
