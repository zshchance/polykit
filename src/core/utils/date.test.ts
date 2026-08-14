import { describe, it, expect } from 'vitest';
import { toDateKey, toDateCompact } from './date';

describe('日期格式化', () => {
  it('个位月/日补零', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toDateKey(new Date(2026, 10, 15))).toBe('2026-11-15');
    expect(toDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('紧凑版去掉连字符', () => {
    expect(toDateCompact(new Date(2026, 0, 5))).toBe('20260105');
  });
});
