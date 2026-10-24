/**
 * 演示翻页视频选项 —— 本地持久化（localStorage）。
 *
 * 记住用户上次的全部设置与文稿内容（文稿是本工具的核心产出，随设置一并
 * 记忆；上限 20k 字符 ≈ 60 页 × 170 字，安全且远离 5MB 配额）。
 * 不存 BGM 文件（体积大且属用户隐私，每次由用户重新选择）。
 *
 * 存储形态（JSON）：{ "version": 2, "options": SlideVideoOptions }
 * v1 自动保存的默认字体/对齐/淡入淡出会迁移到新版主题默认；其余选择保留。
 */

import { readJSON, writeJSON } from '@/core/utils/storage';

import { normalizeSoundEffect } from './sound-effects';

import {
  ASPECTS,
  DEFAULT_OPTIONS,
  FLIP_DUR_CHOICES,
  PAGE_DUR_CHOICES,
  RESOLUTIONS,
  normalizeAlign,
  normalizeCountdown,
  normalizeCountdownPos,
  normalizeEnter,
  normalizeFlip,
  normalizeFont,
  normalizeTheme,
  type SlideVideoOptions,
} from './options';

const STORAGE_KEY = 'slide-video:options';
const CURRENT_VERSION = 2;

/** 文稿长度上限（字符） */
export const CONTENT_MAX = 20_000;

interface OptionsBlob {
  version: number;
  options: SlideVideoOptions;
}

/** 校验 7 位 hex 颜色（#rrggbb），非法返回 null */
function validColor(v: unknown): string | null {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null;
}

/** 数值档位合法值（浮点比较用容差） */
function inChoices(v: unknown, choices: readonly number[]): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return choices.some((c) => Math.abs(c - v) < 1e-6) ? v : null;
}

export function loadOptions(): SlideVideoOptions {
  const parsed = readJSON(STORAGE_KEY) as Partial<OptionsBlob> | null;
  if (!parsed) return { ...DEFAULT_OPTIONS };
  const o = parsed.options;
  if (!o || typeof o !== 'object') return { ...DEFAULT_OPTIONS };

  const d = DEFAULT_OPTIONS;
  const legacyDefaults = parsed.version === 1;
  return {
    contentText:
      typeof o.contentText === 'string' ? o.contentText.slice(0, CONTENT_MAX) : d.contentText,
    aspect:
      typeof o.aspect === 'string' && ASPECTS.some((a) => a.id === o.aspect)
        ? (o.aspect as SlideVideoOptions['aspect'])
        : d.aspect,
    resolution:
      typeof o.resolution === 'string' && RESOLUTIONS.some((r) => r.id === o.resolution)
        ? (o.resolution as SlideVideoOptions['resolution'])
        : d.resolution,
    pageDur: inChoices(o.pageDur, PAGE_DUR_CHOICES) ?? d.pageDur,
    flipDur: inChoices(o.flipDur, FLIP_DUR_CHOICES) ?? d.flipDur,
    flip: legacyDefaults && o.flip === 'fade' ? d.flip : normalizeFlip(o.flip),
    firstPageFlip: typeof o.firstPageFlip === 'boolean' ? o.firstPageFlip : d.firstPageFlip,
    enter: normalizeEnter(o.enter),
    countdown: normalizeCountdown(o.countdown),
    countdownPos: normalizeCountdownPos(o.countdownPos),
    showPageNo: typeof o.showPageNo === 'boolean' ? o.showPageNo : d.showPageNo,
    // 主题 id：内置合法 id，或自定义主题 id（custom: 前缀；本体在 custom-themes.ts 校验）
    theme:
      typeof o.theme === 'string' &&
      o.theme.length <= 32 &&
      (o.theme.startsWith('custom:') || normalizeTheme(o.theme) === o.theme)
        ? o.theme
        : d.theme,
    accentColor: validColor(o.accentColor),
    // v1 总会写入黑体/居中/淡入淡出，无法区分是否主动选择；仅这些旧默认值跟随新版设计。
    font: o.font == null || (legacyDefaults && o.font === 'sans') ? null : normalizeFont(o.font),
    align:
      o.align == null || (legacyDefaults && o.align === 'center') ? null : normalizeAlign(o.align),
    soundEffect: normalizeSoundEffect(o.soundEffect),
    soundVolume:
      typeof o.soundVolume === 'number' && Number.isFinite(o.soundVolume)
        ? Math.min(100, Math.max(0, Math.round(o.soundVolume)))
        : d.soundVolume,
    bgmVolume:
      typeof o.bgmVolume === 'number' && Number.isFinite(o.bgmVolume)
        ? Math.min(100, Math.max(0, Math.round(o.bgmVolume)))
        : d.bgmVolume,
    bgmLoop: typeof o.bgmLoop === 'boolean' ? o.bgmLoop : d.bgmLoop,
  };
}

/** 持久化选项（隐私模式 / 配额满时静默忽略） */
export function saveOptions(opts: SlideVideoOptions): void {
  const blob: OptionsBlob = { version: CURRENT_VERSION, options: { ...opts } };
  writeJSON(STORAGE_KEY, blob);
}
