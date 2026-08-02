/**
 * 导出 PNG —— 用 html-to-image 截取终端外框并下载。
 *
 * 关键时序（修复字体/字号切换未生效就截图的坑）：
 *   1) frameEl 加 .exporting 类：复位 CRT transform（防截图变形）+ 字号改绝对像素
 *   2) await document.fonts.ready：等 webfont 加载完（防首屏字体未就绪）
 *   3) await 一帧 requestAnimationFrame：等 .exporting 的样式变更实际应用
 *   4) toPng(pixelRatio:2)
 *   5) 移除 .exporting，恢复预览态
 *
 * 导出目标宽固定 1600px（pixelRatio 2 → 3200px 实际，够社交图）。
 * 字符宽 W → 字号 = 1600 / W（绝对像素，由 main.ts 注入内联 style）。
 */

import { toPng } from 'html-to-image';
import { downloadBlob } from '@/core/utils/clipboard';

export type ExportResult = { ok: true } | { ok: false; reason: string };

/** 导出目标宽（px）。 */
export const EXPORT_TARGET_WIDTH = 1600;

/**
 * 截图并下载。
 * @param frameEl 终端外框根元素（buildTerminalFrame 的返回值）
 * @param W 字符宽（仅图片模式用于算字号；文字流传 0 表示用预览原样字号）
 */
export async function downloadPng(frameEl: HTMLElement, W: number, filename: string): Promise<ExportResult> {
  // 注入导出态字号（图片模式）
  let styleInjector: HTMLStyleElement | null = null;
  if (W > 0) {
    const fontSize = EXPORT_TARGET_WIDTH / W;
    styleInjector = document.createElement('style');
    styleInjector.textContent = `.ascii-frame.exporting .ascii-screen pre,
.ascii-frame.exporting pre,
.ascii-frame--bare.exporting pre,
.ascii-frame--bare.exporting { font-size: ${fontSize}px !important; line-height: 1 !important; }`;
    document.head.append(styleInjector);
  }

  frameEl.classList.add('exporting');

  try {
    // 1) 等 webfont（加 2 秒超时保护，避免某些 webview fonts.ready 永不 resolve）
    if (document.fonts && document.fonts.ready) {
      await Promise.race([
        document.fonts.ready,
        new Promise<void>((resolve) => setTimeout(resolve, 2000)),
      ]);
    }
    // 2) 等一帧让 .exporting 样式生效
    //    rAF 在后台/不可见标签页会暂停，用 setTimeout 兜底（后台标签页是 IAB 常见场景）
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
      setTimeout(resolve, 100);
    });

    const dataUrl = await Promise.race([
      toPng(frameEl, {
        pixelRatio: 2,
        cacheBust: true,
        // 显式设背景，避免 html-to-image 默认白底覆盖透明区
        backgroundColor: undefined,
      }),
      // toPng 超时保护（15 秒）：某些受限 webview 会卡死，避免按钮永远停在「生成中」
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('导出超时，请重试或换浏览器')), 15000),
      ),
    ]);
    const blob = dataURLtoBlob(dataUrl);
    downloadBlob(blob, filename);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : '未知错误' };
  } finally {
    frameEl.classList.remove('exporting');
    styleInjector?.remove();
  }
}

function dataURLtoBlob(dataUrl: string): Blob {
  const [meta, base64] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(meta ?? '')?.[1] ?? 'image/png';
  const bin = atob(base64 ?? '');
  const len = bin.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** 生成安全文件名。 */
export function safeFilename(name: string, ext = '.png'): string {
  const base = name.replace(/[\\/:*?"<>|\n\r]/g, '').replace(/\s+/g, '_').slice(0, 30) || 'ascii-art';
  return `字符画_${base}${ext}`;
}
