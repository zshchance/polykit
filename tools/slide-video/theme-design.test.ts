import { describe, expect, it } from 'vitest';
import { THEMES } from './options';
import { themePageSpec, type TextBox } from './theme-design';

const page = {
  title: '一页只讲一个核心观点',
  body: '主题不仅改变颜色，也应该改变字号、行距、留白和内容位置。',
};
const sizes = [
  [1920, 1080],
  [1080, 1920],
  [1080, 1080],
  [1440, 1080],
] as const;

function inside(b: TextBox, W: number, H: number): boolean {
  return (
    b.x >= 0 &&
    b.y >= 0 &&
    b.width > 0 &&
    b.height > 0 &&
    b.x + b.width <= W + 0.001 &&
    b.y + b.height <= H + 0.001
  );
}

describe('主题布局 · 多比例内容安全区', () => {
  it('全部内置主题在四种比例下都把文字区留在画布内', () => {
    for (const theme of THEMES) {
      for (const [W, H] of sizes) {
        const spec = themePageSpec(W, H, theme, page, null, null);
        expect(inside(spec.title, W, H), `${theme.id} title ${W}x${H}`).toBe(true);
        expect(inside(spec.body, W, H), `${theme.id} body ${W}x${H}`).toBe(true);
        const separated =
          spec.title.y + spec.title.height <= spec.body.y + 0.001 ||
          spec.title.x + spec.title.width <= spec.body.x + 0.001 ||
          spec.body.x + spec.body.width <= spec.title.x + 0.001;
        expect(separated, `${theme.id} overlap ${W}x${H}`).toBe(true);
      }
    }
  });

  it('纯标题页自动变成居中封面构图', () => {
    const spec = themePageSpec(1920, 1080, THEMES[0]!, { title: '封面', body: '' }, null, null);
    expect(spec.title.y).toBeGreaterThan(1080 * 0.25);
    expect(spec.typography.titleScale).toBeGreaterThan(0.075);
  });

  it('字体和对齐覆盖优先于主题默认值', () => {
    const spec = themePageSpec(1920, 1080, THEMES[0]!, page, 'kai', 'center');
    expect(spec.typography.titleFont).toBe('kai');
    expect(spec.typography.bodyFont).toBe('kai');
    expect(spec.title.align).toBe('center');
    expect(spec.body.align).toBe('center');
  });

  it('主题布局确实产生不同标题位置，而非只换色', () => {
    const [W, H] = sizes[0];
    const positions = new Set(
      THEMES.map((theme) => {
        const s = themePageSpec(W, H, theme, page, null, null);
        return `${s.title.x}:${s.title.y}:${s.title.width}`;
      }),
    );
    expect(positions.size).toBeGreaterThanOrEqual(6);
  });
});
