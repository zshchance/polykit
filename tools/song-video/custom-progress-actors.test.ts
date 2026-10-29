/**
 * AI 角色代码解析 / 静态扫描单测（dryRun 需要 DOM，由浏览器测试覆盖）。
 */

import { describe, expect, it } from 'vitest';

import { parseActorAIOutput, scanActorCode } from './custom-progress-actors';

describe('parseActorAIOutput', () => {
  it('提取名称注释与代码体', () => {
    const raw =
      '```js\n// 名称：火尾流星\nconst r = size * 0.3;\nctx.arc(x, y, r, 0, Math.PI * 2);\nctx.fill();\n```';
    const out = parseActorAIOutput(raw);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.name).toBe('火尾流星');
    expect(out.code).toContain('ctx.arc');
    expect(out.code).not.toContain('名称');
  });

  it('缺少名称或代码时返回原因', () => {
    expect(parseActorAIOutput('```js\nctx.fillRect(0,0,1,1)\n```').ok).toBe(false);
    expect(parseActorAIOutput('   ').ok).toBe(false);
  });
});

describe('scanActorCode', () => {
  it('拒绝非确定性 API', () => {
    expect(scanActorCode('const x = Math.random() * 10;')).toContain('Math.random');
    expect(scanActorCode('const t0 = performance.now();')).toContain('performance.now');
    expect(scanActorCode('setTimeout(() => {}, 10);')).toContain('setTimeout');
  });

  it('拒绝危险全局对象', () => {
    expect(scanActorCode('document.body.append(1);')).not.toBeNull();
    expect(scanActorCode('fetch("https://x")')).not.toBeNull();
  });

  it('干净的确定性代码通过', () => {
    const code =
      'const r = size * 0.3; const wob = Math.sin(t * 2) * size * 0.1;' +
      'ctx.fillStyle = theme.accent; ctx.beginPath(); ctx.arc(x, y + wob, r, 0, Math.PI * 2); ctx.fill();';
    expect(scanActorCode(code)).toBeNull();
  });
});
