/**
 * AI 风格方案 —— 完整主题（配色 + 版式 + 背景 + 字体）与播放选项。
 * AI 只返回声明式 JSON，所有字段经真实枚举目录校验，不执行生成代码。
 */

import { readJSON, writeJSON } from '@/core/utils/storage';

import {
  BACKGROUNDS,
  DEFAULT_THEME_DESIGN,
  FONTS,
  LAYOUTS,
  MOTIONS,
  normalizeMotion,
  type FlashOptions,
  type MotionId,
  type Theme,
  type ThemeDesign,
} from './options';
import { toRenderTheme } from './custom-themes';

const STORAGE_KEY = 'word-flash:custom-schemes';
const CURRENT_VERSION = 1;
const ID_PREFIX = 'wfscheme:';
const HEX = /^#[0-9a-fA-F]{6}$/;

export interface CustomScheme {
  id: string;
  name: string;
  bg1: string;
  bg2: string;
  fg: string;
  accent: string;
  design?: ThemeDesign;
  motion?: MotionId;
  createdAt: number;
}

interface CustomSchemeBlob {
  version: number;
  items: CustomScheme[];
}

function validEnum<T extends string>(v: unknown, choices: readonly { id: T }[]): T | undefined {
  return typeof v === 'string' && choices.some((c) => c.id === v) ? (v as T) : undefined;
}

/** 同时接受新版扁平字段和 design 嵌套对象；旧 JSON 无这些字段时保持 undefined。 */
function parseDesign(o: Record<string, unknown>): ThemeDesign | undefined {
  const nested =
    o.design && typeof o.design === 'object' ? (o.design as Record<string, unknown>) : {};
  const value = (key: keyof ThemeDesign): unknown => o[key] ?? nested[key];
  const keys: (keyof ThemeDesign)[] = ['layout', 'background', 'font'];
  if (!keys.some((k) => value(k) !== undefined)) return undefined;
  return {
    layout: validEnum(value('layout'), LAYOUTS) ?? DEFAULT_THEME_DESIGN.layout,
    background: validEnum(value('background'), BACKGROUNDS) ?? DEFAULT_THEME_DESIGN.background,
    font: validEnum(value('font'), FONTS) ?? DEFAULT_THEME_DESIGN.font,
  };
}

function validScheme(it: unknown): CustomScheme | null {
  if (!it || typeof it !== 'object') return null;
  const o = it as Record<string, unknown>;
  const colors = ['bg1', 'bg2', 'fg', 'accent'].every(
    (k) => typeof o[k] === 'string' && HEX.test(o[k] as string),
  );
  if (
    typeof o.id !== 'string' ||
    !o.id.startsWith(ID_PREFIX) ||
    typeof o.name !== 'string' ||
    !o.name.trim() ||
    !colors ||
    typeof o.createdAt !== 'number'
  )
    return null;
  const scheme: CustomScheme = {
    id: o.id,
    name: o.name.trim().slice(0, 12),
    bg1: o.bg1 as string,
    bg2: o.bg2 as string,
    fg: o.fg as string,
    accent: o.accent as string,
    createdAt: o.createdAt,
  };
  const design = parseDesign(o);
  const motion = validEnum(o.motion, MOTIONS);
  if (design) scheme.design = design;
  if (motion) scheme.motion = motion;
  return scheme;
}

export function loadCustomSchemes(): CustomScheme[] {
  const parsed = readJSON(STORAGE_KEY) as Partial<CustomSchemeBlob> | null;
  if (!parsed || !Array.isArray(parsed.items)) return [];
  return parsed.items.map(validScheme).filter((it): it is CustomScheme => it !== null);
}

function persist(items: CustomScheme[]): void {
  writeJSON(STORAGE_KEY, { version: CURRENT_VERSION, items } satisfies CustomSchemeBlob);
}

