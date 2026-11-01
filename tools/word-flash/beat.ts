/**
 * BGM 节拍检测 —— 基于短时能量的确定性鼓点识别（纯函数，无 DOM）。
 *
 * 做法（不引入 FFT / 第三方依赖，够用且可单测）：
 *   1. 按 20ms 能量帧计算 RMS，并做 3 点平滑；
 *   2. 以「均值 + 标准差 × 系数」为动态阈值，取局部极大值为候选鼓点；
 *   3. 用最短间隔（默认 0.22s）合并过密候选，保留能量更强者。
 *
 * 检测结果只用于「卡片切换点对齐」，不要求识别出每一拍——
 * 只要能得到一段稳定的鼓点序列，快闪卡点就有明显的节奏感。
 */

export interface BeatDetectOptions {
  /** 两个鼓点之间的最短间隔（秒） */
  minGap?: number;
  /** 能量帧时长（秒） */
  hop?: number;
  /** 阈值系数：threshold = mean + std × factor */
  factor?: number;
  /** 忽略开头若干秒（淡入或空拍段） */
  skipStart?: number;
}

export function detectBeatTimes(
  samples: ArrayLike<number>,
  sampleRate: number,
  opts: BeatDetectOptions = {},
): number[] {
  if (sampleRate <= 0 || samples.length < 4) return [];
  const hop = Math.max(1, Math.round(sampleRate * (opts.hop ?? 0.02)));
  const frames = Math.floor(samples.length / hop);
  if (frames < 4) return [];

  // 1) RMS 能量
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const base = f * hop;
    let sum = 0;
    for (let i = 0; i < hop; i++) {
      const v = samples[base + i] ?? 0;
      sum += v * v;
    }
    energy[f] = Math.sqrt(sum / hop);
  }

  // 2) 3 点平滑（压掉单帧噪声）
  const smooth = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const a = energy[Math.max(0, f - 1)]!;
    const b = energy[f]!;
    const c = energy[Math.min(frames - 1, f + 1)]!;
    smooth[f] = (a + b * 2 + c) / 4;
  }

  // 3) 动态阈值
  let mean = 0;
  for (let f = 0; f < frames; f++) mean += smooth[f]!;
  mean /= frames;
  let variance = 0;
  for (let f = 0; f < frames; f++) {
    const d = smooth[f]! - mean;
    variance += d * d;
  }
  const std = Math.sqrt(variance / frames);
  if (mean <= 1e-6 || std <= 1e-9) return [];
  const threshold = mean + std * (opts.factor ?? 1.1);
  const minGap = opts.minGap ?? 0.22;
  const skipStart = Math.max(0, opts.skipStart ?? 0);

  // 4) 局部极大值 + 最小区间合并
  const peaks: { time: number; level: number }[] = [];
  for (let f = 1; f < frames - 1; f++) {
    const level = smooth[f]!;
    if (level <= threshold) continue;
    if (level < smooth[f - 1]! || level <= smooth[f + 1]!) continue;
    const time = (f * hop) / sampleRate;
    if (time < skipStart) continue;
    const last = peaks[peaks.length - 1];
    if (last && time - last.time < minGap) {
      if (level > last.level) last.time = time; // 同区间保留更强的一拍
      continue;
    }
    peaks.push({ time, level });
  }

  return peaks.map((p) => Math.round(p.time * 1000) / 1000);
}
