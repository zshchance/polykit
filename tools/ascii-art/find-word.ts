/**
 * 找字游戏 —— 把一句话的每个字按顺序「藏」进字符画 Cell 网格。
 *
 * 核心架构约束：绝不把全角汉字写进 Cell.ch（会破坏等宽网格，让 renderCellsToPre /
 * to-text / fitFontSize 三条下游全崩）。沿用项目正统：复用 Logo 点阵管线（rasterizeChar）
 * 把每个隐藏字栅格化成 █ / 空格 的半角点阵，再叠到字符画上。所有 Cell 始终半角字符。
 *
 * 植入顺序：按「从左到右、从上到下」逐行扫描顺序逐字放置——「爱」必在「我」之右或下一行。
 * 字间距由 spread 控制（0=紧挨连成块，100=按列距均匀铺满）。
 *
 * 依赖：复用 Logo 点阵管线 → 依赖 DOM canvas（主线程调用，非纯函数，不在渲染热路径）。
 * 浅拷贝：只 clone 被改写的 Cell，其余共享原数组引用（避免上万 Cell 全量深拷贝）。
 */

import type { Rendered, Cell } from './types';
import { rasterizeChar } from './render/text-to-logo-cells';

export interface FindWordCfg {
  /** 开启开关。 */
  enabled: boolean;
  /** 隐藏文字（一句话，如「我爱字符画」）。 */
  text: string;
  /** 随机种子（4 位 hex），同种子→同位置。 */
  seed: string;
  /** 点阵字符（默认 true）：true=每个字栅格化成 █ 点阵植入；false=每字作为单个字符植入（全角字标 w:true，渲染层 scaleX 压回半角宽）。 */
  dotMatrix: boolean;
  /** 每字点阵高度行数（4~16，默认 10）。仅 dotMatrix=true 时用。显示时纵向拉长。 */
  glyphSize: number;
  /** 分布程度 0~100：0=字字紧挨连成块；100=按列距均匀铺满画面。 */
  spread: number;
  /** 杂色 0~100：0=与终端前景色 fg 相同（融入）；100=与 fg 反色（最大对比）；中间线性插值。 */
  colorContrast: number;
}

export const FIND_WORD_DEFAULTS: FindWordCfg = {
  enabled: false,
  text: '',
  seed: '',
  dotMatrix: true,
  glyphSize: 10,
  spread: 30,
  colorContrast: 70,
};

/** 生成 4 位十六进制种子。 */
export function randomSeed(): string {
  return Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
}

/**
 * 在 cells 上叠加隐藏字。
 * - dotMatrix=true（默认）：每字栅格化成 █ 点阵植入（中英文通吃，半角不破坏等宽）。
 * - dotMatrix=false：每字作为单个字符植入（全角字标 w:true，渲染层 scaleX 压回半角宽）。
 * @param cells 已渲染的字符画网格（图片模式 / Logo 模式产出）
 * @param cfg 找字游戏配置
 * @param fg 终端前景色（杂色插值的起点）
 * @returns 新网格（未改写的 Cell 共享原引用，仅改写的 Cell 浅拷贝）
 */
export function applyFindWord(cells: Rendered, cfg: FindWordCfg, fg: string): Rendered {
  // 早返回：未启用 / 无字 / 网格空
  if (!cfg.enabled) return cells;
  const chars = Array.from((cfg.text || '').trim());
  if (chars.length === 0) return cells;
  if (cells.length === 0) return cells;

  return cfg.dotMatrix
    ? applyDotMatrix(cells, chars, cfg, fg)
    : applySingleChar(cells, chars, cfg, fg);
}

/** 杂色：lerpColor(fg, invert(fg), colorContrast/100)。0→fg 融入，100→反色最大对比。 */
function highlightColor(cfg: FindWordCfg, fg: string): string {
  const t = clampInt(cfg.colorContrast, 0, 100, 70) / 100;
  return lerpColor(fg, invertColor(fg), t);
}

