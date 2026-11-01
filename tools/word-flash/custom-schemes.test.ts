import { describe, expect, it } from 'vitest';

import {
  buildSchemePrompt,
  parseSchemeAIOutput,
  schemeOptionPatches,
  schemePreviewTheme,
} from './custom-schemes';

describe('parseSchemeAIOutput', () => {
  it('解析完整 JSON，保留设计选项与动效', () => {
    const raw =
      '```json\n{"name":"霓虹脉冲","bg1":"#0a0618","bg2":"#2a1150","fg":"#f4ecff","accent":"#7cf2ff","layout":"center","background":"aurora","font":"heavy","motion":"zoom"}\n```';
    const r = parseSchemeAIOutput(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scheme.name).toBe('霓虹脉冲');
    expect(r.scheme.colors.accent).toBe('#7cf2ff');
    expect(r.scheme.design).toEqual({ layout: 'center', background: 'aurora', font: 'heavy' });
    expect(r.scheme.motion).toBe('zoom');
  });

    it('缺少颜色字段拒收', () => {
      const r = parseSchemeAIOutput('{"name":"缺色","bg1":"#000000"}');
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toContain('配色字段不完整');
    });

  it('非法 hex 颜色拒收', () => {
    const r = parseSchemeAIOutput(
      '{"name":"坏色","bg1":"#000000","bg2":"#ffffff","fg":"#zzzzzz","accent":"#123456"}',
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain('fg');
  });

  it('缺少 name 或非 JSON 拒收', () => {
    expect(parseSchemeAIOutput('not json').ok).toBe(false);
    expect(
      parseSchemeAIOutput(
        '{"bg1":"#000000","bg2":"#ffffff","fg":"#111111","accent":"#222222"}',
      ).ok,
    ).toBe(false);
  });

  it('未知枚举字段回退默认而不整体拒收', () => {
    const r = parseSchemeAIOutput(
      '{"name":"兜底","bg1":"#000000","bg2":"#ffffff","fg":"#111111","accent":"#222222","layout":"weird","motion":"nope"}',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scheme.design?.layout).toBe('center');
    expect(r.scheme.motion).toBeUndefined();
  });
});

describe('schemeOptionPatches', () => {
  it('只回传可应用的动效选项', () => {
    expect(
      schemeOptionPatches({
        id: 'wfscheme:x',
        name: 'x',
        bg1: '#000000',
        bg2: '#111111',
        fg: '#ffffff',
        accent: '#00ffff',
        motion: 'shake',
        createdAt: 0,
      }),
    ).toEqual({ motion: 'shake' });
  });
});

describe('schemePreviewTheme', () => {
  it('生成与保存后结构一致的真实主题', () => {
    const theme = schemePreviewTheme({
      name: '样张',
      colors: { bg1: '#101010', bg2: '#202020', fg: '#ffffff', accent: '#ffcc00' },
      design: { layout: 'band', background: 'grid', font: 'mono' },
    });
    expect(theme.bg).toEqual(['#101010', '#202020']);
    expect(theme.accent).toBe('#ffcc00');
    expect(theme.design).toEqual({ layout: 'band', background: 'grid', font: 'mono' });
    expect(theme.light).toBe(false);
  });
});

describe('buildSchemePrompt', () => {
  it('包含全部枚举目录、输出格式与硬性要求', () => {
    const p = buildSchemePrompt('测试风格');
    expect(p).toContain('```json');
    expect(p).toContain('"layout"');
    expect(p).toContain('"background"');
    expect(p).toContain('"motion"');
    expect(p).toContain('center');
    expect(p).toContain('aurora');
    expect(p).toContain('9:16');
  });
});
