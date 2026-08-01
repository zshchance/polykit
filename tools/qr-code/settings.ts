/**
 * 二维码生成器 —— 用户偏好本地持久化（localStorage）。
 *
 * 记住用户上次的内容、点形状、纠错等级、配色、Logo 设置，重进自动还原。
 * 与项目其它 settings 模块一致：带 version 的 JSON blob，损坏/隐私模式安全回退。
 *
 * 除配置外，还持久化两张图（转 base64 dataURL，压缩到长边≤800）：
 *   - Logo 图（qr-code:logo-img）：重进恢复中心 Logo
 *   - 识别的二维码原图 + 多码结果 + 当前选中（qr-code:detected-img）：
 *     重进恢复识别下拉与选中项，免去重新上传
 * 图片用独立 key 存（base64 很大，与配置 JSON 分开，配置读写不被拖慢）。
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
import type { DetectedCode } from './decode';

const STORAGE_KEY = 'qr-code:config';
const LOGO_KEY = 'qr-code:logo-img';
const DETECTED_KEY = 'qr-code:detected-img';
const CURRENT_VERSION = 4;

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
      activeStyleId:
        c.activeStyleId === null || typeof c.activeStyleId === 'string'
          ? c.activeStyleId
          : DEFAULT_CONFIG.activeStyleId,
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

// ─────────────────────────── Logo 图持久化 ───────────────────────────

/**
 * 读取 Logo dataURL；无则 null。
 * 存裸 dataURL 字符串（非 JSON），避免双重编码；空串视为已清除，返回 null。
 */
export function loadLogoImage(): string | null {
  try {
    const raw = localStorage.getItem(LOGO_KEY);
    if (!raw) return null;
    return raw.startsWith('data:image/') ? raw : null;
  } catch {
    return null;
  }
}

/** 存 Logo dataURL；传空串即清除。隐私模式 / 配额满时静默忽略。 */
export function saveLogoImage(dataUrl: string): void {
  try {
    if (dataUrl) localStorage.setItem(LOGO_KEY, dataUrl);
    else localStorage.removeItem(LOGO_KEY);
  } catch {
    // 静默忽略
  }
}

// ─────────────────────────── 识别原图持久化 ───────────────────────────

/** 可被还原的识别态：原图 dataURL + 全部识别结果 + 当前选中索引 */
export interface DetectedBlob {
  version: number;
  /** 原图压缩后的 dataURL，重进时作 <img src> 与重建位图之用 */
  dataUrl: string;
  /** 全部识别到的码（可序列化，含 text/version/box） */
  codes: DetectedCode[];
  /** 当前选中的第几个码 */
  selectedIndex: number;
}

/** 读取识别态；无/损坏返回 null */
export function loadDetectedImage(): DetectedBlob | null {
  try {
    const raw = localStorage.getItem(DETECTED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DetectedBlob>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.dataUrl !== 'string' || !parsed.dataUrl.startsWith('data:image/')) return null;
    if (!Array.isArray(parsed.codes)) return null;
    const codes = parsed.codes.filter(
      (c) => c && typeof c.text === 'string' && c.box && typeof c.box.x === 'number',
    );
    if (codes.length === 0) return null;
    const selectedIndex =
      typeof parsed.selectedIndex === 'number' && parsed.selectedIndex >= 0 && parsed.selectedIndex < codes.length
        ? parsed.selectedIndex
        : 0;
    return { version: CURRENT_VERSION, dataUrl: parsed.dataUrl, codes, selectedIndex };
  } catch {
    return null;
  }
}

/** 存识别态。隐私模式 / 配额满时静默忽略。 */
export function saveDetectedImage(dataUrl: string, codes: DetectedCode[], selectedIndex: number): void {
  try {
    const blob: DetectedBlob = { version: CURRENT_VERSION, dataUrl, codes, selectedIndex };
    localStorage.setItem(DETECTED_KEY, JSON.stringify(blob));
  } catch {
    // 静默忽略（大图可能超配额）
  }
}

/** 清除识别态（如用户想重新上传） */
export function clearDetectedImage(): void {
  try {
    localStorage.removeItem(DETECTED_KEY);
  } catch {
    // 静默忽略
  }
}
