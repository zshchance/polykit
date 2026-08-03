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
import { FIND_WORD_DEFAULTS, randomSeed, type FindWordCfg } from './find-word';

const STORAGE_KEY = 'ascii-art:cfg';
const CURRENT_VERSION = 2;

interface Blob {
  version: number;
  cfg: Partial<StyleConfig>;
  mode: InputMode;
  text: string;
  /** 文字流是否开启 Logo 字符模式。 */
  textLogo: boolean;
  /** Logo 字符大小（每个字的点阵高度行数）。 */
  logoSize: number;
  /** Logo 同字元素（每个字用它自身字符填充，而非 █）。v2+ 缺省 false。 */
  textLogoSelfChar?: boolean;
  /** 找字游戏配置（v2+）。v1 旧数据缺省 → 归一化补默认。 */
  findWord?: Partial<FindWordCfg>;
}

/** 默认配置（基于复古终端预设，可被 settings 覆盖）。 */
function defaultCfg(): StyleConfig {
  return { ...DEFAULT_PRESET.config };
}

/** 默认 state（首次访问 / 解析失败回退）。seed 随机生成。 */
function defaultState(): PersistedState {
  return {
    cfg: defaultCfg(),
    mode: 'image',
    text: '',
    textLogo: false,
    logoSize: DEFAULT_LOGO_SIZE,
    textLogoSelfChar: false,
    findWord: { ...FIND_WORD_DEFAULTS, seed: randomSeed() },
  };
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

/** 把任意输入归一化为合法 FindWordCfg。seed 空时随机生成（首次访问）。 */
function normalizeFindWord(partial: Partial<FindWordCfg> | undefined): FindWordCfg {
  const d = FIND_WORD_DEFAULTS;
  if (!partial) return { ...d, seed: randomSeed() };
  return {
    enabled: typeof partial.enabled === 'boolean' ? partial.enabled : d.enabled,
    text: typeof partial.text === 'string' ? partial.text : d.text,
    seed: typeof partial.seed === 'string' && partial.seed ? partial.seed : randomSeed(),
    dotMatrix: typeof partial.dotMatrix === 'boolean' ? partial.dotMatrix : d.dotMatrix,
    glyphSize: clampInt(partial.glyphSize, 4, 16, d.glyphSize),
    spread: clampInt(partial.spread, 0, 100, d.spread),
    colorContrast: clampInt(partial.colorContrast, 0, 100, d.colorContrast),
    nonBlankOnly: typeof partial.nonBlankOnly === 'boolean' ? partial.nonBlankOnly : d.nonBlankOnly,
  };
}

export interface PersistedState {
  cfg: StyleConfig;
  mode: InputMode;
  text: string;
  /** 文字流是否开启 Logo 字符模式。 */
  textLogo: boolean;
  /** Logo 字符大小（每个字的点阵高度行数，8~40）。 */
  logoSize: number;
  /** Logo 同字元素（每个字用它自身字符填充，而非 █）。 */
  textLogoSelfChar: boolean;
  /** 找字游戏配置。 */
  findWord: FindWordCfg;
}

/** Logo 字符大小默认值（点阵高度行数）。 */
export const DEFAULT_LOGO_SIZE = 16;

/** 读取并归一化。任何错误静默回退默认（不阻塞 UI）。v1 旧数据迁移补 findWord 默认。 */
export function loadCfg(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Blob;
    if (!parsed) return defaultState();
    // v1（无 findWord）和 v2 都走归一化：v1 的 findWord 为 undefined → normalizeFindWord 补默认
    return {
      cfg: normalize(parsed.cfg),
      mode: parsed.mode === 'text' ? 'text' : 'image',
      text: typeof parsed.text === 'string' ? parsed.text : '',
      textLogo: parsed.textLogo === true,
      logoSize: clampInt(parsed.logoSize, 8, 40, DEFAULT_LOGO_SIZE),
      textLogoSelfChar: parsed.textLogoSelfChar === true,
      findWord: normalizeFindWord(parsed.findWord),
    };
  } catch {
    return defaultState();
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
      textLogoSelfChar: state.textLogoSelfChar,
      findWord: state.findWord,
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
