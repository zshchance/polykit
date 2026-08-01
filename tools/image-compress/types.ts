/**
 * 图片压缩转换 —— 共享类型、选项常量、默认配置。
 *
 * 字段命名与 settings.ts 的校验逻辑一一对应；新增可持久化字段时
 * 必须同步更新 settings.ts 的逐字段校验（保证旧草稿向前兼容）。
 */

/** 输出格式。PNG/ICO 无损（画质滑块对其无效），JPEG/WebP 有损。 */
export type OutputFormat = 'jpeg' | 'webp' | 'png' | 'ico';

/** 对比预览模式 */
export type CompareMode = 'original' | 'compare' | 'output';

export interface FormatOption {
  id: OutputFormat;
  name: string;
  /** 是否有损（决定画质滑块是否可调） */
  lossy: boolean;
  /** 下载扩展名（不含点） */
  ext: string;
  /** 简短说明 */
  hint: string;
}

/** 用户可选的输出格式。顺序即页面展示顺序。 */
export const FORMAT_OPTIONS: readonly FormatOption[] = [
  { id: 'webp', name: 'WebP', lossy: true, ext: 'webp', hint: '体积最小，现代浏览器通吃' },
  { id: 'jpeg', name: 'JPG', lossy: true, ext: 'jpg', hint: '兼容性最广，无透明通道' },
  { id: 'png', name: 'PNG', lossy: false, ext: 'png', hint: '无损，保留透明' },
  { id: 'ico', name: 'ICO', lossy: false, ext: 'ico', hint: '多尺寸图标，用于 favicon' },
];

/** ICO 可选尺寸（像素，正方形） */
export const ICO_SIZE_OPTIONS: readonly number[] = [16, 24, 32, 48, 64];

export const MIN_QUALITY = 1;
export const MAX_QUALITY = 100;
/** 最长边 0 表示不缩放，保持原尺寸 */
export const MIN_LONG_EDGE = 16;
export const MAX_LONG_EDGE = 8000;
export const LONG_EDGE_OPTIONS: readonly number[] = [0, 512, 720, 1080, 1440, 1920, 2560];

/** 持久化的用户配置（不含图片与输出，按需求只记参数） */
export interface CompressConfig {
  /** 输出格式 */
  format: OutputFormat;
  /** 画质 1-100（仅对 JPEG/WebP 有效） */
  quality: number;
  /** 最长边像素上限，0 表示不缩放 */
  maxLongEdge: number;
  /** ICO 内嵌的尺寸集合（已排序、去重） */
  icoSizes: number[];
  /** 对比预览模式 */
  mode: CompareMode;
}

export const DEFAULT_CONFIG: CompressConfig = {
  format: 'webp',
  quality: 80,
  maxLongEdge: 0,
  icoSizes: [16, 32, 48],
  mode: 'compare',
};

/** 画质限制器：越界/非有限数回退默认 */
export function clampQuality(n: unknown): number {
  if (typeof n === 'number' && Number.isFinite(n)) {
    return Math.max(MIN_QUALITY, Math.min(MAX_QUALITY, Math.round(n)));
  }
  return DEFAULT_CONFIG.quality;
}

/** 最长边限制器 */
export function clampLongEdge(n: unknown): number {
  if (typeof n === 'number' && Number.isFinite(n) && n >= MIN_LONG_EDGE && n <= MAX_LONG_EDGE) {
    return Math.round(n);
  }
  // 0 = 不缩放（默认）；其它非法值也回退默认
  return DEFAULT_CONFIG.maxLongEdge;
}

/** 把任意数字数组规整为合法、去重、升序的 ICO 尺寸集合；空则回退默认 */
export function normalizeIcoSizes(arr: unknown): number[] {
  const valid = ICO_SIZE_OPTIONS;
  if (!Array.isArray(arr)) return [...DEFAULT_CONFIG.icoSizes];
  const seen = new Set<number>();
  for (const v of arr) {
    if (typeof v === 'number' && Number.isFinite(v) && (valid as readonly number[]).includes(v)) {
      seen.add(v);
    }
  }
  return seen.size > 0 ? [...seen].sort((a, b) => a - b) : [...DEFAULT_CONFIG.icoSizes];
}
