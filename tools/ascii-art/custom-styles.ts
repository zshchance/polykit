/**
 * AI 自定义风格 —— 镜像 quote-card/custom-templates.ts 的流程，
 * 但因为 ascii-art 的「风格」是纯数据 StyleConfig（非可执行代码），
 * 所以省去了 dryRun / 危险扫描 / 沙箱，只需校验 JSON 字段合法性。
 *
 * 流程：用户描述风格 → buildStylePrompt 生成提示词 → 粘贴 AI 返回的 JSON →
 *      parseStyleAIOutput 解析（名称/缩略图色/外观 JSON）→ validateAppearance 校验 →
 *      addCustomStyle 保存 → toStylePreset 包装进选择器。
 */

import type { TerminalType, CursorStyle } from './types';
import type { StylePreset } from './presets';
import { DEFAULT_PRESET } from './presets';

const STORAGE_KEY = 'ascii-art:custom-styles';
const CURRENT_VERSION = 1;
const ID_PREFIX = 'astyle:';

/** AI 生成的风格外观子集（StyleConfig 的风格相关字段，不含 charset/width 等图片参数）。 */
export interface StyleAppearance {
  bg: string;
  fg: string;
  terminal: TerminalType;
  title: string;
  showFrame: boolean;
  crtScanlines: boolean;
  crtGlow: boolean;
  crtCurve: boolean;
  cursor: CursorStyle;
}

/** 持久化的自定义风格。 */
export interface CustomStyle {
  id: string;
  name: string;
  config: StyleAppearance;
  preview: { bg: string; fg: string };
  createdAt: number;
}

interface Blob {
  version: number;
  items: CustomStyle[];
}

// —— CRUD ——

/** 读取全部自定义风格。任何错误静默回退空数组。 */
export function loadCustomStyles(): CustomStyle[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Blob;
    if (!parsed || parsed.version !== CURRENT_VERSION) return [];
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    // 防御性过滤：id 前缀 + 必填字段
    return items.filter(
      (it): it is CustomStyle =>
        typeof it?.id === 'string' &&
        it.id.startsWith(ID_PREFIX) &&
        typeof it.name === 'string' &&
        it.name.trim().length > 0 &&
        it.config != null &&
        typeof it.preview === 'object' &&
        typeof it.createdAt === 'number',
    );
  } catch {
    return [];
  }
}

function persist(items: CustomStyle[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: CURRENT_VERSION, items }));
  } catch {
    // 静默失败（隐私模式 / 配额）
  }
}

