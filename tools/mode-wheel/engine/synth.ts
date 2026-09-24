import { midiToFreq } from '../theory';

/**
 * 调式罗盘 —— 和弦合成器。
 *
 * 与 chord-lab 的 PianoSynth 同源（三角波基音 + 正弦八度 + 微量锯齿、
 * 低通随包络收拢），但语义不同：琴房是"按下/松开"的持续音，这里是
 * "敲击一次、到时自灭"的拨弦——点扇区和巡航播放统一走 strike()，
 * time 传音频时钟时刻即可精确排程，无需 noteOff 管理。
 *
 * 全部振荡器实时合成，零音频资产；AudioContext 懒初始化。
 */

interface StrikeOptions {
  /** 音频时钟触发时刻；缺省 = 立即 */
  time?: number;
  /** 响度 0-1 */
  vel?: number;
  /** 保持时长（秒），之后进入释放尾音 */
  dur?: number;
}

export class ChordSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: { stop: (when: number) => void; until: number }[] = [];
  private volume = 0.8;

  /** 懒初始化并恢复（自动播放策略）；返回当前 AudioContext */
  ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume * 0.9;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master) this.master.gain.value = this.volume * 0.9;
  }

  /** 敲击一个音；低音给足、泛音略暗，高音清脆，统一拨弦质感 */
  strike(midi: number, opts: StrikeOptions = {}): void {
    const ctx = this.ensure();
    const t = opts.time ?? ctx.currentTime;
    const dur = opts.dur ?? 1.2;
    const v = Math.min(1, Math.max(0.05, opts.vel ?? 0.7)) * 0.5;

    const freq = midiToFreq(midi);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    filter.frequency.setValueAtTime(Math.min(6000, freq * 8), t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(700, freq * 2), t + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(v, t + 0.008);
    gain.gain.setTargetAtTime(v * 0.35, t + 0.03, 0.2);
    gain.gain.setValueAtTime(v * 0.35, t + dur);
    gain.gain.setTargetAtTime(0.0001, t + dur, 0.18);

    const mk = (type: OscillatorType, f: number, g: number): OscillatorNode => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      osc.connect(og).connect(filter);
      osc.start(t);
      osc.stop(t + dur + 1.4);
      return osc;
    };

    mk('triangle', freq, 1);
    mk('sine', freq * 2, 0.3);
    mk('sawtooth', freq * 2, 0.045);

    filter.connect(gain).connect(this.master!);

    const until = t + dur + 1.4;
    this.voices.push({
      until,
      stop: (when: number) => {
        gain.gain.cancelScheduledValues(when);
        gain.gain.setTargetAtTime(0.0001, when, 0.05);
      },
    });
    // 顺手清掉已经播完的 voice 记录
    this.voices = this.voices.filter((voice) => voice.until > ctx.currentTime);
  }

  /** 节拍器短促咔嗒；accent = 循环第一拍（音高更高） */
  tick(accent: boolean, time?: number): void {
    const ctx = this.ensure();
    const t = time ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = accent ? 1680 : 1120;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(accent ? 0.14 : 0.09, t);
    gain.gain.setTargetAtTime(0.0001, t, 0.025);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /** 一键静音（停止巡航 / 切调式时兜底） */
  stopAll(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const voice of this.voices) voice.stop(t);
    this.voices = [];
  }
}
