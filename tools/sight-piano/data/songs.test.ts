import { describe, it, expect } from 'vitest';
import { BUILTIN_SONGS } from './songs';
import { scoreRange } from '../score';

/**
 * 曲库完整性：所有内置谱面可构建、音域在 32 键窗口可达范围内、
 * 和弦/琶音谱面带标签，识谱曲库按调性分组爬坡。
 */
describe('内置曲库', () => {
  it('三个阶段都有曲子，且事件非空', () => {
    for (const stage of ['read', 'chord', 'arp'] as const) {
      expect(BUILTIN_SONGS[stage].length).toBeGreaterThanOrEqual(5);
      for (const s of BUILTIN_SONGS[stage]) {
        expect(s.score.events.length).toBeGreaterThan(0);
        expect(s.score.stage).toBe(stage);
        expect(s.tip.length).toBeGreaterThan(4);
      }
    }
  });

  it('所有曲目的音域不超过 32 键窗口可达范围（C2–C6）', () => {
    for (const stage of ['read', 'chord', 'arp'] as const) {
      for (const s of BUILTIN_SONGS[stage]) {
        const r = scoreRange(s.score)!;
        expect(r.lo).toBeGreaterThanOrEqual(36);
        expect(r.hi).toBeLessThanOrEqual(84);
      }
    }
  });

  it('识谱曲库覆盖 C/G/F/D/降B 五个调性组', () => {
    const groups = new Set(BUILTIN_SONGS.read.map((s) => s.score.group));
    expect(groups.size).toBe(5);
  });

  it('和弦 / 琶音曲目带和弦标签与贝斯根音', () => {
    for (const s of [...BUILTIN_SONGS.chord, ...BUILTIN_SONGS.arp]) {
      const labeled = s.score.events.filter((e) => e.label);
      expect(labeled.length).toBeGreaterThan(0);
      expect(labeled.every((e) => e.bassPc !== undefined)).toBe(true);
    }
  });

  it('识谱曲目键域友好：多数音符集中在中央 C 附近', () => {
    for (const s of BUILTIN_SONGS.read) {
      const r = scoreRange(s.score)!;
      expect(r.hi - r.lo).toBeLessThanOrEqual(24); // 两个八度内
    }
  });
});
