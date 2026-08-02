/**
 * 字符集 —— 灰度字符画用的字符序列。
 *
 * 关键约定：字符集必须按「暗→亮」排列（第一个字符代表最暗的像素，最后一个代表最亮），
 * 这样像素亮度才能线性映射到字符索引。
 *
 * 安全性：只放确定半角的字符。
 *   - 全角字符（中文、全角符号）在等宽字体里占 2 个半角宽，会撑破字符画对齐；
 *   - 块字符若 fallback 到中文字体会渲染成全角方块。
 * 故默认字符集只用 ASCII + 明确半角的 Block Elements；自定义字符集运行时做宽度检测。
 */

/** 预设字符集（已按暗→亮排序）。 */
export interface CharsetPreset {
  id: string;
  name: string;
  chars: string;
}

export const CHARSET_PRESETS: CharsetPreset[] = [
  { id: 'classic', name: '经典灰度', chars: ' .:-=+*#%@' },
  { id: 'dense', name: '高密度', chars: " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$" },
  { id: 'block', name: '块字符', chars: ' ░▒▓█' },
  { id: 'binary', name: '二值', chars: ' 01' },
  { id: 'dots', name: '点阵', chars: ' ·∙●' },
];

export const DEFAULT_CHARSET = CHARSET_PRESETS[0]!.chars;

/** 字符集校验结果。 */
export interface CharsetValidation {
  ok: boolean;
  /** 清洗后的字符集（已剔除异常字符）。 */
  cleaned: string;
  /** 被剔除的字符列表。 */
  dropped: string[];
}

/**
 * 校验自定义字符集：用 canvas measureText 检测每个字符的实际宽度，
 * 剔除全角 / fallback 异常字符（与基准半角字符 'M' 宽度差异过大者）。
 *
 * 保留所有「宽度等于基准半角宽」的字符；其余剔除并记入 dropped。
 * 若清洗后为空，返回 ok:false（调用方据此报错或回退默认）。
 */
export function validateCharset(charset: string): CharsetValidation {
  const chars = Array.from(new Set(charset.split(''))).filter((c) => c !== '');
  if (chars.length === 0) return { ok: false, cleaned: '', dropped: [] };

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // 极端环境无 canvas：原样返回，不做剔除（降级，不阻塞）
    return { ok: true, cleaned: chars.join(''), dropped: [] };
  }
  ctx.font = '16px ui-monospace, Menlo, Consolas, monospace';
  const baseWidth = ctx.measureText('M').width;

  const kept: string[] = [];
  const dropped: string[] = [];
  for (const c of chars) {
    const w = ctx.measureText(c).width;
    // 允许 10% 容差（不同字符在等宽字体下仍可能有微小差异）
    if (Math.abs(w - baseWidth) <= baseWidth * 0.1) {
      kept.push(c);
    } else {
      dropped.push(c);
    }
  }
  return { ok: kept.length > 0, cleaned: kept.join(''), dropped };
}

/**
 * 按字符视觉亮度排序（暗→亮）。
 * 用一个粗糙的「字符填充率」估计：用 canvas 把字符画下来，数非透明像素占比。
 * 保证用户乱序输入也能正确映射。
 */
export function sortCharsetByBrightness(charset: string): string {
  const chars = Array.from(new Set(charset.split(''))).filter((c) => c !== '' && c !== ' ');
  if (chars.length <= 1) return charset;

  const canvas = document.createElement('canvas');
  const size = 32;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return charset;

  ctx.font = '24px ui-monospace, Menlo, Consolas, monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  const brightnessOf = (c: string): number => {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(c, size / 2, size / 2);
    const { data } = ctx.getImageData(0, 0, size, size);
    let sum = 0;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! > 0) {
        sum += data[i - 3]! + data[i - 2]! + data[i - 1]!;
        count++;
      }
    }
    return count === 0 ? 0 : sum / count;
  };

  const sorted = [...chars].sort((a, b) => brightnessOf(a) - brightnessOf(b));
  // 空格始终最暗（放最前）
  return (charset.includes(' ') ? ' ' : '') + sorted.join('');
}
