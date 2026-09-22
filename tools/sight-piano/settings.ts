/**
 * 识谱琴房 —— 用户配置与练习记忆（localStorage）。
 *
 * 记三类数据：
 *   1. 面板设置：阶段 / 当前曲目 / 键数 / 窗口 / 练习模式 / 节奏型 / BPM / 音量 / 踏板
 *   2. 练习成绩：每首曲子的最好星级与正确率（学习路径进度条的来源）
 *   3. 我的曲库：用户导入的谱面（文本存原文，MIDI 存 base64），
 *      刷新后原样恢复——包括「最后一次上传的谱」
 * 与项目其它 settings 模块一致：版本化 blob，逐字段校验，读写经
 * core/utils/storage 容错，损坏/隐私模式静默回退默认。
 */

import { readJSON, writeJSON } from '@/core/utils/storage';
import type { Stage } from './score';
import type { Tonality } from './theory';

const STORAGE_KEY = 'sight-piano:state';
const CURRENT_VERSION = 1;

export const PIANO_MIN = 21; // A0
export const PIANO_MAX = 108; // C8

export type PracticeMode = 'wait' | 'play';

/** 一首导入曲目的存档 */
export interface ImportedSong {
  id: string;
  title: string;
  format: '简谱' | 'ABC' | 'MIDI';
  /** text 格式存原文；MIDI 存 base64 */
  kind: 'text' | 'midi';
  data: string;
  addedAt: number;
}

export interface SongProgress {
  /** 0-3 星（历史最好） */
  stars: number;
  /** 历史最好正确率 0-1 */
  bestAcc: number;
  /** 完成次数 */
  plays: number;
}

export interface LabState {
  stage: Stage;
  /** 各阶段最后选中的曲目 id */
  songId: Record<Stage, string>;
  /** 各阶段难度页签（1 入门 / 2 进阶 / 3 挑战） */
  level: Record<Stage, 1 | 2 | 3>;
  keyCount: 25 | 32;
  windowStart: number;
  mode: PracticeMode;
  rhythmId: string;
  /** 用户覆盖的 BPM；null = 跟随曲目建议值 */
  bpm: number | null;
  volume: number;
  bandVolume: number;
  pedalOn: boolean;
  /** 当前目标音的键盘引导（犹豫提示之外的常亮引导） */
  keyGuide: boolean;
  /** 自由弹奏实时谱面的调号（用户自选，可被记忆） */
  freeKeyPc: number;
  freeTonality: Tonality;
  progress: Record<string, SongProgress>;
  imported: ImportedSong[];
  /** 最后一次导入的曲目 id（刷新后自动选中） */
  lastImportedId: string | null;
}

export function clampWindow(start: number, keyCount: 25 | 32): number {
  return Math.min(PIANO_MAX - keyCount + 1, Math.max(PIANO_MIN, Math.round(start)));
}

export function defaultState(): LabState {
  return {
    stage: 'read',
    songId: { read: 'twinkle', chord: 'ch-pcanon-0', arp: 'arp-pcanon-updown-0' },
    level: { read: 1, chord: 1, arp: 1 },
    keyCount: 32,
    windowStart: 48, // C3 起，32 键覆盖 C3–G5
    mode: 'wait',
    rhythmId: 'metro',
    bpm: null,
    volume: 0.8,
    bandVolume: 0.7,
    pedalOn: false,
    keyGuide: true,
    freeKeyPc: 0,
    freeTonality: 'major',
    progress: {},
    imported: [],
    lastImportedId: null,
  };
}

const STAGES: readonly Stage[] = ['read', 'chord', 'arp'];
const IMPORT_MAX = 12;
const IMPORT_BYTES = 240_000; // 曲库总大小上限（JSON 字符数粗算）

function healProgress(raw: unknown): Record<string, SongProgress> {
  const out: Record<string, SongProgress> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const { stars, bestAcc, plays } = v as Record<string, unknown>;
    out[id] = {
      stars: typeof stars === 'number' ? Math.min(3, Math.max(0, Math.round(stars))) : 0,
      bestAcc:
        typeof bestAcc === 'number' && Number.isFinite(bestAcc)
          ? Math.min(1, Math.max(0, bestAcc))
          : 0,
      plays: typeof plays === 'number' ? Math.max(0, Math.round(plays)) : 0,
    };
  }
  return out;
}

