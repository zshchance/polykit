import { describe, expect, it } from 'vitest';

import {
  buildCountdownPrompt,
  compileCountdownForPreview,
  parseCountdownAIOutput,
  scanCountdownCode,
} from './custom-countdowns';
import { THEMES } from './options';
import type { CountdownFrame } from './renderer';

/** node 环境无 canvas：用对象冒充（被测代码只把它透传给用户代码） */
function fakeFrame(over: Partial<CountdownFrame> = {}): CountdownFrame {
  const fakeCtx = {
    save: () => undefined,
    restore: () => undefined,
    fillRect: () => undefined,
    beginPath: () => undefined,
    arc: () => undefined,
    stroke: () => undefined,
    fillText: () => undefined,
    globalAlpha: 1,
  };
  return {
    ctx: fakeCtx as unknown as CanvasRenderingContext2D,
    W: 640,
    H: 360,
    S: 360,
    remain: 3.2,
    total: 8,
    page: 2,
    pages: 5,
    theme: THEMES[0]!,
    ...over,
  };
}

describe('scanCountdownCode（静态扫描）', () => {
  it('干净代码通过', () => {
    expect(
      scanCountdownCode('ctx.fillStyle = theme.accent; ctx.fillRect(0, 0, 10, 10);'),
    ).toBeNull();
  });

  it('确定性名单命中（remain 是唯一时间源）', () => {
    for (const code of [
      'Math.random()',
      'Date.now()',
      'new Date()',
      'performance.now()',
      'setInterval(() => {}, 100)',
    ]) {
      const hit = scanCountdownCode(code);
      expect(hit).not.toBeNull();
      expect(hit).toContain('remain');
    }
  });

  it('共享危险名单命中', () => {
    expect(scanCountdownCode('fetch("/x")')).toContain('越界');
    expect(scanCountdownCode('window.location.href = "x"')).toContain('越界');
  });
});

describe('compileCountdownForPreview（编译与运行时守卫）', () => {
  it('正常绘制返回 true', () => {
    const r = compileCountdownForPreview(
      'ctx.fillStyle = theme.accent; ctx.fillRect(W - 40, H - 40, 20, 20);',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draw(fakeFrame())).toBe(true);
  });

  it('运行时抛错 → 本会话死亡（后续返回 false）', () => {
    const r = compileCountdownForPreview('throw new Error("boom");');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draw(fakeFrame())).toBe(false);
    expect(r.draw(fakeFrame())).toBe(false);
  });

  it('语法错误返回原因', () => {
    const r = compileCountdownForPreview('const const');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('语法');
  });
});

describe('parseCountdownAIOutput（AI 输出解析）', () => {
  it('识别围栏 + 名称注释行', () => {
    const raw = '```js\n// 名称：沙漏细语\nctx.arc(0, 0, 10, 0, 6.28);\n```';
    const r = parseCountdownAIOutput(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe('沙漏细语');
    expect(r.code).not.toContain('名称');
  });

  it('缺名称拒收 / 空输入拒收', () => {
    expect(parseCountdownAIOutput('```js\nctx.fillRect(0,0,1,1);\n```').ok).toBe(false);
    expect(parseCountdownAIOutput('').ok).toBe(false);
  });
});

describe('buildCountdownPrompt（提示词完整性）', () => {
  it('包含参数契约、角落小部件约束与确定性禁令', () => {
    const p = buildCountdownPrompt('测试');
    expect(p).toContain("'remain'");
    expect(p).toContain("'total'");
    expect(p).toContain('角落小部件');
    expect(p).toContain('Math.random');
    expect(p).toContain('// 名称：');
  });
});
