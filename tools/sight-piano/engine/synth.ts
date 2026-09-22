/**
 * 识谱琴房 —— 音频引擎：钢琴音色 + 节拍器/鼓组/贝斯伴奏。
 *
 * 全部用 Web Audio 振荡器/噪声实时合成，零音频资产。AudioContext 懒初始化
 * （浏览器要求用户手势后才能出声）。两条总线：keys（用户弹奏）与 band
 * （节拍器/鼓/贝斯），各自独立音量。
 *
 * 钢琴音色与和弦琴房同源：三角波基音 + 正弦八度泛音 + 微量锯齿提亮，
 * 低通随包络收拢，两段指数衰减；延音踏板语义内建（踩下时松键的音继续衰减，
 * 抬踏板统一收尾）。
 */

interface Voice {
  oscs: OscillatorNode[];
  gain: GainNode;
  sustained: boolean;
  stopped: boolean;
}

export class PianoSynth {
  private ctx: AudioContext | null = null;
  private keysBus: GainNode | null = null;
  private bandBus: GainNode | null = null;
  private voices = new Map<number, Voice>();
  private pedalDown = false;
  private volume = 0.8;
  private bandVolume = 0.7;
  private noiseBuf: AudioBuffer | null = null;

  /** 懒初始化并恢复（自动播放策略）；返回当前 AudioContext */
  ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const master = this.ctx.createGain();
      master.gain.value = 0.9;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      master.connect(comp).connect(this.ctx.destination);
      this.keysBus = this.ctx.createGain();
      this.keysBus.gain.value = this.volume;
      this.keysBus.connect(master);
      this.bandBus = this.ctx.createGain();
      this.bandBus.gain.value = this.bandVolume;
      this.bandBus.connect(master);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  get currentTime(): number {
    return this.ensure().currentTime;
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.keysBus) this.keysBus.gain.value = this.volume;
  }

  setBandVolume(v: number): void {
    this.bandVolume = Math.min(1, Math.max(0, v));
    if (this.bandBus) this.bandBus.gain.value = this.bandVolume;
  }

  // ───────────── 钢琴 ─────────────

  noteOn(midi: number, vel = 0.8): void {
    const ctx = this.ensure();
    this.kill(midi);
    const t = ctx.currentTime;
    const freq = midiToFreqOf(midi);
    const v = Math.min(1, Math.max(0.05, vel)) * 0.55;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.6;
    filter.frequency.setValueAtTime(Math.min(6500, freq * 9), t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(900, freq * 2.2), t + 1.1);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(v, t + 0.006);
    gain.gain.setTargetAtTime(v * 0.32, t + 0.02, 0.22);
    gain.gain.setTargetAtTime(0.0001, t + 0.55, 1.05);

    const mk = (type: OscillatorType, f: number, g: number): OscillatorNode => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      osc.connect(og).connect(filter);
      osc.start(t);
      return osc;
    };

    const oscs = [mk('triangle', freq, 1), mk('sine', freq * 2, 0.32), mk('sawtooth', freq * 2, 0.05)];
    oscs[2]!.detune.value = 5;

    filter.connect(gain).connect(this.keysBus!);
    this.voices.set(midi, { oscs, gain, sustained: false, stopped: false });
  }

  noteOff(midi: number): void {
    const voice = this.voices.get(midi);
    if (!voice) return;
    if (this.pedalDown) {
      voice.sustained = true;
      return;
    }
    this.releaseVoice(midi, voice, 0.07);
  }

  setPedal(down: boolean): void {
    this.pedalDown = down;
    if (down) return;
    for (const [midi, voice] of this.voices) {
      if (voice.sustained) this.releaseVoice(midi, voice, 0.12);
    }
  }

  releaseAll(): void {
    for (const [midi, voice] of this.voices) this.releaseVoice(midi, voice, 0.06);
  }

  private releaseVoice(midi: number, voice: Voice, tau: number): void {
    if (voice.stopped) return;
    voice.stopped = true;
    const t = this.ensure().currentTime;
    voice.gain.gain.cancelScheduledValues(t);
    voice.gain.gain.setTargetAtTime(0.0001, t, tau);
    for (const o of voice.oscs) o.stop(t + tau * 6);
    this.voices.delete(midi);
  }

  private kill(midi: number): void {
    const voice = this.voices.get(midi);
    if (!voice || voice.stopped) return;
    voice.stopped = true;
    const t = this.ensure().currentTime;
    voice.gain.gain.cancelScheduledValues(t);
    voice.gain.gain.setTargetAtTime(0.0001, t, 0.012);
    for (const o of voice.oscs) o.stop(t + 0.09);
    this.voices.delete(midi);
  }

  // ───────────── 节拍器 ─────────────

  /** 节拍器嗒声：短促方波 + 高通，重拍音高更高 */
  click(time: number, accent: boolean): void {
    const ctx = this.ensure();
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = accent ? 1568 : 1046; // G6 / C6
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(accent ? 0.28 : 0.18, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    osc.connect(gain).connect(hp).connect(this.bandBus!);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  // ───────────── 鼓组 ─────────────

  kick(time: number, vel = 1): void {
    const ctx = this.ensure();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.11);
    gain.gain.setValueAtTime(vel * 0.9, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
    osc.connect(gain).connect(this.bandBus!);
    osc.start(time);
    osc.stop(time + 0.3);
  }

  snare(time: number, vel = 1): void {
    const ctx = this.ensure();
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.9;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(vel * 0.5, time);
    nGain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
    noise.connect(bp).connect(nGain).connect(this.bandBus!);
    noise.start(time);
    noise.stop(time + 0.18);

    const osc = ctx.createOscillator();
    const oGain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 190;
    oGain.gain.setValueAtTime(vel * 0.4, time);
    oGain.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
    osc.connect(oGain).connect(this.bandBus!);
    osc.start(time);
    osc.stop(time + 0.1);
  }

  hat(time: number, vel = 1): void {
    const ctx = this.ensure();
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vel * 0.25, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    noise.connect(hp).connect(gain).connect(this.bandBus!);
    noise.start(time);
    noise.stop(time + 0.06);
  }

  /** 贝斯：三角波 + 低通的柔和圆贝斯 */
  bass(time: number, midi: number, dur: number, vel = 0.8): void {
    const ctx = this.ensure();
    const freq = midiToFreqOf(midi);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(900, freq * 6);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(vel * 0.5, time + 0.015);
    gain.gain.setTargetAtTime(0.0001, time + dur * 0.7, 0.09);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq / 2;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.4;
    osc.connect(filter);
    sub.connect(subGain).connect(filter);
    filter.connect(gain).connect(this.bandBus!);
    const stop = time + dur + 0.3;
    osc.start(time);
    sub.start(time);
    osc.stop(stop);
    sub.stop(stop);
  }

  /** 曲终小奖励：大三和弦琶音上扬 */
  tada(time: number, rootMidi: number): void {
    const ctx = this.ensure();
    [0, 4, 7, 12, 16].forEach((off, i) => {
      const t = time + i * 0.09;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = midiToFreqOf(rootMidi + off);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.22, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      osc.connect(gain).connect(this.bandBus!);
      osc.start(t);
      osc.stop(t + 0.7);
    });
    void ctx;
  }

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

function midiToFreqOf(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
