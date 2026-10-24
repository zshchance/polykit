import { describe, expect, it } from 'vitest';

import {
  buildFlipPrompt,
  compileFlipForPreview,
  parseFlipAIOutput,
  scanFlipCode,
} from './custom-transitions';
import { THEMES } from './options';
import type { FlipFrame } from './renderer';

/** node 环境无 canvas：用对象冒充（被测代码只把它透传给用户代码） */
function fakeFrame(over: Partial<FlipFrame> = {}): FlipFrame {
  const fakeCtx = {
    save: () => undefined,
    restore: () => undefined,
    drawImage: () => undefined,
    fillRect: () => undefined,
    globalAlpha: 1,
  };
  return {
    ctx: fakeCtx as unknown as CanvasRenderingContext2D,
    W: 640,
    H: 360,
    S: 360,
    p: 0.5,
    from: {} as HTMLCanvasElement,
    to: {} as HTMLCanvasElement,
    theme: THEMES[0]!,
    ...over,
  };
}

describe('scanFlipCode（静态扫描）', () => {
  it('干净代码通过', () => {
    expect(scanFlipCode('ctx.drawImage(from, 0, 0); ctx.drawImage(to, 0, 0);')).toBeNull();
  });

  it('确定性名单命中并给出替换指引', () => {
    for (const code of [
      'const r = Math.random();',
      'const now = Date.now();',
      'const d = new Date();',
      'performance.now();',
      'setTimeout(() => {}, 0);',
    ]) {
      const hit = scanFlipCode(code);
      expect(hit).not.toBeNull();
      expect(hit).toContain('画面一致');
    }
  });

  it('共享危险名单命中（fetch / localStorage / document.body）', () => {
    expect(scanFlipCode('fetch("/x")')).toContain('越界');
    expect(scanFlipCode('localStorage.getItem("a")')).toContain('越界');
    expect(scanFlipCode('document.body.append(el)')).toContain('越界');
  });
});

describe('compileFlipForPreview（编译与运行时守卫）', () => {
  it('正常绘制返回 true', () => {
    const r = compileFlipForPreview(
      'ctx.drawImage(from, 0, 0); ctx.globalAlpha = 0.5; ctx.drawImage(to, 0, 0);',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draw(fakeFrame())).toBe(true);
  });

  it('运行时抛错 → 本会话死亡（后续返回 false）', () => {
    const r = compileFlipForPreview('throw new Error("boom");');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draw(fakeFrame())).toBe(false);
    expect(r.draw(fakeFrame())).toBe(false); // dead 标志生效
  });

  it('语法错误返回原因', () => {
    const r = compileFlipForPreview('const const');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('语法');
  });

  it('扫描不通过直接拒收（不编译）', () => {
    const r = compileFlipForPreview('Math.random();');
    expect(r.ok).toBe(false);
  });
});

describe('parseFlipAIOutput（AI 输出解析）', () => {
  it('识别围栏 + 名称注释行，并从代码体剥离名称', () => {
    const raw = '说明文字\n```js\n// 名称：对角卷页\nctx.drawImage(from, 0, 0);\n```';
    const r = parseFlipAIOutput(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe('对角卷页');
    expect(r.code).not.toContain('名称');
    expect(r.code).toContain('drawImage');
  });

  it('缺名称注释拒收', () => {
    const r = parseFlipAIOutput('```js\nctx.drawImage(from, 0, 0);\n```');
    expect(r.ok).toBe(false);
  });

  it('空输入拒收', () => {
    expect(parseFlipAIOutput('').ok).toBe(false);
  });
});

describe('buildFlipPrompt（提示词完整性）', () => {
  it('包含参数契约、确定性禁令与输出格式', () => {
    const p = buildFlipPrompt('测试');
    expect(p).toContain("'from'");
    expect(p).toContain("'to'");
    expect(p).toContain('drawImage');
    expect(p).toContain('Math.random');
    expect(p).toContain('// 名称：');
    expect(p).toContain('```js');
  });
});
