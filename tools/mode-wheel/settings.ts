/**
 * 调式罗盘 —— 用户状态本地持久化（localStorage）。
 * 与项目其它 settings 模块一致：版本化 blob、逐字段校验、损坏静默回退。
 * v3 起持久化 Looper 层（事件记级数/度数，天然支持换调式重解析）。
 */

import { readJSON, writeJSON } from '@/core/utils/storage';
import { MODE_MAP } from './data/modes';
import { decodeSteps, encodeSteps, type WheelStep } from './theory';
import type { LoopEvent, LoopLayer } from './engine/looper';

const STORAGE_KEY = 'mode-wheel:state';
const CURRENT_VERSION = 3;

export interface WheelState {
  /** 主音音高类 0-11 */
  keyPc: number;
  /** 调式 id（MODES 之一） */
  modeId: string;
  /** 巡航速度 60-160 */
  bpm: number;
  /** 每个和弦的拍数（2/4） */
  beatsPerChord: 2 | 4;
  /** 主音量 0-1 */
  volume: number;
  /** 编排器里"我的进行"（持久化为编码字符串） */
  customSteps: WheelStep[];
  /** Looper 层 */
  loopLayers: LoopLayer[];
  /** Looper 循环长度（拍） */
  loopBeats: number;
}

interface WheelBlob extends Omit<WheelState, 'customSteps' | 'loopLayers' | 'loopBeats'> {
  version: number;
  /** v2 起：encodeSteps 编码；旧版无此字段 */
  customSteps?: unknown;
  /** v3 起：Looper 层（JSON 数组） */
  loopLayers?: unknown;
  loopBeats?: unknown;
}

export function defaultState(): WheelState {
  return {
    keyPc: 0,
    modeId: 'mixolydian-s2',
    bpm: 96,
    beatsPerChord: 4,
    volume: 0.8,
    customSteps: [],
    loopLayers: [],
    loopBeats: 8,
  };
}

/** 校验"我的进行"：只接受能解码的字符串，且长度封顶 32 */
function healSteps(raw: unknown): WheelStep[] {
  if (typeof raw !== 'string' || raw.length > 200) return [];
  const steps = decodeSteps(raw);
  if (!steps) return [];
  return steps.slice(0, 32);
}

/** 校验 Looper 事件：字段类型逐个把关，非法事件丢弃 */
function healEvent(raw: unknown): LoopEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const beat = typeof e.beat === 'number' && Number.isFinite(e.beat) ? e.beat : null;
  if (beat === null || beat < 0 || beat > 64) return null;
  if (e.kind === 'chord') {
    if (typeof e.d !== 'number' || !Number.isInteger(e.d) || e.d < 0 || e.d > 6) return null;
    const len = typeof e.len === 'number' && e.len > 0 && e.len <= 16 ? e.len : undefined;
    const extra = Array.isArray(e.extra)
      ? e.extra
          .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
          .filter(
            (x): x is Record<string, unknown> =>
              x !== null &&
              typeof x.d === 'number' &&
              Number.isInteger(x.d) &&
              x.d >= 0 &&
              x.d <= 6,
          )
          .slice(0, 15)
          .map((x) => ({ d: x.d as number, alt: x.alt === true || undefined }))
      : undefined;
    return {
      kind: 'chord',
      d: e.d,
      alt: e.alt === true || undefined,
      register: e.register === 'high' ? 'high' : 'low',
      beat,
      ...(len === undefined ? {} : { len }),
      ...(extra && extra.length > 0 ? { extra } : {}),
    };
  }
  if (e.kind === 'melody') {
    if (typeof e.deg !== 'number' || !Number.isInteger(e.deg) || e.deg < 0 || e.deg > 6)
      return null;
    const len = typeof e.len === 'number' && e.len > 0 && e.len <= 16 ? e.len : 1;
    const extra = Array.isArray(e.extra)
      ? e.extra
          .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
          .filter(
            (x): x is Record<string, unknown> =>
              x !== null &&
              typeof x.deg === 'number' &&
              Number.isInteger(x.deg) &&
              x.deg >= 0 &&
              x.deg <= 6,
          )
          .slice(0, 15)
          .map((x) => ({
            deg: x.deg as number,
            octave: x.octave === -1 || x.octave === 1 ? x.octave : 0,
          }))
      : undefined;
    return {
      kind: 'melody',
      deg: e.deg,
      octave: e.octave === -1 || e.octave === 1 ? e.octave : 0,
      beat,
      len,
      ...(extra && extra.length > 0 ? { extra } : {}),
    };
  }
  return null;
}