/** 点阵模式：每字栅格化成 █ 点阵，按扫描顺序植入。 */
function applyDotMatrix(cells: Rendered, chars: string[], cfg: FindWordCfg, fg: string): Rendered {
  const H = cells.length;
  const W = cells[0]?.length ?? 0;
  if (W === 0) return cells;

  const glyphH = clampInt(cfg.glyphSize, 4, 16, 10);
  const N = chars.length;

  // —— 单实例 canvas（N 个字复用，不建 N 个 canvas）——
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return cells;

  // —— 栅格化每个字（点阵 [行][列]，true=亮像素）——
  const glyphs: boolean[][][] = chars.map((ch) => rasterizeChar(ctx, canvas, ch, glyphH));
  const glyphWs: number[] = glyphs.map((g) => g[0]?.length ?? 0);

  // 网格放不下任何字 → 不植入
  const maxGlyphW = Math.max(1, ...glyphWs);
  if (maxGlyphW > W || glyphH > H) return cells;

  // —— 位置规划：spread=0 紧挨成块，spread=100 分散铺满整个画面（行列都散）——
  // 用最大字宽估算「紧凑」布局的步距，让紧挨时字与字不重叠。
  const rng = makeRng(cfg.seed || 'default');
  const anchors = planAnchors({
    N, W, H, rng,
    spread: clampInt(cfg.spread, 0, 100, 30),
    itemW: maxGlyphW,   // 紧凑步距≈最大字宽
    itemH: glyphH,
  });

  const targetColor = highlightColor(cfg, fg);
  return stampGlyphs(cells, anchors, glyphs, targetColor, H);
}

/** 非点阵模式：每字作为单个字符植入（全角标 w:true，渲染层 scaleX 压回半角宽）。 */
function applySingleChar(cells: Rendered, chars: string[], cfg: FindWordCfg, fg: string): Rendered {
  const H = cells.length;
  const W = cells[0]?.length ?? 0;
  if (W === 0) return cells;
  const N = chars.length;

  const rng = makeRng(cfg.seed || 'default');
  // 非点阵每字占 1 列 1 行，紧凑步距 = 1
  const rawAnchors = planAnchors({
    N, W, H, rng,
    spread: clampInt(cfg.spread, 0, 100, 30),
    itemW: 1,
    itemH: 1,
  });

  const targetColor = highlightColor(cfg, fg);
  const anchors: { x: number; y: number; ch: string }[] = rawAnchors.map((a, i) =>
    a.x < 0 ? { x: -1, y: -1, ch: '' } : { x: a.x, y: a.y, ch: chars[i]! },
  );
  return stampChars(cells, anchors, targetColor, H);
}

/**
 * 二维位置规划：在 W×H 网格上为 N 个字算锚点。
 *
 * 两套锚点 + 线性插值（按 spread/100）：
 *   - compact（spread=0）：从种子化起点出发，逐字紧挨（步距=itemW/itemH），按行优先扫描，
 *     同行放不下自动换行 → 字字紧挨成一块。
 *   - distributed（spread=100）：把 N 个字铺满整个画面——排成近正方形的行列网格，
 *     每个字均匀分布在 W×H 内（行列都散），不再挤在一行。
 *   - 中间 spread：每个字的坐标 = lerp(compact[i], distributed[i], spread/100)。
 *
 * 顺序保证：两套都按行优先扫描 → 「爱」的 compact 与 distributed 坐标都在「我」之后，
 * 插值后仍保持从左到右、从上到下的相对顺序（用户期望「按顺序隐藏」）。
 *
 * 同种子→同起点→同布局（可复现）。放不下的字标 x=-1（跳过，不回溯）。
 */
