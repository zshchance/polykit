/**
 * 自定义配色主题 —— 参考名言卡片自定义模板的存储与管理方式。
 *
 * 用户以内置主题为基础调整配色（背景双色/文字/主色），命名后保存到
 * localStorage（数据不出本地），在主题选择区与内置主题同样一按钮选用、可删除。
 *
 * 存储形态（JSON）：
 *   { "version": 1, "items": CustomTheme[] }
 */

import { readJSON, writeJSON } from '@/core/utils/storage';

import type { Theme } from './options';

const STORAGE_KEY = 'song-video:custom-themes';
const CURRENT_VERSION = 1;
const ID_PREFIX = 'custom:';

/** 一条自定义主题（本地存储形态）；muted/light 渲染时由配色推导，不必存储 */
export interface CustomTheme {
  /** 形如 custom:abcd1234 */
  id: string;
  /** 用户填的展示名 */
  name: string;
  /** 背景渐变起止色（hex） */
  bg1: string;
  bg2: string;
  /** 文字色（hex） */
  fg: string;
  /** 主强调色（hex，频谱/进度条/高亮歌词） */
  accent: string;
  createdAt: number;
}

interface CustomThemeBlob {
  version: number;
  items: CustomTheme[];
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** 读取全部自定义主题；存储损坏/为空时返回 []（读取经 core/utils/storage 统一容错） */
export function loadCustomThemes(): CustomTheme[] {
  const parsed = readJSON(STORAGE_KEY) as Partial<CustomThemeBlob> | null;
  if (!parsed) return [];
  const items = parsed.items;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (it): it is CustomTheme =>
      !!it &&
      typeof it.id === 'string' &&
      it.id.startsWith(ID_PREFIX) &&
      typeof it.name === 'string' &&
      it.name.trim().length > 0 &&
      typeof it.bg1 === 'string' &&
      HEX.test(it.bg1) &&
      typeof it.bg2 === 'string' &&
      HEX.test(it.bg2) &&
      typeof it.fg === 'string' &&
      HEX.test(it.fg) &&
      typeof it.accent === 'string' &&
      HEX.test(it.accent) &&
      typeof it.createdAt === 'number',
  );
}

function persist(items: CustomTheme[]): void {
  const blob: CustomThemeBlob = { version: CURRENT_VERSION, items };
  writeJSON(STORAGE_KEY, blob);
}

function newId(): string {
  return ID_PREFIX + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** 新增或同名覆盖一条；返回更新后的完整列表 */
export function addCustomTheme(
  name: string,
  bg1: string,
  bg2: string,
  fg: string,
  accent: string,
): CustomTheme[] {
  const trimmed = name.trim();
  const items = loadCustomThemes();
  const existingIdx = items.findIndex((it) => it.name.trim() === trimmed);
  const entry: CustomTheme = {
    id: existingIdx >= 0 ? items[existingIdx]!.id : newId(),
    name: trimmed,
    bg1,
    bg2,
    fg,
    accent,
    createdAt: existingIdx >= 0 ? items[existingIdx]!.createdAt : Date.now(),
  };
  if (existingIdx >= 0) items[existingIdx] = entry;
  else items.push(entry);
  persist(items);
  return items;
}

/** 删除一条；返回更新后的完整列表 */
export function removeCustomTheme(id: string): CustomTheme[] {
  const items = loadCustomThemes().filter((it) => it.id !== id);
  persist(items);
  return items;
}

// ─────────────────────────── 存储态 → 渲染态 ───────────────────────────

/** hex → [r, g, b]（非法输入返回 null） */
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Rec.709 感知亮度（0-1），用于自动判断浅色/深色主题 */
function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

/**
 * 自定义主题 → 渲染用 Theme：
 * muted 取文字色加透明度；浅/深按背景平均亮度自动判定。
 */
export function toRenderTheme(c: CustomTheme): Theme {
  const rgb = hexToRgb(c.fg) ?? [255, 255, 255];
  const light = (luminance(c.bg1) + luminance(c.bg2)) / 2 > 0.55;
  return {
    id: c.id,
    label: c.name,
    swatch: `linear-gradient(135deg,${c.bg1},${c.bg2})`,
    bg: [c.bg1, c.bg2],
    fg: c.fg,
    accent: c.accent,
    muted: `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.55)`,
    light,
  };
}

/** 判断 id 是否是自定义主题 id */
export function isCustomThemeId(id: string): boolean {
  return id.startsWith(ID_PREFIX);
}
