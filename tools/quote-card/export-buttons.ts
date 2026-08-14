/**
 * 名言卡片 —— 导出按钮（图片 + 视频）与状态提示。
 *
 * 从 main.ts 拆出：downloadImgBtn / downloadVideoBtn / exportHint / exportRow。
 * 图片导出需把动画跳到终态再截「成品」；视频导出走离屏逐帧录制，
 * 导出期间临时移除画板缩放（.exporting），完成后恢复预览态。
 *
 * 依赖方向：依赖 core 的 h()、card.renderCard、export.downloadCard、
 * video-export.exportVideo/finishAllAnimations、templates.getTemplate；
 * 画板元素、编辑态、当前宽高比/动画/分辨率/帧率与重绘/适配回调等闭包依赖
 * 由 main.ts 通过 createExportRow(deps) 显式注入。
 */

import { h } from '@/core/components/element';
import { renderCard } from './card';
import { downloadCard, safeFilename } from './export';
import { getTemplate } from './templates';
import { exportVideo, finishAllAnimations } from './video-export';
import type { QuoteCardState } from './state';
import type { Aspect } from './aspect';
import type { AnimEffect } from './animations';
import type { VideoResolution, VideoFps } from './video-export';

/** createExportRow 的依赖（由 main.ts 注入，替代原闭包变量） */
export interface ExportRowDeps {
  /** 共享编辑态（读 quote / templateId 供导出） */
  state: QuoteCardState;
  /** 卡片画板（截图/录制的源元素） */
  cardEl: HTMLElement;
  /** 当前宽高比对象 */
  currentAspect: () => Aspect;
  /** 当前动画效果 */
  currentAnim: () => AnimEffect;
  /** 当前视频分辨率 */
  currentVideoRes: () => VideoResolution;
  /** 当前视频帧率 */
  currentVideoFps: () => VideoFps;
  /** 重绘卡片预览（导出完成后恢复预览态） */
  rerenderCard: () => void;
  /** 按容器宽度重新适配画板缩放 */
  fitCardToContainer: () => void;
  /** 读当前播放中的动画对象（原闭包变量 currentAnimObj，导出时 finish/cancel） */
  getCurrentAnimObj: () => Animation | null;
}

/** 导出区 API */
export interface ExportRow {
  /** 导出按钮行（图片 + 视频） */
  exportRow: HTMLElement;
  /** 导出状态提示 */
  exportHint: HTMLElement;
}

export function createExportRow(deps: ExportRowDeps): ExportRow {
  const {
    state,
    cardEl,
    currentAspect,
    currentAnim,
    currentVideoRes,
    currentVideoFps,
    rerenderCard,
    fitCardToContainer,
    getCurrentAnimObj,
  } = deps;

  // 导出按钮（图片 + 视频）+ 状态提示
  const exportHint = h('div', { class: 'text-sm text-[var(--fg-muted)] min-h-[1.25rem]' });

  const downloadImgBtn = h('button', {
    type: 'button',
    class:
      'flex-1 rounded-md bg-[var(--accent)] px-4 py-2.5 text-[var(--accent-fg)] font-medium hover:opacity-90 transition-opacity',
    textContent: '📷 导出图片',
    onclick: async () => {
      downloadImgBtn.textContent = '生成中…';
      downloadImgBtn.disabled = true;
      // 图片导出需截「动画完成后的成品」：把动画跳到终态（finish），
      // 否则逐字/淡入等动画停在中间帧会截到半透明/缺字画面。
      // 注意：逐字类的字符 span 各有独立动画，finish controller 不够——
      // 必须把 content 子树所有子动画一并 finish，长文本末字才不会缺失。
      try {
        getCurrentAnimObj()?.finish();
        const contentEl = cardEl.querySelector('.quote-card-content') as HTMLElement | null;
        if (contentEl) finishAllAnimations(contentEl);
      } catch {
        // 忽略
      }
      cardEl.classList.add('exporting');
      cardEl.style.transform = 'none';
      await new Promise((r) => setTimeout(r, 50)); // 等重排
      const result = await downloadCard(cardEl, safeFilename(state.quote, '.png'));
      // 恢复
      cardEl.classList.remove('exporting');
      fitCardToContainer();
      // 重新播放动画（finish 后动画在终态，重播给预览一个完整入场）
      rerenderCard();
      downloadImgBtn.textContent = '📷 导出图片';
      downloadImgBtn.disabled = false;
      exportHint.textContent = result.ok ? '✓ 图片已下载' : `× 导出失败：${result.reason}`;
      exportHint.style.color = result.ok ? '#22c55e' : '#ef4444';
    },
  });

  const downloadVideoBtn = h('button', {
    type: 'button',
    class:
      'flex-1 rounded-md border border-[var(--accent)] bg-[var(--bg-elevated)] px-4 py-2.5 text-[var(--accent)] font-medium hover:opacity-90 transition-opacity',
    textContent: '🎬 导出视频',
    onclick: async () => {
      downloadVideoBtn.textContent = '录制中…';
      downloadVideoBtn.disabled = true;
      downloadImgBtn.disabled = true;
      exportHint.textContent = '正在录制动画过程，请稍候…';
      exportHint.style.color = 'var(--fg-muted)';
      // 导出态：surface 复位 transform、原始尺寸；重渲染确保最新内容
      getCurrentAnimObj()?.cancel();
      cardEl.classList.add('exporting');
      cardEl.style.transform = 'none';
      renderCard(cardEl, state.quote, getTemplate(state.templateId), currentAspect());
      await new Promise((r) => setTimeout(r, 80)); // 等重排 + 字体
      try {
        const result = await exportVideo({
          surface: cardEl,
          aspect: currentAspect(),
          effect: currentAnim(),
          quote: state.quote,
          resolution: currentVideoRes(),
          videoFps: currentVideoFps(),
        });
        exportHint.textContent = result.ok
          ? `✓ 视频已下载（${result.format.toUpperCase()} · ${currentVideoRes().name} · ${currentVideoFps().fps}fps）`
          : `× 视频导出失败：${result.reason}`;
        exportHint.style.color = result.ok ? '#22c55e' : '#ef4444';
      } finally {
        // 恢复预览态
        cardEl.classList.remove('exporting');
        rerenderCard();
        downloadVideoBtn.textContent = '🎬 导出视频';
        downloadVideoBtn.disabled = false;
        downloadImgBtn.disabled = false;
      }
    },
  });

  const exportRow = h('div', { class: 'flex gap-2' }, [downloadImgBtn, downloadVideoBtn]);

  return { exportRow, exportHint };
}
