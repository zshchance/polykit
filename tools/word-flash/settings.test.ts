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

describe('word-flash 设置持久化与校验', () => {
  beforeEach(() => {
    store.clear();
    stubStorage();
  });

  it('空存档使用竖屏、标准节奏、弹入与底部进度条默认值', () => {
    const o = loadOptions();
    expect(o.aspect).toBe('9:16');
    expect(o.pace).toBe('normal');
    expect(o.motion).toBe('pop');
    expect(o.progress).toBe('bar');
    expect(o.soundEffect).toBe('none');
  });

  it('设置可完整读回', () => {
    saveOptions({
      ...DEFAULT_OPTIONS,
      contentText: '你好',
      pace: 'fast',
      speed: 1.4,
      motion: 'typewriter',
      theme: 'cyber',
      font: 'serif',
      emphasis: 'block',
      progress: 'dots',
      soundEffect: 'whoosh',
      soundVolume: 38,
      bgmLoop: false,
    });
    expect(loadOptions()).toMatchObject({
      contentText: '你好',
      pace: 'fast',
      speed: 1.4,
      motion: 'typewriter',
      theme: 'cyber',
      font: 'serif',
      emphasis: 'block',
      progress: 'dots',
      soundEffect: 'whoosh',
      soundVolume: 38,
      bgmLoop: false,
    });
  });

  it('非法枚举回退默认，音量与速度被收窄', () => {
    store.set(
      'word-flash:options',
      JSON.stringify({
        version: 1,
        options: {
          aspect: '2:1',
          pace: 'nope',
          speed: 9,
          motion: 'unknown',
          progress: 'x',
          soundEffect: 'unknown',
          soundVolume: 800,
          bgmVolume: -10,
        },
      }),
    );
    const o = loadOptions();
    expect(o.aspect).toBe('9:16');
    expect(o.pace).toBe('normal');
    expect(o.speed).toBe(2);
    expect(o.motion).toBe('pop');
    expect(o.progress).toBe('bar');
    expect(o.soundEffect).toBe('none');
    expect(o.soundVolume).toBe(100);
    expect(o.bgmVolume).toBe(0);
  });

  it('接受自定义主题与自定义动效前缀 id', () => {
    saveOptions({ ...DEFAULT_OPTIONS, theme: 'custom:demo', motion: 'cmot:demo' });
    expect(loadOptions()).toMatchObject({ theme: 'custom:demo', motion: 'cmot:demo' });
  });

  it('非法主题 id 回退默认', () => {
    saveOptions({ ...DEFAULT_OPTIONS, theme: 'not-a-theme' });
    expect(loadOptions().theme).toBe(DEFAULT_OPTIONS.theme);
  });

  it('文稿超长被截断', () => {
    saveOptions({ ...DEFAULT_OPTIONS, contentText: 'a'.repeat(30_000) });
    expect(loadOptions().contentText.length).toBe(20_000);
  });
});
