/**
 * AI 效果配方解析单测：载体形态、枚举回退、数值钳制与 JSON 容错。
 */

import { describe, expect, it } from 'vitest';

import { buildProgressEffectPrompt, parseProgressEffectAIOutput } from './progress-recipes';

const wrap = (obj: unknown): string => '```json\n' + JSON.stringify(obj) + '\n```';

describe('parseProgressEffectAIOutput', () => {
  it('内置载体 + 合法字段完整保留', () => {
    const out = parseProgressEffectAIOutput(
      wrap({
        name: '流星火尾',
        actor: 'meteor',
        motion: 'fly',
        trail: 'fire',
        trailLen: 0.85,
        size: 0.12,
        tint: 'accent',
        tempoSync: true,
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.recipe.actor).toEqual({ kind: 'builtin', id: 'meteor' });
    expect(out.recipe.trail).toBe('fire');
    expect(out.recipe.trailLen).toBe(0.85);
    expect(out.recipe.tint).toBe('accent');
    expect(out.recipe.tempoSync).toBe(true);
    expect(out.recipe.spin).toBe(0);
    expect(out.recipe.halo).toBe(0);
    expect(out.recipe.offsetY).toBe(0);
  });

  it('asset: 素材名与 custom + assetPrompt', () => {
    const asset = parseProgressEffectAIOutput(wrap({ name: '我的跑者', actor: 'asset:奔跑小人' }));
    expect(asset.ok && asset.recipe.actor).toEqual({ kind: 'asset', name: '奔跑小人' });

    const custom = parseProgressEffectAIOutput(
      wrap({
        name: '木偶人',
        actor: 'custom',
        motion: 'run',
        trail: 'echo',
        assetPrompt: '扁平贴纸，透明背景，木偶人侧面奔跑',
      }),
    );
    expect(custom.ok && custom.recipe.actor).toEqual({ kind: 'custom' });
    expect(custom.ok && custom.recipe.assetPrompt).toContain('木偶人');
  });

  it('非法枚举回退默认，数值越界钳制', () => {
    const out = parseProgressEffectAIOutput(
      wrap({
        name: '坏配方',
        actor: 'no-such-actor',
        motion: 'teleport',
        trail: 'sparkle',
        trailLen: 3,
        size: 0.001,
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.recipe.actor).toEqual({ kind: 'custom' });
    expect(out.recipe.trail).toBe('none');
    expect(out.recipe.trailLen).toBe(1);
    expect(out.recipe.size).toBe(0.06);
  });

  it('缺少 name / 非 JSON 会给出可读原因', () => {
    expect(parseProgressEffectAIOutput(wrap({ actor: 'meteor' })).ok).toBe(false);
    const bad = parseProgressEffectAIOutput('```json\n{ not json }\n```');
    expect(bad.ok).toBe(false);
  });
});

describe('buildProgressEffectPrompt', () => {
  it('提示词包含素材库名称与内置载体 id', () => {
    const prompt = buildProgressEffectPrompt('一个拖着火焰的流星', ['我的跑者', '足球贴纸']);
    expect(prompt).toContain('我的跑者');
    expect(prompt).toContain('足球贴纸');
    expect(prompt).toContain('"meteor"');
  });
});
