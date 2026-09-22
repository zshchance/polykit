import { describe, it, expect } from 'vitest';
import {
  keyFifths,
  keySigOf,
  spellInKey,
  spelledName,
  detectKey,
  pcOf,
  midiToFreq,
  stepRootPc,
  stepQuality,
  stepLabel,
  nearestVoicing,
  chordPcs,
  QUALITY_MAP,
} from './theory';

describe('调号（五度圈）', () => {
  it('C 大调无升降', () => {
    expect(keyFifths(0, 'major')).toBe(0);
    expect(keySigOf(0, 'major').sig.size).toBe(0);
  });

  it('G 大调一个升号（F♯），F 大调一个降号（B♭）', () => {
    expect(keyFifths(7, 'major')).toBe(1);
    expect(keySigOf(7, 'major').sig.get(5)).toBe(1);
    expect(keyFifths(5, 'major')).toBe(-1);
    expect(keySigOf(5, 'major').sig.get(11)).toBe(-1);
  });

  it('小调换算关系大调：a 小调无升降', () => {
    expect(keyFifths(9, 'minor')).toBe(0);
    // e 小调 = G 大调 1♯
    expect(keyFifths(4, 'minor')).toBe(1);
  });
});

describe('音高拼写', () => {
  it('C 大调：白键无临时记号，黑键用升号', () => {
    const sig = keySigOf(0, 'major');
    const c4 = spellInKey(60, sig);
    expect(spelledName(c4)).toBe('C');
    expect(c4.octave).toBe(4);
    expect(c4.step).toBe(28);
    expect(c4.acc).toBe(0);

    const cs4 = spellInKey(61, sig);
    expect(spelledName(cs4)).toBe('C♯');
    expect(cs4.step).toBe(28); // 与 C 同一线位，靠临时记号区分
  });

  it('G 大调：F♯ 是调内音不带临时记号；F 自然拼还原号', () => {
    const sig = keySigOf(7, 'major');
    const fs4 = spellInKey(66, sig);
    expect(fs4.acc).toBe(0);
    expect(spelledName(fs4)).toBe('F');
    // G 大调里的 F 自然 = 调号 F♯ 的还原 → F♮
    const fNat = spellInKey(65, sig);
    expect(fNat.acc).toBe(2);
    expect(spelledName(fNat)).toBe('F♮');
  });

  it('F 大调：B♭ 调内无记号；B 自然拼还原号', () => {
    const sig = keySigOf(5, 'major');
    const bb4 = spellInKey(70, sig);
    expect(bb4.acc).toBe(0);
    expect(spelledName(bb4)).toBe('B');
    const bNat = spellInKey(71, sig);
    expect(bNat.acc).toBe(2);
    expect(spelledName(bNat)).toBe('B♮');
  });

  it('降号调用 ♭ 拼写调外音', () => {
    const sig = keySigOf(10, 'major'); // 降B：B♭ E♭
    // F♯（pc 6）在降号调 → G♭
    const fs = spellInKey(66, sig);
    expect(fs.acc).toBe(-1);
    expect(spelledName(fs)).toBe('G♭');
  });

  it('八度边界：B 与 C 的跨八度', () => {
    const sig = keySigOf(0, 'major');
    expect(spellInKey(59, sig).octave).toBe(3); // B3
    expect(spellInKey(60, sig).octave).toBe(4); // C4
    expect(spellInKey(72, sig).step).toBe(35); // C5
  });
});

describe('判调', () => {
  it('全白键旋律 → C 大调', () => {
    const midis = [60, 62, 64, 65, 67, 69, 71, 72];
    expect(detectKey(midis)).toEqual({ keyPc: 0, tonality: 'major' });
  });

  it('含 F♯ 的 G 大调旋律 → G 大调', () => {
    const midis = [67, 69, 71, 72, 74, 76, 66, 67, 67, 66, 74];
    const k = detectKey(midis);
    expect(k.keyPc).toBe(7);
    expect(k.tonality).toBe('major');
  });
});

describe('走向与 voicing', () => {
  it('C 大调 1/4/5 级根音与性质', () => {
    expect(stepRootPc(0, 'major', { d: 1 })).toBe(0);
    expect(stepRootPc(0, 'major', { d: 4 })).toBe(5);
    expect(stepQuality('major', { d: 6 })).toBe('min');
    expect(stepLabel('major', { d: 6 })).toBe('vi');
    expect(stepLabel('major', { d: 7 })).toBe('vii°');
  });

  it('nearestVoicing 在音域内返回完整三和弦', () => {
    const v = nearestVoicing(0, QUALITY_MAP.get('maj')!.intervals, 64, 52, 76);
    expect(v.length).toBe(3);
    expect(v.map(pcOf).sort()).toEqual(chordPcs(0, 'maj'));
    expect(Math.min(...v)).toBeGreaterThanOrEqual(52 - 12);
    expect(Math.max(...v)).toBeLessThanOrEqual(76 + 12);
  });

  it('midiToFreq：A4=440', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(60)).toBeCloseTo(261.626, 2);
  });
});
