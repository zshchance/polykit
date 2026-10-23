/**
 * AI 风格方案 —— 整套「配色主题 + 版式选项」组合的存储、校验与提示词。
 *
 * 与自定义频谱样式（代码执行）不同：风格方案是纯数据 JSON，零代码执行、
 * 天然安全。AI 返回一个 json 围栏对象（名称 + 四个 hex 颜色 + 若干枚举选项），
 * 逐字段校验（枚举值用 options.ts 的真实常量目录核对，非法字段静默丢弃）。
 *
 * 应用为「快照语义」：点 chip 时按方案创建/覆盖同名自定义主题（custom-themes 层）
 * 并合并选项字段；之后手动改主题色不影响已存方案；删除方案 chip 不动同名主题。
 *
 * 存储形态（JSON）：{ "version": 1, "items": CustomStyle[] }
 */

import { readJSON, writeJSON } from '@/core/utils/storage';

import {
  COVER_STYLES,
  INTRO_ANIMS,
  LYRIC_MODES,
  OUTRO_ANIMS,
  PROGRESS_BARS,
  VISUALIZERS,
  type CoverStyleId,
  type IntroAnimId,
  type LyricModeId,
  type OutroAnimId,
  type ProgressBarId,
  type SongVideoOptions,
  type VisualizerId,
} from './options';

const STORAGE_KEY = 'song-video:custom-styles';
const CURRENT_VERSION = 1;
const ID_PREFIX = 'svstyle:';

/** 一条 AI 风格方案（本地存储形态）。颜色必填；枚举字段可选（缺省 = 应用时不改变该项）。 */
export interface CustomStyle {
  /** 形如 svstyle:abcd1234 */
  id: string;
  /** 方案名（≤12 字，同时用作自动创建的自定义主题名） */
  name: string;
  /** 背景渐变起止色 / 文字色 / 主强调色（hex #rrggbb） */
  bg1: string;
  bg2: string;
  fg: string;
  accent: string;
  /** 以下版式选项全部可选；值必须来自 options.ts 的枚举目录（仅内置可视化样式） */
  visualizer?: VisualizerId;
  lyricMode?: LyricModeId;
  progressBar?: ProgressBarId;
  introAnim?: IntroAnimId;
  outroAnim?: OutroAnimId;
  coverStyle?: CoverStyleId;
  createdAt: number;
}

interface CustomStyleBlob {
  version: number;
  items: CustomStyle[];
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function validEnum<T extends string>(v: unknown, choices: readonly { id: T }[]): T | undefined {
  return typeof v === 'string' && choices.some((c) => c.id === v) ? (v as T) : undefined;
}

/** 逐字段校验一条存储项；不合法返回 null（整条丢弃） */
function validStyle(it: unknown): CustomStyle | null {
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
  ) {
    return null;
  }
  const style: CustomStyle = {
    id: o.id,
    name: o.name.trim().slice(0, 12),
    bg1: o.bg1 as string,
    bg2: o.bg2 as string,
    fg: o.fg as string,
    accent: o.accent as string,
    createdAt: o.createdAt,
  };
  const visualizer = validEnum(o.visualizer, VISUALIZERS);
  const lyricMode = validEnum(o.lyricMode, LYRIC_MODES);
  const progressBar = validEnum(o.progressBar, PROGRESS_BARS);
  const introAnim = validEnum(o.introAnim, INTRO_ANIMS);
  const outroAnim = validEnum(o.outroAnim, OUTRO_ANIMS);
  const coverStyle = validEnum(o.coverStyle, COVER_STYLES);
  if (visualizer) style.visualizer = visualizer;
  if (lyricMode) style.lyricMode = lyricMode;
  if (progressBar) style.progressBar = progressBar;
  if (introAnim) style.introAnim = introAnim;
  if (outroAnim) style.outroAnim = outroAnim;
  if (coverStyle) style.coverStyle = coverStyle;
  return style;
}

