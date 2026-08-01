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
  /** 录制帧率（默认 60，更流畅） */
  fps?: number;
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
  const fps = opts.fps ?? 60;
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

  const stream = canvas.captureStream(fps);
  // 高清码率：按录制画布像素总量估算（1080² 约 14Mbps，4K 相应提升），保证文字清晰。
  const pixels = cw * ch;
  const bitrate = Math.max(10_000_000, Math.round((pixels / (1920 * 1080)) * 14_000_000));
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  // 3. 重新渲染 surface 内容（确保是最新名言），并构建可控动画
  //    注意：surface 的 content 由调用方渲染（renderCard 已在导出前重跑），
  //    这里在现有 content 上构建动画。
  const content = surface.querySelector('.quote-card-content') as HTMLElement | null;
  if (!content) {
    return { ok: false, reason: '卡片内容层缺失' };
  }

  return new Promise<VideoExportResult>((resolve) => {
    let rafId = 0;
    let stopTimer = 0;
    let anim: Animation | null = null;

    const cleanup = () => {
      cancelAnimationFrame(rafId);
      clearTimeout(stopTimer);
      try {
        anim?.cancel();
      } catch {
        // 忽略
      }
    };

    recorder.onstop = () => {
      cleanup();
      const blob = new Blob(chunks, { type: mime });
      if (blob.size === 0) {
        resolve({ ok: false, reason: '录制内容为空' });
        return;
      }
      resolve({ ok: true as const, format: ext });
      // 延迟下载，确保 resolve 先返回
      setTimeout(() => {
        const fname = `名言_${quote.author.slice(0, 12)}-${quote.text.slice(0, 12)}`.replace(/[\\/:*?"<>|\n\r\s]/g, '_');
        downloadBlob(blob, `${fname}.${ext}`);
      }, 50);
    };

    recorder.onerror = () => {
      cleanup();
      resolve({ ok: false, reason: '录制过程出错' });
    };

    // 4. 每帧把 surface 栅格化到 canvas（captureStream 自动捕获）。
    //    pixelRatio = scale × 2：先按分辨率档位放大，再 2× 超采样，drawImage 降采样到
    //    录制 canvas，文字在高分辨率下依然锐利。
    const pr = Math.max(2, scale * 2);
    let settled = false; // 是否已做末态收尾（防重入）
    const paintFrame = async () => {
      try {
        const frame = await toCanvas(surface, { pixelRatio: pr, cacheBust: false });
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      } catch {
        // 单帧失败不中断录制，保留上一帧
      }
      // 动画未结束则继续（currentTime 类型为 CSSNumberish，统一转 number 比较）
      const t = anim ? Number(anim.currentTime) : ANIM_DURATION;
      if (t < ANIM_DURATION) {
        rafId = requestAnimationFrame(paintFrame);
      } else if (!settled) {
        // —— 末态收尾（修长文本末字缺失）——
        // 逐字类动画的末字可能略晚于 ANIM_DURATION 才到 opacity:1（如炫光/弹跳 eachDur 较长），
        // 此时 controller 已到点、绘制循环本会停帧，末字还半透明。这里把 content 上所有子动画
        // 强制 finish 到终态，再补一帧干净的「成品帧」，保证末字可见后再进入尾帧定格。
        settled = true;
        finishAllAnimations(content);
        await new Promise((r) => setTimeout(r, 30)); // 等重排
        try {
          const finalFrame = await toCanvas(surface, { pixelRatio: pr, cacheBust: false });
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(finalFrame, 0, 0, canvas.width, canvas.height);
        } catch {
          // 末帧失败则保留上一帧
        }
      }
    };

    // 5. 启动：开始录制 → 构建并播放动画 → 开始绘制循环
    try {
      recorder.start();
      // 构建动画（从头播放）
      anim = buildForExport(effect, content, quote);
      anim.currentTime = 0;
      anim.play();
      // 启动绘制
      rafId = requestAnimationFrame(paintFrame);
      // 动画结束 + 尾帧后停止。逐字末字有时略晚于 ANIM_DURATION，故多留 200ms 余量
      // 让收尾帧/末字稳定后再定格（上方 paintFrame 也会在到点后补一帧终态）。
      const totalMs = ANIM_DURATION + 200 + tailMs;
      stopTimer = window.setTimeout(() => {
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      }, totalMs);
    } catch (e) {
      cleanup();
      resolve({ ok: false, reason: e instanceof Error ? e.message : '启动录制失败' });
    }
  });
}