function newId(): string {
  return ID_PREFIX + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function addCustomScheme(scheme: Omit<CustomScheme, 'id' | 'createdAt'>): CustomScheme[] {
  const items = loadCustomSchemes();
  const existingIdx = items.findIndex((it) => it.name.trim() === scheme.name.trim());
  const entry: CustomScheme = {
    ...scheme,
    id: existingIdx >= 0 ? items[existingIdx]!.id : newId(),
    createdAt: existingIdx >= 0 ? items[existingIdx]!.createdAt : Date.now(),
  };
  if (existingIdx >= 0) items[existingIdx] = entry;
  else items.push(entry);
  persist(items);
  return items;
}

export function removeCustomScheme(id: string): CustomScheme[] {
  const items = loadCustomSchemes().filter((it) => it.id !== id);
  persist(items);
  return items;
}

export function schemeOptionPatches(s: CustomScheme): Partial<FlashOptions> {
  const p: Partial<FlashOptions> = {};
  if (s.motion) p.motion = s.motion;
  return p;
}

export interface ParsedScheme {
  name: string;
  colors: { bg1: string; bg2: string; fg: string; accent: string };
  design?: ThemeDesign;
  motion?: MotionId;
}

export function parseSchemeAIOutput(
  raw: string,
): { ok: true; scheme: ParsedScheme } | { ok: false; reason: string } {
  const fence = /```(?:json)?\s*\n([\s\S]*?)\n?```/i.exec(raw);
  const text = (fence ? fence[1] : raw).trim();
  let obj: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return { ok: false, reason: 'AI 返回的不是 JSON 对象——请把 ```json 代码块完整粘进来。' };
    obj = parsed as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      reason: 'JSON 解析失败——请把 AI 返回的 ```json 代码块原样粘进来（不要增删字符）。',
    };
  }
  const name = typeof obj.name === 'string' ? obj.name.trim().slice(0, 12) : '';
  if (!name) return { ok: false, reason: 'JSON 里缺少有效 name（方案名，≤12 字）。' };
  const colorKeys = ['bg1', 'bg2', 'fg', 'accent'] as const;
  const present = colorKeys.filter((k) => obj[k] !== undefined);
  if (present.length < 4)
    return { ok: false, reason: '配色字段不完整——bg1/bg2/fg/accent 四个 #rrggbb 颜色必须齐全。' };
  const bad = colorKeys.filter((k) => typeof obj[k] !== 'string' || !HEX.test(obj[k] as string));
  if (bad.length) return { ok: false, reason: `${bad.join('/')} 不是合法的 #rrggbb hex 颜色。` };
  const scheme: ParsedScheme = {
    name,
    colors: {
      bg1: obj.bg1 as string,
      bg2: obj.bg2 as string,
      fg: obj.fg as string,
      accent: obj.accent as string,
    },
  };
  const design = parseDesign(obj);
  const motion = validEnum(obj.motion, MOTIONS);
  if (design) scheme.design = design;
  if (motion) scheme.motion = normalizeMotion(motion) as MotionId;
  return { ok: true, scheme };
}

/** 风格向导中的真实 Canvas 样张使用与保存后完全一致的主题结构。 */
export function schemePreviewTheme(s: ParsedScheme): Theme {
  return toRenderTheme({
    id: 'scheme-preview',
    name: s.name,
    bg1: s.colors.bg1,
    bg2: s.colors.bg2,
    fg: s.colors.fg,
    accent: s.colors.accent,
    design: s.design ?? DEFAULT_THEME_DESIGN,
    createdAt: 0,
  });
}

function enumDoc<T extends string>(
  choices: readonly { id: T; label: string; hint?: string }[],
): string {
  return choices.map((c) => `"${c.id}"（${c.label}${c.hint ? `：${c.hint}` : ''}）`).join(' / ');
}

export function buildSchemePrompt(description: string): string {
  const desc = description.trim() || '高对比度、适合竖屏快闪的视觉风格';
  return `你是短视频视觉设计总监。请设计一套「文字快闪视频」的完整视觉方案，不只是换颜色，还要让版式、背景与字体共同表达同一种气质。

【我想要的风格】
${desc}

【输出格式（必须严格遵守）】
只输出一个 \`\`\`json 围栏代码块，内容为一个 JSON 对象：
{
  "name": "方案名，不超过 12 字",
  "bg1": "#0b1026", "bg2": "#2b0f45", "fg": "#f5f3ff", "accent": "#22d3ee",
  "layout": "……", "background": "……", "font": "……", "motion": "……"
}
字段说明：
- bg1/bg2：背景起止色；fg：文字色；accent：强调色（用于强调卡、色带与进度条），均为 #rrggbb。
- layout（卡片版式）：${enumDoc(LAYOUTS)}
- background（背景层次）：${enumDoc(BACKGROUNDS)}
- font（字体）：${enumDoc(FONTS)}
- motion（入场动效）：${enumDoc(MOTIONS)}

【设计要求】
- 配色对比必须充足：快闪是大字瞬间阅读，fg 与 bg 的明度差要够；accent 要能跳出来。
- 竖屏 9:16 是主要场景，避免过于细密的背景纹理；版式与字体要和风格意象匹配。
- name 用中文并体现风格意象。围栏之外不要写解释。`;
}
