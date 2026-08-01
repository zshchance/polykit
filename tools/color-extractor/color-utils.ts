/**
 * 纯色彩工具函数 —— 无 DOM、无 IO、确定性强。
 *
 * 被抽取算法、格式化器、UI 着色复用。可独立单元测试（Node 直跑）。
 * 全部输入输出为 0-255 的整数或标准 hex/hsl 字符串，避免浮点误差堆积。
 */

/** RGB 三元组，各通道 0-255 整数 */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** HSL 三元组：h∈[0,360)、s∈[0,100]、l∈[0,100] */
export interface HSL {
  h: number;
  s: number;
  l: number;
}

/** 把任意通道值钳到 [0,255] 并取整 */
export function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** hex → RGB；非法输入抛错。支持 #rgb / #rrggbb / rgb（无 #） */
export function hexToRgb(hex: string): RGB {
  let s = hex.trim().replace(/^#/, '');
  if (s.length === 3) {
    s = s
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(s)) {
    throw new Error(`非法 hex: ${hex}`);
  }
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

/** RGB → hex，如 "#1a2b3c"。各分量会被钳到 [0,255] 取整 */
export function rgbToHex({ r, g, b }: RGB): string {
  const t = (n: number) => clamp255(n).toString(16).padStart(2, '0');
  return `#${t(r)}${t(g)}${t(b)}`;
}

/**
 * RGB → HSL（标准算法）。
 * s/l 用百分比，便于人读；h∈[0,360)。
 */
export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
        break;
      case gn:
        h = ((bn - rn) / d + 2) * 60;
        break;
      default:
        h = ((rn - gn) / d + 4) * 60;
    }
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** HSL → RGB。h 支持越界（自动取模 360），s/l 钳到 [0,100]。 */
export function hslToRgb({ h, s, l }: HSL): RGB {
  const hn = ((h % 360) + 360) % 360 / 360;
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const ln = Math.max(0, Math.min(100, l)) / 100;
  if (sn === 0) {
    const v = ln * 255;
    return { r: v, g: v, b: v };
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  const hue = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return {
    r: hue(hn + 1 / 3) * 255,
    g: hue(hn) * 255,
    b: hue(hn - 1 / 3) * 255,
  };
}

/**
 * 相对亮度（WCAG）。用于判断一个色块上该叠黑字还是白字，
 * 也用于把提取色排序到"背景/前景"等语义角色。
 */
export function relativeLuminance({ r, g, b }: RGB): number {
  const ch = (c: number): number => {
    const cn = c / 255;
    return cn <= 0.03928 ? cn / 12.92 : ((cn + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/**
 * 一段文字在指定底色上，该用黑（true）还是白（false）才清晰。
 * 底色越亮（亮度高），文字越该用黑；底色越暗，越该用白。
 * 阈值 0.45 是黑/白对比的经验近似（WCAG 1.4.3 用对比比，这里用亮度直接判定更轻量）。
 */
export function readableForeground(bg: RGB): boolean {
  // 亮底 → 黑字；暗底 → 白字。注意：返回 true=黑字。
  return relativeLuminance(bg) >= 0.45;
}

/**
 * 两色欧氏距离（RGB 空间）。仅用于"近色去重"与排序，非感知精确；
 * 感知更准的 CIEDE2000 实现复杂、收益有限，这里不引入。
 */
export function colorDistance(a: RGB, b: RGB): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * 把颜色近似归类为中文色名（红/橙/黄/绿/青/蓝/紫/粉/棕/灰/黑/白）。
 * 依据 HSL 的 h/s/l 分桶，给 UI 色块加可读标签，非严格命名。
 */
export function colorName(rgb: RGB): string {
  const { h, s, l } = rgbToHsl(rgb);
  if (l < 8) return '黑';
  if (l > 92) return '白';
  if (s < 12) return l < 35 ? '深灰' : l < 65 ? '灰' : '浅灰';
  // 彩色：按色相分段
  if (h < 15 || h >= 345) return '红';
  if (h < 45) return l < 45 ? '棕' : '橙';
  if (h < 70) return '黄';
  if (h < 165) return '绿';
  if (h < 200) return '青';
  if (h < 255) return '蓝';
  if (h < 295) return '紫';
  return '粉';
}