interface PlanAnchor { x: number; y: number; }
interface PlanOpts {
  N: number;
  W: number;
  H: number;
  rng: () => number;
  spread: number; // 0~100
  /** 紧凑布局时每字占的宽（点阵=最大字宽，单字符=1）。 */
  itemW: number;
  /** 紧凑布局时每字占的高（点阵=glyphH，单字符=1）。 */
  itemH: number;
}
function planAnchors(opts: PlanOpts): PlanAnchor[] {
  const { N, W, H, rng, spread, itemW, itemH } = opts;
  const t = spread / 100; // 插值系数 0~1

  // —— compact（紧挨成块）：种子化起点 + 行优先扫描，步距=itemW/itemH ——
  // 起点在前 1/4 区域随机（给后续字留铺开空间）
  const startMaxX = Math.max(0, Math.floor((W - itemW) / 4));
  const startMaxY = Math.max(0, Math.floor((H - itemH) / 4));
  const startX = Math.floor(rng() * (startMaxX + 1));
  const startY = Math.floor(rng() * (startMaxY + 1));
  const compact: PlanAnchor[] = [];
  let cx = startX;
  let cy = startY;
  for (let i = 0; i < N; i++) {
    // 同行放不下 → 换行（行间留 1 空位）
    if (cx + itemW > W) {
      cy += itemH + 1;
      cx = 0;
    }
    if (cy + itemH > H) {
      compact.push({ x: -1, y: -1 }); // 放不下，跳过
    } else {
      compact.push({ x: cx, y: cy });
      cx += itemW + 1; // 字间留 1 空位
    }
  }

  // —— distributed（铺满画面）：近正方形行列网格，均匀分布到 W×H ——
  const cols = Math.max(1, Math.ceil(Math.sqrt(N)));
  const rows = Math.max(1, Math.ceil(N / cols));
  // 每格中心：横向均分 W，纵向均分 H，让字铺满整个画面（不再挤一行）
  const cellW = W / cols;
  const cellH = H / rows;
  const distributed: PlanAnchor[] = [];
  for (let i = 0; i < N; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    // 格子中心 - 字宽/2，让字落在格子中央
    const dx = Math.round((c + 0.5) * cellW - itemW / 2);
    const dy = Math.round((r + 0.5) * cellH - itemH / 2);
    // 越界裁剪（防御）
    const fx = Math.max(0, Math.min(W - itemW, dx));
    const fy = Math.max(0, Math.min(H - itemH, dy));
    distributed.push({ x: fx, y: fy });
  }

  // —— 插值：compact → distributed，按 spread/100 ——
  const anchors: PlanAnchor[] = [];
  for (let i = 0; i < N; i++) {
    const cp = compact[i]!;
    // compact 放不下的字 → 直接跳过（即使 distributed 能放也不插值，保持顺序语义）
    if (cp.x < 0) { anchors.push({ x: -1, y: -1 }); continue; }
    const dp = distributed[i]!;
    const ix = Math.round(cp.x + (dp.x - cp.x) * t);
    const iy = Math.round(cp.y + (dp.y - cp.y) * t);
    // 插值后越界防御
    const fx = Math.max(0, Math.min(W - itemW, ix));
    const fy = Math.max(0, Math.min(H - itemH, iy));
    anchors.push({ x: fx, y: fy });
  }
  return anchors;
}

/** 把点阵锚点盖到 cells（逐像素越界防御 + 浅拷贝）。 */
function stampGlyphs(
  cells: Rendered,
  anchors: { x: number; y: number }[],
  glyphs: boolean[][][],
  targetColor: string,
  H: number,
): Rendered {
  const out: Cell[][] = cells.map((row) => row);
  const rowCloned: boolean[] = new Array(H).fill(false);
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]!;
    if (a.x < 0) continue; // 跳过
    const glyph = glyphs[i]!;
    for (let dy = 0; dy < glyph.length; dy++) {
      const ty = a.y + dy;
      if (ty >= H) break; // 越界：目标行不存在
      const srcRow = glyph[dy]!;
      const gw = srcRow.length;
      for (let dx = 0; dx < gw; dx++) {
        if (!srcRow[dx]) continue; // 暗像素不动
        const tx = a.x + dx;
        const targetRow = out[ty]!;
        if (tx >= targetRow.length) break; // 越界：该行长度不足（Logo 多行模式各行宽可能不同）
        if (!rowCloned[ty]) {
          out[ty] = targetRow.slice();
          rowCloned[ty] = true;
        }
        // ch='█' + 杂色 fg，清 bg（半块模式避免下半像素色压住高亮；灰度模式本就无 bg）
        out[ty]![tx] = { ch: '█', fg: targetColor };
      }
    }
  }
  return out;
}

