import { describe, it, expect } from 'vitest';
import { BUILTIN_SONGS } from './songs';
import { isGrand, scoreRange } from '../score';

/**
 * 曲库完整性与规模：
 * 三个阶段各 150 首上下，按 1/2/3 难度分级且每级 ≥ 50；
 * 双手曲（大谱表）在进阶/挑战里占足量；全部谱面音域在 88 键钢琴内。
 */
describe('内置曲库规模与分级', () => {
  it('三个阶段曲目都 ≥ 150，且每个难度级 ≥ 50', () => {
    for (const stage of ['read', 'chord', 'arp'] as const) {
      const list = BUILTIN_SONGS[stage];
      expect(list.length).toBeGreaterThanOrEqual(150);
      for (const lv of [1, 2, 3] as const) {
        const n = list.filter((s) => s.score.level === lv).length;
        expect(n, `${stage} L${lv}`).toBeGreaterThanOrEqual(50);
      }
      for (const s of list) {
        expect(s.score.events.length).toBeGreaterThan(0);
        expect(s.score.stage).toBe(stage);
        expect(s.tip.length).toBeGreaterThan(4);
      }
    }
  });

  it('曲目 id 全局唯一', () => {
    const ids = new Set<string>();
    for (const stage of ['read', 'chord', 'arp'] as const) {
      for (const s of BUILTIN_SONGS[stage]) {
        expect(ids.has(s.score.id), `重复 id ${s.score.id}`).toBe(false);
        ids.add(s.score.id);
      }
    }
  });

  it('所有曲目的音域在钢琴键域内（36–96）', () => {
    for (const stage of ['read', 'chord', 'arp'] as const) {
      for (const s of BUILTIN_SONGS[stage]) {
        const r = scoreRange(s.score)!;
        expect(r.lo, s.score.id).toBeGreaterThanOrEqual(36);
        expect(r.hi, s.score.id).toBeLessThanOrEqual(96);
      }
    }
  });
});

describe('识谱曲库内容结构', () => {
  it('单手曲能装进一个 32 键窗口（跨度 ≤ 31）', () => {
    for (const s of BUILTIN_SONGS.read) {
      if (isGrand(s.score)) continue;
      const r = scoreRange(s.score)!;
      expect(r.hi - r.lo, s.score.id).toBeLessThanOrEqual(31);
    }
  });

  it('双手曲（大谱表）足量且只在进阶/挑战出现', () => {
    const grand = BUILTIN_SONGS.read.filter((s) => isGrand(s.score));
    expect(grand.length).toBeGreaterThanOrEqual(40);
    for (const s of grand) {
      expect(s.score.level).toBeGreaterThanOrEqual(2);
      // 双手曲左手真的在低音区
      const bassNotes = s.score.events.flatMap((e) => e.bassMidis);
      expect(bassNotes.length).toBeGreaterThan(0);
      expect(Math.min(...bassNotes)).toBeLessThanOrEqual(55);
    }
  });

  it('覆盖 C/G/F/D/降B 等五个以上的调性组，含小调曲目', () => {
    const oneHand = BUILTIN_SONGS.read.filter((s) => !isGrand(s.score) && !s.score.id.startsWith('et-'));
    const majors = new Set(oneHand.filter((s) => s.score.tonality === 'major').map((s) => s.score.keyPc));
    expect(majors.size).toBeGreaterThanOrEqual(5);
    const minors = oneHand.filter((s) => s.score.tonality === 'minor');
    expect(minors.length).toBeGreaterThanOrEqual(4);
  });

  it('练习曲是确定性的（两次构建完全一致）', async () => {
    const { buildEtudes } = await import('./etudes');
    const a = buildEtudes();
    const b = buildEtudes();
    expect(a.length).toBe(b.length);
    expect(JSON.stringify(a[13]!.events)).toBe(JSON.stringify(b[13]!.events));
  });
});

describe('和弦 / 琶音曲库', () => {
  it('曲目带和弦标签与贝斯根音', () => {
    for (const s of [...BUILTIN_SONGS.chord, ...BUILTIN_SONGS.arp]) {
      const labeled = s.score.events.filter((e) => e.label);
      expect(labeled.length).toBeGreaterThan(0);
      expect(labeled.every((e) => e.bassPc !== undefined)).toBe(true);
    }
  });

  it('和弦库覆盖 10 个调 × 15 条走向', () => {
    expect(BUILTIN_SONGS.chord.length).toBe(150);
    const keys = new Set(BUILTIN_SONGS.chord.map((s) => `${s.score.keyPc}-${s.score.tonality}`));
    expect(keys.size).toBeGreaterThanOrEqual(15); // 10 大调 + 若干小调
  });

  it('琶音库含十六分音符的挑战曲目', () => {
    const run16 = BUILTIN_SONGS.arp.filter((s) =>
      s.score.events.some((e) => e.dur <= 0.25),
    );
    expect(run16.length).toBeGreaterThanOrEqual(20);
  });
});
