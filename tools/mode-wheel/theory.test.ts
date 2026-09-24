import { describe, it, expect } from 'vitest';
import {
  buildModeTable,
  decodeSteps,
  degreePrimaryNumeral,
  encodeSteps,
  fifthIndex,
  FIFTH_ORDER,
  midiToDegree,
  numeralFor,
  pcName,
  prefersFlat,
  progPreview,
  resolveStep,
  voiceChord,
} from './theory';
import { MODES, MODE_MAP, MODE_PROGS } from './data/modes';

const mode = (id: string) => MODE_MAP.get(id)!;

describe('五度圈映射', () => {
  it('位置与音高类互逆', () => {
    expect(FIFTH_ORDER).toHaveLength(12);
    for (let i = 0; i < 12; i++) expect(fifthIndex(FIFTH_ORDER[i]!)).toBe(i);
  });

  it('C 在顶部，G 顺时针下一站，F 逆时针上一站', () => {
    expect(fifthIndex(0)).toBe(0);
    expect(fifthIndex(7)).toBe(1);
    expect(fifthIndex(5)).toBe(11);
  });
});

describe('拼写', () => {
  it('升号/降号两套拼写', () => {
    expect(pcName(1)).toBe('C#');
    expect(pcName(1, true)).toBe('Db');
    expect(pcName(10, true)).toBe('Bb');
  });

  it('降号调判定', () => {
    expect(prefersFlat(5)).toBe(true); // F
    expect(prefersFlat(10)).toBe(true); // Bb
    expect(prefersFlat(0)).toBe(false); // C
    expect(prefersFlat(6)).toBe(true); // Gb/F#
  });
});

describe('罗马数字', () => {
  it('大小增减与临时记号', () => {
    expect(numeralFor('1', 'maj')).toBe('Ⅰ');
    expect(numeralFor('1', 'min')).toBe('ⅰ');
    expect(numeralFor('♯2', 'maj')).toBe('♯Ⅱ');
    expect(numeralFor('3', 'dim')).toBe('ⅲ°');
    expect(numeralFor('♭7', 'maj')).toBe('♭Ⅶ');
    expect(numeralFor('♭6', 'aug')).toBe('♭Ⅵ+');
    expect(numeralFor('♯4', 'dim')).toBe('♯ⅳ°');
  });
});

describe('C 大调（Ionian）和弦表', () => {
  it('Ⅰ ⅱ ⅲ Ⅳ Ⅴ ⅵ ⅶ°', () => {
    const table = buildModeTable(mode('ionian'), 0);
    expect(table.degrees.map(degreePrimaryNumeral)).toEqual(['Ⅰ', 'ⅱ', 'ⅲ', 'Ⅳ', 'Ⅴ', 'ⅵ', 'ⅶ°']);
    // 大调每级只有一个三和弦
    expect(table.degrees.every((d) => d.chords.length === 1)).toBe(true);
  });
});

describe('自然小调（Aeolian）和弦表', () => {
  it('ⅰ ⅱ° ♭Ⅲ ⅳ ⅴ ♭Ⅵ ♭Ⅶ', () => {
    const table = buildModeTable(mode('aeolian'), 0);
    expect(table.degrees.map(degreePrimaryNumeral)).toEqual([
      'ⅰ',
      'ⅱ°',
      '♭Ⅲ',
      'ⅳ',
      'ⅴ',
      '♭Ⅵ',
      '♭Ⅶ',
    ]);
  });
});

