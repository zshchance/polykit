/**
 * 名言卡片视频导出（优先 MP4，回退 WebM，零新增依赖）。
 *
 * 原理：
 *   1. 创建离屏 canvas（aspect.w × aspect.h）。
 *   2. canvas.captureStream(fps) 取视频流，MediaRecorder 录制为 MP4/WebM。
 *   3. 重新构建入场动画（WAAPI Animation）并正常播放。
 *   4. 用 requestAnimationFrame 循环：每帧用 html-to-image 的 toCanvas 把 surface
 *      栅格化成 canvas，drawImage 到录制 canvas 上。captureStream 会自动捕获 canvas 变化。
 *   5. 动画播放完毕 + 尾帧定格 0.8s 后停止录制，收集 chunks 成 Blob 下载。
 *
 * 格式选择：pickMime 优先 H.264/MP4（兼容性广，微信/iOS/播放器可直接打开），
 *   浏览器不支持时自动回退 WebM（VP9/VP8）。实际命中的格式决定文件扩展名与提示文案。
 *
 * 注意：surface 在调用前需已被设为「导出态」（transform 复位、原始 aspect 尺寸），
 *       且 .exporting 类不影响 WAAPI 动画（WAAPI 不走 CSS animation）。
 */

import { toCanvas } from 'html-to-image';
import { downloadBlob } from '@/core/utils/clipboard';
import type { Aspect } from './aspect';
import type { AnimEffect } from './animations';
import { buildForExport, ANIM_DURATION } from './animations';
import type { QuoteData } from './templates/types';

export type VideoExportResult =
  | { ok: true; format: 'mp4' | 'webm' }
  | { ok: false; reason: string };

/**
 * 视频分辨率档位。卡片画板短边基准 1080，分辨率档位 = 目标短边像素。
 *   - '1080' 标清（默认，短边 1080）
 *   - '1440' 2K（短边 1440）
 *   - '2160' 4K 超清（短边 2160）
 * 录制 canvas 按 shortSide/1080 等比放大；toCanvas pixelRatio 同步放大以保证文字清晰。
 */
export type VideoResId = '1080' | '1440' | '2160';

export interface VideoResolution {
  id: VideoResId;
  /** 展示名 */
  name: string;
  /** 目标短边像素 */
  shortSide: number;
}

export const VIDEO_RESOLUTIONS: VideoResolution[] = [
  { id: '1080', name: '1080p 标清', shortSide: 1080 },
  { id: '1440', name: '1440p 2K', shortSide: 1440 },
  { id: '2160', name: '2160p 4K 超清', shortSide: 2160 },
];

const DEFAULT_RES: VideoResolution = VIDEO_RESOLUTIONS[0]!;

/** 按 id 取分辨率，非法 id 回退 1080p */
export function getVideoResolution(id: string | undefined): VideoResolution {
  return VIDEO_RESOLUTIONS.find((r) => r.id === id) ?? DEFAULT_RES;
}

/** 判断 id 是否合法 */
export function isValidVideoResId(id: unknown): id is VideoResId {
  return typeof id === 'string' && VIDEO_RESOLUTIONS.some((r) => r.id === id);
}

/**
 * 视频帧率档位。
 *   - '30' 流畅（文件小，逐字动画已够顺）
 *   - '60' 丝滑（默认，文字动画最顺，文件较大）
 *   - '120' 超流畅（高刷展示用，文件最大、录制最慢）
 *
 * 注：本工具用【离线逐帧渲染】（见 exportVideo），帧率是精确的——每一帧都按
 * 1/fps 秒的时间步长渲染一次，不依赖实时栅格化速度。所以即便 html-to-image
 * 单帧栅格化耗时 >16ms，成品仍是精确 60fps，不会掉帧（只是录制比实时慢）。
 */
export type VideoFpsId = '30' | '60' | '120';

export interface VideoFps {
  id: VideoFpsId;
  /** 展示名 */
  name: string;
  /** 实际帧率 */
  fps: number;
}

export const VIDEO_FPS: VideoFps[] = [
  { id: '30', name: '30 流畅', fps: 30 },
  { id: '60', name: '60 丝滑', fps: 60 },
  { id: '120', name: '120 超流畅', fps: 120 },
];

const DEFAULT_FPS: VideoFps = VIDEO_FPS[1]!; // 60

/** 按 id 取帧率，非法 id 回退 60 */
export function getVideoFps(id: string | undefined): VideoFps {
  return VIDEO_FPS.find((f) => f.id === id) ?? DEFAULT_FPS;
}

/** 判断 id 是否合法 */
export function isValidVideoFpsId(id: unknown): id is VideoFpsId {
  return typeof id === 'string' && VIDEO_FPS.some((f) => f.id === id);
}