/** 读取全部风格方案；存储损坏/为空时返回 [] */
export function loadCustomStyles(): CustomStyle[] {
  const parsed = readJSON(STORAGE_KEY) as Partial<CustomStyleBlob> | null;
  if (!parsed) return [];
  const items = parsed.items;
  if (!Array.isArray(items)) return [];
  return items
    .map(validStyle)
    .filter((it): it is CustomStyle => it !== null);
}

function persist(items: CustomStyle[]): void {
  const blob: CustomStyleBlob = { version: CURRENT_VERSION, items };
  writeJSON(STORAGE_KEY, blob);
}

function newId(): string {
  return (
    ID_PREFIX + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  );
}

/** 新增或同名覆盖一条；返回更新后的完整列表 */
export function addCustomStyle(style: Omit<CustomStyle, 'id' | 'createdAt'>): CustomStyle[] {
  const items = loadCustomStyles();
  const existingIdx = items.findIndex((it) => it.name.trim() === style.name.trim());
  const entry: CustomStyle = {
    ...style,
    id: existingIdx >= 0 ? items[existingIdx]!.id : newId(),
    createdAt: existingIdx >= 0 ? items[existingIdx]!.createdAt : Date.now(),
  };
  if (existingIdx >= 0) items[existingIdx] = entry;
  else items.push(entry);
  persist(items);
  return items;
}

/** 删除一条；返回更新后的完整列表 */
export function removeCustomStyle(id: string): CustomStyle[] {
  const items = loadCustomStyles().filter((it) => it.id !== id);
  persist(items);
  return items;
}

/** 方案中的版式选项 → SongVideoOptions 补丁（仅含方案明确指定的字段） */
export function styleOptionPatches(s: CustomStyle): Partial<SongVideoOptions> {
  const p: Partial<SongVideoOptions> = {};
  if (s.visualizer) p.visualizer = s.visualizer;
  if (s.lyricMode) p.lyricMode = s.lyricMode;
  if (s.progressBar) p.progressBar = s.progressBar;
  if (s.introAnim) p.introAnim = s.introAnim;
  if (s.outroAnim) p.outroAnim = s.outroAnim;
  if (s.coverStyle) p.coverStyle = s.coverStyle;
  return p;
}

// ─────────────────────────── AI 输出解析 ───────────────────────────

/** AI 输出解析结果（配色必齐——chips 需要渐变色渲染，配色缺失直接拒收） */
export interface ParsedStyle {
  name: string;
  colors: { bg1: string; bg2: string; fg: string; accent: string };
  visualizer?: VisualizerId;
  lyricMode?: LyricModeId;
  progressBar?: ProgressBarId;
  introAnim?: IntroAnimId;
  outroAnim?: OutroAnimId;
  coverStyle?: CoverStyleId;
}

/**
 * 从 AI 整段回复解析风格方案 JSON。
 * 规则：名称与四个颜色必填且合法；枚举字段值非法则静默丢弃（应用时不改变该项）。
 */
export function parseStyleAIOutput(raw: string): { ok: true; style: ParsedStyle } | { ok: false; reason: string } {
  const fence = /```(?:json)?\s*\n([\s\S]*?)\n?```/i.exec(raw);
  const text = (fence ? fence[1] : raw).trim();
  let obj: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'AI 返回的不是 JSON 对象——请把 ```json 代码块完整粘进来。' };
    }
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
  if (present.length === 0) {
    return { ok: false, reason: '缺少配色字段——bg1/bg2/fg/accent 四个 #rrggbb 颜色必须齐全。' };
  }
  if (present.length < 4) {
    return {
      ok: false,
      reason: `配色字段不完整（出现 ${present.join('/')}）——bg1/bg2/fg/accent 四个 hex 颜色必须齐全。`,
    };
  }
  const bad = colorKeys.filter((k) => typeof obj[k] !== 'string' || !HEX.test(obj[k] as string));
  if (bad.length > 0) {
    return { ok: false, reason: `${bad.join('/')} 不是合法的 #rrggbb hex 颜色。` };
  }
  const colors: ParsedStyle['colors'] = {
    bg1: obj.bg1 as string,
    bg2: obj.bg2 as string,
    fg: obj.fg as string,
    accent: obj.accent as string,
  };

  const style: ParsedStyle = { name, colors };
  const visualizer = validEnum(obj.visualizer, VISUALIZERS);
  const lyricMode = validEnum(obj.lyricMode, LYRIC_MODES);
  const progressBar = validEnum(obj.progressBar, PROGRESS_BARS);
  const introAnim = validEnum(obj.introAnim, INTRO_ANIMS);
  const outroAnim = validEnum(obj.outroAnim, OUTRO_ANIMS);
  const coverStyle = validEnum(obj.coverStyle, COVER_STYLES);
  if (visualizer) style.visualizer = visualizer;
  if (lyricMode) style.lyricMode = lyricMode;
  if (progressBar) style.progressBar = progressBar;
  if (introAnim) style.introAnim = introAnim;
  if (outroAnim) style.outroAnim = outroAnim;
  if (coverStyle) style.coverStyle = coverStyle;
  return { ok: true, style };
}

