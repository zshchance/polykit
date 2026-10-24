import { beforeEach, describe, expect, it } from 'vitest';
import { addCustomTheme, loadCustomThemes, toRenderTheme } from './custom-themes';

const store = new Map<string, string>();
function stubStorage(): void {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
}

describe('自定义完整主题存档', () => {
  beforeEach(() => {
    store.clear();
    stubStorage();
  });

  it('v1 纯颜色主题自动补经典设计', () => {
    store.set(
      'slide-video:custom-themes',
      JSON.stringify({
        version: 1,
        items: [
          {
            id: 'custom:old',
            name: '旧主题',
            bg1: '#000000',
            bg2: '#111111',
            fg: '#ffffff',
            accent: '#ff0000',
            createdAt: 1,
          },
        ],
      }),
    );
    const [theme] = loadCustomThemes();
    expect(theme?.design).toEqual({
      layout: 'classic',
      decoration: 'none',
      background: 'linear',
      typography: 'classic',
    });
    expect(theme && toRenderTheme(theme).design.layout).toBe('classic');
  });

  it('新版布局、装饰和字体组合随主题保存', () => {
    const design = {
      layout: 'notebook',
      decoration: 'autumn',
      background: 'paper',
      typography: 'handwritten',
    } as const;
    addCustomTheme('深秋手账', '#f6ead8', '#dfb88e', '#563b2a', '#a65f36', design);
    expect(loadCustomThemes()[0]?.design).toEqual(design);
  });
});
