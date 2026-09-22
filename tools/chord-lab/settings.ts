/**
 * 和弦琴房 —— 用户配置本地持久化（localStorage）。
 *
 * 记两类状态：学习方式（模式 / 键数 / 窗口起点 / 调性 / 踏板 / 音量）
 * 与卡片偏好（和弦性质卡与走向卡的顺序 = 优先级、开关、引导色）。
 * 与项目其它 settings 模块一致：版本化 JSON blob，逐字段校验，
 * 读写经 core/utils/storage 统一容错，损坏/隐私模式静默回退默认。
 */

import { readJSON, writeJSON } from '@/core/utils/storage';
import { CHORD_QUALITIES, type ChordQualityId, type Tonality } from './theory';
import { PROGRESSIONS } from './data/progressions';

const STORAGE_KEY = 'chord-lab:state';
const CURRENT_VERSION = 1;

/** 引导色预设盘：双击卡片循环切换；索引被数据与默认配置引用 */
export const PALETTE = [
  '#22c55e', // 0 绿（大三默认）
  '#86efac', // 1 淡绿（小三默认）
  '#38bdf8', // 2 天蓝
  '#a78bfa', // 3 紫
  '#f59e0b', // 4 琥珀
  '#fb923c', // 5 橙
  '#fb7185', // 6 玫红
  '#f472b6', // 7 桃粉
  '#2dd4bf', // 8 青
  '#94a3b8', // 9 灰（增/减三默认，关闭引导时的中性色）
  '#e879f9', // 10 玫紫
  '#eab308', // 11 金
] as const;

export const PALETTE_LEN = PALETTE.length;

export type LabMode = 'chord' | 'prog';

/** 一张卡片（和弦性质 / 走向）的用户偏好；数组顺序 = 优先级 */
export interface CardPref {
  id: string;
  enabled: boolean;
  color: number;
}

export interface LabState {
  mode: LabMode;
  /** 键盘视图键数（便携键盘规格） */
  keyCount: 25 | 32;
  /** 视图最左键的 MIDI 音高 */
  windowStart: number;
  /** 走向模式调性：主音音高类 + 大小调 */
  keyPc: number;
  tonality: Tonality;
  /** 延音踏板（跟随按压模式下让已松开的音继续参与判定与发声） */
  pedalOn: boolean;
  /** 和弦模式：是否把进阶包（七/挂留/add9）卡片放上屏幕 */
  advancedPack: boolean;
  /** 主音量 0-1 */
  volume: number;
  chordCards: CardPref[];
  progCards: CardPref[];
}

interface LabBlob extends Omit<LabState, 'chordCards' | 'progCards'> {
  version: number;
  chordCards: unknown;
  progCards: unknown;
}

/** 钢琴全键域；视图起点按键数钳制，保证窗口不越界 */
export const PIANO_MIN = 21; // A0
export const PIANO_MAX = 108; // C8

export function clampWindow(start: number, keyCount: 25 | 32): number {
  return Math.min(PIANO_MAX - keyCount + 1, Math.max(PIANO_MIN, Math.round(start)));
}

export function defaultState(): LabState {
  return {
    mode: 'chord',
    keyCount: 25,
    windowStart: 48, // C3 起，25 键恰覆盖 C3–C5
    keyPc: 0,
    tonality: 'major',
    pedalOn: false,
    advancedPack: false,
    volume: 0.8,
    chordCards: CHORD_QUALITIES.map((q) => ({
      id: q.id,
      enabled: q.defaultEnabled,
      color: q.defaultColor,
    })),
    progCards: PROGRESSIONS.map((p) => ({
      id: p.id,
      enabled: p.defaultEnabled,
      color: p.defaultColor,
    })),
  };
}

/** 卡片数组校验：保留已知 id 的顺序与偏好，未知 id 丢弃，新词条目追加在末尾 */
function healCards(raw: unknown, knownIds: readonly string[], defaults: CardPref[]): CardPref[] {
  const out: CardPref[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const { id, enabled, color } = item as Record<string, unknown>;
      if (typeof id !== 'string' || !knownIds.includes(id) || seen.has(id)) continue;
      seen.add(id);
      const def = defaults.find((d) => d.id === id)!;
      out.push({
        id,
        enabled: typeof enabled === 'boolean' ? enabled : def.enabled,
        color:
          typeof color === 'number' && Number.isInteger(color) && color >= 0 && color < PALETTE_LEN
            ? color
            : def.color,
      });
    }
  }
  for (const d of defaults) if (!seen.has(d.id)) out.push({ ...d });
  return out;
}

/** 读取持久化状态；损坏/字段非法时逐项回退默认 */
export function loadState(): LabState {
  const def = defaultState();
  const parsed = readJSON(STORAGE_KEY) as Partial<LabBlob> | null;
  if (!parsed) return def;

  const keyCount: 25 | 32 = parsed.keyCount === 32 ? 32 : 25;
  const windowStart =
    typeof parsed.windowStart === 'number' && Number.isFinite(parsed.windowStart)
      ? clampWindow(parsed.windowStart, keyCount)
      : keyCount === 32
        ? 41 // F2 起，32 键覆盖 F2–C5
        : def.windowStart;

  return {
    mode: parsed.mode === 'prog' ? 'prog' : 'chord',
    keyCount,
    windowStart,
    keyPc:
      typeof parsed.keyPc === 'number' && Number.isInteger(parsed.keyPc)
        ? Math.min(11, Math.max(0, parsed.keyPc))
        : def.keyPc,
    tonality: parsed.tonality === 'minor' ? 'minor' : 'major',
    pedalOn: typeof parsed.pedalOn === 'boolean' ? parsed.pedalOn : def.pedalOn,
    advancedPack: typeof parsed.advancedPack === 'boolean' ? parsed.advancedPack : def.advancedPack,
    volume:
      typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
        ? Math.min(1, Math.max(0, parsed.volume))
        : def.volume,
    chordCards: healCards(
      parsed.chordCards,
      CHORD_QUALITIES.map((q) => q.id),
      def.chordCards,
    ),
    progCards: healCards(
      parsed.progCards,
      PROGRESSIONS.map((p) => p.id),
      def.progCards,
    ),
  };
}

/** 持久化（隐私模式 / 配额满时静默忽略） */
export function saveState(state: LabState): void {
  const blob: LabBlob = { version: CURRENT_VERSION, ...state };
  writeJSON(STORAGE_KEY, blob);
}

/** 当前启用的和弦性质 id（按卡片优先级；进阶包未勾选时过滤掉进阶性质） */
export function activeQualities(state: LabState): ChordQualityId[] {
  return state.chordCards
    .filter((c) => {
      if (!c.enabled) return false;
      const q = CHORD_QUALITIES.find((q) => q.id === c.id)!;
      return state.advancedPack || !q.advanced;
    })
    .map((c) => c.id as ChordQualityId);
}