function healLayers(raw: unknown): LoopLayer[] {
  if (!Array.isArray(raw)) return [];
  const out: LoopLayer[] = [];
  const usedIds = new Set<number>();
  for (const item of raw.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue;
    const l = item as Record<string, unknown>;
    if (typeof l.id !== 'number' || !Number.isInteger(l.id) || l.id <= 0) continue;
    if (!Array.isArray(l.events)) continue;
    const events = l.events.map(healEvent).filter((e): e is LoopEvent => e !== null);
    // v4 前的层没有 kind：从内容推断，默认和弦层
    const kind: LoopLayer['kind'] =
      l.kind === 'melody' || l.kind === 'chord'
        ? l.kind
        : events.some((e) => e.kind === 'melody')
          ? 'melody'
          : 'chord';
    // 旧版曾持久化出重复 id（恢复后计数器脱节，新旧层撞号）：换空号自愈
    let id = l.id;
    while (usedIds.has(id)) id++;
    usedIds.add(id);
    // 每格时值：格下标整数、tv 为 (0,16] 的有限数才保留，封顶 64 格
    const cellTv: Record<number, number> = {};
    if (l.cellTv && typeof l.cellTv === 'object') {
      for (const [k, v] of Object.entries(l.cellTv as Record<string, unknown>).slice(0, 64)) {
        const cell = Number(k);
        if (!Number.isInteger(cell) || cell < 0 || cell >= 64) continue;
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 16) continue;
        if (v !== 1) cellTv[cell] = v;
      }
    }
    out.push({
      id,
      kind,
      name: typeof l.name === 'string' ? l.name.slice(0, 12) : `层 ${out.length + 1}`,
      muted: l.muted === true,
      events: events.slice(0, 256),
      ...(Object.keys(cellTv).length > 0 ? { cellTv } : {}),
    });
  }
  return out;
}

export function loadState(): WheelState {
  const def = defaultState();
  const parsed = readJSON(STORAGE_KEY) as Partial<WheelBlob> | null;
  if (!parsed) return def;
  return {
    keyPc:
      typeof parsed.keyPc === 'number' && Number.isInteger(parsed.keyPc)
        ? Math.min(11, Math.max(0, parsed.keyPc))
        : def.keyPc,
    modeId:
      typeof parsed.modeId === 'string' && MODE_MAP.has(parsed.modeId) ? parsed.modeId : def.modeId,
    bpm:
      typeof parsed.bpm === 'number' && Number.isFinite(parsed.bpm)
        ? Math.min(160, Math.max(60, Math.round(parsed.bpm)))
        : def.bpm,
    beatsPerChord: parsed.beatsPerChord === 2 ? 2 : 4,
    volume:
      typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
        ? Math.min(1, Math.max(0, parsed.volume))
        : def.volume,
    customSteps: healSteps(parsed.customSteps),
    loopLayers: healLayers(parsed.loopLayers),
    loopBeats:
      typeof parsed.loopBeats === 'number' && [4, 8, 16].includes(parsed.loopBeats)
        ? (parsed.loopBeats as number)
        : def.loopBeats,
  };
}

export function saveState(state: WheelState): void {
  const { customSteps, ...rest } = state;
  const blob: WheelBlob = {
    version: CURRENT_VERSION,
    ...rest,
    customSteps: encodeSteps(customSteps),
  };
  writeJSON(STORAGE_KEY, blob);
}
