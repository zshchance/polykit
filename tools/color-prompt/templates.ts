/**
 * AI 配色提示词模板（中英双语）。
 *
 * 把用户选中的色系（名称、情绪、逐色 hex + 用途）注入模板，
 * 生成结构化提示词，便于 AI 工具（GLM/Kimi/通义/ChatGPT/Midjourney 等）
 * 理解用户的配色意图，输出美化后的幻灯片或网站。
 *
 * 模板注入项：色系名、情绪关键词、逐色（角色名 + hex + 用途）、场景（幻灯片/网站）。
 * 输出纯文本，便于复制粘贴。
 */

import type { Palette, ColorRole } from './data/palettes';
import { colorOf } from './data/palettes';

/** 角色色 → 人类可读的用途说明（中文） */
const ROLE_USAGE_ZH: Record<ColorRole, string> = {
  bg: '页面大面积背景',
  surface: '卡片/面板表面',
  text: '正文主文字',
  muted: '次要文字与辅助信息',
  primary: '关键按钮、链接与主强调',
  accent: '点缀色，用于次要按钮、标签、装饰',
};

/** 角色色 → 人类可读的用途说明（英文） */
const ROLE_USAGE_EN: Record<ColorRole, string> = {
  bg: 'page background (large area)',
  surface: 'card / panel surface',
  text: 'body text',
  muted: 'secondary text and helper info',
  primary: 'primary buttons, links, main emphasis',
  accent: 'accent color for secondary buttons, tags, decoration',
};

/** 角色色 → 中文名（用于逐色列表） */
const ROLE_NAME_ZH: Record<ColorRole, string> = {
  bg: '背景',
  surface: '表面',
  text: '主文字',
  muted: '次要文字',
  primary: '主色',
  accent: '点缀色',
};

const ROLES: ColorRole[] = ['bg', 'surface', 'text', 'muted', 'primary', 'accent'];

/**
 * 生成中文提示词。
 * 适用场景：幻灯片美化、网站前端美化。
 */
export function buildPromptZh(p: Palette, scene: 'slide' | 'web' | 'both' = 'both'): string {
  const sceneText = scene === 'slide' ? '幻灯片' : scene === 'web' ? '网站前端页面' : '页面';
  const moodText = p.moods.join('、');
  const colorLines = ROLES.map((r) => {
    const hex = colorOf(p, r);
    return `- ${ROLE_NAME_ZH[r]}：${hex}（${ROLE_USAGE_ZH[r]}）`;
  }).join('\n');

  return `请使用以下配色方案，美化我要做的${sceneText}，使其整体气质统一、专业且富有美感。

【色系名称】${p.name}
【风格关键词】${moodText}
【风格说明】${p.desc}

【色彩规范】
${colorLines}

【设计要求】
1. 背景使用「${colorOf(p, 'bg')}」大面积铺底，保持留白与呼吸感，避免画面拥挤。
2. 主色「${colorOf(p, 'primary')}」用于关键按钮、主链接与核心强调元素，控制使用面积以保持克制。
3. 点缀色「${colorOf(p, 'accent')}」仅用于次要按钮、标签、小图标或装饰细节，起到画龙点睛作用。
4. 正文使用「${colorOf(p, 'text')}」，次要/辅助信息使用「${colorOf(p, 'muted')}」；确保文字与背景对比度满足可读性（正文对比度建议 ≥ 4.5:1）。
5. 卡片、面板等容器使用表面色「${colorOf(p, 'surface')}」，与背景形成层次。
6. 整体气质应传达：${moodText}。色块比例建议约 60% 背景 / 30% 主色与表面 / 10% 点缀色。

请基于以上配色，输出美化后的设计方案（可直接给出配色后的界面描述、配色搭配示例或具体 hex 用法）。`;
}

/**
 * 生成英文提示词。
 * 适用场景：Midjourney / DALL·E / 英文 LLM。
 */
export function buildPromptEn(p: Palette, scene: 'slide' | 'web' | 'both' = 'both'): string {
  const sceneText =
    scene === 'slide' ? 'a slide deck' : scene === 'web' ? 'a website front-end page' : 'slide decks and website front-end pages';
  const moodText = p.moods.join(', ');
  const colorLines = ROLES.map((r) => {
    const hex = colorOf(p, r);
    return `- ${r}: ${hex} — ${ROLE_USAGE_EN[r]}`;
  }).join('\n');

  return `Please design and beautify ${sceneText} using the color palette below. Make the overall look cohesive, professional, and visually appealing.

[Palette Name] ${p.name}
[Mood / Keywords] ${moodText}
[Style Note] ${p.desc}

[Color Specification]
${colorLines}

[Design Guidelines]
1. Use "${colorOf(p, 'bg')}" as the dominant background; keep generous whitespace and avoid clutter.
2. Use the primary color "${colorOf(p, 'primary')}" for key buttons, main links, and core emphasis — apply it sparingly.
3. Use the accent color "${colorOf(p, 'accent')}" only for secondary buttons, tags, small icons, or decorative details.
4. Use "${colorOf(p, 'text')}" for body text and "${colorOf(p, 'muted')}" for secondary/helper info; ensure text-background contrast meets readability (body contrast >= 4.5:1 recommended).
5. Use the surface color "${colorOf(p, 'surface')}" for cards and panels to create depth against the background.
6. The overall mood should feel: ${moodText}. Suggested color ratio ~60% background / 30% primary & surface / 10% accent.

Based on this palette, output the beautified design (a styled interface description, color pairing examples, or concrete hex usage).`;
}
