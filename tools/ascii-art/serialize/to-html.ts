/**
 * Cell[][] → 彩色 HTML（复制用，含 fg/bg 色，不含终端外框）。
 *
 * 每个 Cell 一个 <span style="color:fg;background-color:bg">，行末 <br>。
 * 连续同色合并（RLE）为二期优化项，此处先直出保证正确。
 *
 * 需转义 < > & 防注入（虽然字符画里这些字符不常见，但 charset 可能含）。
 */

import type { Rendered } from '../render/types';

export function serializeHtml(cells: Rendered): string {
  if (cells.length === 0) return '';
  const lines: string[] = [];
  for (const row of cells) {
    const parts: string[] = [];
    for (const cell of row) {
      const style = cellStyle(cell);
      parts.push(`<span${style}>${escapeHtml(cell.ch)}</span>`);
    }
    lines.push(parts.join(''));
  }
  return lines.join('<br>');
}

function cellStyle(cell: { fg?: string; bg?: string }): string {
  const decls: string[] = [];
  if (cell.fg) decls.push(`color:${cell.fg}`);
  if (cell.bg) decls.push(`background-color:${cell.bg}`);
  return decls.length === 0 ? '' : ` style="${decls.join(';')}"`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
