/**
 * 配色提取算法 —— 中位切分（median-cut）颜色量化。
 *
 * 纯函数、无 DOM 依赖：输入像素数组与目标色数，输出按"出现占比"降序的色板。
 * 同类库（node-vibrant 等）算法思路一致，但这里零依赖、确定、可测。
 *
 * 算法：
 *   1. 把所有像素视为一个"色桶"。
 *   2. 反复：在所有色桶里找出"沿某一 RGB 通道跨度最大"的桶，按该通道中位数切两半。
 *   3. 直到桶数 = 目标色数（或无法再切）。
 *   4. 合并：中位切分会把同一纯色簇切成若干等分小块，故对色心（桶均值）再做一次
 *      贪心合并——距离小于阈值的桶按像素数加权合并，恢复真实占比、去除近似重复色。
 *   5. 每个桶的输出色 = 桶内像素均值；占比 = 桶内像素数 / 总像素数。
 */

import type { RGB } from './color-utils';

/** 单个像素（含透明通道，用于丢弃半透明像素） */
export interface Pixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 提取出的单个主色：颜色 + 在原图中的占比（0-1） */
export interface ExtractedColor {
  rgb: RGB;
  /** hex，如 "#1a2b3c"，大写 */
  hex: string;
  /** 该色在原图像素中的占比，0-1，所有色之和 ≈ 1（去除透明像素后） */
  ratio: number;
  /** 桶内像素数，可用于调试/排序稳定性 */
  count: number;
}

/** 一个色桶：持有一组像素索引与各通道最值（懒计算） */
interface Bucket {
  pixels: number[]; // 指向 samples 数组的下标，避免拷贝
  // 缓存：通道范围与切分所需统计
  minR: number;
  maxR: number;
  minG: number;
  maxG: number;
  minB: number;
  maxB: number;
}

/** 沿哪一通道切 */
type Channel = 'r' | 'g' | 'b';

/**
 * 提取主色。
 *
 * @param pixels  全部像素（含 alpha）。透明度低于 minAlpha 的像素被忽略。
 * @param count   目标色数，会被钳到 [1, 16]。
 * @param sampleStep 像素采样步长（1=全采，2=每隔1个采1个…）。大图默认 4 足够稳。
 * @param minAlpha 低于此 alpha 的像素忽略（默认 128，丢弃半透明/全透明）。
 * @param mergeThreshold 合并阈值：均值 RGB 距离小于此值的桶会被合并（默认 24）。
 *   中位切分天然会把同色簇切成多块（按中位数等分），合并后能恢复真实占比、去除近似重复色。
 */
export function extractPalette(
  pixels: Pixel[],
  count: number,
  sampleStep = 1,
  minAlpha = 128,
  mergeThreshold = 24,
): ExtractedColor[] {
  if (pixels.length === 0) return [];

  // 钳制色数；中位切分只能处理 2 的幂个桶最自然，但不必强求——余数桶也能切。
  const target = Math.max(1, Math.min(16, Math.floor(count)));

  // 采样 + 过滤透明像素，构造有效像素数组
  const valid: RGB[] = [];
  for (let i = 0; i < pixels.length; i += sampleStep) {
    const p = pixels[i]!;
    if (p.a < minAlpha) continue;
    valid.push({ r: p.r, g: p.g, b: p.b });
  }
  if (valid.length === 0) return [];

  // 初始桶：包含全部有效像素
  let buckets: Bucket[] = [makeBucket(valid, Array.from({ length: valid.length }, (_, i) => i))];

  // 过分割：切到远多于目标数的桶（min(目标*3, 64)），让相近色被切成相邻小块，
  // 后续合并阶段再把它们归并。这样能规避中位切分对"并列值中位数"导致的切偏，
  // 使最终占比更贴近真实分布。上限 64 避免大图过慢。
  const overSplit = Math.min(Math.max(target * 3, target + 2), 64);
  while (buckets.length < overSplit) {
    // 选出"可切且跨度最大"的桶
    let bestIdx = -1;
    let bestSpan = -1;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i]!;
      if (b.pixels.length < 2) continue; // 单像素桶不可切
      const span = Math.max(b.maxR - b.minR, b.maxG - b.minG, b.maxB - b.minB);
      if (span > bestSpan) {
        bestSpan = span;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break; // 没有可切的桶了

    const [a, b2] = splitBucket(buckets[bestIdx]!, valid);
    buckets.splice(bestIdx, 1, a, b2);
  }

  // 桶 → "色心"（均值色 + 像素数）。先归约到色心，再做近似合并 + 占比归一。
  const total = valid.length;
  const centroids: { rgb: RGB; count: number }[] = [];
  for (const b of buckets) {
    if (b.pixels.length === 0) continue;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (const idx of b.pixels) {
      const px = valid[idx]!;
      sr += px.r;
      sg += px.g;
      sb += px.b;
    }
    const n = b.pixels.length;
    centroids.push({ rgb: { r: sr / n, g: sg / n, b: sb / n }, count: n });
  }

  // 合并色心相近的桶（中位切分会把同一纯色簇切成若干等分小块）：
  // 贪心——反复找距离最小的一对，若 < 阈值则合并（色心按像素数加权平均），
  // 直到没有可合的对，或桶数已 ≤ 目标色数。合并后占比更贴近真实。
  mergeCentroids(centroids, mergeThreshold, target);

  // 按像素数降序，转成输出结构，占比归一（合并后总和仍 = total）。
  const out: ExtractedColor[] = centroids
    .sort((x, y) => y.count - x.count)
    .map((c) => ({
      rgb: c.rgb,
      hex: rgbToHex(c.rgb),
      ratio: c.count / total,
      count: c.count,
    }));

  return out;
}

