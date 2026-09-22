import { midiToFreq } from '../theory';

/**
 * 和弦琴房 —— 复音钢琴音色合成器。
 *
 * 全部用 Web Audio 振荡器实时合成，零音频资产。AudioContext 懒初始化
 * （浏览器要求用户手势后才能出声）。音色设计：三角波基音 + 正弦八度
 * 泛音 + 微量锯齿提亮，低通滤波随包络收拢，快速起音 + 两段指数衰减，
 * 听感接近柔和的电钢琴。
 *
 * 延音踏板语义在引擎内：踏板踩下时 noteOff 只把声音标记为 sustained
 * （继续自然衰减），松开踏板时统一收尾；这与界面「跟随按压 + 踏板锁定」
 * 的交互一致。
 */

interface Voice {
  oscs: OscillatorNode[];
  gain: GainNode;
  /** 踏板踩着时已松键的音：等踏板抬起再快速收尾 */
  sustained: boolean;
  stopped: boolean;
}

export class PianoSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<number, Voice>();
  private pedalDown = false;
  private volume = 0.8;

  /** 懒初始化并恢复（自动播放策略）；返回当前 AudioContext */
  ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume * 0.9;
      // 轻压缩防多音齐响削波
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

  /** 按下发声；同音重复触发时旧音色立即让位 */
  noteOn(midi: number, vel = 0.8): void {
    const ctx = this.ensure();
    this.kill(midi);

    const t = ctx.currentTime;
    const freq = midiToFreq(midi);
    const v = Math.min(1, Math.max(0.05, vel)) * 0.55;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.6;
    filter.frequency.setValueAtTime(Math.min(6500, freq * 9), t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(900, freq * 2.2), t + 1.1);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(v, t + 0.006);
    // 钢琴式两段衰减：先快后慢的长尾
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

    const oscs = [
      mk('triangle', freq, 1),
      mk('sine', freq * 2, 0.32),
      mk('sawtooth', freq * 2, 0.05),
    ];
    oscs[2]!.detune.value = 5;

    filter.connect(gain).connect(this.master!);
    this.voices.set(midi, { oscs, gain, sustained: false, stopped: false });
  }

  /** 松键：踏板踩着则转入持续（自然衰减），否则快速收尾 */
  noteOff(midi: number): void {
    const voice = this.voices.get(midi);
    if (!voice) return;
    if (this.pedalDown) {
      voice.sustained = true;
      return;
    }
    this.release(midi, voice, 0.07);
  }

  /** 踏板开关；抬起时给所有 sustained 音收尾 */
  setPedal(down: boolean): void {
    this.pedalDown = down;
    if (down) return;
    for (const [midi, voice] of this.voices) {
      if (voice.sustained) this.release(midi, voice, 0.12);
    }
  }

  /** 一键全部静音（Esc / 模式切换兜底） */
  releaseAll(): void {
    for (const [midi, voice] of this.voices) this.release(midi, voice, 0.06);
  }

  private release(midi: number, voice: Voice, tau: number): void {
    if (voice.stopped) return;
    voice.stopped = true;
    const ctx = this.ensure();
    const t = ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(t);
    voice.gain.gain.setTargetAtTime(0.0001, t, tau);
    for (const o of voice.oscs) o.stop(t + tau * 6);
    this.voices.delete(midi);
  }

  /** 同音重触发：立即掐断旧音（不等淡出，避免叠音轰鸣） */
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
}
