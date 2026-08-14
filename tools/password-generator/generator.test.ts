import { describe, it, expect } from 'vitest';
import { generatePassword, CHARSETS, DEFAULT_OPTIONS, type PasswordOptions } from './generator';

/** 全部字符池的合集 */
const ALL = Object.values(CHARSETS).join('');

function opts(over: Partial<PasswordOptions>): PasswordOptions {
  return { ...DEFAULT_OPTIONS, ...over };
}

describe('generatePassword 契约', () => {
  it('没有任何字符集被选中时抛错', () => {
    expect(() =>
      generatePassword(
        opts({ useLower: false, useUpper: false, useDigits: false, useSymbols: false }),
      ),
    ).toThrow('至少选择一种字符类型');
  });

  it('开启"每类至少一个"时，长度不足以容纳各类时抛错', () => {
    expect(() =>
      generatePassword(
        opts({ length: 3, useLower: true, useUpper: true, useDigits: true, useSymbols: true }),
      ),
    ).toThrow('长度需');
  });

  it('生成的密码长度与选项一致', () => {
    // 开启 requireEachEnabled 时长度需 ≥ 4（默认四类字符池）
    for (const length of [4, 8, 16, 64, 128]) {
      expect(generatePassword(opts({ length })).length).toBe(length);
    }
    for (const length of [1, 2, 3]) {
      expect(generatePassword(opts({ length, requireEachEnabled: false })).length).toBe(length);
    }
  });

  it('只使用选中字符池中的字符', () => {
    const onlyLower = opts({
      useLower: true,
      useUpper: false,
      useDigits: false,
      useSymbols: false,
      length: 200,
    });
    for (const ch of generatePassword(onlyLower)) {
      expect(CHARSETS.lower).toContain(ch);
    }
  });

  it('开启 requireEachEnabled 时每类选中字符集至少出现一次', () => {
    for (let i = 0; i < 20; i++) {
      const pwd = generatePassword(opts({ length: 16 }));
      expect(pwd).toMatch(/[a-z]/);
      expect(pwd).toMatch(/[A-Z]/);
      expect(pwd).toMatch(/[0-9]/);
      // 符号池里任一字符出现即可
      expect([...pwd].some((ch) => CHARSETS.symbols.includes(ch))).toBe(true);
    }
  });

  it('关闭 requireEachEnabled 时不强制每类出现（仍只用合集字符）', () => {
    for (const ch of generatePassword(opts({ length: 32, requireEachEnabled: false }))) {
      expect(ALL).toContain(ch);
    }
  });

  it('多次生成结果互不相同（密码学随机，非固定序列）', () => {
    const set = new Set(Array.from({ length: 30 }, () => generatePassword(opts({ length: 16 }))));
    expect(set.size).toBeGreaterThan(1);
  });
});
