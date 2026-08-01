/**
 * 配色多格式输出 —— 纯格式化器，无副作用。
 *
 * 输入一组提取色，按所选格式拼成可复制文本，方便直接粘贴进工程。
 * 所有格式都可独立测试。
 */

import type { ExtractedColor } from './extractor';

/** 支持的输出格式 */
export type OutputFormat =
  | 'css-vars' // :root { --c1: #...; }
  | 'tailwind' // Tailwind config 的 colors 片段
  | 'scss' // $c1: #...;
  | 'json' // [{hex, ratio}, ...]
  | 'hex'; // 纯 hex 列表，逗号分隔

export const FORMAT_OPTIONS: { id: OutputFormat; name: string; desc: string }[] = [
  { id: 'css-vars', name: 'CSS 变量', desc: ':root { --color-1: #...; }' },
  { id: 'tailwind', name: 'Tailwind', desc: 'theme.colors 配置片段' },
  { id: 'scss', name: 'SCSS', desc: '$color-1: #...;' },
  { id: 'json', name: 'JSON', desc: '[{ hex, ratio }, ...]' },
  { id: 'hex', name: 'Hex 列表', desc: '#..., #..., 逗号分隔' },
];

/** 主键名生成：color-1 / color-2 …，方便多格式复用 */
function key(i: number): string {
  return `color-${i + 1}`;
}

/** 按格式生成可复制文本；无色时返回空串 */
export function formatPalette(colors: ExtractedColor[], fmt: OutputFormat): string {
  if (colors.length === 0) return '';
  switch (fmt) {
    case 'css-vars':
      return `:root {\n${colors
        .map((c, i) => `  --${key(i)}: ${c.hex}; /* ${(c.ratio * 100).toFixed(1)}% */`)
        .join('\n')}\n}`;
    case 'tailwind':
      return `colors: {\n${colors
        .map((c, i) => `  '${key(i)}': '${c.hex}',`)
        .join('\n')}\n}`;
    case 'scss':
      return colors.map((c, i) => `$${key(i)}: ${c.hex};`).join('\n');
    case 'json':
      return JSON.stringify(
        colors.map((c) => ({ hex: c.hex, ratio: Number((c.ratio * 100).toFixed(1)) })),
        null,
        2,
      );
    case 'hex':
      return colors.map((c) => c.hex).join(', ');
    default:
      return '';
  }
}

/** 取格式的人类可读名称（用于 UI 标题） */
export function formatName(fmt: OutputFormat): string {
  return FORMAT_OPTIONS.find((f) => f.id === fmt)?.name ?? fmt;
}
