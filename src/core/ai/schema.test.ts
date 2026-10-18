import { describe, expect, it } from 'vitest';
import { emptyAIConfig, guessCapabilities, hasRoutableModel, sanitizeAIConfig } from './schema';
import type { AIConfig } from './types';

function sampleConfig(): AIConfig {
  return {
    version: 1,
    providers: [
      {
        id: 'p1',
        name: 'OpenAI 官方',
        protocol: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-x',
        enabled: true,
        addedAt: 1,
      },
      {
        id: 'p2',
        name: 'Anthropic',
        protocol: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: '',
        enabled: false,
        addedAt: 2,
      },
    ],
    models: [
      { id: 'm1', providerId: 'p1', name: 'gpt-4o', capabilities: ['text', 'image'], enabled: true },
      { id: 'm2', providerId: 'p1', name: 'gpt-4o-mini', capabilities: ['text'], enabled: true },
      { id: 'm3', providerId: 'p2', name: 'claude-sonnet-4-5', capabilities: ['text', 'image'], enabled: true },
    ],
  };
}

describe('sanitizeAIConfig', () => {
  it('合法配置原样通过（字段不变）', () => {
    const config = sampleConfig();
    expect(sanitizeAIConfig(config)).toEqual(config);
  });

  it('完全非法的输入返回 null', () => {
    expect(sanitizeAIConfig(null)).toBeNull();
    expect(sanitizeAIConfig('x')).toBeNull();
    expect(sanitizeAIConfig([1, 2])).toBeNull();
  });

  it('非法字段安全回退：协议回 openai、能力白名单过滤、enabled 缺省 true', () => {
    const out = sanitizeAIConfig({
      providers: [
        {
          id: 'p1',
          name: '',
          protocol: 'weird',
          baseUrl: 'https://x.com/v1',
          apiKey: 'k',
          enabled: 'yes',
        },
      ],
      models: [
        { id: 'm1', providerId: 'p1', name: 'm', capabilities: ['text', 'hack', 'image'] },
      ],
    });
    expect(out).not.toBeNull();
    expect(out?.providers[0]?.protocol).toBe('openai');
    expect(out?.providers[0]?.enabled).toBe(true);
    expect(out?.models[0]?.capabilities).toEqual(['text', 'image']);
  });

  it('丢弃悬空模型与重复 id，丢弃无 baseUrl 的供应商', () => {
    const out = sanitizeAIConfig({
      providers: [
        { id: 'p1', protocol: 'openai', baseUrl: 'https://x.com/v1', name: 'A' },
        { id: 'p1', protocol: 'openai', baseUrl: 'https://dup.com', name: 'dup' }, // 重复 id
        { id: 'p3', protocol: 'openai', baseUrl: '', name: 'no-base' }, // 无 baseUrl
      ],
      models: [
        { id: 'm1', providerId: 'p1', name: 'a' },
        { id: 'm2', providerId: 'ghost', name: 'orphan' }, // 悬空
        { id: 'm1', providerId: 'p1', name: 'dup' }, // 重复 id
      ],
    });
    expect(out?.providers.map((p) => p.name)).toEqual(['A']);
    expect(out?.models.map((m) => m.name)).toEqual(['a']);
  });

  it('能力数组为空时回退 [text]', () => {
    const out = sanitizeAIConfig({
      providers: [{ id: 'p1', protocol: 'openai', baseUrl: 'https://x.com/v1' }],
      models: [{ id: 'm1', providerId: 'p1', name: 'm', capabilities: [] }],
    });
    expect(out?.models[0]?.capabilities).toEqual(['text']);
  });
});

describe('hasRoutableModel', () => {
  it('启用供应商下有启用模型才算可用', () => {
    expect(hasRoutableModel(sampleConfig())).toBe(true);
    const disabled = emptyAIConfig();
    disabled.providers = [sampleConfig().providers[0]!];
    disabled.providers[0]!.enabled = false;
    disabled.models = [sampleConfig().models[0]!];
    expect(hasRoutableModel(disabled)).toBe(false);
  });

  it('空配置不可用', () => {
    expect(hasRoutableModel(emptyAIConfig())).toBe(false);
  });
});

describe('guessCapabilities', () => {
  it('常见视觉模型名补 image', () => {
    expect(guessCapabilities('gpt-4o')).toContain('image');
    expect(guessCapabilities('qwen-vl-max')).toContain('image');
    expect(guessCapabilities('claude-sonnet-4-5')).toContain('image');
  });

  it('纯文本模型只有 text；音频模型补 audio', () => {
    expect(guessCapabilities('deepseek-chat')).toEqual(['text']);
    expect(guessCapabilities('whisper-1')).toContain('audio');
    expect(guessCapabilities('glm-4-voice')).toContain('audio');
  });
});
