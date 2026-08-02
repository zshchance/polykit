/**
 * 终端外框 DOM 构建。
 *
 * 结构（showFrame=true 时）：
 *   .ascii-frame（外框，圆角/边框/CRT 容器）
 *     .ascii-titlebar（标题栏：圆点 + title 文字）
 *     .ascii-screen（屏幕区：扫描线覆盖层 + 内容 pre）
 *       .ascii-scanlines（CRT 扫描线，pointer-events:none）
 *       <contentEl>（调用方传入的 <pre>）
 *
 * showFrame=false 时（如白纸风格）：只返回 contentEl 的直接包装（背景 + padding）。
 *
 * CRT 弧度用 .ascii-screen 的 transform（perspective + rotateX），导出时由 export.ts
 * 切 .exporting 类复位 transform（html-to-image 截 transform 会变形）。
 */

import { h } from '@/core/components/element';
import type { StyleConfig } from '../types';
import { getTerminalMeta } from '../presets';

/**
 * 构建终端外框。
 * @param cfg 风格配置
 * @param contentEl 内容元素（通常是 <pre>），会被放进屏幕区
 * @returns 外框根元素（用于预览/导出截图）
 */
export function buildTerminalFrame(cfg: StyleConfig, contentEl: HTMLElement): HTMLElement {
  if (!cfg.showFrame) {
    // 无外框：直接背景 + padding + 内容
    return h('div', {
      class: 'ascii-frame ascii-frame--bare',
      style: [
        `background:${cfg.bg};`,
        `color:${cfg.fg};`,
        `padding:${cfg.padding}px;`,
        'box-sizing:border-box;',
        'display:inline-block;',
        'font-family:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;',
        cfg.crtGlow ? `text-shadow:0 0 8px ${cfg.fg};` : '',
      ].join(''),
    }, [contentEl]);
  }

  const meta = getTerminalMeta(cfg.terminal);

  // 标题栏圆点
  const dots =
    meta.dots
      ? h('div', { class: 'flex items-center gap-1.5' }, [
          h('span', { style: `width:12px;height:12px;border-radius:50%;background:${meta.dots[0]};display:inline-block;` }),
          h('span', { style: `width:12px;height:12px;border-radius:50%;background:${meta.dots[1]};display:inline-block;` }),
          h('span', { style: `width:12px;height:12px;border-radius:50%;background:${meta.dots[2]};display:inline-block;` }),
        ])
      : h('div');

  const titlebar = h('div', {
    class: 'ascii-titlebar',
    style: [
      'display:flex;',
      'align-items:center;',
      `gap:${meta.dots ? '12px' : '0'};`,
      'padding:8px 12px;',
      meta.barBg ? `background:${meta.barBg};` : '',
      `color:${readableBarFg(cfg)};`,
      'font-size:13px;',
      'font-family:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;',
    ].join(''),
  }, [
    dots,
    h('span', { style: 'flex:1;text-align:center;opacity:0.85;', textContent: cfg.title }),
    // 右侧占位平衡布局
    h('span', { style: 'width:54px;' }),
  ]);

  // 屏幕区：扫描线 + 内容
  const scanlines = cfg.crtScanlines
    ? h('div', {
        class: 'ascii-scanlines',
        style: [
          'position:absolute;',
          'inset:0;',
          'pointer-events:none;',
          `background:repeating-linear-gradient(to bottom,transparent 0,transparent 2px,rgba(0,0,0,0.15) 3px,transparent 4px);`,
          'z-index:2;',
        ].join(''),
      })
    : null;

  const screen = h('div', {
    class: 'ascii-screen',
    style: [
      'position:relative;',
      `background:${cfg.bg};`,
      `color:${cfg.fg};`,
      `padding:${cfg.padding}px;`,
      'box-sizing:border-box;',
      'overflow:hidden;',
      cfg.crtCurve ? 'transform:perspective(800px) rotateX(1.5deg);' : '',
      cfg.crtGlow ? `text-shadow:0 0 8px ${cfg.fg};` : '',
    ].join(''),
  }, [scanlines, contentEl].filter(Boolean) as HTMLElement[]);

  return h('div', {
    class: 'ascii-frame',
    style: [
      'display:inline-block;',
      'border-radius:' + meta.radius + 'px;',
      'overflow:hidden;',
      'border:1px solid rgba(128,128,128,0.25);',
      'box-shadow:0 8px 32px rgba(0,0,0,0.35);',
      'font-family:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;',
    ].join(''),
  }, [titlebar, screen]);
}

/** 标题栏文字色：根据屏幕背景明暗选白/黑，保证可读。 */
function readableBarFg(cfg: StyleConfig): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(cfg.bg.trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 140 ? '#1a1a1a' : '#e5e7eb';
}
