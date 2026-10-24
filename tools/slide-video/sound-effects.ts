/** 内置翻页音效：本地确定性合成、按时间轴调度，预览与录制共用。 */
import type { SoundEffectId, Timeline } from './options';
export type { SoundEffectId } from './options';

export const SOUND_EFFECTS: { id: SoundEffectId; label: string; hint: string }[] = [
  { id: 'none', label: '无音效', hint: '只保留背景音乐' },
  { id: 'paper', label: '纸张翻页', hint: '自然的纸面摩擦与轻微落页声' },
  { id: 'soft', label: '轻柔书页', hint: '更柔和、更低沉的书页声' },
  { id: 'crisp', label: '清脆翻页', hint: '短促清晰，适合节奏较快的演示' },
];

export function normalizeSoundEffect(id: unknown): SoundEffectId {
  return SOUND_EFFECTS.some((s) => s.id === id) ? (id as SoundEffectId) : 'none';
}

export interface PageSoundCue {
  time: number;
  pageIndex: number;
  flipDur: number;
}

/** 首页翻入与每次页间切换都配音；末页停留在内容上，不额外发声。 */
export function pageSoundCues(timeline: Timeline, includeIntro = true): PageSoundCue[] {
  const cues: PageSoundCue[] = [];
  for (let i = includeIntro ? 0 : 1; i < timeline.pages; i++) {
    cues.push({ time: i * timeline.pageDur, pageIndex: i, flipDur: timeline.flipDur });
  }
  return cues;
}

const bufferCache = new WeakMap<AudioContext, Partial<Record<SoundEffectId, AudioBuffer>>>();

export function getSoundEffectBuffer(ctx: AudioContext, id: SoundEffectId): AudioBuffer | null {
  if (id === 'none') return null;
  const cached = bufferCache.get(ctx);
  if (cached?.[id]) return cached[id]!;
  const duration = id === 'crisp' ? 0.34 : id === 'soft' ? 0.58 : 0.46;
  const length = Math.ceil(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = id === 'paper' ? 71827 : id === 'soft' ? 19373 : 42191;
  let low = 0;
  let slower = 0;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const white = (seed / 4294967296) * 2 - 1;
    const t = i / ctx.sampleRate;
    const p = t / duration;
    const smoothing = id === 'soft' ? 0.12 : id === 'paper' ? 0.28 : 0.48;
    low += smoothing * (white - low);
    slower += 0.035 * (white - slower);
    const rustle =
      id === 'soft'
        ? low * 0.8
        : id === 'paper'
          ? (white - low) * 0.58 + low * 0.45
          : (white - low) * 0.88;
    const envelope = Math.sin(Math.PI * Math.min(1, p)) ** 1.25;
    const texture =
      0.62 + 0.2 * Math.sin(t * (id === 'crisp' ? 117 : 83)) + 0.18 * Math.sin(t * 191 + 0.7);
    const lift = Math.exp(-t * 24) * slower * (id === 'soft' ? 0.8 : 0.45);
    const landing = p > 0.7 ? Math.sin(((p - 0.7) / 0.3) * Math.PI) * low * 0.28 : 0;
    const edgeFade = Math.min(1, t / 0.008, (duration - t) / 0.025);
    data[i] = (rustle * envelope * texture + lift + landing) * 0.36 * Math.max(0, edgeFade);
  }
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
  /** 是否为首页从空白翻入配音（与首页翻入动画开关联动） */
  includeIntro?: boolean;
}

export function schedulePageSounds(o: ScheduleOptions): SoundPlayback {
  const buffer = getSoundEffectBuffer(o.ctx, o.effect);
  if (!buffer || o.timeline.pages < 1) return silentPlayback();
  const gain = o.ctx.createGain();
  gain.gain.value = clampVolume(o.volume);
  gain.connect(o.destination);
  const sources = new Set<AudioBufferSourceNode>();
  for (const cue of pageSoundCues(o.timeline, o.includeIntro ?? true)) {
    const rate = Math.min(2, Math.max(0.65, buffer.duration / Math.max(0.12, cue.flipDur)));
    const audibleDur = buffer.duration / rate;
    const elapsed = o.offset - cue.time;
    if (elapsed >= audibleDur) continue;
    const source = o.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(gain);
    const startAt = Math.max(o.ctx.currentTime + 0.003, o.when + cue.time - o.offset);
    const bufferOffset = Math.max(0, elapsed) * rate;
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

/** 设置面板试听单个音效，不影响预览时间轴。 */
export function playSoundEffect(o: {
  ctx: AudioContext;
  destination: AudioNode;
  effect: SoundEffectId;
  volume: number;
  when?: number;
}): SoundPlayback {
  const buffer = getSoundEffectBuffer(o.ctx, o.effect);
  if (!buffer) return silentPlayback();
  const gain = o.ctx.createGain();
  gain.gain.value = clampVolume(o.volume);
  gain.connect(o.destination);
  const source = o.ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(gain);
  source.start(Math.max(o.ctx.currentTime, o.when ?? o.ctx.currentTime));
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
