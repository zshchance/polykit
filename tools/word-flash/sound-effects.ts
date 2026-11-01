/**
 * 切卡音效 —— 本地确定性合成、按时间轴调度，预览与录制共用。
 *
 * 三种音效都由噪声 / 正弦包络合成（零依赖、字节级确定）：
 *   click  短促高频咔哒；pop 低频弹响；whoosh 气流掠过。
 * 每个音效缓存一份 AudioBuffer，调度时按卡片开始时刻各起一个源节点。
 */

import type { SoundEffectId, Timeline } from './options';

export type { SoundEffectId } from './options';

export const SOUND_EFFECTS: { id: SoundEffectId; label: string; hint: string }[] = [
  { id: 'none', label: '无音效', hint: '只保留背景音乐' },
  { id: 'click', label: '机械咔哒', hint: '短促的电子按键声，科技感强' },
  { id: 'pop', label: '气泡弹入', hint: '轻微的低频弹响，轻松俏皮' },
  { id: 'whoosh', label: '气流掠过', hint: '短促风声扫过，适合快速切卡' },
];

export function normalizeSoundEffect(id: unknown): SoundEffectId {
  return SOUND_EFFECTS.some((s) => s.id === id) ? (id as SoundEffectId) : 'none';
}

/** 每张卡开始时的音效提示点 */
export interface CardSoundCue {
  time: number;
  index: number;
}

export function cardSoundCues(timeline: Timeline): CardSoundCue[] {
  return timeline.starts.map((time, index) => ({ time, index }));
}

const bufferCache = new WeakMap<AudioContext, Partial<Record<SoundEffectId, AudioBuffer>>>();

function synthesize(ctx: AudioContext, id: Exclude<SoundEffectId, 'none'>): AudioBuffer {
  const duration = id === 'click' ? 0.14 : id === 'pop' ? 0.22 : 0.42;
  const length = Math.ceil(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = id === 'click' ? 24601 : id === 'pop' ? 77137 : 91357;
  let low = 0;
  let low2 = 0;

  for (let i = 0; i < length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const white = (seed / 4294967296) * 2 - 1;
    const t = i / ctx.sampleRate;
    const p = t / duration;
    let sample: number;

    if (id === 'click') {
      low += 0.36 * (white - low);
      const tick = (white - low) * Math.exp(-t * 66);
      const ping = Math.sin(2 * Math.PI * 1750 * t) * Math.exp(-t * 34) * 0.5;
      sample = tick * 0.85 + ping;
    } else if (id === 'pop') {
      const freq = 380 - 230 * Math.min(1, p * 1.6);
      const body = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 26);
      low += 0.18 * (white - low);
      const thump = low * Math.exp(-t * 20) * 0.5;
      sample = body * 0.8 + thump;
    } else {
      // whoosh：噪声经过由紧到松的双级低通，包络先扬后抑
      const cutoff = 0.5 - 0.42 * Math.min(1, p * 1.2);
      low += cutoff * (white - low);
      low2 += cutoff * (low - low2);
      const envelope = Math.sin(Math.PI * Math.min(1, p)) ** 1.4;
      sample = low2 * envelope * 1.5;
    }

    const edge = Math.min(1, t / 0.004, (duration - t) / 0.02);
    data[i] = sample * Math.max(0, edge) * 0.55;
  }
  return buffer;
}

export function getSoundEffectBuffer(ctx: AudioContext, id: SoundEffectId): AudioBuffer | null {
  if (id === 'none') return null;
  const cached = bufferCache.get(ctx);
  if (cached?.[id]) return cached[id]!;
  const buffer = synthesize(ctx, id);
  bufferCache.set(ctx, { ...cached, [id]: buffer });
  return buffer;
}

export interface SoundPlayback {
  stop: () => void;
  setVolume: (volume: number) => void;
}

function silentPlayback(): SoundPlayback {
  return { stop: () => {}, setVolume: () => {} };
}

function clampVolume(v: number): number {
  return Math.min(1, Math.max(0, v / 100));
}

interface ScheduleOptions {
  ctx: AudioContext;
  destination: AudioNode;
  timeline: Timeline;
  effect: SoundEffectId;
  volume: number;
  /** 时间轴 offset 对应的 AudioContext 绝对时间 */
  when: number;
  /** 从视频的 offset 秒继续，不补播此前已经结束的音效 */
  offset: number;
}

export function scheduleCardSounds(o: ScheduleOptions): SoundPlayback {
  const buffer = getSoundEffectBuffer(o.ctx, o.effect);
  if (!buffer || o.timeline.cards < 1) return silentPlayback();
  const gain = o.ctx.createGain();
  gain.gain.value = clampVolume(o.volume);
  gain.connect(o.destination);
  const sources = new Set<AudioBufferSourceNode>();
  for (const cue of cardSoundCues(o.timeline)) {
    const elapsed = o.offset - cue.time;
    if (elapsed >= buffer.duration) continue;
    const source = o.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    const startAt = Math.max(o.ctx.currentTime + 0.003, o.when + cue.time - o.offset);
    const bufferOffset = Math.max(0, elapsed);
    source.start(startAt, Math.min(buffer.duration - 0.001, bufferOffset));
    sources.add(source);
    source.onended = () => {
      sources.delete(source);
      source.disconnect();
    };
  }
  let stopped = false;
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      for (const source of sources) {
        source.onended = null;
        try {
          source.stop();
        } catch {
          /* 已结束 */
        }
        source.disconnect();
      }
      sources.clear();
      gain.disconnect();
    },
    setVolume: (volume) => {
      if (!stopped) gain.gain.value = clampVolume(volume);
    },
  };
}

/** 设置面板试听单个音效，不影响预览时间轴 */
export function playSoundEffect(o: {
  ctx: AudioContext;
  destination: AudioNode;
  effect: SoundEffectId;
  volume: number;
}): SoundPlayback {
  const buffer = getSoundEffectBuffer(o.ctx, o.effect);
  if (!buffer) return silentPlayback();
  const gain = o.ctx.createGain();
  gain.gain.value = clampVolume(o.volume);
  gain.connect(o.destination);
  const source = o.ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(gain);
  source.start(Math.max(o.ctx.currentTime, o.ctx.currentTime));
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* 已结束 */
    }
    source.disconnect();
    gain.disconnect();
  };
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
    stopped = true;
  };
  return {
    stop,
    setVolume: (volume) => {
      if (!stopped) gain.gain.value = clampVolume(volume);
    },
  };
}
