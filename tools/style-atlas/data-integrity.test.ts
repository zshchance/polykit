import { describe, it, expect } from 'vitest';
import { ALL_STYLES } from './data';
import { getAiSampleUrl } from './ai-samples';
import { CATEGORY_ORDER, ERA_ORDER, MOODS, TRAITS, SCENES } from './types';

describe('风格图鉴数据完整性', () => {
  it('每个词条都有 AI 生成参考图（assets/samples/<id>.webp）', () => {
    for (const s of ALL_STYLES) {
      expect(getAiSampleUrl(s.id), `缺少 AI 参考图: ${s.id}`).toBeTruthy();
    }
  });

  it('词条 id 全局唯一', () => {
    const ids = ALL_STYLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('维度取值全部来自词表（筛选胶囊集合可控）', () => {
    const eras = new Set<string>(ERA_ORDER);
    const moods = new Set<string>(MOODS);
    const traits = new Set<string>(TRAITS);
    const scenes = new Set<string>(SCENES);
    const categories = new Set<string>(CATEGORY_ORDER);
    for (const s of ALL_STYLES) {
      expect(categories.has(s.category), `${s.id} category 越界`).toBe(true);
      expect(eras.has(s.era), `${s.id} era 越界`).toBe(true);
      for (const m of s.moods) expect(moods.has(m), `${s.id} mood 越界: ${m}`).toBe(true);
      for (const t of s.traits) expect(traits.has(t), `${s.id} trait 越界: ${t}`).toBe(true);
      for (const sc of s.scenes) expect(scenes.has(sc), `${s.id} scene 越界: ${sc}`).toBe(true);
    }
  });

  it('必备字段非空且规模达标（48 种风格 / 8 大类）', () => {
    expect(ALL_STYLES.length).toBe(48);
    expect(new Set(ALL_STYLES.map((s) => s.category)).size).toBe(CATEGORY_ORDER.length);
    for (const s of ALL_STYLES) {
      expect(s.desc.length, `${s.id} desc`).toBeGreaterThan(10);
      expect(s.background.length, `${s.id} background`).toBeGreaterThan(30);
      expect(s.techniques.length, `${s.id} techniques`).toBeGreaterThanOrEqual(4);
      expect(s.palette.length, `${s.id} palette`).toBe(5);
      expect(s.keywords.length, `${s.id} keywords`).toBeGreaterThanOrEqual(6);
      expect(s.prompt.length, `${s.id} prompt`).toBeGreaterThan(20);
      expect(s.promptZh.length, `${s.id} promptZh`).toBeGreaterThan(20);
    }
  });

  it('调色板 hex 格式合法', () => {
    for (const s of ALL_STYLES) {
      for (const p of s.palette) {
        expect(p.hex, `${s.id} ${p.name}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });
});
