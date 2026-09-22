/**
 * 节奏琶音工坊 —— 检索态与工作台状态本地持久化（localStorage）。
 *
 * 记两类状态：浏览状态（Tab / 关键词 / 两库筛选 / 面板开合）
 * 与工作状态（选中的节奏×琶音组合、BPM、调性、混合模式）。
 * 与项目其它 settings 模块一致：版本化 JSON blob，逐字段校验，
 * 读写经 core/utils/storage 统一容错，损坏/隐私模式静默回退默认。
 */

import { readJSON, writeJSON } from '@/core/utils/storage';
import { DRUM_GENRES, MOODS, ARP_FORMS } from './types';
import { ALL_RHYTHMS, ALL_ARPS } from './data';
import type { MixMode } from './engine/mixer';
import type { Tonality } from './engine/harmony';

const STORAGE_KEY = 'rhythm-arp-lab:state';
const CURRENT_VERSION = 1;
const MAX_KEYWORD_LEN = 50;
export const BPM_MIN = 60;
export const BPM_MAX = 180;

export type LabTab = 'rhythm' | 'arp';

export interface LabState {
  /** 当前浏览的库 */
  tab: LabTab;
  keyword: string;
  /** 鼓律动库筛选（各维度单选，null = 不限） */
  rhythmSel: { genre: string | null; moods: string | null };
  /** 琶音库筛选 */
  arpSel: { form: string | null; moods: string | null };
  /** 筛选面板是否展开 */
  panelOpen: boolean;
  /** 试听工作台是否展开（展开时吸顶悬停） */
  benchOpen: boolean;
  /** 工作台当前选中的词条 id（null = 未选） */
  rhythmId: string | null;
  arpId: string | null;
  /** BPM；null = 跟随选中节奏型的推荐中值 */
  bpm: number | null;
  /** 主音音高类 0-11 */
  keyPc: number;
  tonality: Tonality;
  mixMode: MixMode;
}

interface LabBlob {
  version: number;
  tab: LabTab;
  keyword: string;
  rhythmSel: Record<string, string | null>;
  arpSel: Record<string, string | null>;
  panelOpen: boolean;
  benchOpen: boolean;
  rhythmId: string | null;
  arpId: string | null;
  bpm: number | null;
  keyPc: number;
  tonality: Tonality;
  mixMode: MixMode;
}

const RHYTHM_IDS = new Set(ALL_RHYTHMS.map((r) => r.id));
const ARP_IDS = new Set(ALL_ARPS.map((a) => a.id));

export function defaultState(): LabState {
  return {
    tab: 'rhythm',
    keyword: '',
    rhythmSel: { genre: null, moods: null },
    arpSel: { form: null, moods: null },
    panelOpen: true,
    benchOpen: true,
    rhythmId: null,
    arpId: null,
    bpm: null,
    keyPc: 0,
    tonality: 'major',
    mixMode: 'layer',
  };
}

/** 词表校验：值在词表中才保留，否则回退 null */
function vocabPick(value: unknown, vocab: readonly string[]): string | null {
  return typeof value === 'string' && vocab.includes(value) ? value : null;
}

/** 读取持久化状态；损坏/字段非法时逐项回退默认 */
export function loadState(): LabState {
  const def = defaultState();
  const parsed = readJSON(STORAGE_KEY) as Partial<LabBlob> | null;
  if (!parsed) return def;

  const tab: LabTab = parsed.tab === 'arp' ? 'arp' : 'rhythm';
  const keyword =
    typeof parsed.keyword === 'string' ? parsed.keyword.slice(0, MAX_KEYWORD_LEN) : def.keyword;
  const panelOpen = typeof parsed.panelOpen === 'boolean' ? parsed.panelOpen : def.panelOpen;
  const benchOpen = typeof parsed.benchOpen === 'boolean' ? parsed.benchOpen : def.benchOpen;

  const rSel = parsed.rhythmSel ?? {};
  const aSel = parsed.arpSel ?? {};

  const bpm =
    typeof parsed.bpm === 'number' &&
    Number.isFinite(parsed.bpm) &&
    parsed.bpm >= BPM_MIN &&
    parsed.bpm <= BPM_MAX
      ? Math.round(parsed.bpm)
      : null;

  const keyPc =
    typeof parsed.keyPc === 'number' && Number.isInteger(parsed.keyPc)
      ? Math.min(11, Math.max(0, parsed.keyPc))
      : def.keyPc;

  return {
    tab,
    keyword,
    rhythmSel: {
      genre: vocabPick(rSel.genre, DRUM_GENRES),
      moods: vocabPick(rSel.moods, MOODS),
    },
    arpSel: {
      form: vocabPick(aSel.form, ARP_FORMS),
      moods: vocabPick(aSel.moods, MOODS),
    },
    panelOpen,
    benchOpen,
    rhythmId:
      typeof parsed.rhythmId === 'string' && RHYTHM_IDS.has(parsed.rhythmId)
        ? parsed.rhythmId
        : null,
    arpId: typeof parsed.arpId === 'string' && ARP_IDS.has(parsed.arpId) ? parsed.arpId : null,
    bpm,
    keyPc,
    tonality: parsed.tonality === 'minor' ? 'minor' : 'major',
    mixMode: parsed.mixMode === 'fuse' ? 'fuse' : 'layer',
  };
}

/** 持久化（隐私模式 / 配额满时静默忽略） */
export function saveState(state: LabState): void {
  const blob: LabBlob = { version: CURRENT_VERSION, ...state };
  writeJSON(STORAGE_KEY, blob);
}
