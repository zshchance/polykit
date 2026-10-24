/**
 * 视频录制 —— 实时 MediaRecorder 录制（视频轨 + 可选音频轨），零新增依赖。
 *
 * 为什么选「实时录制」而不是离线逐帧：BGM 音轨只能由 MediaStreamDestination
 * 实时产生——实时播放音频 + rAF 同帧绘制，音画天然对齐（都锚定 AudioContext
 * 时钟）；即使偶发掉帧也只丢画面不偏移时间。
 *
 * 时钟纪律：无论有无 BGM，帧时间 t 一律取 audioCtx.currentTime（与预览同源），
 * 无 BGM 只是跳过音频节点，绝不改用 performance.now——避免两套时钟导致
 * 预览与成片不一致。
 *
 * 音频行为：BGM 可选，内置翻页音效按同一时间轴独立调度；两者可单独使用
 * 或混音。BGM 短于总时长且 loop=true 时循环，结尾 1.2s 线性淡出。
 * 只有音效而没有 BGM 时也会创建音频轨。录制期间不外放。
 *
 * 注意：后台标签页会节流 rAF 导致丢帧，UI 需提示用户保持页面前台。
 */

import { getSharedAudioContext } from './audio';
import { schedulePageSounds, type SoundPlayback } from './sound-effects';
import type { SoundEffectId } from './options';
import { drawFrame, type RenderInput } from './renderer';

export type RecordResult =
  { ok: true; blob: Blob; ext: 'mp4' | 'webm' } | { ok: false; reason: string };

export interface RecordOptions {
  /** 背景音乐（null = 纯视频轨导出） */
  buffer: AudioBuffer | null;
  /** BGM 音量 0-100 */
  volume: number;
  /** BGM 短于总时长时是否循环 */
  loop: boolean;
  /** 内置翻页音效；none 时仅使用 BGM */
  soundEffect: SoundEffectId;
  soundVolume: number;
  /** 渲染输入（opts/theme/pages 等静态部分） */
  input: RenderInput;
  /** 录制画布像素尺寸（按分辨率档位换算） */
  W: number;
  H: number;
  /** 采样帧率（captureStream） */
  fps: number;
  /** 进度回调（0~1，以及当前/总秒数；总秒数已知，调用方可展示预计剩余时间） */
  onProgress: (ratio: number, t: number, total: number) => void;
}

export interface RecordHandle {
  /** 录制结束（完成/失败/取消）后 resolve */
  result: Promise<RecordResult>;
  /** 中途取消：停止录制，result 以 cancelled 结束，不产出文件 */
  cancel: () => void;
}

interface PickedMime {
  mime: string;
  ext: 'mp4' | 'webm';
}

/** 选浏览器支持的录制格式：优先 MP4/H.264（兼容性最广），回退 WebM VP9/VP8 */
function pickMime(): PickedMime | null {
  const candidates: PickedMime[] = [
    { mime: 'video/mp4;codecs=avc1.640028', ext: 'mp4' },
    { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
    { mime: 'video/mp4;codecs=h264', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mime)) {
      return c;
    }
  }
  return null;
}

/** 结尾淡出时长（秒）：BGM 比总时长长时的截断缓冲 */
const FADE_OUT = 1.2;

// ─────────────────────────── 屏幕常亮(录制期间) ───────────────────────────

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
}

let wakeLock: WakeLockSentinelLike | null = null;
let wakeLockActive = false;

/** 是否支持屏幕常亮锁(用于 UI 提示) */
export function isWakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

async function acquireWakeLock(): Promise<void> {
  if (!isWakeLockSupported()) return;
  try {
    const nav = navigator as Navigator & {
      wakeLock: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
    };
    wakeLock = await nav.wakeLock.request('screen');
  } catch {
    // 被系统策略拒绝(如低电量):静默降级,录制照常
    wakeLock = null;
  }
}

async function releaseWakeLock(): Promise<void> {
  const lock = wakeLock;
  wakeLock = null;
  try {
    await lock?.release();
  } catch {
    /* 忽略 */
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLockActive) {
    void acquireWakeLock();
  }
});

