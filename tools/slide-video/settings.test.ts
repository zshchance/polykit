import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from './options';
import { loadOptions, saveOptions } from './settings';

const store = new Map<string, string>();
function stubStorage(): void {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
}

describe('slide-video 设置迁移与持久化', () => {
  beforeEach(() => {
    store.clear();
    stubStorage();
  });

  it('空存档使用拟物翻页、跟随主题与无音效默认值', () => {
    const o = loadOptions();
    expect(o.flip).toBe('flip');
    expect(o.font).toBeNull();
    expect(o.align).toBeNull();
    expect(o.soundEffect).toBe('none');
    expect(o.firstPageFlip).toBe(true);
  });

  it('新版设置可完整读回', () => {
    const o = {
      ...DEFAULT_OPTIONS,
      soundEffect: 'soft' as const,
      soundVolume: 43,
      firstPageFlip: false,
      font: 'serif' as const,
    };
    saveOptions(o);
    expect(loadOptions()).toMatchObject({
      soundEffect: 'soft',
      soundVolume: 43,
      firstPageFlip: false,
      font: 'serif',
    });
  });

  it('旧存档保留显式字体和对齐，缺失音效回退默认', () => {
    store.set(
      'slide-video:options',
      JSON.stringify({ version: 1, options: { font: 'kai', align: 'left' } }),
    );
    const o = loadOptions();
    expect(o.font).toBe('kai');
    expect(o.align).toBe('left');
    expect(o.soundEffect).toBe('none');
    expect(o.soundVolume).toBe(55);
  });

  it('v1 自动保存的默认黑体、居中和淡入淡出迁移为新版主题默认', () => {
    store.set(
      'slide-video:options',
      JSON.stringify({ version: 1, options: { font: 'sans', align: 'center', flip: 'fade' } }),
    );
    expect(loadOptions()).toMatchObject({ font: null, align: null, flip: 'flip' });
  });

  it('v2 主动选择的黑体和居中不会被迁移规则重置', () => {
    saveOptions({ ...DEFAULT_OPTIONS, font: 'sans', align: 'center', flip: 'fade' });
    expect(loadOptions()).toMatchObject({ font: 'sans', align: 'center', flip: 'fade' });
  });

  it('非法音效和超界音量被修复', () => {
    store.set(
      'slide-video:options',
      JSON.stringify({ version: 1, options: { soundEffect: 'unknown', soundVolume: 800 } }),
    );
    expect(loadOptions()).toMatchObject({ soundEffect: 'none', soundVolume: 100 });
  });
});
