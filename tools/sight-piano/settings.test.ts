import { describe, it, expect, beforeEach } from 'vitest';
import { defaultState, loadState, saveState, clampWindow } from './settings';

/** node 环境没有 localStorage：垫一个内存实现（与浏览器行为一致的部分） */
const store = new Map<string, string>();

function stubLocalStorage(): void {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

/**
 * 新字段（难度页签 level / 自由弹奏调号 freeKey*）的存档与愈合：
 * 老版本存档缺字段时回退默认，损坏值被钳制。
 */
describe('settings 存档', () => {
  beforeEach(() => {
    store.clear();
    stubLocalStorage();
  });

  it('空存档 → 默认值（含 level 与 freeKey）', () => {
    const s = loadState();
    expect(s.level).toEqual({ read: 1, chord: 1, arp: 1 });
    expect(s.freeKeyPc).toBe(0);
    expect(s.freeTonality).toBe('major');
  });

  it('写入后可原样读回', () => {
    const s = defaultState();
    s.level.read = 3;
    s.freeKeyPc = 10;
    s.freeTonality = 'minor';
    saveState(s);
    const back = loadState();
    expect(back.level.read).toBe(3);
    expect(back.freeKeyPc).toBe(10);
    expect(back.freeTonality).toBe('minor');
  });

  it('老存档缺新字段时回退默认，损坏值被钳制', () => {
    localStorage.setItem(
      'sight-piano:state',
      JSON.stringify({
        version: 1,
        level: { read: 9, chord: 'x' },
        freeKeyPc: 99,
        freeTonality: 'dorian',
      }),
    );
    const s = loadState();
    expect(s.level.read).toBe(1); // 非法值 → 默认
    expect(s.level.chord).toBe(1);
    expect(s.level.arp).toBe(1);
    expect(s.freeKeyPc).toBe(11); // 超界 → 钳进 0-11
    expect(s.freeTonality).toBe('major');
  });

  it('clampWindow 钳在 88 键范围内', () => {
    expect(clampWindow(0, 32)).toBe(21);
    expect(clampWindow(200, 25)).toBe(108 - 25 + 1);
  });
});
