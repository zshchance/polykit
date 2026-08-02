/**
 * 配置持久化 —— 版本化 localStorage，含字段校验 + colorMode↔halfBlock 钳制。
 *
 * 钳制规则：colorMode === false 时 halfBlock 强制 false。
 *   原因：半块模式用 fg/bg 表示两个像素，单色下两者相同 = 死图，无意义。
 *   在 load 时统一钳制，保证任何来源（旧草稿 / 手改 localStorage）都不会产生非法组合。
 */

import type { StyleConfig, TerminalType, CursorStyle, InputMode } from './types';
import { DEFAULT_PRESET, ASPECT_HALF_BLOCK, ASPECT_TEXT } from './presets';
import { DEFAULT_CHARSET } from './charsets';

const STORAGE_KEY = 'ascii-art:cfg';
const CURRENT_VERSION = 1;

interface Blob {
  version: number;
  cfg: Partial<StyleConfig>;
  mode: InputMode;
  text: string;
  /** 文字流是否开启 Logo 字符模式。 */
  textLogo: boolean;
  /** Logo 字符大小（每个字的点阵高度行数）。 */
  logoSize: number;
}

/** 默认配置（基于复古终端预设，可被 settings 覆盖）。 */
function defaultCfg(): StyleConfig {
  return { ...DEFAULT_PRESET.config };
}

/** 把任意输入归一化为合法 StyleConfig（钳制 + 缺省）。 */
function normalize(partial: Partial<StyleConfig> | undefined): StyleConfig {
  const base = defaultCfg();
  if (!partial) return base;

  const cfg: StyleConfig = {
    ...base,
    ...partial,
    charset: typeof partial.charset === 'string' && partial.charset.length > 0 ? partial.charset : base.charset,
    width: clampInt(partial.width, 20, 240, base.width),
    halfBlock: typeof partial.halfBlock === 'boolean' ? partial.halfBlock : base.halfBlock,
    colorMode: typeof partial.colorMode === 'boolean' ? partial.colorMode : base.colorMode,
    aspectRatio: typeof partial.aspectRatio === 'number' && Number.isFinite(partial.aspectRatio) && partial.aspectRatio > 0
      ? partial.aspectRatio
      : base.aspectRatio,
    contrast: clampInt(partial.contrast, -100, 100, 0),
    brightness: clampInt(partial.brightness, -100, 100, 0),
    invert: typeof partial.invert === 'boolean' ? partial.invert : false,
    bg: typeof partial.bg === 'string' && partial.bg ? partial.bg : base.bg,
    fg: typeof partial.fg === 'string' && partial.fg ? partial.fg : base.fg,
    terminal: isValidTerminal(partial.terminal) ? partial.terminal! : base.terminal,
    title: typeof partial.title === 'string' ? partial.title : base.title,
    showFrame: typeof partial.showFrame === 'boolean' ? partial.showFrame : base.showFrame,
    crtScanlines: typeof partial.crtScanlines === 'boolean' ? partial.crtScanlines : base.crtScanlines,
    crtGlow: typeof partial.crtGlow === 'boolean' ? partial.crtGlow : base.crtGlow,
    crtCurve: typeof partial.crtCurve === 'boolean' ? partial.crtCurve : base.crtCurve,
    cursor: isValidCursor(partial.cursor) ? partial.cursor! : base.cursor,
    padding: clampInt(partial.padding, 0, 200, base.padding),
  };

  // 关键钳制：colorMode 关 → halfBlock 强制关
  if (!cfg.colorMode) cfg.halfBlock = false;

  return cfg;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function isValidTerminal(v: unknown): v is TerminalType {
  return v === 'macos' || v === 'iterm2' || v === 'cmd' || v === 'bash';
}
function isValidCursor(v: unknown): v is CursorStyle {
  return v === 'none' || v === '▋' || v === '_' || v === '█';
}

export interface PersistedState {
  cfg: StyleConfig;
  mode: InputMode;
  text: string;
  /** 文字流是否开启 Logo 字符模式。 */
  textLogo: boolean;
  /** Logo 字符大小（每个字的点阵高度行数，8~40）。 */
  logoSize: number;
}

/** Logo 字符大小默认值（点阵高度行数）。 */
export const DEFAULT_LOGO_SIZE = 16;

/** 读取并归一化。任何错误静默回退默认（不阻塞 UI）。 */
export function loadCfg(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { cfg: defaultCfg(), mode: 'image', text: '', textLogo: false, logoSize: DEFAULT_LOGO_SIZE };
    const parsed = JSON.parse(raw) as Blob;
    if (!parsed || parsed.version !== CURRENT_VERSION) return { cfg: defaultCfg(), mode: 'image', text: '', textLogo: false, logoSize: DEFAULT_LOGO_SIZE };
    return {
      cfg: normalize(parsed.cfg),
      mode: parsed.mode === 'text' ? 'text' : 'image',
      text: typeof parsed.text === 'string' ? parsed.text : '',
      textLogo: parsed.textLogo === true,
      logoSize: clampInt(parsed.logoSize, 8, 40, DEFAULT_LOGO_SIZE),
    };
  } catch {
    return { cfg: defaultCfg(), mode: 'image', text: '', textLogo: false, logoSize: DEFAULT_LOGO_SIZE };
  }
}

export function saveCfg(state: PersistedState): void {
  try {
    const blob: Blob = {
      version: CURRENT_VERSION,
      // 保存前再钳制一次（防御性）
      cfg: { ...state.cfg, halfBlock: state.cfg.colorMode ? state.cfg.halfBlock : false },
      mode: state.mode,
      text: state.text,
      textLogo: state.textLogo,
      logoSize: clampInt(state.logoSize, 8, 40, DEFAULT_LOGO_SIZE),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // 静默失败（隐私模式 / 配额满）
  }
}

/**
 * 切换 halfBlock 时重设 aspectRatio 为对应默认值（替换，不乘除）。
 * 调用方在 toggle halfBlock 后调此函数。
 */
export function aspectRatioForHalfBlock(halfBlock: boolean): number {
  return halfBlock ? ASPECT_HALF_BLOCK : ASPECT_TEXT;
}

export { DEFAULT_CHARSET };