/**
 * 原地合并色心相近的桶。
 * 中位切分会把同一纯色簇切成若干等分小块（含并列值的中位选择问题），
 * 配合上方"过分割"，此处合并阶段会把相邻小块重新归并，恢复真实占比。
 *
 * 两阶段：
 *   1) 阈值合并：贪心找距离 ≤ threshold 的最近对合并，直到没有可合对。
 *      这步合并"本就是同一颜色"的小块，不动真正不同的色。
 *   2) 强制收敛：若仍多于 targetCount，则无视阈值继续合并最近对，
 *      保证最终色数 = 用户请求数（用户明确要 N 个色时，给出 N 个）。
 *
 * 合并后的色心 = 两色按像素数加权平均，像素数相加。
 */
function mergeCentroids(
  centroids: { rgb: RGB; count: number }[],
  threshold: number,
  targetCount: number,
): void {
  // 阶段 1：阈值内合并（清掉因过分割产生的同色碎片）
  for (;;) {
    let bestI = -1;
    let bestJ = -1;
    let bestDist = Infinity;
    for (let i = 0; i < centroids.length; i++) {
      for (let j = i + 1; j < centroids.length; j++) {
        const d = colorDist(centroids[i]!.rgb, centroids[j]!.rgb);
        if (d < bestDist) {
          bestDist = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (centroids.length <= targetCount) break; // 已达到目标数，停止阈值合并
    if (bestI === -1 || bestDist > threshold) break; // 没有阈值内可合对，进入阶段 2
    mergeAt(centroids, bestI, bestJ);
  }

  // 阶段 2：强制收敛到 targetCount（无视阈值合并最近对）
  while (centroids.length > targetCount) {
    let bestI = -1;
    let bestJ = -1;
    let bestDist = Infinity;
    for (let i = 0; i < centroids.length; i++) {
      for (let j = i + 1; j < centroids.length; j++) {
        const d = colorDist(centroids[i]!.rgb, centroids[j]!.rgb);
        if (d < bestDist) {
          bestDist = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (bestI === -1) break;
    mergeAt(centroids, bestI, bestJ);
  }
}

/** 合并 centroids[i] 与 centroids[j]（i<j），按像素数加权平均，原地删除两者并追加合并结果 */
function mergeAt(centroids: { rgb: RGB; count: number }[], i: number, j: number): void {
  const a = centroids[i]!;
  const b = centroids[j]!;
  const total = a.count + b.count;
  const merged = {
    rgb: {
      r: (a.rgb.r * a.count + b.rgb.r * b.count) / total,
      g: (a.rgb.g * a.count + b.rgb.g * b.count) / total,
      b: (a.rgb.b * a.count + b.rgb.b * b.count) / total,
    },
    count: total,
  };
  centroids.splice(j, 1); // 先删大下标
  centroids.splice(i, 1);
  centroids.push(merged);
}

/** RGB 欧氏距离（局部副本，避免把 color-utils 拖入运行期依赖图） */
function colorDist(a: RGB, b: RGB): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** 由像素子集构造色桶，并统计通道范围 */
function makeBucket(samples: RGB[], indices: number[]): Bucket {
  let minR = 255,
    maxR = 0,
    minG = 255,
    maxG = 0,
    minB = 255,
    maxB = 0;
  for (const idx of indices) {
    const p = samples[idx]!;
    if (p.r < minR) minR = p.r;
    if (p.r > maxR) maxR = p.r;
    if (p.g < minG) minG = p.g;
    if (p.g > maxG) maxG = p.g;
    if (p.b < minB) minB = p.b;
    if (p.b > maxB) maxB = p.b;
  }
  return { pixels: indices, minR, maxR, minG, maxG, minB, maxB };
}

/** 把桶沿最大跨度通道的中位数切成两个子桶 */
function splitBucket(bucket: Bucket, samples: RGB[]): [Bucket, Bucket] {
  const spanR = bucket.maxR - bucket.minR;
  const spanG = bucket.maxG - bucket.minG;
  const spanB = bucket.maxB - bucket.minB;
  const channel: Channel = spanR >= spanG && spanR >= spanB ? 'r' : spanG >= spanB ? 'g' : 'b';

  // 按选定通道升序排，取中位元素值为切分点
  const sorted = [...bucket.pixels].sort((a, b) => samples[a]![channel] - samples[b]![channel]);
  const mid = sorted.length >> 1;
  const leftIdx = sorted.slice(0, mid);
  const rightIdx = sorted.slice(mid);

  return [makeBucket(samples, leftIdx), makeBucket(samples, rightIdx)];
}

// 局部 hex 转换：避免 extractor 直接依赖 color-utils 的运行期函数
// （保持 extractor 仅 import type，便于在纯算法层面替换/裁剪）。
function rgbToHex({ r, g, b }: RGB): string {
  const t = (n: number): string => {
    const v = Math.max(0, Math.min(255, Math.round(n)));
    return v.toString(16).padStart(2, '0');
  };
  return `#${t(r)}${t(g)}${t(b)}`.toUpperCase();
}
