/**
 * 操作按钮区（buildActions）：复制纯文本 / 复制 HTML / 下载 PNG，
 * 以及按钮 flash 反馈与富 HTML 剪贴板写入。
 *
 * 依赖方向：依赖 core 的 h/clipboard、serialize 与 export 模块；
 * 共享状态（state/currentCells/currentGridWidth/loadedImage）与
 * htmlCopyBtn / plainTextHint 前向引用经 ControlsContext 显式传入并回写
 * （原为 main.ts render() 闭包变量，语义不变；frameWrap 由 main.ts 装配时传入）。
 */

import { h } from '@/core/components/element';
import { copyText } from '@/core/utils/clipboard';
import { serializeText } from './serialize/to-text';
import { buildStandaloneHtml } from './serialize/to-html';
import { downloadPng, safeFilename } from './export';
import { downloadPngCanvas } from './render/canvas-export';
import type { ControlsContext } from './controls-context';

export function buildActions(ctx: ControlsContext, frameWrap: HTMLElement): HTMLElement {
  const { state, updatePlainTextHint } = ctx;
  // 纯文本错位提示：非点阵找字 + 含全角字时显示（CSS 压缩只对预览/HTML/PNG，纯文本仍错位）
  // （回写到 ctx.plainTextHint：updatePlainTextHint 经 ctx 读取，等价于原 render() 闭包前向声明）
  const plainTextHint = h('span', {
    class: 'text-[11px] text-[var(--fg-muted)]',
    title: '全角字符在纯文本中占 2 字符宽，无法对齐',
    textContent: '⚠ 全角字符在纯文本中无法对齐',
  });
  ctx.plainTextHint = plainTextHint;
  const textBtn = h('button', {
    type: 'button',
    class:
      'inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--fg)] hover:opacity-80 transition-opacity',
    title: '复制字符画纯文本（不含外框）',
    textContent: '复制纯文本',
    onclick: async () => {
      // 图片模式 / 文字流 Logo 模式：复制序列化的字符画；纯文字流：复制原文本
      const text =
        state.mode === 'image' || (state.mode === 'text' && state.textLogo)
          ? serializeText(ctx.currentCells, state.cfg.charset)
          : state.text;
      const ok = await copyText(text);
      flash(textBtn, ok ? '已复制 ✓' : '复制失败');
    },
  });

  // （回写到 ctx.htmlCopyBtn：buildControls 的 updateModeVisibility 经 ctx 读取其显隐，
  // 与原 render() 闭包前向声明语义一致）
  const htmlCopyBtn = h('button', {
    type: 'button',
    class:
      'inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--fg)] hover:opacity-80 transition-opacity',
    title: '复制完整 HTML 页面（含终端外框、配色、CRT 效果、字符画，粘到 .html 文件可直接打开）',
    textContent: '复制 HTML',
    onclick: async () => {
      // 从预览区取实际终端外框元素，生成完整独立 HTML 页面源码
      const frame = frameWrap.firstElementChild as HTMLElement | null;
      if (!frame) {
        flash(htmlCopyBtn, '无内容可复制');
        return;
      }
      const html = buildStandaloneHtml(frame);
      const ok = await copyRichHtml(html);
      flash(htmlCopyBtn, ok ? '已复制 ✓' : '复制失败');
    },
  });
  ctx.htmlCopyBtn = htmlCopyBtn;

  const pngBtn = h('button', {
    type: 'button',
    class:
      'inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
    title: '下载 PNG（含终端外框）',
    textContent: '下载 PNG',
    onclick: async () => {
      const frame = frameWrap.firstElementChild as HTMLElement | null;
      if (!frame) return;
      // 导出全程禁用按钮 + 显示「生成中…」（downloadPng 可能数秒，不走 flash 的 1.5s 自动恢复，
      // 否则按钮会在导出途中提前恢复可点 → 用户重复点击触发并发导出）
      const b = pngBtn as HTMLButtonElement;
      if (!b.dataset.label) b.dataset.label = b.textContent ?? '';
      b.textContent = '生成中…';
      b.disabled = true;
      // 图片模式：W=cfg.width；文字流 Logo 模式：W=currentGridWidth；纯文字流：0（用预览原样字号）
      const W =
        state.mode === 'image' ? state.cfg.width : state.textLogo ? ctx.currentGridWidth : 0;
      const name =
        state.mode === 'image'
          ? (ctx.loadedImage?.name ?? '字符画')
          : state.textLogo
            ? (state.text.split('\n')[0] ?? 'logo') + '-logo'
            : (state.text.split('\n')[0] ?? '文字流');
      // Cell 模式（图片 / Logo）用 Canvas 自绘导出（所见即所得，无 html-to-image 的
      // SVG foreignObject 子像素漂移）；纯文字流 / 无网格时回退 DOM 截图。
      const hasCells = ctx.currentCells.length > 0;
      const result =
        (state.mode === 'text' && !state.textLogo) || !hasCells
          ? await downloadPng(frame, W, safeFilename(name))
          : await downloadPngCanvas(ctx.currentCells, state.cfg, W, safeFilename(name));
      // 导出完成：用 flash 显示结果（1.5s 后恢复「下载 PNG」）
      flash(pngBtn, result.ok ? '已下载 ✓' : `失败：${result.reason}`);
    },
  });

  updatePlainTextHint();
  return h('div', { class: 'flex flex-wrap items-center gap-2' }, [
    textBtn,
    plainTextHint,
    htmlCopyBtn,
    pngBtn,
  ]);
}

/**
 * 临时把按钮文案改成 text，1500ms 后恢复原样；并发安全。
 *
 * 关键：用 per-button 自增 token 防止「生成中…」和「已下载 ✓」两次 flash 叠加出错——
 * 旧实现捕获 orig=按钮当前文案，但若两次 flash 间隔 < 1500ms，第二次的 orig 会是中间态
 * （如「生成中…」），恢复时把按钮永久卡在中间态。
 * 现在：每次 flash 拿一个新 token，setTimeout 回调只在自己仍是最新 token 时才恢复；
 * 按钮的「真实文案」固定记在 dataset，恢复永远回到它。
 */
function flash(btn: HTMLElement, text: string): void {
  const b = btn as HTMLButtonElement;
  // 首次记录按钮的真实文案（data-label），后续永远恢复到它
  if (!b.dataset.label) b.dataset.label = b.textContent ?? '';
  b.textContent = text;
  b.disabled = true;
  const token = (Number(b.dataset.flashToken ?? '0') + 1) % 1e9;
  b.dataset.flashToken = String(token);
  setTimeout(() => {
    // 只有最新的 flash 才恢复（被更新的 flash 抢占则不动）
    if (b.dataset.flashToken === String(token)) {
      b.textContent = b.dataset.label!;
      b.disabled = false;
    }
  }, 1500);
}

/**
 * 复制完整 HTML 页面源码到剪贴板。
 * text/html 和 text/plain 都写同一份完整 HTML 源码（<!doctype>...</html>），
 * 这样无论粘贴方读哪个 MIME，粘到空白 .html 文件 / 记事本 / 编辑器，
 * 都得到完整页面源码，保存为 .html 打开即可预览完整终端页面。
 * ClipboardItem 不可用时回退 execCommand 复制纯文本（同样是 HTML 源码）。
 */
async function copyRichHtml(html: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      const htmlBlob = new Blob([html], { type: 'text/html' });
      const plainBlob = new Blob([html], { type: 'text/plain' });
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': plainBlob }),
      ]);
      return true;
    }
  } catch {
    // 回退
  }
  // 回退：execCommand 复制（内容同样是完整 HTML 源码）
  return copyText(html);
}
