import { describe, expect, it } from 'vitest';
import {
  buildChatBody,
  extractDelta,
  normalizeImagesResponse,
  parseSSE,
  providerEndpoints,
  providerHeaders,
} from './http';
import { AIError } from './types';
import type { ChatMessage } from './types';

describe('providerEndpoints', () => {
  it('openai：约定含 /v1，直接拼端点', () => {
    const e = providerEndpoints('https://api.deepseek.com/v1', 'openai');
    expect(e?.chatUrl).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(e?.modelsUrl).toBe('https://api.deepseek.com/v1/models');
  });

  it('openai：裸根地址自动补 /v1；尾斜杠容忍', () => {
    expect(providerEndpoints('https://api.openai.com', 'openai')?.chatUrl).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
    expect(providerEndpoints('https://api.openai.com/', 'openai')?.modelsUrl).toBe(
      'https://api.openai.com/v1/models',
    );
  });

  it('openai：自定义网关路径不强行加 /v1', () => {
    expect(providerEndpoints('https://gate.example.com/api', 'openai')?.chatUrl).toBe(
      'https://gate.example.com/api/chat/completions',
    );
  });

  it('anthropic：尾部 /v1 先剥掉再统一拼 /v1/*', () => {
    expect(providerEndpoints('https://api.anthropic.com', 'anthropic')?.chatUrl).toBe(
      'https://api.anthropic.com/v1/messages',
    );
    expect(providerEndpoints('https://api.anthropic.com/v1', 'anthropic')?.modelsUrl).toBe(
      'https://api.anthropic.com/v1/models',
    );
  });

  it('非法输入返回 null', () => {
    expect(providerEndpoints('', 'openai')).toBeNull();
    expect(providerEndpoints('ftp://x', 'openai')).toBeNull();
    expect(providerEndpoints('just-text', 'anthropic')).toBeNull();
  });
});

describe('providerHeaders', () => {
  it('openai 用 Bearer；anthropic 用 x-api-key + 浏览器直连头', () => {
    expect(providerHeaders({ protocol: 'openai', apiKey: 'sk-1' })).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer sk-1',
    });
    const ah = providerHeaders({ protocol: 'anthropic', apiKey: 'ak-1' });
    expect(ah['x-api-key']).toBe('ak-1');
    expect(ah['anthropic-version']).toBe('2023-06-01');
    expect(ah['anthropic-dangerous-direct-browser-access']).toBe('true');
  });
});

describe('buildChatBody', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: '你是助手' },
    { role: 'user', content: '你好' },
  ];

  it('openai：messages 原样、可选参数缺省不加', () => {
    const body = buildChatBody('openai', 'gpt-4o-mini', messages);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages).toEqual([
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '你好' },
    ]);
    expect('temperature' in body).toBe(false);
    expect('max_tokens' in body).toBe(false);
    expect('stream' in body).toBe(false);
  });

  it('anthropic：system 提升为顶层字段、max_tokens 必填默认 4096', () => {
    const body = buildChatBody('anthropic', 'claude-sonnet-4-5', messages);
    expect(body.system).toBe('你是助手');
    expect(body.max_tokens).toBe(4096);
    expect((body.messages as Array<{ role: string }>).map((m) => m.role)).toEqual(['user']);
  });

  it('多模态：openai 转 image_url；anthropic 拆 data URL 为 base64 source', () => {
    const mm: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: '这是什么' },
          { type: 'image', url: 'data:image/png;base64,QUJD' },
        ],
      },
    ];
    const o = buildChatBody('openai', 'gpt-4o', mm) as { messages: Array<{ content: unknown[] }> };
    expect(o.messages[0]!.content).toEqual([
      { type: 'text', text: '这是什么' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
    ]);
    const a = buildChatBody('anthropic', 'claude-sonnet-4-5', mm) as {
      messages: Array<{ content: Array<Record<string, unknown>> }>;
    };
    expect(a.messages[0]!.content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'QUJD' },
    });
  });

  it('anthropic 收到远程图片 URL 时抛友好错误', () => {
    const mm: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: '看图' },
          { type: 'image', url: 'https://cdn.example.com/a.png' },
        ],
      },
    ];
    expect(() => buildChatBody('anthropic', 'claude-sonnet-4-5', mm)).toThrow(AIError);
  });
});