function newId(): string {
  return ID_PREFIX + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/**
 * 新增 / 覆盖自定义风格（同名覆盖：保留原 id + createdAt）。
 * @returns 保存后的完整列表
 */
export function addCustomStyle(
  name: string,
  config: StyleAppearance,
  preview: { bg: string; fg: string },
): CustomStyle[] {
  const trimmed = name.trim();
  const items = loadCustomStyles();
  const existingIdx = items.findIndex((it) => it.name.trim() === trimmed);
  if (existingIdx >= 0) {
    // 同名覆盖：保留 id + createdAt
    const old = items[existingIdx]!;
    items[existingIdx] = { ...old, name: trimmed, config, preview };
  } else {
    items.push({ id: newId(), name: trimmed, config, preview, createdAt: Date.now() });
  }
  persist(items);
  return items;
}

/** 删除指定 id 的自定义风格。@returns 保存后的完整列表 */
export function removeCustomStyle(id: string): CustomStyle[] {
  const items = loadCustomStyles().filter((it) => it.id !== id);
  persist(items);
  return items;
}

export function isCustomStyleId(id: string): boolean {
  return id.startsWith(ID_PREFIX);
}

// —— 校验 ——

const VALID_TERMINALS: TerminalType[] = ['macos', 'iterm2', 'cmd', 'bash'];
const VALID_CURSORS: CursorStyle[] = ['none', '▋', '_', '█'];

/** 简单颜色合法性：#hex / rgb() / rgba() / hsl() / 命名色（宽容）。 */
function isValidColor(v: unknown): v is string {
  if (typeof v !== 'string' || v.trim() === '') return false;
  const s = v.trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) || /^(rgb|hsl)a?\(/i.test(s) || /^[a-z]+$/i.test(s);
}

export interface AppearanceValidation {
  ok: boolean;
  cleaned: StyleAppearance;
  /** 校验失败原因（ok=false 时）。 */
  reason?: string;
}

/**
 * 校验并归一化 StyleAppearance。
 * 用 DEFAULT_PRESET 的外观字段作为兜底默认值。
 */
export function validateAppearance(raw: Record<string, unknown>): AppearanceValidation {
  const base = DEFAULT_PRESET.config;
  const bg = typeof raw.bg === 'string' ? raw.bg : base.bg;
  const fg = typeof raw.fg === 'string' ? raw.fg : base.fg;
  if (!isValidColor(bg)) return { ok: false, cleaned: makeDefault(), reason: `背景色不合法：${raw.bg}` };
  if (!isValidColor(fg)) return { ok: false, cleaned: makeDefault(), reason: `文字色不合法：${raw.fg}` };

  const terminal = VALID_TERMINALS.includes(raw.terminal as TerminalType)
    ? (raw.terminal as TerminalType)
    : base.terminal;
  const cursor = VALID_CURSORS.includes(raw.cursor as CursorStyle)
    ? (raw.cursor as CursorStyle)
    : base.cursor;

  const cleaned: StyleAppearance = {
    bg,
    fg,
    terminal,
    title: typeof raw.title === 'string' ? raw.title : base.title,
    showFrame: typeof raw.showFrame === 'boolean' ? raw.showFrame : base.showFrame,
    crtScanlines: typeof raw.crtScanlines === 'boolean' ? raw.crtScanlines : base.crtScanlines,
    crtGlow: typeof raw.crtGlow === 'boolean' ? raw.crtGlow : base.crtGlow,
    crtCurve: typeof raw.crtCurve === 'boolean' ? raw.crtCurve : base.crtCurve,
    cursor,
  };
  return { ok: true, cleaned };
}

function makeDefault(): StyleAppearance {
  const c = DEFAULT_PRESET.config;
  return {
    bg: c.bg, fg: c.fg, terminal: c.terminal, title: c.title,
    showFrame: c.showFrame, crtScanlines: c.crtScanlines, crtGlow: c.crtGlow,
    crtCurve: c.crtCurve, cursor: c.cursor,
  };
}

/** 包装成 StylePreset（合并图片默认参数，使其能直接喂给 applyPreset）。 */
export function toStylePreset(c: CustomStyle): StylePreset {
  // 合并：以当前内置预设的图片默认参数为底，覆盖风格外观字段
  const config = { ...DEFAULT_PRESET.config, ...c.config };
  return {
    id: c.id,
    name: '⭐ ' + c.name,
    preview: c.preview,
    config,
  };
}

// —— AI 提示词 ——

/**
 * 生成给 AI 的标准提示词。
 * 要求 AI 输出一个 ```json 代码块：前三行注释声明名称/背景/文字色，之后是 StyleAppearance 的 JSON。
 */
export function buildStylePrompt(description: string): string {
  const desc = description.trim() || '复古赛博朋克风的终端配色，带扫描线和辉光';
  return `你是一位精通终端美学与复古 CRT 文化的视觉设计专家。我要为一个「终端字符画生成器」设计一套终端风格，请根据我的描述生成风格参数。

【我想要的风格】
${desc}

【背景知识】
这个工具把图片或文字渲染成终端样式的字符画，外面包一个模拟终端窗口（标题栏 + 屏幕）。你设计的「风格」决定终端窗口的配色、终端类型、CRT 复古效果开关。你【不需要】、也【不要】管字符画本身的参数（字符集、分辨率、对比度等），只设计「终端外观」。

【你需要输出的字段（JSON 对象）】
- bg：终端屏幕背景色，#hex 格式（如 "#0a1a0a"）。深色背景通常更有终端味。
- fg：终端文字色，#hex 格式（如 "#33ff66"）。要与 bg 有足够对比度。
- terminal：终端窗口类型，四选一：
    "macos"   —— 标题栏左侧三个红黄绿圆点，圆角，深色半透明标题栏（最经典）
    "iterm2"  —— 同 macos 圆点，但圆角更小，标题栏更暗
    "cmd"     —— Windows CMD 风：无圆点，银灰色标题栏，几乎直角
    "bash"    —— Linux 终端风：无圆点，暗色标题栏，小圆角
- title：标题栏显示的文字（如 "zsh@matrix:~$" 或 "neo@cyberpunk:~$"），可空字符串表示不显示。要和风格氛围搭。
- showFrame：是否显示终端外框，布尔。复古风通常 true；纯纸质感/极简风可 false。
- crtScanlines：是否开启 CRT 扫描线效果，布尔。复古风建议 true（屏幕上有细细的横线纹理）。
- crtGlow：是否开启文字辉光，布尔。复古荧光屏建议 true（文字带柔光晕）。
- crtCurve：是否开启屏幕弧度，布尔。老 CRT 建议 true（屏幕微微鼓起）；现代扁平风 false。
- cursor：光标样式，四选一："none"（无）、"▋"（竖块）、"_"（下划线）、"█"（全块）。

【设计建议】
- 背景色与文字色务必有足够对比度（深底配亮字最稳妥）。
- 复古 / 怀旧 / 赛博朋克风：建议开 crtScanlines + crtGlow + crtCurve，用 macos/iterm2 终端。
- 现代 / 干净 / 极简风：建议关掉 CRT 三件套，showFrame 可保留或关。
- 纸质 / 打字机风：showFrame:false，关 CRT，用 bash 终端，bg 用米白色。
- 蓝屏 / 故障艺术：可用 cmd 终端，蓝色背景白色字。
- 标题栏文字要呼应主题（如赛博朋克用 "neo@cyberpunk:~$"，复古绿屏用 "zsh@matrix:~$"）。

【完整示例】
\`\`\`json
// 名称：深空
// 背景：#0a0e27
// 文字色：#64ffda
{
  "bg": "#0a0e27",
  "fg": "#64ffda",
  "terminal": "iterm2",
  "title": "admin@deep-space:~$",
  "showFrame": true,
  "crtScanlines": true,
  "crtGlow": true,
  "crtCurve": true,
  "cursor": "▋"
}
\`\`\`

【输出格式（务必照此结构，不要加其它说明）】
只输出一个代码块（用 \`\`\`json 包裹）。代码块【前三行】必须是注释，格式严格为：
    // 名称：<风格名，不含引号>
    // 背景：<#hex 背景色>
    // 文字色：<#hex 文字色>
其后是一个 JSON 对象，包含上述全部 9 个字段（bg/fg/terminal/title/showFrame/crtScanlines/crtGlow/crtCurve/cursor）。
JSON 必须合法（双引号、无尾逗号）。代码块之外不要写任何文字。`;
}

// —— 解析 ——

export interface ParsedStyleAIOutput {
  name: string;
  appearance: StyleAppearance;
  preview: { bg: string; fg: string };
}

const NAME_LINE_RE = /^[ \t]*(?:(?:\/\/|#)\s*)?(?:名称|风格名(?:称)?|name)[ \t]*[:：][ \t]*(.+?)[ \t]*$/i;
const BG_LINE_RE = /^[ \t]*(?:(?:\/\/|#)\s*)?(?:背景|缩略图背景|background|bg)[ \t]*[:：][ \t]*(.+?)[ \t]*$/i;
const FG_LINE_RE = /^[ \t]*(?:(?:\/\/|#)\s*)?(?:文字色|前景色|缩略图文字色|foreground|fg)[ \t]*[:：][ \t]*(.+?)[ \t]*$/i;

/** 从一行匹配结果里提取干净的值（去引号，不去括号——颜色值不会有括号问题）。 */
function cleanMetaValue(line: string, re: RegExp): string | null {
  const m = line.trim().match(re);
  if (!m) return null;
  return m[1]!.trim().replace(/^["'「『]+|["'」』]+$/g, '').trim();
}

/**
 * 解析用户从 AI 复制回来的内容：拆出【名称】+【缩略图背景/文字色】+【风格 JSON】。
 * 容错：JSON 解析失败时逐字段正则兜底提取。
 */
export function parseStyleAIOutput(raw: string): ParsedStyleAIOutput | null {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return null;

  // 1) 提取代码块（```json 优先，否则去 ``` 行）
  let body = '';
  const fence = text.match(/```(?:json)?\s*\n([\s\S]*?)\n?```/i);
  if (fence) {
    body = fence[1]!.trim();
  } else {
    body = text
      .split('\n')
      .filter((l) => !/^```/.test(l.trim()))
      .join('\n')
      .trim();
  }

  // 2) 从注释行提取名称/背景/文字色（先扫代码块内，再扫全文兜底）
  const bodyLines = body.split('\n');
  const allLines = text.split('\n');

  let name = '';
  let bg = '';
  let fg = '';
  for (const l of bodyLines) {
    if (!name) {
      const v = cleanMetaValue(l, NAME_LINE_RE);
      if (v && /^\s*(?:\/\/|#)/.test(l)) name = v;
    }
    if (!bg) {
      const v = cleanMetaValue(l, BG_LINE_RE);
      if (v && /^\s*(?:\/\/|#)/.test(l)) bg = v;
    }
    if (!fg) {
      const v = cleanMetaValue(l, FG_LINE_RE);
      if (v && /^\s*(?:\/\/|#)/.test(l)) fg = v;
    }
  }
  if (!name) {
    const line = allLines.find((l) => NAME_LINE_RE.test(l.trim()));
    if (line) name = cleanMetaValue(line, NAME_LINE_RE) ?? '';
  }

  // 3) 剥掉三条声明注释，剩余当 JSON 解析
  const isMetaLine = (l: string): boolean =>
    NAME_LINE_RE.test(l.trim()) || BG_LINE_RE.test(l.trim()) || FG_LINE_RE.test(l.trim());
  const jsonText = body
    .split('\n')
    .filter((l) => !isMetaLine(l))
    .join('\n')
    .trim();

  let parsedObj: Record<string, unknown> = {};
  try {
    parsedObj = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    // JSON 解析失败：逐字段正则兜底
    const pickStr = (key: string): string | undefined => {
      const m = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 'i').exec(jsonText);
      return m?.[1];
    };
    const pickBool = (key: string): boolean | undefined => {
      const m = new RegExp(`"${key}"\\s*:\\s*(true|false)`, 'i').exec(jsonText);
      return m ? m[1] === 'true' : undefined;
    };
    parsedObj = {
      bg: pickStr('bg'), fg: pickStr('fg'),
      terminal: pickStr('terminal'), title: pickStr('title'),
      showFrame: pickBool('showFrame'), crtScanlines: pickBool('crtScanlines'),
      crtGlow: pickBool('crtGlow'), crtCurve: pickBool('crtCurve'),
      cursor: pickStr('cursor'),
    };
  }

  // 4) 校验归一化
  const validation = validateAppearance(parsedObj);
  const appearance = validation.cleaned;
  // bg/fg 优先用注释声明的缩略图色（更准），否则用 JSON 里的
  const finalBg = bg || appearance.bg;
  const finalFg = fg || appearance.fg;
  appearance.bg = finalBg;
  appearance.fg = finalFg;

  if (!name) return null;
  return { name, appearance, preview: { bg: finalBg, fg: finalFg } };
}
