// 二维码生成器主入口：共享可变状态（cfg / logoBitmap / activeDotEffect）+ 预览重绘 +
// 状态提示 + 导出按钮 + 整体装配与初始化。
// 依赖方向：controls / upload-panel / style-dialog 三个面板模块由本文件装配；
// 各面板经参数注入 state 引用与回调，不反向 import 本文件。

import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import type { QrConfig } from './types';
import { buildModules, drawQr } from './render';
import { loadConfig, saveConfig } from './settings';
import { downloadCanvasPng, copyCanvasToClipboard, safeFilename } from './export';
import {
  findCustomStyle,
  isCustomStyleId,
  compileDotEffect,
  type DotEffectFn,
} from './custom-styles';
import { createControlsPanel, field } from './controls';
import { createLogoSection, createDecodeSection } from './upload-panel';
import { createStyleDialog } from './style-dialog';

initTheme();

/**
 * 二维码生成器 —— 输入内容 → 实时预览 → 美化 → 导出。
 *
 * 布局（左控制 / 右预览，窄屏堆叠）：
 *   左：内容输入、码点形状、定位眼形状、纠错等级、前景/背景色、Logo 上传与开关
 *   右：实时预览 canvas + 上传已有二维码解码美化 + 导出 PNG / 复制
 *
 * 任何配置或内容变化都触发防抖重绘。Logo 上传后缓存 ImageBitmap，
 * 开关切换不重复解码。上传二维码图片 → jsQR 解码 → 回填内容并用当前风格重绘。
 */
