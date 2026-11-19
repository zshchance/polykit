import { getSharedAudioContext, resumeAudioContext } from './audio';
import type { TimeRange } from './spectrogram';

interface PlayerOptions {
  onTick: (time: number, playing: boolean) => void;
  getLoopRange: () => TimeRange | null;
  /** 到达该时间（秒）自动暂停；返回 null 表示连续播放。用于单句试听到句尾即停。 */
  getStopAt?: () => number | null;
}

/** 以 AudioContext.currentTime 为唯一播放时钟，seek 时重建一次性 BufferSource。 */
export class AudioPlayer {
  private readonly ctx = getSharedAudioContext();
  private readonly onTick: PlayerOptions['onTick'];
  private readonly getLoopRange: PlayerOptions['getLoopRange'];
  private readonly getStopAt: PlayerOptions['getStopAt'];
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private raf = 0;
  private playRequest = 0;
  private startedAt = 0;
  private pausedAt = 0;
  private playing = false;

  constructor(options: PlayerOptions) {
    this.onTick = options.onTick;
    this.getLoopRange = options.getLoopRange;
    this.getStopAt = options.getStopAt;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  setBuffer(buffer: AudioBuffer | null): void {
    this.playRequest++;
    this.stopSource();
    this.buffer = buffer;
    this.pausedAt = 0;
    this.playing = false;
    this.onTick(0, false);
  }

  getTime(): number {
    if (!this.buffer) return 0;
    if (!this.playing) return this.pausedAt;
    return Math.min(
      this.duration,
      Math.max(0, this.ctx.currentTime - this.startedAt + this.pausedAt),
    );
  }

  async play(offset = this.pausedAt): Promise<void> {
    if (!this.buffer) return;
    const request = ++this.playRequest;
    await resumeAudioContext();
    if (request !== this.playRequest || !this.buffer) return;

    this.stopSource();
    const duration = this.buffer.duration;
    const at = Math.min(Math.max(0, offset), Math.max(0, duration - 0.001));
    this.pausedAt = at;
    this.startedAt = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.ctx.destination);
    source.onended = () => {
      if (this.source !== source) return;
      this.source = null;
      this.playing = false;
      this.pausedAt = this.duration;
      cancelAnimationFrame(this.raf);
      this.onTick(this.pausedAt, false);
    };
    this.source = source;
    this.playing = true;
    source.start(0, at);
    this.onTick(at, true);
    this.tick();
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedAt = this.getTime();
    this.playing = false;
    this.playRequest++;
    this.stopSource();
    cancelAnimationFrame(this.raf);
    this.onTick(this.pausedAt, false);
  }

  seek(time: number): void {
    if (!this.buffer) return;
    const at = Math.min(this.duration, Math.max(0, time));
    if (this.playing) {
      void this.play(at);
    } else {
      this.pausedAt = at;
      this.onTick(at, false);
    }
  }

  destroy(): void {
    this.playRequest++;
    this.stopSource();
    cancelAnimationFrame(this.raf);
    this.buffer = null;
  }

  private stopSource(): void {
    cancelAnimationFrame(this.raf);
    const source = this.source;
    this.source = null;
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // 已结束的 source 无需再次停止。
    }
    source.disconnect();
  }

  private tick = (): void => {
    if (!this.playing) return;
    const time = this.getTime();
    const loop = this.getLoopRange();
    if (loop && loop.end > loop.start && time >= loop.end && time - loop.end < 0.25) {
      void this.play(loop.start);
      return;
    }
    const stopAt = this.getStopAt?.() ?? null;
    if (stopAt !== null && time >= stopAt) {
      // 单句试听：到句尾自动停（循环开启时上方循环分支先命中，不会走到这里）。
      this.pause();
      return;
    }
    this.onTick(time, true);
    this.raf = requestAnimationFrame(this.tick);
  };
}