export function startRecording(o: RecordOptions): RecordHandle {
  const { buffer, volume, loop, soundEffect, soundVolume, input, W, H, fps, onProgress } = o;

  if (typeof MediaRecorder === 'undefined') {
    return {
      result: Promise.resolve({ ok: false, reason: '当前浏览器不支持视频录制（MediaRecorder）' }),
      cancel: () => {},
    };
  }
  const picked = pickMime();
  if (!picked) {
    return {
      result: Promise.resolve({ ok: false, reason: '当前浏览器不支持 MP4/WebM 视频录制' }),
      cancel: () => {},
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { result: Promise.resolve({ ok: false, reason: '无法创建录制画布' }), cancel: () => {} };
  }

  const audioCtx = getSharedAudioContext();
  const total = input.timeline.total;

  // —— 音频链路（可选）：BufferSource → Gain → 录制目的地（不外放） ——
  const source = buffer ? audioCtx.createBufferSource() : null;
  const gain = audioCtx.createGain();
  const dest = audioCtx.createMediaStreamDestination();
  if (source && buffer) {
    source.buffer = buffer;
    source.loop = loop;
    gain.gain.value = Math.min(1, Math.max(0, volume / 100));
    source.connect(gain);
    gain.connect(dest);
  }

  const hasAudio = !!(source && buffer) || soundEffect !== 'none';
  const stream = canvas.captureStream(fps);
  if (hasAudio) {
    const audioTrack = dest.stream.getAudioTracks()[0];
    if (audioTrack) stream.addTrack(audioTrack);
  }

  // 码率：按像素总量与帧率估算（同 song-video 经验值）
  const pixels = W * H;
  const bitrate = Math.max(
    6_000_000,
    Math.round((pixels / (1920 * 1080)) * 12_000_000 * (fps / 30) ** 0.5),
  );
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, {
      mimeType: picked.mime,
      videoBitsPerSecond: bitrate,
      ...(hasAudio ? { audioBitsPerSecond: 192_000 } : {}),
    });
  } catch (e) {
    return {
      result: Promise.resolve({
        ok: false,
        reason: e instanceof Error ? e.message : '无法启动录制器',
      }),
      cancel: () => {},
    };
  }

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  let cancelled = false;
  let settled = false;
  let rafId = 0;
  let soundPlayback: SoundPlayback | null = null;

  const cleanup = (): void => {
    cancelAnimationFrame(rafId);
    soundPlayback?.stop();
    wakeLockActive = false;
    void releaseWakeLock();
    if (source) {
      try {
        source.stop();
      } catch {
        /* 尚未 start 时 stop 会抛错：忽略 */
      }
      try {
        source.disconnect();
      } catch {
        /* 忽略 */
      }
    }
    try {
      gain.disconnect();
    } catch {
      /* 忽略 */
    }
    stream.getTracks().forEach((tr) => tr.stop());
  };

  const result = new Promise<RecordResult>((resolve) => {
    const finish = (r: RecordResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(r);
    };

    recorder.onstop = () => {
      if (cancelled) {
        finish({ ok: false, reason: 'cancelled' });
        return;
      }
      const blob = new Blob(chunks, { type: picked.mime.split(';')[0] });
      if (blob.size === 0) {
        finish({ ok: false, reason: '录制内容为空，请重试' });
        return;
      }
      finish({ ok: true, blob, ext: picked.ext });
    };
    recorder.onerror = () => {
      finish({ ok: false, reason: '录制过程出错' });
    };

    // —— 启动：录制器起跑 → 调度 BGM（从 t=0 进入）→ rAF 逐帧绘制 ——
    const t0 = audioCtx.currentTime + 0.2; // 预调度缓冲，保证首帧不丢
    try {
      recorder.start(250); // timeslice：定期产出 chunk，进度/取消更即时
      if (source) source.start(t0);
      soundPlayback = schedulePageSounds({
        ctx: audioCtx,
        destination: dest,
        timeline: input.timeline,
        effect: soundEffect,
        volume: soundVolume,
        when: t0,
        offset: 0,
        includeIntro: input.opts.firstPageFlip,
      });
      // 结尾淡出：BGM 比总时长长或循环时平滑收尾（瞬间停轨会有爆音）
      if (source && buffer) {
        const g = gain.gain;
        g.setValueAtTime(g.value, Math.max(t0, t0 + total - FADE_OUT));
        g.linearRampToValueAtTime(0.0001, t0 + total - 0.05);
      }
      wakeLockActive = true;
      void acquireWakeLock();
    } catch (e) {
      finish({ ok: false, reason: e instanceof Error ? e.message : '启动录制失败' });
      return;
    }

    const loopFn = (): void => {
      const t = audioCtx.currentTime - t0;
      const tc = Math.min(Math.max(t, 0), total);

      drawFrame(ctx, W, H, input, tc);
      onProgress(Math.min(1, tc / total), tc, total);

      if (t >= total) {
        if (source) {
          try {
            source.stop();
          } catch {
            /* 忽略 */
          }
        }
        if (recorder.state !== 'inactive') recorder.stop();
        return;
      }
      rafId = requestAnimationFrame(loopFn);
    };
    rafId = requestAnimationFrame(loopFn);
  });

  return {
    result,
    cancel: () => {
      if (settled || cancelled) return;
      cancelled = true;
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          settled = true;
          cleanup();
        }
      } else {
        settled = true;
        cleanup();
      }
    },
  };
}
