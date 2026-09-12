/**
 * 视频录制 —— 实时 MediaRecorder 录制（视频轨 + 音频轨），零新增依赖。
 *
 * 为什么选「实时录制」而不是 quote-card 的「离线逐帧」：
 *   本工具每帧是纯 canvas 2D 绘制（频谱/歌词/进度条，单帧 <2ms），远快于帧间隔，
 *   而音轨只能由 MediaStreamDestination 实时产生——实时播放音频 + rAF 同帧绘制，
 *   音画天然对齐（都锚定 AudioContext 时钟）；即使偶发掉帧也只丢画面不偏移。
 *
 * 时间轴（与 renderer.drawFrame 约定一致）：
 *   [0, intro) 开场动画（音频尚未进入，频谱为 0）
 *   [intro, intro+audio) 主段（BufferSource 调度在此刻起播，Analyser 出数据）
 *   [intro+audio, total) 结尾段（内容淡出 + 片尾滚动字幕）
 *
 * 注意：录制期间不外放（不连 ctx.destination），录完即得无声扰动的成片；
 *       后台标签页会节流 rAF 导致丢帧，UI 需提示用户保持页面前台。
 */

import { getSharedAudioContext } from './audio';
import { computeBands, drawFrame, type RenderInput } from './renderer';

export type RecordResult =
  | { ok: true; blob: Blob; ext: 'mp4' | 'webm' }
  | { ok: false; reason: string };

export interface RecordOptions {
  /** 解码后的音频 */
  buffer: AudioBuffer;
  /** 渲染输入（opts/theme/lyrics/图片等静态部分） */
  input: RenderInput;
  /** 录制画布像素尺寸（按分辨率档位换算） */
  W: number;
  H: number;
  /** 采样帧率（captureStream） */
  fps: number;
  /** 进度回调（0~1，以及当前/总秒数） */
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

/** 频段数量（bars/mirror/circle 共用一组对数分桶数据） */
const BAND_COUNT = 64;

export function startRecording(o: RecordOptions): RecordHandle {
  const { buffer, input, W, H, fps, onProgress } = o;

  // —— 能力检测 ——
  if (typeof MediaRecorder === 'undefined') {
    return { result: Promise.resolve({ ok: false, reason: '当前浏览器不支持视频录制（MediaRecorder）' }), cancel: () => {} };
  }
  const picked = pickMime();
  if (!picked) {
    return { result: Promise.resolve({ ok: false, reason: '当前浏览器不支持 MP4/WebM 视频录制' }), cancel: () => {} };
  }

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { result: Promise.resolve({ ok: false, reason: '无法创建录制画布' }), cancel: () => {} };
  }

  const audioCtx = getSharedAudioContext();
  const timeline = input.timeline;
  const total = timeline.total;

  // —— 音频链路：BufferSource → Analyser → 录制目的地（不外放） ——
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.82;
  const dest = audioCtx.createMediaStreamDestination();
  source.connect(analyser);
  analyser.connect(dest);

  const stream = canvas.captureStream(fps);
  const audioTrack = dest.stream.getAudioTracks()[0];
  if (audioTrack) stream.addTrack(audioTrack);

  // 码率：按像素总量与帧率估算，保证频谱/文字清晰（同 quote-card 的经验值）
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
      audioBitsPerSecond: 192_000,
    });
  } catch (e) {
    return {
      result: Promise.resolve({ ok: false, reason: e instanceof Error ? e.message : '无法启动录制器' }),
      cancel: () => {},
    };
  }

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  // 频谱缓冲（复用，避免每帧分配）
  const freqRaw = new Uint8Array(analyser.frequencyBinCount);
  const waveRaw = new Uint8Array(analyser.fftSize);
  const bandsBuf = new Uint8Array(BAND_COUNT);

  let cancelled = false;
  let settled = false;
  let rafId = 0;

  const cleanup = (): void => {
    cancelAnimationFrame(rafId);
    try {
      source.stop();
    } catch {
      /* 尚未 start 时 stop 会抛错：忽略 */
    }
    try {
      source.disconnect();
      analyser.disconnect();
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

    // —— 启动：录制器起跑 → 调度音频在开场段结束时进入 → rAF 驱动逐帧绘制 ——
    const t0 = audioCtx.currentTime + 0.2; // 预调度缓冲，保证首帧不丢
    try {
      recorder.start(250); // timeslice：定期产出 chunk，进度/取消更即时
      source.start(t0 + timeline.intro);
    } catch (e) {
      finish({ ok: false, reason: e instanceof Error ? e.message : '启动录制失败' });
      return;
    }

    const loop = (): void => {
      const t = audioCtx.currentTime - t0;
      const tc = Math.min(Math.max(t, 0), total);

      analyser.getByteFrequencyData(freqRaw);
      analyser.getByteTimeDomainData(waveRaw);
      computeBands(freqRaw, BAND_COUNT, bandsBuf);
      const dt = 1 / fps;

      drawFrame(ctx, W, H, input, tc, dt, bandsBuf, waveRaw);
      onProgress(Math.min(1, tc / total), tc, total);

      if (t >= total) {
        // 音频自然播完 + 结尾段滚完：停源、停录制（onstop 里收尾）
        try {
          source.stop();
        } catch {
          /* 忽略 */
        }
        if (recorder.state !== 'inactive') recorder.stop();
        return;
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  });

  return {
    result,
    cancel: () => {
      if (settled || cancelled) return;
      cancelled = true;
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop(); // onstop 里按 cancelled 收尾
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