function healImported(raw: unknown): ImportedSong[] {
  if (!Array.isArray(raw)) return [];
  const out: ImportedSong[] = [];
  let bytes = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { id, title, format, kind, data, addedAt } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof data !== 'string' || !data) continue;
    if (kind !== 'text' && kind !== 'midi') continue;
    if (format !== '简谱' && format !== 'ABC' && format !== 'MIDI') continue;
    bytes += data.length;
    if (bytes > IMPORT_BYTES) break;
    out.push({
      id,
      title: typeof title === 'string' && title ? title.slice(0, 40) : '未命名曲谱',
      format,
      kind,
      data,
      addedAt: typeof addedAt === 'number' ? addedAt : 0,
    });
    if (out.length >= IMPORT_MAX) break;
  }
  return out;
}

export function loadState(): LabState {
  const def = defaultState();
  const parsed = readJSON(STORAGE_KEY);
  if (!parsed) return def;

  const keyCount: 25 | 32 = parsed.keyCount === 25 ? 25 : 32;
  const songIdRaw = parsed.songId as Record<string, unknown> | undefined;
  const levelRaw = parsed.level as Record<string, unknown> | undefined;
  const healLevel = (v: unknown): 1 | 2 | 3 => (v === 1 || v === 2 || v === 3 ? v : 1);

  return {
    stage: STAGES.includes(parsed.stage as Stage) ? (parsed.stage as Stage) : def.stage,
    songId: {
      read: typeof songIdRaw?.read === 'string' ? songIdRaw.read : def.songId.read,
      chord: typeof songIdRaw?.chord === 'string' ? songIdRaw.chord : def.songId.chord,
      arp: typeof songIdRaw?.arp === 'string' ? songIdRaw.arp : def.songId.arp,
    },
    level: {
      read: healLevel(levelRaw?.read),
      chord: healLevel(levelRaw?.chord),
      arp: healLevel(levelRaw?.arp),
    },
    keyCount,
    windowStart:
      typeof parsed.windowStart === 'number' && Number.isFinite(parsed.windowStart)
        ? clampWindow(parsed.windowStart, keyCount)
        : def.windowStart,
    mode: parsed.mode === 'play' ? 'play' : 'wait',
    rhythmId: typeof parsed.rhythmId === 'string' ? parsed.rhythmId : def.rhythmId,
    bpm:
      typeof parsed.bpm === 'number' && Number.isFinite(parsed.bpm)
        ? Math.min(220, Math.max(40, Math.round(parsed.bpm)))
        : null,
    volume:
      typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
        ? Math.min(1, Math.max(0, parsed.volume))
        : def.volume,
    bandVolume:
      typeof parsed.bandVolume === 'number' && Number.isFinite(parsed.bandVolume)
        ? Math.min(1, Math.max(0, parsed.bandVolume))
        : def.bandVolume,
    pedalOn: typeof parsed.pedalOn === 'boolean' ? parsed.pedalOn : def.pedalOn,
    keyGuide: typeof parsed.keyGuide === 'boolean' ? parsed.keyGuide : def.keyGuide,
    freeKeyPc:
      typeof parsed.freeKeyPc === 'number' && Number.isInteger(parsed.freeKeyPc)
        ? Math.min(11, Math.max(0, parsed.freeKeyPc))
        : def.freeKeyPc,
    freeTonality: parsed.freeTonality === 'minor' ? 'minor' : 'major',
    progress: healProgress(parsed.progress),
    imported: healImported(parsed.imported),
    lastImportedId: typeof parsed.lastImportedId === 'string' ? parsed.lastImportedId : null,
  };
}

export function saveState(state: LabState): void {
  writeJSON(STORAGE_KEY, { version: CURRENT_VERSION, ...state });
}

/** 追加导入曲目（同 id 覆盖）；超出容量时丢最旧的。返回是否成功入库 */
export function pushImported(state: LabState, song: ImportedSong): boolean {
  state.imported = state.imported.filter((s) => s.id !== song.id);
  state.imported.push(song);
  let bytes = state.imported.reduce((n, s) => n + s.data.length, 0);
  while (state.imported.length > IMPORT_MAX || bytes > IMPORT_BYTES) {
    const removed = state.imported.shift();
    if (!removed) break;
    bytes -= removed.data.length;
  }
  state.lastImportedId = song.id;
  return state.imported.some((s) => s.id === song.id);
}
