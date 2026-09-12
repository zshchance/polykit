/**
 * 歌曲生成视频选项 —— 本地持久化（localStorage）。
 *
 * 记住用户上次的所有设置（宽高比/可视化/主题/动画/片尾字幕等），
 * 下次打开页面自动恢复，免去重复配置。仅存选项，不存任何音频/图片文件
 * （文件体积大且属用户隐私，每次由用户重新选择）。
 *
 * 设计与 password-generator/settings.ts 一致：带 version 的 JSON blob，
 * 读取经 core/utils/storage 统一容错，损坏/隐私模式时安全回退默认值。
 *
 * 存储形态（JSON）：
 *   { "version": 1, "options": SongVideoOptions }
 */

import { readJSON, writeJSON } from '@/core/utils/storage';

import {
  ASPECTS,
  DEFAULT_OPTIONS,
  INTRO_DUR_CHOICES,
  OUTRO_DUR_CHOICES,
  RESOLUTIONS,
  normalizeIntroAnim,
  normalizeLyricMode,
  normalizeOutroAnim,
  normalizeProgressBar,
  normalizeTheme,
  normalizeVisualizer,
  type SongVideoOptions,
} from './options';

const STORAGE_KEY = 'song-video:options';
const CURRENT_VERSION = 1;

interface OptionsBlob {
  version: number;
  options: SongVideoOptions;
}

/** 校验 7 位 hex 颜色（#rrggbb），非法返回 null */
function validColor(v: unknown): string | null {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null;
}

/** 时长档位合法值（浮点比较用容差） */
function inChoices(v: unknown, choices: readonly number[]): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return choices.some((c) => Math.abs(c - v) < 1e-6) ? v : null;
}

/**
 * 读取已记忆的选项；存储损坏、为空或字段非法时逐字段回退默认值。
 * 每个字段单独校验：脏数据（旧版本/手改）不会影响渲染逻辑。
 */
export function loadOptions(): SongVideoOptions {
  const parsed = readJSON(STORAGE_KEY) as Partial<OptionsBlob> | null;
  if (!parsed) return { ...DEFAULT_OPTIONS };
  const o = parsed.options;
  if (!o || typeof o !== 'object') return { ...DEFAULT_OPTIONS };

  const d = DEFAULT_OPTIONS;
  const aspect =
    typeof o.aspect === 'string' && ASPECTS.some((a) => a.id === o.aspect)
      ? (o.aspect as SongVideoOptions['aspect'])
      : d.aspect;
  const resolution =
    typeof o.resolution === 'string' && RESOLUTIONS.some((r) => r.id === o.resolution)
      ? (o.resolution as SongVideoOptions['resolution'])
      : d.resolution;
  const introDur = inChoices(o.introDur, INTRO_DUR_CHOICES) ?? d.introDur;
  const outroDur = inChoices(o.outroDur, OUTRO_DUR_CHOICES) ?? d.outroDur;

  return {
    aspect,
    resolution,
    visualizer: normalizeVisualizer(o.visualizer),
    lyricMode: normalizeLyricMode(o.lyricMode),
    theme: normalizeTheme(o.theme),
    accentColor: validColor(o.accentColor),
    showTitle: typeof o.showTitle === 'boolean' ? o.showTitle : d.showTitle,
    titleText: typeof o.titleText === 'string' ? o.titleText.slice(0, 80) : d.titleText,
    progressBar: normalizeProgressBar(o.progressBar),
    introAnim: normalizeIntroAnim(o.introAnim),
    introDur,
    outroAnim: normalizeOutroAnim(o.outroAnim),
    outroDur,
    coverSpin: typeof o.coverSpin === 'boolean' ? o.coverSpin : d.coverSpin,
    publisher: typeof o.publisher === 'string' ? o.publisher.slice(0, 40) : d.publisher,
    endRollEnabled:
      typeof o.endRollEnabled === 'boolean' ? o.endRollEnabled : d.endRollEnabled,
    endRollText:
      typeof o.endRollText === 'string' ? o.endRollText.slice(0, 2000) : d.endRollText,
  };
}

/** 持久化选项（隐私模式 / 配额满时静默忽略） */
export function saveOptions(opts: SongVideoOptions): void {
  const blob: OptionsBlob = { version: CURRENT_VERSION, options: { ...opts } };
  writeJSON(STORAGE_KEY, blob);
}