function renderQrCode(): void {
  const { content } = renderToolLayout(document.getElementById('app')!, '二维码生成器');

  const cfg: QrConfig = loadConfig();
  // 跨面板共享的可变状态（原巨型闭包中的 let 变量）：各面板模块经参数注入的同一引用读写。
  const state = {
    cfg,
    logoBitmap: null as ImageBitmap | null, // Logo 缓存，关闭开关不丢（upload-panel 写，重绘读）
    // 当前激活的码点叠加钩子（来自 AI 风格的 dotEffectCode）。null=无叠加。
    // 由套用 AI 风格 / 切换内置预设 / 重进恢复 时设置；手动改颜色/形状不清空它。
    activeDotEffect: null as DotEffectFn | null,
  };
  let lastCanvas: HTMLCanvasElement | null = null; // 供导出复用

  function persist(): void {
    saveConfig(cfg);
  }

  // ────────── 预览区 ──────────
  const previewWrap = h('div', {
    class:
      'flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-6 min-h-[320px]',
  });
  const statusLine = h('div', {
    class: 'min-h-[1.25rem] text-xs text-[var(--fg-muted)] text-center',
  });

  /** 防抖重绘 */
  let drawTimer: number | undefined;
  function scheduleDraw(): void {
    clearTimeout(drawTimer);
    drawTimer = window.setTimeout(() => void redraw(), 80);
  }

  async function redraw(): Promise<void> {
    const text = cfg.text.trim();
    if (!text) {
      previewWrap.replaceChildren(
        h('div', {
          class: 'text-sm text-[var(--fg-muted)]',
          textContent: '输入内容后这里会显示二维码',
        }),
      );
      lastCanvas = null;
      return;
    }
    showStatus('生成中…');
    try {
      const modules = await buildModules(text, cfg.errorLevel);
      const { canvas } = drawQr(modules, cfg, state.logoBitmap, 1024, state.activeDotEffect);
      // 预览缩放：CSS 限制最大 320px，保持像素高清
      canvas.style.maxWidth = '320px';
      canvas.style.height = 'auto';
      canvas.style.width = '100%';
      previewWrap.replaceChildren(canvas);
      lastCanvas = canvas;
      showStatus('');
    } catch (err) {
      previewWrap.replaceChildren(
        h('div', {
          class: 'px-4 text-center text-sm text-[var(--holiday-legal)]',
          textContent: err instanceof Error ? err.message : '生成失败',
        }),
      );
      lastCanvas = null;
      showStatus('');
    }
  }

  // ────────── 状态提示 ──────────
  let statusTimer: number | undefined;
  function showStatus(msg: string, isError = false): void {
    clearTimeout(statusTimer);
    statusLine.textContent = msg;
    statusLine.style.color = isError ? 'var(--holiday-legal)' : 'var(--fg-muted)';
    if (!isError && msg) {
      statusTimer = window.setTimeout(() => {
        statusLine.textContent = '';
      }, 2500);
    }
  }

  // ────────── 导出 ──────────
  const downloadBtn = h('button', {
    type: 'button',
    class:
      'inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
    textContent: '⬇ 下载 PNG',
    onclick: () => {
      if (!lastCanvas) {
        showStatus('请先生成二维码', true);
        return;
      }
      downloadCanvasPng(lastCanvas, safeFilename(cfg.text));
      showStatus('已下载', false);
    },
  });
  const copyBtn = h('button', {
    type: 'button',
    class:
      'inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2 text-sm text-[var(--fg)] hover:border-[var(--accent)] transition-colors',
    textContent: '⧉ 复制图片',
    onclick: async () => {
      if (!lastCanvas) {
        showStatus('请先生成二维码', true);
        return;
      }
      const ok = await copyCanvasToClipboard(lastCanvas);
      showStatus(ok ? '已复制到剪贴板' : '当前浏览器不支持复制图片，请用下载', !ok);
    },
  });

  // ────────── 装配 ──────────
  const panel = createControlsPanel({ state, scheduleDraw, persist, showStatus });
  const logoSection = createLogoSection({
    cfg: state.cfg,
    state,
    scheduleDraw,
    persist,
    showStatus,
    renderLevelRow: panel.renderLevelRow,
    logoFitField: panel.logoFitField,
  });
  const decodeSection = createDecodeSection({
    cfg: state.cfg,
    textInput: panel.textInput,
    redraw,
    persist,
    showStatus,
  });
  const styleDialog = createStyleDialog({ cfg: state.cfg, applyStyle: panel.applyStyle });

  panel.renderLevelRow();

  // 「一键套用风格」区：预设行 + AI 风格助手入口按钮
  const styleField = h('div', { class: 'space-y-1.5' }, [
    h('div', { class: 'flex items-center gap-1.5' }, [
      h('div', {
        class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]',
        textContent: '一键套用风格',
      }),
      styleDialog.aiHelpBtn,
    ]),
    panel.presetRow,
  ]);

  const controls = h('div', { class: 'space-y-5' }, [
    field('内容', panel.textInput),
    styleField,
    field('码点形状', panel.dotRow),
    field('定位眼形状', panel.eyeRow),
    field('纠错等级', panel.levelContainer),
    h('div', { class: 'grid grid-cols-2 gap-3' }, [
      field('码点颜色', panel.fgInput),
      field('背景颜色', panel.bgInput),
    ]),
    logoSection.root,
  ]);

  const previewCol = h('div', { class: 'space-y-4' }, [
    previewWrap,
    statusLine,
    h('div', { class: 'flex flex-wrap justify-center gap-2' }, [downloadBtn, copyBtn]),
    decodeSection.root,
  ]);

  content.append(
    h('p', {
      class: 'mb-6 text-sm text-[var(--fg-muted)]',
      textContent:
        '生成可定制风格的二维码：一键套用风格预设，或自选码点/定位眼/配色/Logo。上传已有二维码（含海报里的多个码）识别后用当前风格美化重绘。全程本地处理。',
    }),
    h('div', { class: 'grid gap-6 lg:grid-cols-2' }, [controls, previewCol]),
  );

  // 初始绘制：先填充各选择器，再画二维码
  panel.rebuildDotRow();
  panel.rebuildEyeRow();
  panel.renderPresetRow();
  panel.renderLogoFitRow();
  // 恢复上次激活的 AI 风格的码点钩子（内置预设无钩子，跳过）。
  // 编译失败时降级为仅配色（钩子留空），不阻塞初始绘制。
  if (cfg.activeStyleId && isCustomStyleId(cfg.activeStyleId)) {
    const style = findCustomStyle(cfg.activeStyleId);
    if (style && style.dotEffectCode) {
      try {
        state.activeDotEffect = compileDotEffect(style.dotEffectCode);
      } catch {
        state.activeDotEffect = null;
      }
    }
  }
  void redraw();

  // 恢复持久化的图片（Logo / 识别原图），均异步（dataURL→bitmap），恢复后重绘。
  // 这两个恢复互相独立，并行进行。
  void logoSection.restoreLogo();
  void decodeSection.restoreDetected();
}

renderQrCode();