// ─────────────────────────── AI 提示词 ───────────────────────────

/** 枚举取值表由 options.ts 真实常量目录生成，与代码永不漂移 */
function enumDoc<T extends string>(choices: readonly { id: T; label: string }[]): string {
  return choices.map((c) => `"${c.id}"（${c.label}）`).join(' / ');
}

/**
 * 组装「用 AI 生成整套风格方案」的提示词。
 * 用户把它粘到任意 AI 对话，AI 按字段约定返回一个 ```json 对象，粘回即存即用。
 */
export function buildStylePrompt(description: string): string {
  const desc = description.trim() || '高级耐看的音乐视频风格';
  return `你是音乐短视频的视觉设计专家。请为我设计一套「视频风格方案」：一套配色主题 + 版式选项的组合。

【我想要的风格】
${desc}

【输出格式（必须严格遵守）】
只输出一个 \`\`\`json 围栏代码块，内容为一个 JSON 对象。字段与可选值如下（枚举值必须与给出的 id 一字不差）：
{
  "name": "方案名，不超过 12 字",
  "bg1": "#0b1026",
  "bg2": "#2b0f45",
  "fg": "#f5f3ff",
  "accent": "#22d3ee",
  "visualizer": "……",
  "lyricMode": "……",
  "progressBar": "……",
  "introAnim": "……",
  "outroAnim": "……",
  "coverStyle": "……"
}
字段说明：
- bg1/bg2：背景渐变起止色；fg：文字色；accent：主强调色（频谱/进度条/高亮歌词）。四个都是 #rrggbb 格式，必须齐全。
- 可选枚举字段（可整体省略，省略 = 保持该项不变）：
  visualizer（音频可视化）：${enumDoc(VISUALIZERS)}
  lyricMode（歌词显示）：${enumDoc(LYRIC_MODES)}
  progressBar（进度条）：${enumDoc(PROGRESS_BARS)}
  introAnim（开场动画）：${enumDoc(INTRO_ANIMS)}
  outroAnim（结尾动画）：${enumDoc(OUTRO_ANIMS)}
  coverStyle（片头封面样式）：${enumDoc(COVER_STYLES)}

【设计要求】
- 配色和谐、对比充足：背景深则文字浅（反之亦然），accent 与背景区分明显、足够鲜明（它是频谱的主角）。
- 版式选项与配色气质搭配：如电子/夜店风配镜像频谱、民谣/lo-fi 配声波曲线、叙事感配滚动歌词列表。
- name 用中文、体现风格意象。

【示例（展示格式，请按我的需求重新设计）】
\`\`\`json
{ "name": "霓虹夜店", "bg1": "#0b1026", "bg2": "#2b0f45", "fg": "#f5f3ff", "accent": "#22d3ee", "visualizer": "mirror", "lyricMode": "list", "progressBar": "line", "introAnim": "zoom", "outroAnim": "fade", "coverStyle": "sticker" }
\`\`\`
围栏之外不要写任何解释文字。`;
}
