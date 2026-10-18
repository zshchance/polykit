import { describe, expect, it } from 'vitest';
import { extractCodeBlock } from './ai-assist';

describe('extractCodeBlock', () => {
  it('提取首个围栏内容（含语言标记、容忍围栏后空白）', () => {
    expect(extractCodeBlock('说明文字\n```js\n// 名称：冬日落雪\nconst a = 1;\n```\n结尾')).toBe(
      '// 名称：冬日落雪\nconst a = 1;',
    );
    expect(extractCodeBlock('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractCodeBlock('```\nbare fence\n```')).toBe('bare fence');
  });

  it('多个围栏取第一个；内容两端空白裁剪', () => {
    expect(extractCodeBlock('```js\nfirst\n```\n文字\n```js\nsecond\n```')).toBe('first');
  });

  it('无围栏返回 null（调用方回退全文）', () => {
    expect(extractCodeBlock('没有代码块的回复')).toBeNull();
    expect(extractCodeBlock('未闭合 ```js\nconst a = 1;')).toBeNull();
  });
});
