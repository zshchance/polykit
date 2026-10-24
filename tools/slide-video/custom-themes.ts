/**
 * 自定义完整主题 —— 配色、版式、背景、装饰和字体组合的本地存储。
 * v1 仅含颜色的存档读取时自动补经典设计，不改变旧文稿内容。
 */
import { readJSON, writeJSON } from '@/core/utils/storage';
import {
  DEFAULT_THEME_DESIGN,
  normalizeThemeDesign,
  type Theme,
  type ThemeDesign,
} from './options';

const STORAGE_KEY = 'slide-video:custom-themes';
const CURRENT_VERSION = 2;
const ID_PREFIX = 'custom:';

export interface CustomTheme {
  id: string;
  name: string;
  bg1: string;
  bg2: string;
  fg: string;
  accent: string;
  design: ThemeDesign;
  createdAt: number;
}

interface CustomThemeBlob {
  version: number;
  items: CustomTheme[];
}
const HEX = /^#[0-9a-fA-F]{6}$/;

function validTheme(value: unknown): CustomTheme | null {
  if (!value || typeof value !== 'object') return null;
  const it = value as Record<string, unknown>;
  if (
    typeof it.id !== 'string' ||
    !it.id.startsWith(ID_PREFIX) ||
    typeof it.name !== 'string' ||
    !it.name.trim() ||
    typeof it.createdAt !== 'number' ||
    !['bg1', 'bg2', 'fg', 'accent'].every(
      (k) => typeof it[k] === 'string' && HEX.test(it[k] as string),
    )
  )
    return null;
  return {
    id: it.id,
    name: it.name.trim().slice(0, 16),
    bg1: it.bg1 as string,
    bg2: it.bg2 as string,
    fg: it.fg as string,
    accent: it.accent as string,
    design: normalizeThemeDesign(it.design),
    createdAt: it.createdAt,
  };
}

export function loadCustomThemes(): CustomTheme[] {
  const parsed = readJSON(STORAGE_KEY) as Partial<CustomThemeBlob> | null;
  if (!parsed || !Array.isArray(parsed.items)) return [];
  return parsed.items.map(validTheme).filter((it): it is CustomTheme => it !== null);
}

function persist(items: CustomTheme[]): void {
  const blob: CustomThemeBlob = { version: CURRENT_VERSION, items };
  writeJSON(STORAGE_KEY, blob);
}

function newId(): string {
  return ID_PREFIX + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function addCustomTheme(
  name: string,
  bg1: string,
  bg2: string,
  fg: string,
  accent: string,
  design: ThemeDesign = DEFAULT_THEME_DESIGN,
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
    design: normalizeThemeDesign(design),
    createdAt: existingIdx >= 0 ? items[existingIdx]!.createdAt : Date.now(),
  };
  if (existingIdx >= 0) items[existingIdx] = entry;
  else items.push(entry);
  persist(items);
  return items;
}

export function removeCustomTheme(id: string): CustomTheme[] {
  const items = loadCustomThemes().filter((it) => it.id !== id);
  persist(items);
  return items;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

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
    muted: `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.58)`,
    light,
    design: normalizeThemeDesign(c.design),
  };
}
