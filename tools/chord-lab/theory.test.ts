import { describe, it, expect } from 'vitest';
import {
  CHORD_QUALITIES,
  chordPcs,
  chordName,
  exactChord,
  completionHints,
  bestCompletion,
  extractRootPc,
  nearestVoicing,
  stepRootPc,
  stepQuality,
  stepLabel,
  stepChordName,
  pcSetOf,
  ProgressionTracker,
  type ChordQualityId,
} from './theory';
import { PROGRESSIONS } from './data/progressions';
import { PALETTE } from './settings';

const TRIADS: ChordQualityId[] = ['maj', 'min', 'aug', 'dim'];
const ALL_Q: ChordQualityId[] = CHORD_QUALITIES.map((q) => q.id);

// ───────────── 和弦结构 ─────────────

describe('chordPcs / chordName', () => {
  it('三和弦与扩展和弦的音高类', () => {
    expect(chordPcs(0, 'maj')).toEqual([0, 4, 7]);
    expect(chordPcs(0, 'min')).toEqual([0, 3, 7]);
    expect(chordPcs(9, 'min')).toEqual([0, 4, 9]); // Am = A C E
    expect(chordPcs(0, 'add9')).toEqual([0, 2, 4, 7]); // 14 折叠回 2
  });

  it('和弦显示名', () => {
    expect(chordName(0, 'maj')).toBe('C');
    expect(chordName(9, 'min')).toBe('Am');
    expect(chordName(7, '7')).toBe('G7');
  });
});

describe('exactChord', () => {
  it('原位与转位识别（根音命名不受转位影响）', () => {
    expect(exactChord([0, 4, 7], 0, TRIADS)).toEqual({ rootPc: 0, quality: 'maj', inversion: 0 });
    // E G C：最低音是三音 → C 大三第一转位
    expect(exactChord([0, 4, 7], 4, TRIADS)).toEqual({ rootPc: 0, quality: 'maj', inversion: 1 });
    // G C E：最低音是五音 → 第二转位
    expect(exactChord([0, 4, 7], 7, TRIADS)).toEqual({ rootPc: 0, quality: 'maj', inversion: 2 });
  });

  it('小三 / 增 / 减 / 七和弦', () => {
    expect(exactChord([0, 3, 7], 0, TRIADS)?.quality).toBe('min');
    expect(exactChord([0, 4, 8], 0, TRIADS)?.quality).toBe('aug');
    expect(exactChord([0, 3, 6], 0, TRIADS)?.quality).toBe('dim');
    expect(exactChord([0, 4, 7, 10], 0, ALL_Q)?.quality).toBe('7');
  });

  it('增三和弦多根等价时优先最低音命名', () => {
    // C-E-G# 从 E 开始弹 → E aug（G#aug 与 Caug 同音集合，最低音优先）
    expect(exactChord([0, 4, 8], 4, TRIADS)).toEqual({ rootPc: 4, quality: 'aug', inversion: 0 });
  });

  it('单音与不协和音簇不识别', () => {
    expect(exactChord([0], 0, TRIADS)).toBeNull();
    expect(exactChord([0, 1, 2], 0, TRIADS)).toBeNull();
  });
});

describe('completionHints', () => {
  it('单音 C：大三给出 E/G，小三给出 ♭E（G 被高优先级占位）', () => {
    const { satisfiable, hints } = completionHints([0], ['maj', 'min']);
    expect(satisfiable).toEqual(['maj', 'min']);
    expect(hints.get(4)).toBe('maj');
    expect(hints.get(7)).toBe('maj');
    expect(hints.get(3)).toBe('min');
    expect(hints.size).toBe(3);
  });

  it('C+♭E 组不成大三（根音限按下的音），只能成小三 → 提示 G', () => {
    const { satisfiable, hints } = completionHints([0, 3], ['maj', 'min']);
    expect(satisfiable).toEqual(['min']);
    expect(hints.get(7)).toBe('min');
    expect(hints.size).toBe(1);
  });

  it('C+E 小三不满足（Am 的根音 A 没按下）', () => {
    const { satisfiable } = completionHints([0, 4], ['maj', 'min']);
    expect(satisfiable).toEqual(['maj']);
  });

  it('完整和弦仍可提示扩展音（C 大三 → ♭B 成 C7）', () => {
    const { satisfiable, hints } = completionHints([0, 4, 7], ['maj', '7']);
    expect(satisfiable).toEqual(['maj', '7']);
    expect(hints.get(10)).toBe('7');
  });
});