export interface VideoExportOptions {
  /** 卡片 surface（已处于导出态：transform 复位、原始尺寸） */
  surface: HTMLElement;
  /** 宽高比（决定画板基础尺寸） */
  aspect: Aspect;
  /** 动画效果 */
  effect: AnimEffect;
  /** 名言（动画构建需要） */
  quote: QuoteData;
  /** 视频分辨率（短边目标像素，默认 1080） */
  resolution?: VideoResolution;
  /** 帧率档位（默认 60 丝滑） */
  videoFps?: VideoFps;
  /** 尾帧定格时长（ms） */
  tailMs?: number;
}

interface PickedMime {
  mime: string;
  ext: 'mp4' | 'webm';
}

/**
 * 把 content 子树里所有正在播放的 WAAPI 动画强制跳到终态（finish）。
 *
 * 用途：视频/图片导出末态收尾。逐字类动画把每个字符 span 各自 animate（独立的 Animation），
 * 末字的动画可能略晚于 ANIM_DURATION 才到 opacity:1。controller（content 上的占位动画）
 * finish 不会带动这些子动画。这里遍历 content 及其后代的 getAnimations()，统一 finish，
 * 确保所有字符停在终态、末字可见，再补录一帧干净成品帧。
 *
 * 容错：fill:'forwards' 的动画 finish 后保持终态；个别浏览器 finish 抛错则忽略。
 */
export function finishAllAnimations(content: HTMLElement): void {
  const targets: Element[] = [content, ...content.querySelectorAll('*')];
  for (const el of targets) {
    // Element.getAnimations() 返回直接作用于该元素的 Animation（含子动画）
    const anims = typeof el.getAnimations === 'function' ? el.getAnimations() : [];
    for (const a of anims) {
      try {
        // finish 把 currentTime 跳到 end，fill:forwards/both 的动画保持终态
        if (a.playState !== 'finished') a.finish();
      } catch {
        // 个别动画（无效果时间轴等）finish 可能抛错，忽略
      }
    }
  }
}

/**
 * 把 content 子树里所有 WAAPI 动画的 currentTime 设到 t（毫秒）——离线逐帧录制的核心。
 *
 * 为什么需要遍历所有动画而非只设 controller：逐字类动画把每个字符 span 各自 animate
 * （独立的 Animation，各有 delay/duration）。controller（content 上的占位动画）只是
 * 为了对外暴露统一的 currentTime/finish 控制，设它的 currentTime 不会同步子动画。
 * 离线逐帧渲染必须让每个子动画都「定格在 t 时刻的画面」，故遍历 content 子树所有
 * 元素的 getAnimations()，统一 seek。
 *
 * 实现：每个动画先暂停（避免 playState 干扰），再设 currentTime。
 * 容错：个别动画 seek 抛错则忽略。
 */
export function seekAllAnimations(content: HTMLElement, t: number): void {
  const targets: Element[] = [content, ...content.querySelectorAll('*')];
  for (const el of targets) {
    const anims = typeof el.getAnimations === 'function' ? el.getAnimations() : [];
    for (const a of anims) {
      try {
        if (a.playState !== 'paused') a.pause();
        a.currentTime = t;
      } catch {
        // 忽略
      }
    }
  }
}

/**
 * 选择浏览器支持的录制 mime，优先 MP4（H.264），回退 WebM（VP9/VP8）。
 *
 * MP4/H.264 兼容性更广（可直接在微信、iOS、各类播放器打开），Chrome 126+、
 * Safari 14+ 支持 MediaRecorder 录制 MP4；不支持的浏览器自动回退 WebM。
 * 通过 MediaRecorder.isTypeSupported 检测，按候选顺序取首个支持项。
 */
function pickMime(): PickedMime | null {
  const candidates: PickedMime[] = [
    { mime: 'video/mp4;codecs=avc1.640028', ext: 'mp4' }, // H.264 High 5.1（4K 常用）
    { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' }, // H.264 Baseline 3.0
    { mime: 'video/mp4;codecs=h264', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mime)) {
      return c;
    }
  }
  return null;
}

/**
 * 导出视频。调用方需在调用前把 surface 置为导出态（transform:none、原始尺寸），
 * 调用后负责恢复。
 */
