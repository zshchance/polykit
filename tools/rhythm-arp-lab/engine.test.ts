import { describe, it, expect } from 'vitest';
import {
  chordTones,
  diatonicPads,
  chordName,
  midiToFreq,
  padRootMidi,
  ROOT_NAMES,
} from './engine/harmony';
import { fuseSkeleton } from './engine/mixer';
import { buildPromptEn, buildPromptZh, pickMoods } from './prompt';
import { ALL_RHYTHMS, ALL_ARPS } from './data';

/** 引擎纯函数测试：和声计算、融合骨架、提示词拼装（Web Audio 部分不在单测范围） */
describe('和声引擎', () => {
  it('chordTones：三和弦/七和弦/双八度音列', () => {
    expect(chordTones(60, 'maj', 1)).toEqual([60, 64, 67]);
    expect(chordTones(60, 'min', 1)).toEqual([60, 63, 67]);
    expect(chordTones(60, '7', 1)).toEqual([60, 64, 67, 70]);
    expect(chordTones(60, 'maj', 2)).toEqual([60, 64, 67, 72, 76, 79]);
    expect(chordTones(48, 'add9', 1)).toEqual([48, 52, 55, 62]);
  });

  it('midiToFreq：A4=440 标准音', () => {
    expect(midiToFreq(69)).toBeCloseTo(440);
    expect(midiToFreq(60)).toBeCloseTo(261.63, 1);
  });

  it('diatonicPads：C 大调 8 垫与 A 小调 8 垫', () => {
    const cMajor = diatonicPads(0, 'major');
    expect(cMajor.map((p) => chordName(p.rootPc, p.quality))).toEqual([
      'C',
      'Dm',
      'Em',
      'F',
      'G',
      'Am',
      'G7',
      'Cadd9',
    ]);
    const aMinor = diatonicPads(9, 'minor');
    expect(aMinor.map((p) => chordName(p.rootPc, p.quality))).toEqual([
      'Am',
      'C',
      'Dm',
      'Em',
      'E',
      'F',
      'G',
      'Am7',
    ]);
    // 所有垫的根音都在 0-11 内
    for (const p of [...cMajor, ...aMinor]) {
      expect(p.rootPc).toBeGreaterThanOrEqual(0);
      expect(p.rootPc).toBeLessThan(12);
    }
  });

  it('padRootMidi 落在 C3-B3 音区', () => {
    expect(padRootMidi(0)).toBe(48);
    expect(padRootMidi(11)).toBe(59);
  });

  it('ROOT_NAMES 覆盖 12 个半音', () => {
    expect(ROOT_NAMES).toHaveLength(12);
  });
});

describe('融合骨架', () => {
  it('底鼓∪军鼓升序去重', () => {
    const four = ALL_RHYTHMS.find((r) => r.id === 'four-on-floor')!;
    expect(fuseSkeleton(four)).toEqual([0, 4, 8, 12]);
    const boomBap = ALL_RHYTHMS.find((r) => r.id === 'boom-bap')!;
    expect(fuseSkeleton(boomBap)).toEqual([0, 4, 7, 10, 12]);
  });

  it('无节奏型时退化为四正拍', () => {
    expect(fuseSkeleton(null)).toEqual([0, 4, 8, 12]);
  });
});

describe('提示词拼装', () => {
  const rhythm = ALL_RHYTHMS.find((r) => r.id === 'four-on-floor')!;
  const arp = ALL_ARPS.find((a) => a.id === 'rise-run')!;

  it('pickMoods：有交集取交集，无交集各取其一', () => {
    // four-on-floor [律动,欢快] × rise-run [欢快,史诗] → 交集「欢快」
    expect(pickMoods(rhythm, arp)).toEqual(['欢快']);
    const lofi = ALL_RHYTHMS.find((r) => r.id === 'lofi-dust')!; // [慵懒,温暖]
    expect(pickMoods(lofi, arp)).toEqual(['慵懒', '欢快']);
  });

  it('英文提示词：包含情绪/流派/调性/BPM/双片段/混合方式', () => {
    const en = buildPromptEn({
      rhythm,
      arp,
      mixMode: 'layer',
      bpm: 123,
      keyPc: 0,
      tonality: 'major',
    });
    expect(en).toContain('uplifting');
    expect(en).toContain('electronic');
    expect(en).toContain('C major');
    expect(en).toContain('123 BPM');
    expect(en).toContain(rhythm.promptFragment);
    expect(en).toContain(arp.promptFragment);
    expect(en).toContain('woven steadily across the groove');
  });

  it('中文提示词：融合模式语义切换', () => {
    const zh = buildPromptZh({
      rhythm,
      arp,
      mixMode: 'fuse',
      bpm: 123,
      keyPc: 9,
      tonality: 'minor',
    });
    expect(zh).toContain('欢快');
    expect(zh).toContain('电子');
    expect(zh).toContain('A小调');
    expect(zh).toContain('123 BPM');
    expect(zh).toContain(rhythm.promptFragmentZh);
    expect(zh).toContain(arp.promptFragmentZh);
    expect(zh).toContain('紧贴底鼓与军鼓的重拍迸发');
  });
});