describe('bestCompletion', () => {
  it('单音指向最近目标：C → 再按 E、G 成大三', () => {
    const best = bestCompletion([0], 0, TRIADS);
    expect(best).toEqual({ rootPc: 0, quality: 'maj', missing: [4, 7] });
  });

  it('已精确成和弦的不算补全目标（交给 exactChord）', () => {
    // C+♭E+♭G 已是完整减三和弦，bestCompletion 返回 null
    expect(bestCompletion([0, 3, 6], 0, TRIADS)).toBeNull();
  });

  it('无解返回 null', () => {
    expect(bestCompletion([0, 1, 2], 0, TRIADS)).toBeNull();
  });
});

// ───────────── 级数与调 ─────────────

describe('stepRootPc / stepLabel / stepChordName', () => {
  it('C 大调各级根音', () => {
    const pcs = [1, 2, 3, 4, 5, 6, 7].map((d) => stepRootPc(0, 'major', { d }));
    expect(pcs).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it('a 小调（keyPc=9 minor）各级根音', () => {
    const pcs = [1, 2, 3, 4, 5, 6, 7].map((d) => stepRootPc(9, 'minor', { d }));
    expect(pcs).toEqual([9, 11, 0, 2, 4, 5, 7]);
  });

  it('罗马数字标签大小写与临时记号', () => {
    expect(stepLabel('major', { d: 1 })).toBe('I');
    expect(stepLabel('major', { d: 6 })).toBe('vi');
    expect(stepLabel('major', { d: 7 })).toBe('vii°');
    expect(stepLabel('major', { d: 6, acc: -1, q: 'maj' })).toBe('♭VI');
    expect(stepLabel('minor', { d: 3 })).toBe('III');
  });

  it('级数和弦名与性质', () => {
    expect(stepChordName(0, 'major', { d: 6 })).toBe('Am');
    expect(stepQuality('major', { d: 5 })).toBe('maj');
    expect(stepQuality('minor', { d: 3 })).toBe('maj');
    expect(stepQuality('minor', { d: 5, q: 'maj' })).toBe('maj'); // 覆盖
  });
});

// ───────────── 走向追踪器 ─────────────

describe('ProgressionTracker', () => {
  // C 大调：p-1564 = C G Am F，p-6415 = Am F C G
  const p1564 = PROGRESSIONS.find((p) => p.id === 'p-1564')!;
  const p6415 = PROGRESSIONS.find((p) => p.id === 'p-6415')!;

  it('并行匹配、按优先级排列、走完后循环', () => {
    const t = new ProgressionTracker([p1564, p6415], 0, 'major');
    t.feed(0); // C：1564 激活
    expect(t.actives().map((r) => [r.prog.id, r.pos])).toEqual([['p-1564', 1]]);
    t.feed(7); // G
    t.feed(9); // Am：1564 进第三步，6415 从首级激活
    expect(t.actives().map((r) => [r.prog.id, r.pos])).toEqual([
      ['p-1564', 3],
      ['p-6415', 1],
    ]);
    t.feed(5); // F：两条同时推进
    expect(t.actives().map((r) => [r.prog.id, r.pos])).toEqual([
      ['p-1564', 4],
      ['p-6415', 2],
    ]);
    t.feed(0); // C：1564 走完一轮命中首级 = 循环重启；6415 推进到第三步
    expect(t.actives().map((r) => [r.prog.id, r.pos])).toEqual([
      ['p-1564', 1],
      ['p-6415', 3],
    ]);
  });

  it('弹错级安静退场；再命中首级可重新激活', () => {
    const t = new ProgressionTracker([p1564], 0, 'major');
    t.feed(0);
    t.feed(7);
    t.feed(3); // Em 不在走向里 → 失败退场
    expect(t.actives()).toEqual([]);
    t.feed(0); // 重新从首级激活
    expect(t.actives().map((r) => r.pos)).toEqual([1]);
  });

  it('重复同一级原地不动（不算失败）', () => {
    const t = new ProgressionTracker([p1564], 0, 'major');
    t.feed(0);
    t.feed(0);
    t.feed(0);
    expect(t.actives()[0]!.pos).toBe(1);
    t.feed(7);
    expect(t.actives()[0]!.pos).toBe(2);
  });

  it('高优先级匹配失败退场后，次优先级继续', () => {
    // 用户场景：先按 C Am F…… 1564（C 开头）在第二步 G 处失败，
    // 但 6415（Am 开头）还活着，界面应只剩 6415
    const t = new ProgressionTracker([p1564, p6415], 0, 'major');
    t.feed(9); // Am：6415 激活（1564 首级是 C，不动）
    t.feed(5); // F
    t.feed(0); // C：6415 第三步；1564 此刻才从首级激活
    const actives = t.actives();
    expect(actives[0]!.prog.id).toBe('p-1564'); // 卡片优先级仍在前
    expect(actives[1]!.prog.id).toBe('p-6415');
    t.feed(2); // D：1564 失败退场；6415 也失败（期待 G）
    expect(t.actives()).toEqual([]);
  });
});

// ───────────── 声部连接 ─────────────

describe('nearestVoicing', () => {
  it('C 大三围绕 C4：音对、贴中心、在窗口内', () => {
    const v = nearestVoicing(0, [0, 4, 7], 60, 48, 72);
    expect(v.map((m) => m % 12).sort((a, b) => a - b)).toEqual([0, 4, 7]);
    expect(v.every((m) => m >= 48 && m <= 72)).toBe(true);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    expect(Math.abs(mean - 60)).toBeLessThanOrEqual(6);
  });

  it('声部连接：C → F 应选最近的 F/A/C（上行的 53/57/60 或下行解）', () => {
    const v = nearestVoicing(5, [0, 4, 7], 64, 48, 72);
    expect(v.map((m) => m % 12).sort((a, b) => a - b)).toEqual([0, 5, 9]);
    // 围绕 E4(64) 最近的 F 大三 voicing 是 F3 太高/太低之间的中音区解
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    expect(Math.abs(mean - 64)).toBeLessThanOrEqual(6);
  });

  it('窗口边缘不越界（在可选时）', () => {
    const v = nearestVoicing(11, [0, 3, 6], 70, 48, 72);
    expect(v.every((m) => m >= 48 && m <= 72)).toBe(true);
  });

  it('转位候选的乱序不参与音域打分（Am 贴 C4 应选根位 57/60/64）', () => {
    expect(nearestVoicing(9, [0, 3, 7], 61, 48, 72)).toEqual([57, 60, 64]);
  });
});

describe('extractRootPc', () => {
  it('单音即根音；成和弦取和弦根音；杂音取最低音', () => {
    expect(extractRootPc([61], TRIADS)).toBe(1);
    expect(extractRootPc([64, 67, 72], TRIADS)).toBe(0); // C/E 仍是 C
    expect(extractRootPc([61, 63], TRIADS)).toBe(1);
    expect(extractRootPc([], TRIADS)).toBeNull();
  });
});

// ───────────── 策展数据完整性 ─────────────

describe('策展数据', () => {
  it('走向 id 唯一、级数合法、颜色索引在调色板内', () => {
    const ids = new Set<string>();
    for (const p of PROGRESSIONS) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(p.steps.length).toBeGreaterThanOrEqual(2);
      for (const st of p.steps) {
        expect(st.d).toBeGreaterThanOrEqual(1);
        expect(st.d).toBeLessThanOrEqual(7);
        if (st.acc !== undefined) expect([-1, 0, 1]).toContain(st.acc);
      }
      expect(p.defaultColor).toBeGreaterThanOrEqual(0);
      expect(p.defaultColor).toBeLessThan(PALETTE.length);
    }
  });

  it('和弦性质 id 唯一、音程从 0 开始升序', () => {
    const ids = new Set<string>();
    for (const q of CHORD_QUALITIES) {
      expect(ids.has(q.id)).toBe(false);
      ids.add(q.id);
      expect(q.intervals[0]).toBe(0);
      for (let i = 1; i < q.intervals.length; i++) {
        expect(q.intervals[i]!).toBeGreaterThan(q.intervals[i - 1]!);
      }
      expect(q.defaultColor).toBeLessThan(PALETTE.length);
    }
  });

  it('pcSetOf 折叠八度', () => {
    expect(pcSetOf([60, 64, 72, 79])).toEqual([0, 4, 7]);
  });
});
