/**
 * GIF 帧时序 —— 纯函数（可单测，无 DOM 依赖）。
 *
 * GIF 解码与帧合成在 progress-assets.ts；这里只负责两件事：
 *   1. 按音频时间 t 取当前应显示的帧（循环播放，预览/拖动/导出一致）；
 *   2. 原始帧数超过上限时按帧序等间隔抽样，并重算每帧时长（总时长不变）。
 */

/**
 * 取 t 时刻应显示的帧下标。
 * delays 为每帧显示时长（秒），duration 为一轮总时长；t 会被循环取模。
 */
export function frameIndexAt(delays: readonly number[], duration: number, t: number): number {
  if (delays.length === 0) return 0;
  if (!(duration > 0) || !Number.isFinite(t)) return 0;
  let x = t % duration;
  if (x < 0) x += duration;
  let acc = 0;
  for (let i = 0; i < delays.length; i++) {
    acc += delays[i]!;
    if (x < acc) return i;
  }
  return delays.length - 1;
}

/**
 * 帧数超过 maxFrames 时按帧序等间隔抽样：
 * 返回保留的原始帧下标与新时长（总和与原始总时长一致，首尾帧必选）。
 */
export function sampleFramePlan(
  delays: readonly number[],
  maxFrames: number,
): { indices: number[]; delays: number[] } {
  const n = delays.length;
  if (n === 0) return { indices: [], delays: [] };
  if (n <= maxFrames) {
    return { indices: Array.from({ length: n }, (_, i) => i), delays: [...delays] };
  }

  const starts: number[] = [];
  let total = 0;
  for (const d of delays) {
    starts.push(total);
    total += d;
  }

  const step = (n - 1) / Math.max(1, maxFrames - 1);
  const picked: number[] = [];
  for (let j = 0; j < maxFrames; j++) {
    const idx = Math.min(n - 1, Math.round(j * step));
    if (picked.length === 0 || picked[picked.length - 1] !== idx) picked.push(idx);
  }

  const pickedStarts = picked.map((idx) => starts[idx]!);
  const newDelays = pickedStarts.map((s, j) =>
    j + 1 < pickedStarts.length ? pickedStarts[j + 1]! - s : total - s,
  );
  return { indices: picked, delays: newDelays };
}
