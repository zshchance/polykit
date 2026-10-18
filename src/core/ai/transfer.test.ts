import { describe, expect, it } from 'vitest';
import {
  ORIGIN_TOKEN,
  exportAIConfigJSON,
  importAIConfigJSON,
  normalizeSiteRoot,
  rewriteOrigin,
} from './transfer';
import type { AIConfig } from './types';

const SITE_A = 'https://box.pages.dev/';
const SITE_B = 'https://user.github.io/polykit/';

function configWithProxyUrl(url: string): AIConfig {
  return {
    version: 1,
    providers: [
      {
        id: 'p1',
        name: '同域代理',
        protocol: 'openai',
        baseUrl: url,
        apiKey: 'sk-secret',
        enabled: true,
        addedAt: 1,
      },
    ],
    models: [{ id: 'm1', providerId: 'p1', name: 'gpt-4o', capabilities: ['text'], enabled: true }],
  };
}

describe('normalizeSiteRoot', () => {
  it('规范为单一尾斜杠', () => {
    expect(normalizeSiteRoot('https://x.com')).toBe('https://x.com/');
    expect(normalizeSiteRoot('https://x.com///')).toBe('https://x.com/');
    expect(normalizeSiteRoot('https://x.com/repo/')).toBe('https://x.com/repo/');
  });
});

describe('rewriteOrigin', () => {
  it('递归替换字符串叶子，外部 URL 不受影响', () => {
    const out = rewriteOrigin(
      {
        a: 'https://old.example.com/api/proxy',
        b: 'https://api.openai.com/v1',
        c: ['https://old.example.com/x', 42, null],
        d: { nested: 'see https://old.example.com/docs' },
      },
      'https://old.example.com/',
      'https://new.example.com/',
    ) as Record<string, unknown>;
    expect(out.a).toBe('https://new.example.com/api/proxy');
    expect(out.b).toBe('https://api.openai.com/v1');
    expect((out.c as string[])[0]).toBe('https://new.example.com/x');
    expect((out.d as { nested: string }).nested).toBe('see https://new.example.com/docs');
  });

  it('from 与 to 相同时原样返回（零开销路径）', () => {
    const node = { a: 'https://x.com/1' };
    expect(rewriteOrigin(node, 'https://x.com/', 'https://x.com/')).toBe(node);
  });
});

describe('导出 → 导入 全链路', () => {
  it('导出：站点地址替换为 {ORIGIN} 占位，密钥默认保留', () => {
    const json = exportAIConfigJSON(configWithProxyUrl(`${SITE_A}api/proxy`), SITE_A, true);
    const file = JSON.parse(json) as { meta: Record<string, unknown>; config: AIConfig };
    expect(file.meta.format).toBe('polykit-ai-config');
    expect(file.meta.exportedFrom).toBe(SITE_A);
    expect(file.config.providers[0]!.baseUrl).toBe(`${ORIGIN_TOKEN}/api/proxy`);
    expect(file.config.providers[0]!.apiKey).toBe('sk-secret');
  });

  it('导出脱敏版：密钥置空', () => {
    const json = exportAIConfigJSON(configWithProxyUrl(`${SITE_A}api/proxy`), SITE_A, false);
    const file = JSON.parse(json) as { meta: { includeKeys: boolean }; config: AIConfig };
    expect(file.meta.includeKeys).toBe(false);
    expect(file.config.providers[0]!.apiKey).toBe('');
  });

  it('跨域名导入：{ORIGIN} 还原 + exportedFrom 精确替换为当前站点', () => {
    const json = exportAIConfigJSON(configWithProxyUrl(`${SITE_A}api/proxy`), SITE_A, true);
    const out = importAIConfigJSON(json, SITE_B);
    expect(out).not.toBeNull();
    // 导出时已替换为 {ORIGIN}，导入到 B 站点直接还原为 B 的地址
    expect(out?.config.providers[0]!.baseUrl).toBe(`${SITE_B}api/proxy`);
    expect(out?.note).toContain('pages.dev');
  });

  it('手填旧站绝对地址（未经占位符导出）也能被 exportedFrom 锚点替换', () => {
    const file = {
      meta: { format: 'polykit-ai-config', version: 1, exportedAt: '', exportedFrom: SITE_A, includeKeys: true },
      config: configWithProxyUrl(`${SITE_A}api/proxy`),
    };
    const out = importAIConfigJSON(JSON.stringify(file), SITE_B);
    expect(out?.config.providers[0]!.baseUrl).toBe(`${SITE_B}api/proxy`);
  });

  it('同域名导入不产生替换提示', () => {
    const json = exportAIConfigJSON(configWithProxyUrl(`${SITE_A}api/proxy`), SITE_A, true);
    const out = importAIConfigJSON(json, SITE_A);
    expect(out?.note).toBe('');
    expect(out?.config.providers[0]!.baseUrl).toBe(`${SITE_A}api/proxy`);
  });

  it('外部 API 地址在整个链路中永不被改写', () => {
    const config = configWithProxyUrl('https://api.deepseek.com/v1');
    const json = exportAIConfigJSON(config, SITE_A, true);
    const out = importAIConfigJSON(json, SITE_B);
    expect(out?.config.providers[0]!.baseUrl).toBe('https://api.deepseek.com/v1');
  });

  it('非法文件返回 null', () => {
    expect(importAIConfigJSON('not json', SITE_A)).toBeNull();
    expect(importAIConfigJSON('{"meta":{"format":"other"}}', SITE_A)).toBeNull();
    expect(importAIConfigJSON('[]', SITE_A)).toBeNull();
  });
});
