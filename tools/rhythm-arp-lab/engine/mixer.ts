import type { ArpPattern, RhythmPattern } from '../types';
import { chordTones, type ChordQuality } from './harmony';
import type { DrumSynth } from './synth';

/**
 * 混合器 —— 调度器每步回调这里，决定鼓轨与琶音轨在此步发什么声。
 *
 * 两种混合模式：
 *   layer（双层叠加）：鼓照常走，琶音按自身细分（8/16 分）均匀流动；
 *   fuse（融合音型）：鼓照常走，琶音"贴着鼓点走"——只在底鼓∪军鼓的
 *     骨架时刻发声，时值自动延伸到下一个骨架点。
 *
 * 状态由 UI 侧持有并随时改写（MixerState 是引用共享），
 * 因此换和弦、换模式、改 BPM 都会在下一步立即生效。
 */
export type MixMode = 'layer' | 'fuse';

export interface MixerState {
  rhythm: RhythmPattern | null;
  arp: ArpPattern | null;
  mixMode: MixMode;
  /** 当前和弦（和弦垫最近一次触发）；null 时琶音静默 */
  chord: { rootMidi: number; quality: ChordQuality } | null;
  /** 与调度器保持同步的 BPM（时值计算用） */
  bpm: number;
  drumsMuted: boolean;
  arpMuted: boolean;
}

/** 融合模式的触发骨架：底鼓∪军鼓的触发步（升序去重）；无节奏型时退化为四正拍 */
export function fuseSkeleton(rhythm: RhythmPattern | null): number[] {
  if (!rhythm) return [0, 4, 8, 12];
  const set = new Set([...rhythm.tracks.kick, ...rhythm.tracks.snare]);
  return [...set].sort((a, b) => a - b);
}

const STEPS_PER_BAR = 16;

export class Mixer {
  private readonly synth: DrumSynth;
  private readonly state: MixerState;
  /** 琶音音序游标：跨步、跨小节持续推进，换和弦不打断相位 */
  private arpCursor = 0;

  constructor(synth: DrumSynth, state: MixerState) {
    this.synth = synth;
    this.state = state;
  }

  /** 换琶音模式后调用，让音序从头开始 */
  resetArpCursor(): void {
    this.arpCursor = 0;
  }

  onStep(step: number, time: number): void {
    const s = this.state;

    if (s.rhythm && !s.drumsMuted) {
      const { kick, snare, hat } = s.rhythm.tracks;
      if (kick.includes(step)) this.synth.kick(time, step % 4 === 0 ? 1 : 0.85);
      if (snare.includes(step)) this.synth.snare(time, 0.9);
      if (hat.includes(step)) this.synth.hat(time, step % 2 === 0 ? 0.75 : 0.5);
    }

    if (!s.arp || !s.chord || s.arpMuted) return;
    const tones = chordTones(s.chord.rootMidi, s.chord.quality, s.arp.octaves);

    if (s.mixMode === 'layer') {
      const every = s.arp.subdivision === 16 ? 1 : 2;
      if (step % every !== 0) return;
      // 16 分音短促、8 分音舒展，各占自身时值的约九成
      const dur = this.stepDurSeconds() * (s.arp.subdivision === 16 ? 0.9 : 1.8);
      this.triggerArpNote(time, tones, dur);
    } else {
      const skeleton = fuseSkeleton(s.rhythm);
      const pos = skeleton.indexOf(step);
      if (pos === -1) return;
      // 时值延伸到骨架上的下一个触发点（末尾环绕回小节头）
      const next = skeleton[(pos + 1) % skeleton.length]!;
      const gap = next > step ? next - step : STEPS_PER_BAR - step + next;
      this.triggerArpNote(time, tones, gap * this.stepDurSeconds() * 0.9);
    }
  }

  private stepDurSeconds(): number {
    return 60 / this.state.bpm / 4;
  }

  private triggerArpNote(time: number, tones: number[], dur: number): void {
    const arp = this.state.arp!;
    const idx = arp.notes[this.arpCursor % arp.notes.length]!;
    this.arpCursor++;
    if (idx < 0) return; // 休止符同样消耗音序位置
    const midi = tones[idx % tones.length]!;
    this.synth.pluck(time, midi, 0.9, dur);
  }
}
