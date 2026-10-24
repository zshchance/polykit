import { describe, expect, it } from 'vitest';

import {
  addCustomScheme,
  buildSchemePrompt,
  parseSchemeAIOutput,
  schemeOptionPatches,
  type CustomScheme,
} from './custom-schemes';
import { DEFAULT_OPTIONS, type SlideVideoOptions } from './options';

function storedScheme(over: Partial<CustomScheme> = {}): CustomScheme {
  return {
    id: 'svscheme:test0001',
    name: '深夜科技',
    bg1: '#0b1026',
    bg2: '#2b0f45',
    fg: '#f5f3ff',
    accent: '#22d3ee',
    createdAt: 1,
    ...over,
  };
}

describe('parseSchemeAIOutput（AI 输出解析）', () => {
  const valid =
    '```json\n{"name":"霓虹夜话","bg1":"#0b1026","bg2":"#2b0f45","fg":"#f5f3ff","accent":"#22d3ee","flip":"zoom","countdown":"ring"}\n```';

  it('解析合法 JSON 围栏（含枚举）', () => {
    const r = parseSchemeAIOutput(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scheme.name).toBe('霓虹夜话');
    expect(r.scheme.colors).toEqual({
      bg1: '#0b1026',
      bg2: '#2b0f45',
      fg: '#f5f3ff',
      accent: '#22d3ee',
    });
    expect(r.scheme.flip).toBe('zoom');
    expect(r.scheme.countdown).toBe('ring');
  });

  it('无围栏的裸 JSON 也能解析', () => {
    const r = parseSchemeAIOutput(
      '{"name":"x","bg1":"#000000","bg2":"#111111","fg":"#ffffff","accent":"#ff0000"}',
    );
    expect(r.ok).toBe(true);
  });

  it('颜色缺失 / 非法 hex 拒收', () => {
    expect(parseSchemeAIOutput('{"name":"x","bg1":"#000000"}').ok).toBe(false);
    expect(
      parseSchemeAIOutput(
        '{"name":"x","bg1":"#00000","bg2":"#111111","fg":"#ffffff","accent":"#ff0000"}',
      ).ok,
    ).toBe(false);
  });

  it('非法枚举静默丢弃（应用时不改变该项）', () => {
    const r = parseSchemeAIOutput(
      '{"name":"x","bg1":"#000000","bg2":"#111111","fg":"#ffffff","accent":"#ff0000","flip":"不存在"}',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scheme.flip).toBeUndefined();
  });

  it('新版完整主题字段可解析，旧 JSON 保持兼容', () => {
    const r = parseSchemeAIOutput(
      '{"name":"秋叶","bg1":"#f6ead8","bg2":"#dfb88e","fg":"#563b2a","accent":"#a65f36","layout":"editorial","decoration":"autumn","background":"paper","typography":"editorial"}',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scheme.design).toEqual({
      layout: 'editorial',
      decoration: 'autumn',
      background: 'paper',
      typography: 'editorial',
    });
    const old = parseSchemeAIOutput(valid);
    expect(old.ok && old.scheme.design).toBeUndefined();
  });

  it('非法装饰枚举回退经典设计，不进入渲染器', () => {
    const r = parseSchemeAIOutput(
      '{"name":"x","bg1":"#000000","bg2":"#111111","fg":"#ffffff","accent":"#ff0000","decoration":"恶意代码"}',
    );
    expect(r.ok && r.scheme.design?.decoration).toBe('none');
  });

  it('非 JSON 输入拒收', () => {
    expect(parseSchemeAIOutput('这是说明文字').ok).toBe(false);
  });
});

describe('schemeOptionPatches（选项补丁）', () => {
  it('只包含方案明确指定的字段', () => {
    const p = schemeOptionPatches(storedScheme({ flip: 'blinds', align: 'left' }));
    expect(p).toEqual({ flip: 'blinds', align: 'left' });
    const base: SlideVideoOptions = { ...DEFAULT_OPTIONS };
    const merged = { ...base, ...schemeOptionPatches(storedScheme()) };
    expect(merged).toEqual(base); // 无枚举字段时不改变任何选项
  });
});

describe('buildSchemePrompt（提示词防漂移）', () => {
  it('包含全部真实枚举 id（翻页/倒计时/字体/对齐）', () => {
    const prompt = buildSchemePrompt('测试');
    for (const id of ['fade', 'slide', 'cover', 'reveal', 'zoom', 'flip', 'blinds']) {
      expect(prompt).toContain(`"${id}"`);
    }
    for (const id of ['none', 'number', 'bar', 'ring']) {
      expect(prompt).toContain(`"${id}"`);
    }
    for (const id of ['sans', 'serif', 'kai', 'mono']) {
      expect(prompt).toContain(`"${id}"`);
    }
    for (const id of ['left', 'center']) {
      expect(prompt).toContain(`"${id}"`);
    }
    for (const id of [
      'classic',
      'editorial',
      'poster',
      'card',
      'notebook',
      'autumn',
      'snow',
      'paper',
      'modern',
    ]) {
      expect(prompt).toContain(`"${id}"`);
    }
    expect(prompt).toContain('layout');
    expect(prompt).toContain('typography');
  });

  it('包含字段说明与输出格式约定', () => {
    const prompt = buildSchemePrompt('测试');
    expect(prompt).toContain('bg1');
    expect(prompt).toContain('```json');
  });
});

describe('存储 CRUD（node 环境无 localStorage 时安全返回空）', () => {
  it('addCustomScheme 在无存储环境下不抛错', () => {
    // node 测试环境无 localStorage：readJSON 返回 null，列表为空，写忽略
    const items = addCustomScheme({
      name: 'x',
      bg1: '#000000',
      bg2: '#111111',
      fg: '#ffffff',
      accent: '#ff0000',
    });
    expect(Array.isArray(items)).toBe(true);
  });
});