/** 把单字符锚点盖到 cells（逐字越界防御 + 浅拷贝 + 全角标 w）。 */
function stampChars(
  cells: Rendered,
  anchors: { x: number; y: number; ch: string }[],
  targetColor: string,
  H: number,
): Rendered {
  const out: Cell[][] = cells.map((row) => row);
  const rowCloned: boolean[] = new Array(H).fill(false);
  for (const a of anchors) {
    if (a.x < 0) continue; // 跳过标记（planAnchors 放不下的字）
    if (a.y >= H) continue;
    const targetRow = out[a.y]!;
    if (a.x >= targetRow.length) continue; // 越界：该行长度不足
    if (!rowCloned[a.y]) {
      out[a.y] = targetRow.slice();
      rowCloned[a.y] = true;
    }
    // 全角字标 w:true → 渲染层 scaleX(测量 ratio≈0.6) 压回半角列宽（半块 ▀/点阵 █ 不带 w 绝不触发）
    // 清 bg（半块模式避免下半像素色压住高亮，高亮字干净显形）
    out[a.y]![a.x] = { ch: a.ch, fg: targetColor, w: isFullWidthChar(a.ch) };
  }
  return out;
}

/**
 * 判断字符是否占 2 字符宽（全角/CJK）。
 * 仅用于 find-word 非点阵模式植入标记——渲染层据此决定是否 scaleX 压缩（系数 = 半角/全角 advance 比，≈0.6）。
 * 半角 ASCII / 制表符 / 块字符（▀█░▒▓）返回 false，绝不误压。
 */
function isFullWidthChar(ch: string): boolean {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return false;
  // 常见全角区段：CJK 统一汉字、扩展A、日韩、全角标点/符号、全角ASCII
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // 韩文 Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK 部首/标点
    (cp >= 0x3040 && cp <= 0x33ff) || // 日文假名/韩文/兼容
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK 扩展 A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 统一汉字（常用中文）
    (cp >= 0xa000 && cp <= 0xa4cf) || // 彝文
    (cp >= 0xac00 && cp <= 0xd7a3) || // 韩文音节
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 兼容汉字
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK 兼容形式
    (cp >= 0xff00 && cp <= 0xff60) || // 全角 ASCII / 标点
    (cp >= 0xffe0 && cp <= 0xffe6)    // 全角符号
  );
}

// —— 内部工具 ——

/** xmur3 字符串哈希 → 种子（标准算法，无依赖）。 */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** sfc32 PRNG：4 个 32 位种子 → [0,1) 浮点。标准算法，可复现。 */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = c + (c << 3) | 0;
    c = (c << 21 | c >>> 11);
    d = d + 1 | 0;
    t = t + d | 0;
    c = c + t | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** 由字符串种子构造 [0,1) PRNG。 */
function makeRng(seed: string): () => number {
  const h1 = xmur3(seed);
  const h2 = xmur3(seed + '#2');
  const h3 = xmur3(seed + '#3');
  const h4 = xmur3(seed + '#4');
  return sfc32(h1(), h2(), h3(), h4());
}

/** 钳制整数到 [min,max]，非法值回退 fallback。 */
function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/** #rrggbb → [r,g,b]；解析失败回退黑。 */
function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** [r,g,b] → #rrggbb。 */
function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** 取反色（255-r/g/b）。 */
function invertColor(hex: string): string {
  const [r, g, b] = parseHex(hex);
  return rgbToHex(255 - r, 255 - g, 255 - b);
}

/** 两色线性插值，t∈[0,1]，t=0→a，t=1→b。 */
function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}