export async function exportVideo(opts: VideoExportOptions): Promise<VideoExportResult> {
  const { surface, aspect, effect, quote } = opts;
  const videoFps = opts.videoFps ?? DEFAULT_FPS;
  const fps = videoFps.fps;
  const tailMs = opts.tailMs ?? 800;
  const resolution = opts.resolution ?? DEFAULT_RES;

  // 1. 能力检测
  if (typeof MediaRecorder === 'undefined') {
    return { ok: false, reason: '当前浏览器不支持视频录制（MediaRecorder）' };
  }
  const picked = pickMime();
  if (!picked) {
    return { ok: false, reason: '当前浏览器不支持视频录制（MP4/WebM）' };
  }
  const { mime, ext } = picked;

  // 2. 离屏 canvas：按分辨率档位放大（shortSide/1080 为缩放比）。
  //    画板基础短边 1080，目标短边 = resolution.shortSide。
  const scale = resolution.shortSide / 1080;
  const cw = Math.round(aspect.w * scale);
  const ch = Math.round(aspect.h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { ok: false, reason: '无法创建画布上下文' };
  }
  // 先填一帧空白（避免首帧黑屏）
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // —— 离线逐帧录制：captureStream(0) = 手动 requestFrame 模式 ——
  // 与「实时录制」(captureStream(fps) + rAF) 的根本区别：
  //   实时录制时，每帧栅格化(html-to-image)若 >1/fps 秒，captureStream 就捕不到那帧 → 掉帧。
  //   手动模式下，我们主动控制「何时推进一帧」：设好 anim.currentTime → 栅格化到 canvas →
  //   track.requestFrame() 告诉 MediaRecorder「这帧画好了，采一帧」。栅格化多慢都不掉帧，
  //   成品帧率精确 = fps（代价是录制总耗时 = 总帧数 × 单帧栅格化耗时，比实时慢）。
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  if (!track || typeof track.requestFrame !== 'function') {
    // 兜底：浏览器不支持手动帧模式时，退回实时录制
    return realtimeFallback(opts, mime, ext, fps, tailMs, resolution);
  }
  // 高清码率：按录制画布像素总量估算（1080² 约 14Mbps，4K 相应提升），保证文字清晰。
  // 帧率越高、码率相应上调，避免高频细节压缩糊。
  const pixels = cw * ch;
  const fpsFactor = fps / 60;
  const bitrate = Math.max(8_000_000, Math.round((pixels / (1920 * 1080)) * 14_000_000 * fpsFactor));
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  // 3. 构建动画：buildForExport 会运行 effect.build，逐字类效果借此把每个字符 span 的
  //    子动画都建好。离线逐帧渲染靠 seekAllAnimations 驱动这些子动画，不需要 controller
  //    自动播放，故拿到后立刻 pause。
  const content = surface.querySelector('.quote-card-content') as HTMLElement | null;
  if (!content) {
    return { ok: false, reason: '卡片内容层缺失' };
  }

  // pixelRatio = scale × 2：先按分辨率档位放大，再 2× 超采样，drawImage 降采样到录制 canvas，文字锐利。
  const pr = Math.max(2, scale * 2);
  /** 把当前 surface 栅格化到录制 canvas（一帧） */
  const rasterize = async (): Promise<void> => {
    try {
      const frame = await toCanvas(surface, { pixelRatio: pr, cacheBust: false });
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
    } catch {
      // 单帧失败保留上一帧
    }
  };

  // 总帧数 = 动画时长 + 200ms 收尾余量 + 尾帧定格，全部按 fps 离散化。
  const totalMs = ANIM_DURATION + 200 + tailMs;
  const totalFrames = Math.max(1, Math.round((totalMs / 1000) * fps));
  const anim = buildForExport(effect, content, quote);
  try {
    anim.pause();
  } catch {
    // 忽略
  }

  /** 取消 content 子树所有动画（含逐字子动画），录制结束/出错时清理用 */
  const cancelAll = (): void => {
    try { anim.cancel(); } catch { /* 忽略 */ }
    const targets: Element[] = [content, ...content.querySelectorAll('*')];
    for (const el of targets) {
      const anims = typeof el.getAnimations === 'function' ? el.getAnimations() : [];
      for (const a of anims) {
        try { a.cancel(); } catch { /* 忽略 */ }
      }
    }
  };

  return new Promise<VideoExportResult>((resolve) => {
    const cleanup = () => {
      cancelAll();
    };

    recorder.onstop = () => {
      cleanup();
      const blob = new Blob(chunks, { type: mime });
      if (blob.size === 0) {
        resolve({ ok: false, reason: '录制内容为空' });
        return;
      }
      resolve({ ok: true as const, format: ext });
      setTimeout(() => {
        const fname = `名言_${quote.author.slice(0, 12)}-${quote.text.slice(0, 12)}`.replace(/[\\/:*?"<>|\n\r\s]/g, '_');
        downloadBlob(blob, `${fname}.${ext}`);
      }, 50);
    };

    recorder.onerror = () => {
      cleanup();
      resolve({ ok: false, reason: '录制过程出错' });
    };

    // 4. 逐帧渲染循环：第 i 帧对应虚拟时间 t = i / fps * 1000 ms。
    //    离线逐帧：每帧把 content 子树所有动画 seek 到 t（见 seekAllAnimations）→
    //    栅格化 → track.requestFrame() 让 MediaRecorder 采这帧。栅格化多慢都不掉帧，
    //    成品帧率精确 = fps。逐字类的「逐字显现」靠 seek 每个子动画到 t 实现。
    let frameIdx = 0;
    let finishedAll = false;

    const renderFrame = async (): Promise<void> => {
      const t = (frameIdx / fps) * 1000; // 这一帧对应的虚拟时间(ms)

      if (t <= ANIM_DURATION) {
        // 动画时长内：所有子动画 seek 到 t，定格该时刻画面
        seekAllAnimations(content, t);
      } else if (!finishedAll) {
        // 超出动画时长的第一帧：末态收尾——finish 所有子动画（修逐字末字缺失），定格终态。
        finishedAll = true;
        finishAllAnimations(content);
        await new Promise((r) => setTimeout(r, 20)); // 等重排
      }

      await rasterize();
      // 通知 MediaRecorder 采这一帧
      try {
        track.requestFrame();
      } catch {
        // 忽略
      }

      frameIdx++;
      if (frameIdx < totalFrames) {
        // 让出主线程一拍，避免长时间阻塞 UI（导出按钮显示「录制中」、页面不卡死），
        // 同时给 ondataavailable 触发机会。
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        void renderFrame();
      } else {
        // 全部帧渲染完，停止录制（MediaRecorder 会 flush 最后的 chunk）
        if (recorder.state !== 'inactive') {
          try {
            recorder.stop();
          } catch {
            cleanup();
            resolve({ ok: false, reason: '停止录制失败' });
          }
        }
      }
    };

    // 5. 启动：开始录制 → 逐帧渲染
    try {
      recorder.start();
      void renderFrame();
    } catch (e) {
      cleanup();
      resolve({ ok: false, reason: e instanceof Error ? e.message : '启动录制失败' });
    }
  });
}

/**
 * 实时录制兜底：当浏览器不支持 canvas.captureStream(0) + track.requestFrame()
 * （手动帧模式）时退回老路径。此时掉帧风险仍在，但至少能出片。
 */
async function realtimeFallback(
  opts: VideoExportOptions,
  mime: string,
  ext: 'mp4' | 'webm',
  fps: number,
  tailMs: number,
  resolution: VideoResolution,
): Promise<VideoExportResult> {
  const { surface, aspect, effect, quote } = opts;
  const scale = resolution.shortSide / 1080;
  const cw = Math.round(aspect.w * scale);
  const ch = Math.round(aspect.h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, reason: '无法创建画布上下文' };
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const stream = canvas.captureStream(fps);
  const pixels = cw * ch;
  const bitrate = Math.max(10_000_000, Math.round((pixels / (1920 * 1080)) * 14_000_000));
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const content = surface.querySelector('.quote-card-content') as HTMLElement | null;
  if (!content) return { ok: false, reason: '卡片内容层缺失' };

  const pr = Math.max(2, scale * 2);
  return new Promise<VideoExportResult>((resolve) => {
    let rafId = 0;
    let stopTimer = 0;
    let anim: Animation | null = null;
    const cleanup = () => {
      cancelAnimationFrame(rafId);
      clearTimeout(stopTimer);
      try { anim?.cancel(); } catch { /* 忽略 */ }
    };
    recorder.onstop = () => {
      cleanup();
      const blob = new Blob(chunks, { type: mime });
      if (blob.size === 0) { resolve({ ok: false, reason: '录制内容为空' }); return; }
      resolve({ ok: true as const, format: ext });
      setTimeout(() => {
        const fname = `名言_${quote.author.slice(0, 12)}-${quote.text.slice(0, 12)}`.replace(/[\\/:*?"<>|\n\r\s]/g, '_');
        downloadBlob(blob, `${fname}.${ext}`);
      }, 50);
    };
    recorder.onerror = () => { cleanup(); resolve({ ok: false, reason: '录制过程出错' }); };
    const paintFrame = async () => {
      try {
        const frame = await toCanvas(surface, { pixelRatio: pr, cacheBust: false });
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      } catch { /* 保留上一帧 */ }
      const t = anim ? Number(anim.currentTime) : ANIM_DURATION;
      if (t < ANIM_DURATION) {
        rafId = requestAnimationFrame(paintFrame);
      }
    };
    try {
      recorder.start();
      anim = buildForExport(effect, content, quote);
      anim.currentTime = 0;
      anim.play();
      rafId = requestAnimationFrame(paintFrame);
      stopTimer = window.setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, ANIM_DURATION + 200 + tailMs);
    } catch (e) {
      cleanup();
      resolve({ ok: false, reason: e instanceof Error ? e.message : '启动录制失败' });
    }
  });
}
