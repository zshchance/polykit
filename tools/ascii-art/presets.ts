/**
 * 风格预设 —— 6 套完整 StyleConfig + 终端类型元信息。
 *
 * 选预设 = 整体替换 StyleConfig（所有参数同步）；用户调任一字段即派生。
 * aspectRatio 随 halfBlock：半块默认 1.0 / 纯字符默认 0.55（见 types.ts 注释）。
 */

import type { StyleConfig, TerminalType } from './types';
import { DEFAULT_CHARSET } from './charsets';

export interface StylePreset {
  id: string;
  name: string;
  /** 缩略图用的代表色（背景 + 文字色），供选择器预览。 */
  preview: { bg: string; fg: string };
  config: StyleConfig;
}

/** 半块模式默认宽高比系数（1 字符 = 2 像素行）。 */
export const ASPECT_HALF_BLOCK = 1.0;
/** 纯字符模式默认宽高比系数（等宽字体字符格高/宽≈2，校正纵向拉伸）。 */
export const ASPECT_TEXT = 0.55;

/** 终端类型元信息（标题栏样式差异）。 */
export interface TerminalMeta {
  id: TerminalType;
  name: string;
  /** 标题栏三个圆点配色（macOS 风：红黄绿）；null = 无圆点（如 cmd/bash）。 */
  dots: [string, string, string] | null;
  /** 标题栏背景色（null = 透明，继承外层）。 */
  barBg: string | null;
  /** 是否有外边框。 */
  bordered: boolean;
  /** 圆角 px。 */
  radius: number;
}

export const TERMINAL_METAS: TerminalMeta[] = [
  { id: 'macos', name: 'macOS 终端', dots: ['#ff5f56', '#ffbd2e', '#27c93f'], barBg: 'rgba(0,0,0,0.25)', bordered: true, radius: 10 },
  { id: 'iterm2', name: 'iTerm2', dots: ['#ff5f56', '#ffbd2e', '#27c93f'], barBg: 'rgba(0,0,0,0.18)', bordered: true, radius: 8 },
  { id: 'cmd', name: 'Windows CMD', dots: null, barBg: '#c0c0c0', bordered: true, radius: 2 },
  { id: 'bash', name: 'Linux bash', dots: null, barBg: 'rgba(0,0,0,0.3)', bordered: true, radius: 6 },
];

export function getTerminalMeta(id: TerminalType): TerminalMeta {
  return TERMINAL_METAS.find((t) => t.id === id) ?? TERMINAL_METAS[0]!;
}

// 共用的图片模式默认参数（半块真彩）
const imageDefaults = {
  charset: DEFAULT_CHARSET,
  width: 100,
  halfBlock: true,
  colorMode: true,
  contrast: 0,
  brightness: 0,
  invert: false,
  cursor: '_' as const,
  padding: 32,
};

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'retro',
    name: '复古终端',
    preview: { bg: '#0a1a0a', fg: '#33ff66' },
    config: {
      ...imageDefaults,
      aspectRatio: ASPECT_HALF_BLOCK,
      bg: '#0a1a0a',
      fg: '#33ff66',
      terminal: 'macos',
      title: 'zsh@matrix:~$',
      showFrame: true,
      crtScanlines: true,
      crtGlow: true,
      crtCurve: true,
    },
  },
  {
    id: 'amber',
    name: '琥珀屏',
    preview: { bg: '#1a0d00', fg: '#ffb000' },
    config: {
      ...imageDefaults,
      aspectRatio: ASPECT_HALF_BLOCK,
      bg: '#1a0d00',
      fg: '#ffb000',
      terminal: 'macos',
      title: 'amber@ibm:~$',
      showFrame: true,
      crtScanlines: true,
      crtGlow: true,
      crtCurve: true,
    },
  },
  {
    id: 'paper',
    name: '白纸',
    preview: { bg: '#f5f1e8', fg: '#1a1a1a' },
    config: {
      ...imageDefaults,
      aspectRatio: ASPECT_HALF_BLOCK,
      bg: '#f5f1e8',
      fg: '#1a1a1a',
      terminal: 'bash',
      title: '',
      showFrame: false,
      crtScanlines: false,
      crtGlow: false,
      crtCurve: false,
    },
  },
  {
    id: 'cyber',
    name: '赛博朋克',
    preview: { bg: '#0d0014', fg: '#ff00ff' },
    config: {
      ...imageDefaults,
      aspectRatio: ASPECT_HALF_BLOCK,
      bg: '#0d0014',
      fg: '#ff00ff',
      terminal: 'iterm2',
      title: 'neo@cyberpunk:~$',
      showFrame: true,
      crtScanlines: true,
      crtGlow: true,
      crtCurve: true,
    },
  },
  {
    id: 'bsod',
    name: '蓝屏',
    preview: { bg: '#0000aa', fg: '#ffffff' },
    config: {
      ...imageDefaults,
      aspectRatio: ASPECT_HALF_BLOCK,
      bg: '#0000aa',
      fg: '#ffffff',
      terminal: 'cmd',
      title: 'C:\\WINDOWS>',
      showFrame: true,
      crtScanlines: false,
      crtGlow: false,
      crtCurve: false,
    },
  },
  {
    id: 'minimal',
    name: '极简白',
    preview: { bg: '#ffffff', fg: '#0f172a' },
    config: {
      ...imageDefaults,
      aspectRatio: ASPECT_HALF_BLOCK,
      bg: '#ffffff',
      fg: '#0f172a',
      terminal: 'macos',
      title: '',
      showFrame: true,
      crtScanlines: false,
      crtGlow: false,
      crtCurve: false,
    },
  },
];

/** 默认预设（复古终端）。 */
export const DEFAULT_PRESET = STYLE_PRESETS[0]!;

// —— 自定义风格 provider 注入（镜像 quote-card/templates/index.ts）——
// 用 provider 间接打破 presets → custom-styles 的潜在循环依赖；
// main.ts 在 loadCfg 前注入，增删实时反映到 getEffectivePresets。

let customStyleProvider: (() => StylePreset[]) | null = null;

export function setCustomStyleProvider(fn: (() => StylePreset[]) | null): void {
  customStyleProvider = fn;
}

/** 内置 + 自定义风格合并列表（内置在前，自定义在后）。 */
export function getEffectivePresets(): StylePreset[] {
  const customs = customStyleProvider ? customStyleProvider() : [];
  return customs.length > 0 ? [...STYLE_PRESETS, ...customs] : [...STYLE_PRESETS];
}
