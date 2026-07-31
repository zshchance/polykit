/**
 * 名言卡片视频导出（WebM，零新增依赖）。
 *
 * 原理：
 *   1. 创建离屏 canvas（aspect.w × aspect.h）。
 *   2. canvas.captureStream(fps) 取视频流，MediaRecorder 录制为 WebM。
 *   3. 重新构建入场动画（WAAPI Animation）并正常播放。
 *   4. 用 requestAnimationFrame 循环：每帧用 html-to-image 的 toCanvas 把 surface
 *      栅格化成 canvas，drawImage 到录制 canvas 上。captureStream 会自动捕获 canvas 变化。
 *   5. 动画播放完毕 + 尾帧定格 0.8s 后停止录制，收集 chunks 成 Blob 下载。
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

export type VideoExportResult = { ok: true } | { ok: false; reason: string };

export interface VideoExportOptions {
  /** 卡片 surface（已处于导出态：transform 复位、原始尺寸） */
  surface: HTMLElement;
  /** 宽高比（决定 canvas 尺寸） */
  aspect: Aspect;
  /** 动画效果 */
  effect: AnimEffect;
  /** 名言（动画构建需要） */
  quote: QuoteData;
  /** 录制帧率（默认 60，更流畅） */
  fps?: number;
  /** 尾帧定格时长（ms） */
  tailMs?: number;
}

/** 选择浏览器支持的 WebM 录制 mime */
function pickMime(): string | null {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) {
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

  // 1. 能力检测
  if (typeof MediaRecorder === 'undefined') {
    return { ok: false, reason: '当前浏览器不支持视频录制（MediaRecorder）' };
  }
  const mime = pickMime();
  if (!mime) {
    return { ok: false, reason: '当前浏览器不支持 WebM 视频录制' };
  }

  // 2. 离屏 canvas + 录制流
  const canvas = document.createElement('canvas');
  canvas.width = aspect.w;
  canvas.height = aspect.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { ok: false, reason: '无法创建画布上下文' };
  }
  // 先填一帧空白（避免首帧黑屏）
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const stream = canvas.captureStream(fps);
  // 高清码率：按画布像素总量估算（约 12Mbps for 1080²，保证文字清晰不糊）
  const pixels = aspect.w * aspect.h;
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
      const blob = new Blob(chunks, { type: 'video/webm' });
      if (blob.size === 0) {
        resolve({ ok: false, reason: '录制内容为空' });
        return;
      }
      resolve({ ok: true as const });
      // 延迟下载，确保 resolve 先返回
      setTimeout(() => {
        const fname = `名言_${quote.author.slice(0, 12)}-${quote.text.slice(0, 12)}`.replace(/[\\/:*?"<>|\n\r\s]/g, '_');
        downloadBlob(blob, `${fname}.webm`);
      }, 50);
    };

    recorder.onerror = () => {
      cleanup();
      resolve({ ok: false, reason: '录制过程出错' });
    };

    // 4. 每帧把 surface 栅格化到 canvas（captureStream 自动捕获）。
    //    pixelRatio:2 超采样让文字边缘更锐利（drawImage 时降采样到录制 canvas）。
    const paintFrame = async () => {
      try {
        const frame = await toCanvas(surface, { pixelRatio: 2, cacheBust: false });
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      } catch {
        // 单帧失败不中断录制，保留上一帧
      }
      // 动画未结束则继续（currentTime 类型为 CSSNumberish，统一转 number 比较）
      const t = anim ? Number(anim.currentTime) : ANIM_DURATION;
      if (t < ANIM_DURATION) {
        rafId = requestAnimationFrame(paintFrame);
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
      // 动画结束 + 尾帧后停止
      const totalMs = ANIM_DURATION + tailMs;
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