describe('Mixolydian ♯2 —— 复刻视频里的表', () => {
  const table = buildModeTable(mode('mixolydian-s2'), 0);

  it('主行：Ⅰ ♯Ⅱ ⅲ° Ⅳ – ⅵ –', () => {
    expect(table.degrees.map(degreePrimaryNumeral)).toEqual(['Ⅰ', '♯Ⅱ', 'ⅲ°', 'Ⅳ', '–', 'ⅵ', '–']);
  });

  it('Ⅰ 级大小并立（备用 ⅰ），ⅵ 级备用 ⅵ°', () => {
    const d1 = table.degrees[0]!;
    expect(d1.chords.map((c) => c.numeral)).toEqual(['Ⅰ', 'ⅰ']);
    const d6 = table.degrees[5]!;
    expect(d6.chords.map((c) => c.numeral)).toEqual(['ⅵ', 'ⅵ°']);
    // 其余级没有备用和弦
    expect(table.degrees.filter((d) => d.chords.length > 1).map((d) => d.label)).toEqual([
      '1',
      '6',
    ]);
  });

  it('♯Ⅱ 是大三和弦，组成音 D♯ G B♭（等音 E♭ 大三）', () => {
    const chord = table.degrees[1]!.chords[0]!;
    expect(chord.quality).toBe('maj');
    expect(chord.pcs).toEqual([3, 7, 10]);
  });

  it('共同音：ⅲ°、ⅵ 离主和弦近（2 个），♯Ⅱ、Ⅳ 远（1 个）', () => {
    expect(table.degrees[0]!.chords[0]!.common).toBe(3); // Ⅰ
    expect(table.degrees[1]!.chords[0]!.common).toBe(1); // ♯Ⅱ
    expect(table.degrees[2]!.chords[0]!.common).toBe(2); // ⅲ°
    expect(table.degrees[3]!.chords[0]!.common).toBe(1); // Ⅳ
    expect(table.degrees[5]!.chords[0]!.common).toBe(2); // ⅵ
  });

  it('备用和弦解析与进行预览', () => {
    const progs = MODE_PROGS['mixolydian-s2']!;
    expect(progPreview(table, progs[0]!)).toBe('Ⅰ → ♯Ⅱ → Ⅳ → Ⅰ');
    expect(progPreview(table, progs[1]!)).toBe('Ⅰ → ⅰ → ♯Ⅱ → Ⅳ');
    const alt = resolveStep(table, { d: 0, alt: true })!;
    expect(alt.numeral).toBe('ⅰ');
    expect(alt.pcs).toEqual([0, 3, 7]);
  });
});

describe('换调平移', () => {
  it('G Mixolydian ♯2 的音集合与级数根音正确', () => {
    const table = buildModeTable(mode('mixolydian-s2'), 7);
    expect(table.pcSet).toEqual([7, 10, 11, 0, 2, 4, 5]); // G Bb B C D E F
    expect(table.degrees[1]!.rootPc).toBe(10); // ♯2 = Bb
    expect(table.degrees[1]!.chords[0]!.quality).toBe('maj'); // ♯Ⅱ 仍为大三
    expect(table.degrees.map(degreePrimaryNumeral)).toEqual(['Ⅰ', '♯Ⅱ', 'ⅲ°', 'Ⅳ', '–', 'ⅵ', '–']);
  });
});

describe('曲库数据完整性', () => {
  it('每个调式都有招牌进行，且每一步都能解析出和弦', () => {
    for (const m of MODES) {
      const progs = MODE_PROGS[m.id];
      expect(progs, `${m.id} 缺少进行`).toBeTruthy();
      expect(progs!.length).toBeGreaterThanOrEqual(2);
      const table = buildModeTable(m, 0);
      for (const prog of progs!) {
        for (const step of prog.steps) {
          expect(
            resolveStep(table, step),
            `${m.id}/${prog.id} 步 ${JSON.stringify(step)}`,
          ).not.toBeNull();
        }
      }
    }
  });

  it('度数标签与音程表长度一致，特征音下标合法', () => {
    for (const m of MODES) {
      expect(m.degreeLabels).toHaveLength(m.offsets.length);
      expect(m.signature).toBeGreaterThanOrEqual(-1);
      expect(m.signature).toBeLessThan(m.offsets.length);
    }
  });
});