describe('parseSSE', () => {
  it('按空行分块、拼接多行 data、保留未完成尾部', () => {
    const { events, rest } = parseSSE('data: a\n\ndata: b1\ndata: b2\n\ndata: tail');
    expect(events).toEqual(['a', 'b1\nb2']);
    expect(rest).toBe('data: tail');
  });

  it('容忍 \\r\\n 分隔', () => {
    const { events } = parseSSE('data: x\r\n\r\ndata: [DONE]\r\n\r\n');
    expect(events).toEqual(['x', '[DONE]']);
  });
});

describe('normalizeImagesResponse', () => {
  it('url 与 b64_json 两种形态归一化', () => {
    expect(
      normalizeImagesResponse({ data: [{ url: 'https://cdn.example.com/a.png' }] }),
    ).toEqual(['https://cdn.example.com/a.png']);
    expect(normalizeImagesResponse({ data: [{ b64_json: 'QUJD' }] })).toEqual([
      'data:image/png;base64,QUJD',
    ]);
    expect(
      normalizeImagesResponse({
        data: [{ url: 'https://x/1.png' }, { b64_json: 'REVG' }, { url: '' }],
      }),
    ).toEqual(['https://x/1.png', 'data:image/png;base64,REVG']);
  });

  it('缺 data 数组或无可用图片时抛 AIError', () => {
    expect(() => normalizeImagesResponse({})).toThrow(AIError);
    expect(() => normalizeImagesResponse({ data: [] })).toThrow(AIError);
    expect(() => normalizeImagesResponse({ data: [{ url: '' }] })).toThrow(AIError);
  });
});

describe('extractDelta', () => {
  it('openai：content 与 reasoning_content 增量', () => {
    expect(extractDelta('openai', '{"choices":[{"delta":{"content":"你"}}]}')).toEqual({
      content: '你',
      done: false,
    });
    expect(extractDelta('openai', '{"choices":[{"delta":{"reasoning_content":"想"}}]}')).toEqual({
      reasoning: '想',
      done: false,
    });
  });

  it('openai 思考模型真实形态：content 为空串 + reasoning_content 并存', () => {
    // DeepSeek v4 flash 等思考模型的流式块：思考阶段 content:"" 且带 role
    expect(
      extractDelta(
        'openai',
        '{"choices":[{"delta":{"content":"","reasoning_content":"We need","role":"assistant"},"index":0}],"object":"chat.completion.chunk"}',
      ),
    ).toEqual({ reasoning: 'We need', done: false });
  });

  it('openai：[DONE] 结束、非法 JSON 容忍、无 delta 忽略', () => {
    expect(extractDelta('openai', '[DONE]').done).toBe(true);
    expect(extractDelta('openai', 'not-json')).toEqual({ done: false });
    expect(extractDelta('openai', '{"id":"x"}')).toEqual({ done: false });
  });

  it('anthropic：text_delta / thinking_delta / message_stop', () => {
    expect(
      extractDelta('anthropic', '{"type":"content_block_delta","delta":{"type":"text_delta","text":"好"}}'),
    ).toEqual({ content: '好', done: false });
    expect(
      extractDelta('anthropic', '{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"嗯"}}'),
    ).toEqual({ reasoning: '嗯', done: false });
    expect(extractDelta('anthropic', '{"type":"message_stop"}').done).toBe(true);
    expect(extractDelta('anthropic', '{"type":"message_start"}')).toEqual({ done: false });
  });
});
