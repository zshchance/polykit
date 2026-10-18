import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  backupFilename,
  parseSiteBackup,
  splitStorageEntries,
} from './backup';

const SITE_A = 'https://box.pages.dev/';
const SITE_B = 'https://user.github.io/polykit/';

describe('splitStorageEntries', () => {
  it('AI 配置单列一桶，其余全部归工具桶', () => {
    const out = splitStorageEntries([
      ['static-toolkit-ai-config', '{"version":1}'],
      ['static-toolkit-theme', 'dark'],
      ['qr-code:config', '{}'],
      ['static-toolkit-home-prefs', '{}'],
    ]);
    expect(out.ai).toEqual([['static-toolkit-ai-config', '{"version":1}']]);
    expect(out.tools.map(([k]) => k)).toEqual(['static-toolkit-theme', 'qr-code:config', 'static-toolkit-home-prefs']);
  });
});

describe('parseSiteBackup', () => {
  function makeBackup(overrides?: Partial<Record<string, unknown>>): string {
    return JSON.stringify({
      meta: {
        format: BACKUP_FORMAT,
        version: 1,
        exportedAt: '2026-10-18T00:00:00Z',
        exportedFrom: SITE_A,
        includes: { includeTools: true, includeAI: true, includeConversations: true },
      },
      localStorage: {
        'static-toolkit-ai-config': JSON.stringify({
          version: 1,
          providers: [{ id: 'p1', name: '同域代理', baseUrl: '{ORIGIN}/api/proxy', protocol: 'openai', apiKey: 'k', enabled: true, addedAt: 1 }],
          models: [],
        }),
        'static-toolkit-theme': 'dark',
      },
      ...overrides,
    });
  }

  it('合法备份：{ORIGIN} 还原 + exportedFrom 精确替换 + 条目计划', () => {
    const plan = parseSiteBackup(makeBackup(), SITE_B);
    expect(plan).not.toBeNull();
    const aiRaw = plan!.localStorageWrites.find(([k]) => k === 'static-toolkit-ai-config')?.[1];
    expect(aiRaw).toContain(`${SITE_B}api/proxy`);
    expect(plan!.localStorageWrites.some(([k]) => k === 'static-toolkit-theme')).toBe(true);
    expect(plan!.note).toContain('pages.dev');
  });

  it('同域名导入无替换提示；外部地址永不被改写', () => {
    const json = makeBackup();
    const plan = parseSiteBackup(json, SITE_A)!;
    expect(plan.note).toBe('');
    const aiRaw = plan.localStorageWrites.find(([k]) => k === 'static-toolkit-ai-config')?.[1];
    expect(aiRaw).toContain(`${SITE_A}api/proxy`);
  });

  it('携带会话库时计划含 conversations', () => {
    const json = makeBackup({
      conversations: {
        format: 'polykit-ai-conversations',
        version: 1,
        assets: [],
        items: [{ conversation: { id: 'c1', toolSlug: 'prompt-hub', title: 't', createdAt: 1, updatedAt: 1, messageCount: 2, bytes: 10 }, messages: [] }],
      },
    });
    const plan = parseSiteBackup(json, SITE_A)!;
    expect(plan.conversations?.items.length).toBe(1);
  });

  it('旧版首页偏好文件兼容：识别并映射为偏好写回', () => {
    const legacy = JSON.stringify({ version: 1, pinned: ['qr-code'], starred: [], order: [] });
    const plan = parseSiteBackup(legacy, SITE_A);
    expect(plan).not.toBeNull();
    expect(plan!.localStorageWrites[0]![0]).toBe('static-toolkit-home-prefs');
    expect(plan!.note).toContain('旧版偏好备份');
  });

  it('非法输入返回 null', () => {
    expect(parseSiteBackup('not json', SITE_A)).toBeNull();
    expect(parseSiteBackup('[]', SITE_A)).toBeNull();
    expect(parseSiteBackup('{"meta":{"format":"other","version":1}}', SITE_A)).toBeNull();
  });
});

describe('backupFilename', () => {
  it('带日期默认名', () => {
    expect(backupFilename(new Date(2026, 9, 18))).toBe('polykit-backup-20261018.json');
  });
});
