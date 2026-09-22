import { describe, it, expect } from 'vitest';
import { ALL_RHYTHMS, ALL_ARPS } from './data';
import { DRUM_GENRES, MOODS, ARP_FORMS } from './types';

/**
 * 节奏琶音工坊数据完整性校验。
 * 与风格图鉴/乐器百科同一思路：维度取值必须来自词表、id 唯一、
 * 必备字段非空、网格/音序合法，保证筛选胶囊与试听引擎永不被脏数据击穿。
 */
describe('节奏琶音工坊数据完整性', () => {
  it('词条 id 全局唯一（两库合并后也不允许撞 id）', () => {
    const ids = [...ALL_RHYTHMS.map((r) => r.id), ...ALL_ARPS.map((a) => a.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('维度取值全部来自词表', () => {
    const genres = new Set<string>(DRUM_GENRES);
    const moods = new Set<string>(MOODS);
    const forms = new Set<string>(ARP_FORMS);
    for (const r of ALL_RHYTHMS) {
      expect(genres.has(r.genre), `${r.id} genre 越界`).toBe(true);
      for (const m of r.moods) expect(moods.has(m), `${r.id} mood 越界: ${m}`).toBe(true);
    }
    for (const a of ALL_ARPS) {
      expect(forms.has(a.form), `${a.id} form 越界`).toBe(true);
      for (const m of a.moods) expect(moods.has(m), `${a.id} mood 越界: ${m}`).toBe(true);
    }
  });

  it('鼓律动网格合法：16 步、步索引 0-15、升序去重、情绪 1-3 个', () => {
    for (const r of ALL_RHYTHMS) {
      expect(r.steps).toBe(16);
      expect(r.moods.length).toBeGreaterThanOrEqual(1);
      expect(r.moods.length).toBeLessThanOrEqual(3);
      expect(r.bpmRange[0]).toBeLessThan(r.bpmRange[1]);
      for (const track of [r.tracks.kick, r.tracks.snare, r.tracks.hat]) {
        expect(track.length, `${r.id} 空轨`).toBeGreaterThan(0);
        for (let i = 0; i < track.length; i++) {
          const s = track[i]!;
          expect(s, `${r.id} 步越界: ${s}`).toBeGreaterThanOrEqual(0);
          expect(s, `${r.id} 步越界: ${s}`).toBeLessThan(16);
          if (i > 0) expect(s, `${r.id} 步需升序去重`).toBeGreaterThan(track[i - 1]!);
        }
      }
      if (r.swing !== undefined) {
        expect(r.swing).toBeGreaterThan(0);
        expect(r.swing).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('琶音音序合法：长度 4/8/16（与鼓网格相位对齐）、索引 ≥ -1', () => {
    for (const a of ALL_ARPS) {
      expect([4, 8, 16], `${a.id} 音序长度`).toContain(a.notes.length);
      for (const n of a.notes) {
        expect(n, `${a.id} 非法音序值: ${n}`).toBeGreaterThanOrEqual(-1);
        expect(Number.isInteger(n), `${a.id} 音序需整数: ${n}`).toBe(true);
      }
      // 至少有一个发声音
      expect(
        a.notes.some((n) => n >= 0),
        `${a.id} 全休止`,
      ).toBe(true);
    }
  });

  it('必备字段非空且规模达标（20+ 律动 / 14+ 琶音 / 全流派覆盖）', () => {
    expect(ALL_RHYTHMS.length).toBeGreaterThanOrEqual(20);
    expect(ALL_ARPS.length).toBeGreaterThanOrEqual(14);
    expect(new Set(ALL_RHYTHMS.map((r) => r.genre)).size).toBe(DRUM_GENRES.length);
    for (const entry of [...ALL_RHYTHMS, ...ALL_ARPS]) {
      expect(entry.name.length, `${entry.id} name`).toBeGreaterThan(0);
      expect(entry.nameEn.length, `${entry.id} nameEn`).toBeGreaterThan(0);
      expect(entry.desc.length, `${entry.id} desc`).toBeGreaterThan(10);
      expect(entry.promptFragment.length, `${entry.id} promptFragment`).toBeGreaterThan(20);
      expect(entry.promptFragmentZh.length, `${entry.id} promptFragmentZh`).toBeGreaterThan(8);
    }
  });

  it('网格组合不重复（同 swing 下同三轨配置视为重复策展）', () => {
    const seen = new Set<string>();
    for (const r of ALL_RHYTHMS) {
      const key = [
        r.tracks.kick.join(','),
        r.tracks.snare.join(','),
        r.tracks.hat.join(','),
        r.swing ?? 0,
      ].join('|');
      expect(seen.has(key), `重复网格: ${r.id}`).toBe(false);
      seen.add(key);
    }
  });
});
