import { midiToFreq } from './harmony';

/**
 * 迷你鼓机 + 琶音合成器 —— 全部用 Web Audio 振荡器/噪声实时合成，
 * 零音频资产、零依赖。AudioContext 懒初始化（浏览器要求用户手势后才能出声），
 * 之后所有方法接受音频时钟时间戳做精确排程。
 *
 * 分层：鼓三轨（kick/snare/hat）进 drumsBus，琶音进 arpBus，
 * 两条总线各自可静音（UI 的声部开关 / 独奏试听都靠它）。
 */
export class DrumSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private drumsBus: GainNode | null = null;
  private arpBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  /** 懒初始化并恢复（自动播放策略）；返回当前 AudioContext */
  ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.ctx.destination);
      this.drumsBus = this.ctx.createGain();
      this.drumsBus.connect(this.master);
      this.arpBus = this.ctx.createGain();
      this.arpBus.gain.value = 0.6; // 琶音略让位于鼓
      this.arpBus.connect(this.master);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  get currentTime(): number {
    return this.ensure().currentTime;
  }

  /** 声部静音开关（gain 0/1，不做淡入淡出——试听工具，即时即可） */
  setLayerMuted(layer: 'drums' | 'arp', muted: boolean): void {
    const bus = layer === 'drums' ? this.drumsBus : this.arpBus;
    if (bus) bus.gain.value = muted ? 0 : layer === 'drums' ? 1 : 0.6;
  }

  /** 底鼓：正弦从 150Hz 快速滑到 45Hz，短促收尾 */
  kick(time: number, vel = 1): void {
    const ctx = this.ensure();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.11);
    gain.gain.setValueAtTime(vel, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
    osc.connect(gain).connect(this.drumsBus!);
    osc.start(time);
    osc.stop(time + 0.3);
  }

  /** 军鼓：带通噪声（丝绳）+ 三角波（皮声）双层 */
  snare(time: number, vel = 1): void {
    const ctx = this.ensure();
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.9;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(vel * 0.7, time);
    nGain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
    noise.connect(bp).connect(nGain).connect(this.drumsBus!);
    noise.start(time);
    noise.stop(time + 0.18);

    const osc = ctx.createOscillator();
    const oGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 190;
    oGain.gain.setValueAtTime(vel * 0.5, time);
    oGain.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
    osc.connect(oGain).connect(this.drumsBus!);
    osc.start(time);
    osc.stop(time + 0.1);
  }

  /** 踩镲（闭镲）：高通噪声极短促 */
  hat(time: number, vel = 1): void {
    const ctx = this.ensure();
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel * 0.35, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    noise.connect(hp).connect(gain).connect(this.drumsBus!);
    noise.start(time);
    noise.stop(time + 0.06);
  }

  /**
   * 琶音拨弦：三角波为主 + 微量高八度锯齿波增亮，低通滤波随包络收拢，
   * 听感接近柔和的电钢琴/拨弦合成器。
   */
  pluck(time: number, midi: number, vel: number, dur: number): void {
    const ctx = this.ensure();
    const freq = midiToFreq(midi);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(Math.min(3200, freq * 6), time);
    filter.frequency.exponentialRampToValueAtTime(Math.max(500, freq * 1.5), time + dur);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(vel * 0.5, time + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.001, time + dur);

    const main = ctx.createOscillator();
    main.type = 'triangle';
    main.frequency.value = freq;
    const sparkle = ctx.createOscillator();
    sparkle.type = 'sawtooth';
    sparkle.frequency.value = freq * 2;
    sparkle.detune.value = 6;
    const sparkleGain = ctx.createGain();
    sparkleGain.gain.value = 0.08;

    main.connect(filter);
    sparkle.connect(sparkleGain).connect(filter);
    filter.connect(amp).connect(this.arpBus!);
    const stop = time + dur + 0.05;
    main.start(time);
    sparkle.start(time);
    main.stop(stop);
    sparkle.stop(stop);
  }

  /** 共享白噪声缓冲（1 秒循环够用，军鼓/踩镲共用） */
  private noise(): AudioBuffer {
    const ctx = this.ensure();
    if (!this.noiseBuf) {
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuf;
  }
}
