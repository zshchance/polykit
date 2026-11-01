import { describe, expect, it } from 'vitest';

import {
  buildMotionPrompt,
  compileMotionForPreview,
  parseMotionAIOutput,
  scanMotionCode,
} from './custom-motions';
import { THEMES, type MotionFrame } from './options';

/** node 环境无 canvas：用对象冒充（被测代码只把它透传给用户代码） */
function fakeFrame(over: Partial<MotionFrame> = {}): MotionFrame {
  const fakeCtx = {
    save: () => undefined,
    restore: () => undefined,
    fillText: () => undefined,
    fillRect: () => undefined,
    measureText: () => ({ width: 120 }),
    translate: () => undefined,
    scale: () => undefined,
    globalAlpha: 1,
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
    fillStyle: '#fff',
  };
  return {
    ctx: fakeCtx as unknown as CanvasRenderingContext2D,
    W: 640,
    H: 900,
    S: 640,
    p: 0.5,
    card: { text: '文字快闪', em: true, title: false },
    layout: {
      lines: ['文字', '快闪'],
      size: 120,
      lineHeight: 1.3,
      x: 320,
      align: 'center',
      centerY: 450,
      font: '800 120px sans-serif',
    },
    theme: THEMES[0]!,
    ...over,
  };
}

const VALID_CODE = `
ctx.font = layout.font;
ctx.textAlign = layout.align;
ctx.textBaseline = 'middle';
ctx.fillStyle = theme.fg;
const lh = layout.size * layout.lineHeight;
const top = layout.centerY - ((layout.lines.length - 1) * lh) / 2;
layout.lines.forEach((line, i) => {
  ctx.globalAlpha = Math.min(1, p * 3);
  ctx.fillText(line, layout.x, top + i * lh);
});
`;

describe('scanMotionCode（静态扫描）', () => {
  it('干净代码通过', () => {
    expect(scanMotionCode(VALID_CODE)).toBeNull();
  });

  it('确定性名单命中并给出替换指引', () => {
    for (const code of [
      'const r = Math.random();',
      'const now = Date.now();',
      'const d = new Date();',
      'performance.now();',
      'setTimeout(() => {}, 0);',
    ]) {
      const hit = scanMotionCode(code);
      expect(hit).not.toBeNull();
      expect(hit).toContain('画面一致');
    }
  });

  it('共享危险名单命中（fetch / localStorage / document.body）', () => {
    expect(scanMotionCode('fetch("/x")')).toContain('越界');
    expect(scanMotionCode('localStorage.getItem("a")')).toContain('越界');
    expect(scanMotionCode('document.body.append(el)')).toContain('越界');
  });
});

describe('compileMotionForPreview（编译与运行时守卫）', () => {
  it('正常绘制返回 true', () => {
    const r = compileMotionForPreview(VALID_CODE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draw(fakeFrame())).toBe(true);
  });

  it('运行时抛错 → 本会话死亡（后续返回 false）', () => {
    const r = compileMotionForPreview('throw new Error("boom");');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draw(fakeFrame())).toBe(false);
    expect(r.draw(fakeFrame())).toBe(false); // dead 标志生效
  });

  it('语法错误返回原因', () => {
    const r = compileMotionForPreview('const const');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('语法');
  });

  it('扫描不通过直接拒收（不编译）', () => {
    const r = compileMotionForPreview('Math.random();');
    expect(r.ok).toBe(false);
  });
});

describe('parseMotionAIOutput（AI 输出解析）', () => {
  it('识别围栏 + 名称注释行，并从代码体剥离名称', () => {
    const raw = '说明文字\n```js\n// 名称：逐行弹跳\nctx.fillText("hi", 0, 0);\n```';
    const r = parseMotionAIOutput(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe('逐行弹跳');
    expect(r.code).not.toContain('名称');
    expect(r.code).toContain('fillText');
  });

  it('缺名称注释拒收', () => {
    const r = parseMotionAIOutput('```js\nctx.fillText("hi", 0, 0);\n```');
    expect(r.ok).toBe(false);
  });

  it('空输入拒收', () => {
    expect(parseMotionAIOutput('').ok).toBe(false);
  });
});

describe('buildMotionPrompt（提示词完整性）', () => {
  it('包含参数契约、排版说明、禁令与输出格式', () => {
    const p = buildMotionPrompt('测试');
    expect(p).toContain("'layout'");
    expect(p).toContain('layout.lines');
    expect(p).toContain('layout.font');
    expect(p).toContain('Math.random');
    expect(p).toContain('// 名称：');
    expect(p).toContain('```js');
  });
});
