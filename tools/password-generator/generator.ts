import { secureRandomInt } from '@/core/utils/random';

/** 字符集定义，与 UI 复选项一一对应 */
export const CHARSETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/',
};

export interface PasswordOptions {
  length: number;
  useLower: boolean;
  useUpper: boolean;
  useDigits: boolean;
  useSymbols: boolean;
  /** 确保至少包含每类选中字符集各一个，避免全部取自某一类 */
  requireEachEnabled: boolean;
}

export const DEFAULT_OPTIONS: PasswordOptions = {
  length: 16,
  useLower: true,
  useUpper: true,
  useDigits: true,
  useSymbols: true,
  requireEachEnabled: true,
};

/**
 * 生成密码：密码学安全，可选保证每类字符至少出现一次。
 * @throws 若没有任何字符集被选中，或长度不足以容纳"每类至少一个"
 */
export function generatePassword(opts: PasswordOptions): string {
  const pools: string[] = [];
  if (opts.useLower) pools.push(CHARSETS.lower);
  if (opts.useUpper) pools.push(CHARSETS.upper);
  if (opts.useDigits) pools.push(CHARSETS.digits);
  if (opts.useSymbols) pools.push(CHARSETS.symbols);

  if (pools.length === 0) {
    throw new Error('请至少选择一种字符类型');
  }

  const allChars = pools.join('');

  if (opts.requireEachEnabled) {
    if (opts.length < pools.length) {
      throw new Error(`长度需 ≥ ${pools.length}（开启"每类至少一个"时）`);
    }
    // 先从每类各取一个，再从合集补齐，最后打乱顺序避免固定位置特征
    const chars: string[] = pools.map((p) => p[secureRandomInt(0, p.length - 1)]!);
    for (let i = chars.length; i < opts.length; i++) {
      chars.push(allChars[secureRandomInt(0, allChars.length - 1)]!);
    }
    return shuffleInPlace(chars).join('');
  }

  let result = '';
  for (let i = 0; i < opts.length; i++) {
    result += allChars[secureRandomInt(0, allChars.length - 1)];
  }
  return result;
}

/** Fisher-Yates 打乱，不暴露到 utils 以免与 secureShuffle 语义混淆，本工具内部用 */
function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = secureRandomInt(0, i);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/**
 * 粗略估算密码强度（位数 = 集合大小 × 长度，按位转换）。
 * 仅用于 UI 提示，非安全审计依据。
 */
export function estimateStrengthBits(opts: PasswordOptions): number {
  let poolSize = 0;
  if (opts.useLower) poolSize += CHARSETS.lower.length;
  if (opts.useUpper) poolSize += CHARSETS.upper.length;
  if (opts.useDigits) poolSize += CHARSETS.digits.length;
  if (opts.useSymbols) poolSize += CHARSETS.symbols.length;
  if (poolSize === 0) return 0;
  return Math.round(opts.length * Math.log2(poolSize));
}
