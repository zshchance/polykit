import { describe, expect, it } from 'vitest';

import {
  buildVisualizerPrompt,
  compileVisualizerForPreview,
  parseVisualizerAIOutput,
  scanVisualizerCode,
  syntheticBands,
} from './custom-visualizers';
import type { CustomVisualizerFrame } from './renderer';

/** 供守卫包装测试的最小 ctx 桩（save/restore/fillRect 覆盖测试用例的调用面） */
function fakeCtx(): CanvasRenderingContext2D {
  return {
    save: () => undefined,
    restore: () => undefined,
    fillRect: () => undefined,
  } as unknown as CanvasRenderingContext2D;
}

function frame(overrides: Partial<CustomVisualizerFrame> = {}): CustomVisualizerFrame {
  return {
    ctx: fakeCtx(),
    W: 480,
    H: 270,
    S: 270,
    bands: new Uint8Array(64),
    wave: new Uint8Array(2048).fill(128),
    t: 1,
    dur: 180,
    theme: {
      id: 'midnight',
      label: '深空蓝',
      swatch: '',
      bg: ['#0b1220', '#1e3a8a'],
      fg: '#f1f5f9',
      accent: '#38bdf8',
      muted: 'rgba(241,245,249,0.55)',
      light: false,
    },
    layout: { coverCx: 240, coverCy: 97, coverR: 46 },
    ...overrides,
  };
}

describe('scanVisualizerCode · 静态扫描', () => {
  it('干净的绘制代码通过', () => {
    const code = "const base = ctx.globalAlpha;\nctx.fillStyle = theme.accent;\nctx.fillRect(0, 0, S * 0.1, S * 0.1);\nctx.globalAlpha = base;";
    expect(scanVisualizerCode(code)).toBeNull();
  });

  it.each([
    ['Math.random()', 'const r = Math.random();'],
    ['Date.now()', 'const ms = Date.now();'],
    ['new Date()', 'const d = new Date();'],
    ['performance.now()', 'const p = performance.now();'],
    ['setTimeout', 'setTimeout(() => {}, 0);'],
    ['requestAnimationFrame', 'requestAnimationFrame(fn);'],
  ])('确定性硬约束：%s 被拒收并给出替换指引', (_label, code) => {
    const reason = scanVisualizerCode(code);
    expect(reason).not.toBeNull();
    expect(reason).toContain('确定性伪随机');
  });

  it.each([
    ['document.body', 'document.body.append(x);'],
    ['fetch', 'fetch("https://x.example");'],
    ['localStorage', 'localStorage.setItem("k","v");'],
    ['new Function', 'new Function("a","return a")();'],
  ])('共享危险名单：%s 被拒收', (_label, code) => {
    expect(scanVisualizerCode(code)).not.toBeNull();
  });
});

describe('parseVisualizerAIOutput · AI 输出解析', () => {
  it('识别 ```js 围栏 + 名称注释行，并把名称行从代码体剥离', () => {
    const raw = '好的，如下：\n```js\n// 名称：极光幕帘\nconst base = ctx.globalAlpha;\nctx.fillStyle = theme.accent;\n```\n祝使用愉快';
    const parsed = parseVisualizerAIOutput(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.name).toBe('极光幕帘');
    expect(parsed.code).not.toContain('名称');
    expect(parsed.code).toContain('theme.accent');
  });

  it('无围栏时整段视为代码；# 前缀与英文 name 也兼容', () => {
    const parsed = parseVisualizerAIOutput('# name: Test\nctx.fillRect(0,0,1,1);');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.name).toBe('Test');
    expect(parsed.code).toBe('ctx.fillRect(0,0,1,1);');
  });

  it('缺名称注释或空输入报错', () => {
    expect(parseVisualizerAIOutput('```js\nctx.fillRect(0,0,1,1);\n```').ok).toBe(false);
    expect(parseVisualizerAIOutput('').ok).toBe(false);
  });
});

describe('compileVisualizerForPreview · 编译与运行时守卫', () => {
  it('语法错误给出明确原因', () => {
    const r = compileVisualizerForPreview('const const x = 1;');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('语法');
  });

  it('危险代码在编译前即被拒收', () => {
    expect(compileVisualizerForPreview('Math.random();').ok).toBe(false);
    expect(compileVisualizerForPreview('fetch("/x");').ok).toBe(false);
  });

  it('运行时抛错 → 返回 false 且本会话不再执行（dead 标记）', () => {
    const r = compileVisualizerForPreview('throw new Error("boom");');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const f = frame();
    expect(r.draw(f)).toBe(false);
    expect(r.draw(f)).toBe(false); // dead 后仍返回 false，不重复执行
  });

  it('正常绘制返回 true', () => {
    const r = compileVisualizerForPreview('ctx.fillRect(0, 0, 10, 10);');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draw(frame())).toBe(true);
  });
});

describe('syntheticBands · 合成频谱', () => {
  it('值域 0-255 且确定性（同 t 同输出）', () => {
    const a = syntheticBands(64, 12.3);
    const b = syntheticBands(64, 12.3);
    expect(Array.from(a)).toEqual(Array.from(b));
    for (const v of a) expect(v).toBeGreaterThanOrEqual(0);
    expect(a.length).toBe(64);
  });

  it('out 缓冲复用（演播循环零分配）', () => {
    const buf = new Uint8Array(64);
    expect(syntheticBands(64, 5, buf)).toBe(buf);
  });
});

describe('buildVisualizerPrompt · 提示词', () => {
  it('包含用户描述、调用约定与硬性禁令', () => {
    const p = buildVisualizerPrompt('随低频炸开的光环');
    expect(p).toContain('随低频炸开的光环');
    expect(p).toContain("new Function('ctx','W','H','S','bands','wave','t','dur','theme','layout'");
    expect(p).toContain('Math.random');
    expect(p).toContain('globalAlpha');
    expect(p).toContain('// 名称：');
  });

  it('空描述回退默认文案', () => {
    expect(buildVisualizerPrompt('')).toContain('频谱');
  });
});
