/**
 * 文字 → Logo 字符 Cell 网格。
 *
 * 把用户输入的每个字符（中英文/符号皆可）放大成多字符组成的「大字 logo」，
 * 横排并排拼接，像操作系统启动 banner。
 *
 * 渲染法：Canvas 点阵法。
 *   1. 用 canvas fillText 把每个字符画到离屏 canvas
 *   2. getImageData 取 alpha 通道 → alpha>阈值 = 亮像素（笔画）
 *   3. 亮像素 → fillChar（如 █），暗像素 → 空格
 *   4. 每个字的点阵横排拼接（左加 charGap 空列），多行输入纵向堆叠
 *
 * 中英文通吃（canvas 能渲染任何字体里的字），零字体数据依赖。
 * 纯函数：输入 cfg，输出 Rendered，只用临时 canvas，无全局副作用。
 */

import type { Cell, Rendered } from './types';

export interface LogoCfg {
  /** 用户输入（如「即开宝匣」，多行用 \n 分隔）。 */
  text: string;
  /** 每个字的目标点阵高度（行数）。决定 logo 大小。默认 16。 */
  glyphHeight: number;
  /** 亮像素填充字符。默认 '█'。 */
  fillChar: string;
  /** 字符之间的空列数。默认 2。 */
  charGap: number;
  /** 前景色（fillChar 的色）。 */
  fg: string;
  /** 终端背景色（仅用于裁剪判断，不写进 Cell）。 */
  bg: string;
}

/** Canvas 字体栈：等宽优先，中文回退（保证中文能渲染）。 */
const LOGO_FONT_STACK = '"JetBrains Mono", ui-monospace, Menlo, Consolas, "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif';

/** 亮像素 alpha 阈值。 */
const ALPHA_THRESHOLD = 128;

/**
 * 把文字渲染成 Logo Cell 网格。
 * @returns Rendered；空文本返回空数组
 */
export function textToLogoCells(cfg: LogoCfg): Rendered {
  const text = (cfg.text || '').trim();
  if (!text) return [];

  const glyphH = Math.max(6, Math.round(cfg.glyphHeight));
  const fillChar = cfg.fillChar || '█';
  const gap = Math.max(0, Math.round(cfg.charGap));
  const fg = cfg.fg;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  // 字号设得比目标高度略大，留出字面边距 + 防止裁到笔画
  // 用 glyphH 作为像素高度基准；fillText 的字号约等于像素高
  const fontSize = Math.round(glyphH * 1.15);
  ctx.font = `${fontSize}px ${LOGO_FONT_STACK}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  // 按行处理（\n 分隔），每行渲染成一个 logo 块
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const blocks: Rendered = []; // 每个 block 是一行的 logo 网格

  for (const line of lines) {
    const chars = Array.from(line); // 正确处理中文/emoji（码点拆分）
    // 逐字取点阵：glyphs[i] 是第 i 个字的 boolean[][]（[行][列]）
    const glyphs: boolean[][][] = chars.map((ch) => rasterizeChar(ctx, canvas, ch, glyphH));
    if (glyphs.length === 0) continue;

    const lastGlyph = glyphs[glyphs.length - 1];
    const blockRows: Cell[][] = [];
    for (let y = 0; y < glyphH; y++) {
      const row: Cell[] = [];
      for (const dot of glyphs) {
        const w = dot[0]?.length ?? 0;
        for (let x = 0; x < w; x++) {
          const lit = dot[y]?.[x] ?? false;
          row.push(lit ? { ch: fillChar, fg } : { ch: ' ' });
        }
        // 字间距（最后一个字不加）
        if (dot !== lastGlyph) {
          for (let g = 0; g < gap; g++) row.push({ ch: ' ' });
        }
      }
      blockRows.push(row);
    }
    // 行间留 1 空行（宽度对齐本块）
    if (blocks.length > 0) {
      const blankW = blockRows[0]?.length ?? 0;
      const blankRow: Cell[] = Array.from({ length: blankW }, () => ({ ch: ' ' }) as Cell);
      blocks.push(blankRow);
    }
    for (const r of blockRows) blocks.push(r);
  }

  return blocks;
}

/**
 * 把单个字符栅格化成点阵 [行][列] 的 boolean（true=亮）。
 * 高度统一为 targetH 行（裁剪/填充到目标高度）。
 */
function rasterizeChar(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  ch: string,
  targetH: number,
): boolean[][] {
  // 测量字符宽度
  const metrics = ctx.measureText(ch);
  // metrics.width 是 advance width；实际 ink 可能略宽，加点余量
  const advW = Math.ceil(metrics.width);
  // ink 宽度可能小于 advance（英文），也可能差不多（中文方块）
  const w = Math.max(1, advW);
  const h = targetH;

  // 调整 canvas 尺寸（重设尺寸会清空 ctx 状态，需重设 font）
  canvas.width = w;
  canvas.height = h;
  // 重设尺寸后 context 被重置，重新配置
  const fontSize = Math.round(targetH * 1.15);
  ctx.font = `${fontSize}px ${LOGO_FONT_STACK}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.clearRect(0, 0, w, h);
  ctx.fillText(ch, 0, 0);

  const { data } = ctx.getImageData(0, 0, w, h);
  const dot: boolean[][] = [];
  for (let y = 0; y < h; y++) {
    const row: boolean[] = new Array(w).fill(false);
    for (let x = 0; x < w; x++) {
      const alpha = data[(y * w + x) * 4 + 3]!;
      row[x] = alpha > ALPHA_THRESHOLD;
    }
    dot.push(row);
  }
  return trimEmptyColumns(dot);
}

/** 裁掉点阵右侧的全空列（中文方块通常无空列，英文可能有 advance 空白）。 */
function trimEmptyColumns(dot: boolean[][]): boolean[][] {
  if (dot.length === 0) return dot;
  const w = dot[0]!.length;
  let lastLit = -1;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < dot.length; y++) {
      if (dot[y]![x]!) { lastLit = x; break; }
    }
  }
  if (lastLit === -1) return [[false]]; // 全空字符（如空格），保留 1 列
  if (lastLit === w - 1) return dot;
  return dot.map((row) => row.slice(0, lastLit + 1));
}
