/**
 * 二维码生成器 —— 用户偏好本地持久化（localStorage）。
 *
 * 记住用户上次的内容、点形状、纠错等级、配色、Logo 设置，重进自动还原。
 * 与项目其它 settings 模块一致：带 version 的 JSON blob，损坏/隐私模式安全回退。
 *
 * 不持久化 Logo 位图本身（File/ImageBitmap 不可序列化），只记 withLogo 开关。
 */

import {
  DEFAULT_CONFIG,
  DOT_SHAPES,
  EYE_SHAPES,
  ERROR_LEVELS,
  type QrConfig,
  type DotShape,
  type EyeShape,
  type ErrorLevel,
  type LogoFit,
} from './types';

const STORAGE_KEY = 'qr-code:config';
const CURRENT_VERSION = 3;

interface ConfigBlob {
  version: number;
  config: Partial<QrConfig>;
}

const DOT_IDS = DOT_SHAPES.map((d) => d.id);
const EYE_IDS = EYE_SHAPES.map((e) => e.id);
const LEVEL_IDS = ERROR_LEVELS.map((e) => e.id);
const LOGO_FITS: LogoFit[] = ['square', 'rounded'];

function isDotShape(s: unknown): s is DotShape {
  return typeof s === 'string' && (DOT_IDS as string[]).includes(s);
}
function isEyeShape(s: unknown): s is EyeShape {
  return typeof s === 'string' && (EYE_IDS as string[]).includes(s);
}
function isErrorLevel(s: unknown): s is ErrorLevel {
  return typeof s === 'string' && (LEVEL_IDS as string[]).includes(s);
}
function isLogoFit(s: unknown): s is LogoFit {
  return typeof s === 'string' && (LOGO_FITS as string[]).includes(s);
}
function isHex(s: unknown): s is string {
  return typeof s === 'string' && (/^#[0-9a-fA-F]{6}$/.test(s) || s === '');
}

/**
 * 读取配置；存储损坏/字段非法时回退默认。
 * 对每个字段单独校验，合法才采用，否则用默认值，保证向前兼容（新增字段旧草稿无则默认）。
 */
export function loadConfig(): QrConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<ConfigBlob>;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_CONFIG };

    const c = parsed.config ?? {};
    return {
      text: typeof c.text === 'string' ? c.text : DEFAULT_CONFIG.text,
      errorLevel: isErrorLevel(c.errorLevel) ? c.errorLevel : DEFAULT_CONFIG.errorLevel,
      dotShape: isDotShape(c.dotShape) ? c.dotShape : DEFAULT_CONFIG.dotShape,
      eyeShape: isEyeShape(c.eyeShape) ? c.eyeShape : DEFAULT_CONFIG.eyeShape,
      fgColor: isHex(c.fgColor) ? c.fgColor : DEFAULT_CONFIG.fgColor,
      bgColor: isHex(c.bgColor) ? c.bgColor : DEFAULT_CONFIG.bgColor,
      withLogo: typeof c.withLogo === 'boolean' ? c.withLogo : DEFAULT_CONFIG.withLogo,
      logoRatio:
        typeof c.logoRatio === 'number' && c.logoRatio > 0 && c.logoRatio <= 0.4
          ? c.logoRatio
          : DEFAULT_CONFIG.logoRatio,
      logoFit: isLogoFit(c.logoFit) ? c.logoFit : DEFAULT_CONFIG.logoFit,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** 持久化配置（隐私模式 / 配额满时静默忽略） */
export function saveConfig(cfg: QrConfig): void {
  try {
    const blob: ConfigBlob = { version: CURRENT_VERSION, config: cfg };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // 静默忽略
  }
}
