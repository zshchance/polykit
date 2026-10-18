import { describe, expect, it } from 'vitest';
import { primaryFor, resolveCandidates, satisfies } from './router';
import type { AIConfig, AIModel } from './types';

function build(overrides?: Partial<AIConfig>): AIConfig {
  return {
    version: 1,
    providers: [
      { id: 'pb', name: '高优先级', protocol: 'openai', baseUrl: 'https://high.example.com/v1', apiKey: '', enabled: true, addedAt: 1 },
      { id: 'pa', name: '低优先级', protocol: 'openai', baseUrl: 'https://low.example.com/v1', apiKey: '', enabled: true, addedAt: 2 },
      { id: 'pc', name: '已停用', protocol: 'openai', baseUrl: 'https://off.example.com/v1', apiKey: '', enabled: false, addedAt: 3 },
    ],
    models: [
      { id: 'm-low-text', providerId: 'pa', name: 'low-text', capabilities: ['text'], enabled: true },
      { id: 'm-high-vision', providerId: 'pb', name: 'high-vision', capabilities: ['text', 'image'], enabled: true },
      { id: 'm-high-text', providerId: 'pb', name: 'high-text', capabilities: ['text'], enabled: true },
      { id: 'm-off', providerId: 'pc', name: 'off-model', capabilities: ['text'], enabled: true },
      { id: 'm-disabled', providerId: 'pb', name: 'disabled-model', capabilities: ['text'], enabled: false },
      { id: 'm-audio', providerId: 'pb', name: 'audio-model', capabilities: ['text', 'audio'], enabled: true },
    ],
    ...overrides,
  };
}

describe('satisfies', () => {
  it('能力超集判断', () => {
    const vision: AIModel = { id: 'x', providerId: 'p', name: 'x', capabilities: ['text', 'image'], enabled: true };
    expect(satisfies(vision, ['text'])).toBe(true);
    expect(satisfies(vision, ['text', 'image'])).toBe(true);
    expect(satisfies(vision, ['image'])).toBe(true);
    expect(satisfies(vision, ['audio'])).toBe(false);
  });
});

describe('resolveCandidates', () => {
  it('按供应商优先级（数组顺序）× 模型添加顺序排列，过滤停用', () => {
    const names = resolveCandidates(build(), ['text']).map((c) => c.model.name);
    // pb 在 providers 数组中排在 pa 前面（即优先级更高），pc 已停用
    expect(names).toEqual(['high-vision', 'high-text', 'audio-model', 'low-text']);
  });

  it('能力路由：image 需求只匹配视觉模型', () => {
    const names = resolveCandidates(build(), ['text', 'image']).map((c) => c.model.name);
    expect(names).toEqual(['high-vision']);
  });

  it('audio 需求匹配音频模型', () => {
    const names = resolveCandidates(build(), ['audio']).map((c) => c.model.name);
    expect(names).toEqual(['audio-model']);
  });

  it('need 为空数组视同 [text]', () => {
    expect(resolveCandidates(build(), []).map((c) => c.model.name)).toEqual(
      resolveCandidates(build(), ['text']).map((c) => c.model.name),
    );
  });

  it('无匹配时返回空数组；primaryFor 返回 null', () => {
    expect(resolveCandidates(build(), ['image', 'audio'])).toEqual([]);
    expect(primaryFor(build(), ['image', 'audio'])).toBeNull();
  });
});
