/**
 * Cell[][] → 纯文本（复制用，不含终端外框、不含颜色）。
 *
 * 降级规则：
 *   - 半块 Cell（ch='▀'）：取 fg / bg 的亮度平均 → 映射到 charset 字符（比只取上半平滑）
 *   - 纯字符 Cell：直接取 ch
 *   - 空 fg/bg：用空格占位
 *
 * 注意：半块的 fg/bg 是 hex 色字符串，需解析回 RGB 算亮度。
 */

import type { Rendered } from '../render/types';

export function serializeText(cells: Rendered, charset: string): string {
  if (cells.length === 0) return '';
  const cs = charset.length > 0 ? charset : ' .:-=+*#%@';
  const lines: string[] = [];
  for (const row of cells) {
    let line = '';
    for (const cell of row) {
      if (cell.ch === '▀' && (cell.fg || cell.bg)) {
        // 半块降级：上下亮度平均
        const up = parseLum(cell.fg);
        const dn = parseLum(cell.bg);
        const lum = (up + dn) / 2;
        line += lumToChar(lum, cs);
      } else {
        line += cell.ch;
      }
    }
    lines.push(line);
  }
  return lines.join('\n');
}

function parseLum(hex: string | undefined): number {
  if (!hex) return 0;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function lumToChar(lum: number, charset: string): string {
  const n = charset.length;
  if (n === 0) return ' ';
  const idx = Math.min(n - 1, Math.max(0, Math.round((lum / 255) * (n - 1))));
  return charset[idx]!;
}
