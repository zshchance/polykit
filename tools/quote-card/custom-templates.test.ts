import { describe, it, expect } from 'vitest';
import { parseTemplateAIOutput } from './custom-templates';

describe('parseTemplateAIOutput（AI 输出解析）', () => {
  it('标准形态：```js 围栏 + 首三行注释头', () => {
    const raw =
      '```js\n// 名称：星河\n// 背景：linear-gradient(135deg,#6366f1,#8b5cf6)\n// 图标色：#d4af37\nel.style.cssText = "background:#0f172a";\nel.replaceChildren();\n```';
    const parsed = parseTemplateAIOutput(raw);
    expect(parsed.name).toBe('星河');
    expect(parsed.background).toBe('linear-gradient(135deg,#6366f1,#8b5cf6)');
    expect(parsed.iconColor).toBe('#d4af37');
    // 声明注释要从代码体里剥掉
    expect(parsed.code).not.toContain('名称');
    expect(parsed.code).not.toContain('背景：');
    expect(parsed.code).toContain('replaceChildren');
  });

  it('无围栏：去掉 ``` 标记行后整段当代码', () => {
    const raw = '// 名称：无围栏\nconst a = 1;';
    const parsed = parseTemplateAIOutput(raw);
    expect(parsed.name).toBe('无围栏');
    expect(parsed.code).toContain('const a = 1;');
  });

  it('缺背景/图标色时给默认值', () => {
    const parsed = parseTemplateAIOutput('```js\n// 名称：x\nconst a = 1;\n```');
    expect(parsed.background).toBe('linear-gradient(135deg,#6366f1,#8b5cf6)');
    expect(parsed.iconColor).toBe('#ffffff');
  });

  it('名称剥掉包裹引号', () => {
    const parsed = parseTemplateAIOutput('```js\n// 名称："双引号名"\nconst a = 1;\n```');
    expect(parsed.name).toBe('双引号名');
  });

  it('空输入返回空名称与空代码', () => {
    const parsed = parseTemplateAIOutput('   \n');
    expect(parsed.name).toBe('');
    expect(parsed.code).toBe('');
  });

  it('背景值的括号不被误剥（渐变保持完整）', () => {
    const parsed = parseTemplateAIOutput(
      '```js\n// 背景：radial-gradient(circle at 50% 30%,#1e293b,#0f172a)\nconst a = 1;\n```',
    );
    expect(parsed.background).toBe('radial-gradient(circle at 50% 30%,#1e293b,#0f172a)');
  });
});
