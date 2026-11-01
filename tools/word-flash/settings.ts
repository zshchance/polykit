/**
 * 文字快闪视频选项 —— 本地持久化（localStorage）。
 *
 * 记住用户上次的全部设置与文案内容（文案是本工具的核心产出，随设置一并
 * 记忆；上限 20k 字符）。
 * 不存 BGM 文件（体积大且属用户隐私，每次由用户重新选择）。
 *
 * 存储形态（JSON）：{ "version": 1, "options": FlashOptions }
 */

import { readJSON, writeJSON } from '@/core/utils/storage';

import {
  ASPECTS,
  DEFAULT_OPTIONS,
  PACES,
  RESOLUTIONS,
  SYNCS,
  normalizeEmphasis,
  normalizeFont,
  normalizeMotion,
  normalizePace,
  normalizeProgress,
  normalizeSoundEffect,
  normalizeSync,
  normalizeTheme,
  type FlashOptions,
} from './options';

const STORAGE_KEY = 'word-flash:options';
const CURRENT_VERSION = 1;

/** 文案长度上限（字符） */
export const CONTENT_MAX = 20_000;

interface OptionsBlob {
  version: number;
  options: FlashOptions;
}

/** 校验 7 位 hex 颜色（#rrggbb），非法返回 null */
function validColor(v: unknown): string | null {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null;
}

function clampSpeed(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_OPTIONS.speed;
  return Math.round(Math.min(2, Math.max(0.6, v)) * 10) / 10;
}

function clampVolume(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(100, Math.max(0, Math.round(v)));
}

export function loadOptions(): FlashOptions {
  const parsed = readJSON(STORAGE_KEY) as Partial<OptionsBlob> | null;
  if (!parsed) return { ...DEFAULT_OPTIONS };
  const o = parsed.options;
  if (!o || typeof o !== 'object') return { ...DEFAULT_OPTIONS };

  const d = DEFAULT_OPTIONS;
  return {
    contentText:
      typeof o.contentText === 'string' ? o.contentText.slice(0, CONTENT_MAX) : d.contentText,
    aspect:
      typeof o.aspect === 'string' && ASPECTS.some((a) => a.id === o.aspect)
        ? (o.aspect as FlashOptions['aspect'])
        : d.aspect,
    resolution:
      typeof o.resolution === 'string' && RESOLUTIONS.some((r) => r.id === o.resolution)
        ? (o.resolution as FlashOptions['resolution'])
        : d.resolution,
    pace: PACES.some((p) => p.id === o.pace) ? normalizePace(o.pace) : d.pace,
    speed: clampSpeed(o.speed),
    sync: SYNCS.some((s) => s.id === o.sync) ? normalizeSync(o.sync) : d.sync,
    motion: normalizeMotion(o.motion),
    // 主题 id：内置合法 id，或自定义主题 id（custom: 前缀；本体在 custom-themes.ts 校验）
    theme:
      typeof o.theme === 'string' &&
      o.theme.length <= 32 &&
      (o.theme.startsWith('custom:') || normalizeTheme(o.theme) === o.theme)
        ? o.theme
        : d.theme,
    accentColor: validColor(o.accentColor),
    font: o.font == null ? null : normalizeFont(o.font),
    emphasis: normalizeEmphasis(o.emphasis),
    progress: normalizeProgress(o.progress),
    soundEffect: normalizeSoundEffect(o.soundEffect),
    soundVolume: clampVolume(o.soundVolume, d.soundVolume),
    bgmVolume: clampVolume(o.bgmVolume, d.bgmVolume),
    bgmLoop: typeof o.bgmLoop === 'boolean' ? o.bgmLoop : d.bgmLoop,
  };
}

/** 持久化选项（隐私模式 / 配额满时静默忽略） */
export function saveOptions(opts: FlashOptions): void {
  const blob: OptionsBlob = { version: CURRENT_VERSION, options: { ...opts } };
  writeJSON(STORAGE_KEY, blob);
}
