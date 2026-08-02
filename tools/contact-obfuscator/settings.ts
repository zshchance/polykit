/**
 * 设置持久化 —— 记忆用户上次的变换选项。
 *
 * 范式照搬 password-generator/settings.ts：顶层带 version 的 JSON blob + 逐字段校验
 * 回退默认。校验保证向前兼容（未来加新开关，旧数据缺字段时取默认值，不报错）。
 */

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
  'zeroWidth',
  'homoglyph',
  'leetReplace',
  'digitToRoman',
  'shuffleWords',
  'base64Encode',
];

/** 读取记忆的选项；存储损坏/为空时返回默认值（可见层全开、不可见层全关） */
export function loadOptions(): ObfuscateOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_OPTIONS };
    const parsed = JSON.parse(raw) as Partial<OptionsBlob>;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_OPTIONS };
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
  } catch {
    // JSON.parse 失败 / 隐私模式：静默回退默认
    return { ...DEFAULT_OPTIONS };
  }
}

/** 持久化当前选项（隐私模式 / 配额满时静默忽略） */
export function saveOptions(opts: ObfuscateOptions): void {
  try {
    const blob: OptionsBlob = { version: CURRENT_VERSION, options: { ...opts } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // 容量满 / 隐私模式：静默忽略，不影响功能
  }
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
  try {
    const raw = localStorage.getItem(INPUT_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as Partial<InputBlob>;
    if (!parsed || typeof parsed !== 'object') return '';
    return typeof parsed.input === 'string' ? parsed.input : '';
  } catch {
    return '';
  }
}

/** 持久化当前输入（隐私模式 / 配额满时静默忽略） */
export function saveInput(input: string): void {
  try {
    const blob: InputBlob = { version: CURRENT_VERSION, input };
    localStorage.setItem(INPUT_KEY, JSON.stringify(blob));
  } catch {
    // 容量满 / 隐私模式：静默忽略
  }
}