describe('voicing', () => {
  const table = buildModeTable(mode('ionian'), 0);

  it('返回低音 + 三音和弦，音区合理', () => {
    const v = voiceChord(table.degrees[0]!.chords[0]!, 'low', null);
    expect(v.tones).toHaveLength(3);
    expect(v.bass).toBeLessThan(v.tones[0]!);
    const avg = v.tones.reduce((a, b) => a + b, 0) / 3;
    expect(avg).toBeGreaterThanOrEqual(44);
    expect(avg).toBeLessThanOrEqual(78);
  });

  it('声部连接：Ⅰ→Ⅳ 选共同音保持的最近转位', () => {
    const v1 = voiceChord(table.degrees[0]!.chords[0]!, 'low', null);
    const v2 = voiceChord(table.degrees[3]!.chords[0]!, 'low', v1.tones);
    const movement = v2.tones.reduce((acc, t, i) => acc + Math.abs(t - v1.tones[i]!), 0);
    // C E G → C F A 最近连接总位移应为 2（E→F 半音 + G→A 全音）
    expect(movement).toBeLessThanOrEqual(4);
    // 音高类正确
    expect(v2.tones.map((t) => ((t % 12) + 12) % 12).sort((a, b) => a - b)).toEqual([0, 5, 9]);
  });

  it('高音区整体高于低音区', () => {
    const lo = voiceChord(table.degrees[0]!.chords[0]!, 'low', null);
    const hi = voiceChord(table.degrees[0]!.chords[0]!, 'high', null);
    expect(hi.tones[0]!).toBeGreaterThan(lo.tones[0]!);
    expect(hi.bass).toBeGreaterThan(lo.bass);
  });
});

describe('分享编码', () => {
  it('编码/解码往返一致', () => {
    const steps = [{ d: 0 }, { d: 1 }, { d: 0, alt: true }, { d: 3 }];
    expect(encodeSteps(steps)).toBe('0.1.0a.3');
    expect(decodeSteps('0.1.0a.3')).toEqual(steps);
  });

  it('单步与备用标记', () => {
    expect(decodeSteps('5')).toEqual([{ d: 5, alt: undefined }]);
    expect(decodeSteps('2a')).toEqual([{ d: 2, alt: true }]);
  });

  it('非法输入返回 null', () => {
    expect(decodeSteps('')).toBeNull();
    expect(decodeSteps('7.1')).toBeNull(); // 级下标越界
    expect(decodeSteps('0..1')).toBeNull();
    expect(decodeSteps('abc')).toBeNull();
    expect(decodeSteps('0.1b')).toBeNull();
  });
});

describe('MIDI 吸附（midiToDegree）', () => {
  const mxs2 = mode('mixolydian-s2'); // offsets [0,3,4,5,7,9,10]

  it('调内音精确命中，八度以 C4 区段为 0', () => {
    expect(midiToDegree(mxs2, 0, 60)).toEqual({ deg: 0, octave: 0 }); // C4
    expect(midiToDegree(mxs2, 0, 63)).toEqual({ deg: 1, octave: 0 }); // D#4 = ♯2
    expect(midiToDegree(mxs2, 0, 48)).toEqual({ deg: 0, octave: -1 }); // C3
    expect(midiToDegree(mxs2, 0, 72)).toEqual({ deg: 0, octave: 1 }); // C5
  });

  it('调外音吸附到最近度数', () => {
    // D4（pc 2）距 0 两个半音、距 3 一个半音 → 吸到 ♯2（deg 1）
    expect(midiToDegree(mxs2, 0, 62)).toEqual({ deg: 1, octave: 0 });
  });

  it('超出旋律范围的音高钳制八度', () => {
    expect(midiToDegree(mxs2, 0, 84)).toEqual({ deg: 0, octave: 1 }); // C6 → 钳到 +1
    expect(midiToDegree(mxs2, 0, 24)).toEqual({ deg: 0, octave: -1 }); // C1 → 钳到 -1
  });

  it('换调后按新主音重算', () => {
    expect(midiToDegree(mxs2, 9, 69)).toEqual({ deg: 0, octave: 0 }); // A4 in A
    expect(midiToDegree(mxs2, 9, 60)).toEqual({ deg: 1, octave: -1 }); // C4 → 吸到 C#（deg 1）低八度
  });

  it('非法音高返回 null', () => {
    expect(midiToDegree(mxs2, 0, -1)).toBeNull();
    expect(midiToDegree(mxs2, 0, 128)).toBeNull();
    expect(midiToDegree(mxs2, 0, 60.5)).toBeNull();
  });
});
