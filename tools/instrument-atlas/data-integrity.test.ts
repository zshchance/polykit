import { describe, it, expect } from 'vitest';
import { ALL_INSTRUMENTS, getInstrumentById } from './data';
import { PHOTO_COUNT, AUDIO_COUNT, getCredits } from './media';
import { FAMILY_ORDER, RANGE_ORDER, MOODS, GENRES, ROLES, DIFFICULTY_ORDER } from './types';

describe('乐器百科数据完整性', () => {
  it('词条 id 全局唯一', () => {
    const ids = ALL_INSTRUMENTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('维度取值全部来自词表（筛选胶囊集合可控）', () => {
    const families = new Set<string>(FAMILY_ORDER);
    const ranges = new Set<string>(RANGE_ORDER);
    const moods = new Set<string>(MOODS);
    const genres = new Set<string>(GENRES);
    const roles = new Set<string>(ROLES);
    const difficulties = new Set<string>(DIFFICULTY_ORDER);
    for (const s of ALL_INSTRUMENTS) {
      expect(families.has(s.family), `${s.id} family 越界`).toBe(true);
      expect(ranges.has(s.range), `${s.id} range 越界`).toBe(true);
      expect(difficulties.has(s.difficulty), `${s.id} difficulty 越界`).toBe(true);
      for (const m of s.moods) expect(moods.has(m), `${s.id} mood 越界: ${m}`).toBe(true);
      for (const g of s.genres) expect(genres.has(g), `${s.id} genre 越界: ${g}`).toBe(true);
      for (const r of s.roles) expect(roles.has(r), `${s.id} role 越界: ${r}`).toBe(true);
    }
  });

  it('搭配推荐的乐器 id 全部存在且不含自身', () => {
    for (const s of ALL_INSTRUMENTS) {
      for (const pid of s.pairing) {
        expect(getInstrumentById(pid), `${s.id} 搭配了不存在的乐器: ${pid}`).toBeTruthy();
        expect(pid, `${s.id} 搭配了自身`).not.toBe(s.id);
      }
    }
  });

  it('必备字段非空且规模达标（48+ 件乐器 / 全大类覆盖）', () => {
    expect(ALL_INSTRUMENTS.length).toBeGreaterThanOrEqual(48);
    expect(new Set(ALL_INSTRUMENTS.map((s) => s.family)).size).toBe(FAMILY_ORDER.length);
    for (const s of ALL_INSTRUMENTS) {
      expect(s.name.length, `${s.id} name`).toBeGreaterThan(0);
      expect(s.nameEn.length, `${s.id} nameEn`).toBeGreaterThan(0);
      expect(s.desc.length, `${s.id} desc`).toBeGreaterThan(10);
      expect(s.background.length, `${s.id} background`).toBeGreaterThan(30);
      expect(s.timbre.length, `${s.id} timbre`).toBeGreaterThanOrEqual(3);
      expect(s.techniques.length, `${s.id} techniques`).toBeGreaterThanOrEqual(4);
      expect(s.pairing.length, `${s.id} pairing`).toBeGreaterThanOrEqual(3);
      expect(s.exemplars.length, `${s.id} exemplars`).toBeGreaterThanOrEqual(1);
      expect(s.facts.origin.length, `${s.id} facts.origin`).toBeGreaterThan(0);
      expect(s.facts.era.length, `${s.id} facts.era`).toBeGreaterThan(0);
      expect(s.keywords.length, `${s.id} keywords`).toBeGreaterThanOrEqual(5);
      expect(s.prompt.length, `${s.id} prompt`).toBeGreaterThan(20);
    }
  });

  it('图片与音频素材基本齐全（Wikimedia Commons 抓取）', () => {
    // piccolo/xiao 无合格音频（Commons 搜到的均为发音示范）显式跳过，UI 隐藏播放器。
    expect(PHOTO_COUNT).toBe(ALL_INSTRUMENTS.length);
    expect(AUDIO_COUNT).toBe(ALL_INSTRUMENTS.length - 2);
  });

  it('有素材的乐器在 credits.json 中有署名记录', () => {
    for (const s of ALL_INSTRUMENTS) {
      const c = getCredits(s.id);
      if (c?.photo) {
        expect(c.photo.license.length, `${s.id} photo license`).toBeGreaterThan(0);
      }
      if (c?.audio) {
        expect(c.audio.license.length, `${s.id} audio license`).toBeGreaterThan(0);
      }
    }
  });
});
