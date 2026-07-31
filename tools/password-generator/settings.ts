/**
 * 密码生成器选项 —— 本地持久化（localStorage）。
 *
 * 记住用户每次设置的密码长度与字符类型等选项，下次打开页面时自动恢复，
 * 免去重复勾选。仅存选项本身，不存任何生成过的密码（密码归 history.ts 管）。
 *
 * 设计与 history.ts 一致：带 version 的 JSON blob，损坏/隐私模式时安全回退默认值。
 *
 * 存储形态（JSON）：
 *   { "version": 1, "options": PasswordOptions }
 */

import { DEFAULT_OPTIONS, type PasswordOptions } from './generator';

const STORAGE_KEY = 'password-generator:options';
const CURRENT_VERSION = 1;

interface OptionsBlob {
  version: number;
  options: PasswordOptions;
}

/** 长度合法区间（与 UI 滑块 min/max 保持一致） */
const MIN_LENGTH = 4;
const MAX_LENGTH = 64;

/**
 * 读取已记忆的选项；存储损坏、为空或字段非法时安全回退默认值。
 * 对每个字段做类型/范围校验，脏数据不致影响生成逻辑。
 */
export function loadOptions(): PasswordOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_OPTIONS };
    const parsed = JSON.parse(raw) as Partial<OptionsBlob>;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_OPTIONS };
    const o = parsed.options;
    if (!o || typeof o !== 'object') return { ...DEFAULT_OPTIONS };

    // 逐字段校验，缺失则取默认
    const length =
      typeof o.length === 'number' &&
      Number.isFinite(o.length) &&
      o.length >= MIN_LENGTH &&
      o.length <= MAX_LENGTH
        ? Math.round(o.length)
        : DEFAULT_OPTIONS.length;

    const bool = (v: unknown, def: boolean): boolean =>
      typeof v === 'boolean' ? v : def;

    return {
      length,
      useLower: bool(o.useLower, DEFAULT_OPTIONS.useLower),
      useUpper: bool(o.useUpper, DEFAULT_OPTIONS.useUpper),
      useDigits: bool(o.useDigits, DEFAULT_OPTIONS.useDigits),
      useSymbols: bool(o.useSymbols, DEFAULT_OPTIONS.useSymbols),
      requireEachEnabled: bool(o.requireEachEnabled, DEFAULT_OPTIONS.requireEachEnabled),
    };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

/** 持久化选项（隐私模式 / 配额满时静默忽略） */
export function saveOptions(opts: PasswordOptions): void {
  try {
    const blob: OptionsBlob = { version: CURRENT_VERSION, options: { ...opts } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // 容量满 / 隐私模式禁用 localStorage：静默忽略，不影响功能
  }
}
