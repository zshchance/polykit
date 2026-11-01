/**
 * 节奏引擎 —— 把卡片列表排成时间轴（纯函数，无 DOM）。
 *
 * 两种模式：
 *   auto：时长 = (档位基础时长 + 字数 × 每字时长) / 全局倍速，再按档位上下限收窄；
 *   beat：卡片切换点直接对齐 BGM 检测出的鼓点（beats 需至少为「卡片数 + 1」个），
 *         鼓点不足时自动回退 auto，并把 beatSynced 置 false 供 UI 提示。
 *
 * 预览、导出与拖动进度条都使用同一份时间轴，保证三者画面一致。
 */

import { PACES, type PaceId, type SyncId, type Timeline } from './options';

/** 时间轴计算所需的选项子集 */
export interface RhythmOptions {
  pace: PaceId;
  speed: number;
  sync: SyncId;
}

/** 单卡基础时长（秒）：字数越多停留越久 */
export function autoDuration(charCount: number, opts: RhythmOptions): number {
  const pace = PACES.find((p) => p.id === opts.pace) ?? PACES[1]!;
  const speed = Math.min(2, Math.max(0.6, opts.speed));
  const dur = (pace.baseDur + Math.max(0, charCount) * pace.charDur) / speed;
  return Math.min(pace.maxDur, Math.max(pace.minDur, dur));
}

/** 过滤出可用的鼓点：有限、非负、单调递增 */
function normalizeBeats(beats: readonly number[] | null | undefined): number[] {
  if (!beats) return [];
  const out: number[] = [];
  for (const b of beats) {
    if (!Number.isFinite(b) || b < 0) continue;
    if (out.length > 0 && b <= out[out.length - 1]!) continue;
    out.push(b);
  }
  return out;
}

/** 每张卡至少停留的秒数，防止鼓点过密导致画面闪烁 */
const MIN_CARD_DUR = 0.14;

export function computeTimeline(
  opts: RhythmOptions,
  cards: readonly { text: string }[],
  beats?: readonly number[] | null,
): Timeline {
  const n = cards.length;
  if (n === 0) {
    return { cards: 0, durations: [], starts: [], total: 0, beatSynced: false };
  }

  const validBeats = normalizeBeats(beats);
  if (opts.sync === 'beat' && validBeats.length >= n + 1) {
    const t0 = validBeats[0]!;
    const starts: number[] = [];
    const durations: number[] = [];
    for (let i = 0; i < n; i++) {
      const start = Math.max(0, validBeats[i]! - t0);
      const end = Math.max(start + MIN_CARD_DUR, validBeats[i + 1]! - t0);
      starts.push(start);
      durations.push(end - start);
    }
    const total = starts[n - 1]! + durations[n - 1]!;
    return { cards: n, durations, starts, total, beatSynced: true };
  }

  const durations: number[] = [];
  const starts: number[] = [];
  let cursor = 0;
  for (const card of cards) {
    const dur = autoDuration(card.text.length, opts);
    starts.push(cursor);
    durations.push(dur);
    cursor += dur;
  }
  return { cards: n, durations, starts, total: cursor, beatSynced: false };
}
