import { describe, expect, it } from 'vitest';

import { buildStylePrompt, parseStyleAIOutput, styleOptionPatches } from './custom-styles';

const VALID_JSON =
  '{ "name": "霓虹夜店", "bg1": "#0b1026", "bg2": "#2b0f45", "fg": "#f5f3ff", ' +
  '"accent": "#22d3ee", "visualizer": "mirror", "lyricMode": "list", "progressBar": "line", ' +
  '"introAnim": "zoom", "outroAnim": "fade", "coverStyle": "sticker" }';

describe('parseStyleAIOutput · AI 输出解析', () => {
  it('解析 ```json 围栏内的完整方案', () => {
    const raw = `这是为你设计的方案：\n\`\`\`json\n${VALID_JSON}\n\`\`\`\n希望你喜欢`;
    const r = parseStyleAIOutput(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.style.name).toBe('霓虹夜店');
    expect(r.style.colors).toEqual({
      bg1: '#0b1026',
      bg2: '#2b0f45',
      fg: '#f5f3ff',
      accent: '#22d3ee',
    });
    expect(r.style.visualizer).toBe('mirror');
    expect(r.style.lyricMode).toBe('list');
    expect(r.style.coverStyle).toBe('sticker');
  });

  it('枚举值非法时静默丢弃该字段（应用时不改变该项）', () => {
    const raw = VALID_JSON.replace('"visualizer": "mirror"', '"visualizer": "hologram"');
    const r = parseStyleAIOutput(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.style.visualizer).toBeUndefined();
    expect(r.style.lyricMode).toBe('list'); // 其它合法字段不受影响
  });

  it('枚举字段整体缺省也合法（只应用配色）', () => {
    const r = parseStyleAIOutput(
      '{ "name": "纯配色", "bg1": "#000000", "bg2": "#111111", "fg": "#ffffff", "accent": "#38bdf8" }',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.style.colors?.accent).toBe('#38bdf8');
    expect(r.style.progressBar).toBeUndefined();
  });

  it.each([
    ['缺配色', '{ "name": "x" }'],
    ['配色不完整', '{ "name": "x", "bg1": "#000000" }'],
    ['颜色非 hex', `{ "name": "x", "bg1": "red", "bg2": "#111111", "fg": "#ffffff", "accent": "#38bdf8" }`],
    ['缺 name', '{ "bg1": "#000000", "bg2": "#111111", "fg": "#ffffff", "accent": "#38bdf8" }'],
    ['非对象', '"hello"'],
  ])('%s 报错', (_label, raw) => {
    expect(parseStyleAIOutput(raw).ok).toBe(false);
  });

  it('JSON 解析失败给出可操作提示', () => {
    const r = parseStyleAIOutput('```json\n{ name: 霓虹, }\n```');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('JSON');
  });
});

describe('styleOptionPatches · 选项补丁', () => {
  it('只包含方案明确指定的枚举字段', () => {
    const patches = styleOptionPatches({
      id: 'svstyle:x',
      createdAt: 0,
      name: 't',
      bg1: '#000000',
      bg2: '#111111',
      fg: '#ffffff',
      accent: '#38bdf8',
      visualizer: 'wave',
    });
    expect(patches).toEqual({ visualizer: 'wave' });
  });

  it('全字段方案生成完整补丁', () => {
    const patches = styleOptionPatches({
      id: 'svstyle:x',
      createdAt: 0,
      name: 't',
      bg1: '#000000',
      bg2: '#111111',
      fg: '#ffffff',
      accent: '#38bdf8',
      visualizer: 'bars',
      lyricMode: 'fade',
      progressBar: 'full',
      introAnim: 'slide',
      outroAnim: 'zoom',
      coverStyle: 'band',
    });
    expect(patches).toEqual({
      visualizer: 'bars',
      lyricMode: 'fade',
      progressBar: 'full',
      introAnim: 'slide',
      outroAnim: 'zoom',
      coverStyle: 'band',
    });
  });
});

describe('buildStylePrompt · 提示词', () => {
  it('包含用户描述与全部枚举 id（由真实常量目录生成，防漂移）', () => {
    const p = buildStylePrompt('雨夜便利店');
    expect(p).toContain('雨夜便利店');
    // 四个可视化枚举 id 都应出现在取值表里
    for (const id of ['bars', 'mirror', 'circle', 'wave']) expect(p).toContain(`"${id}"`);
    for (const id of ['none', 'fade', 'list']) expect(p).toContain(`"${id}"`);
    expect(p).toContain('"name"');
    expect(p).toContain('```json');
  });
});
