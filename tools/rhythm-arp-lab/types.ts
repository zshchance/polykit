/**
 * 节奏琶音工坊 —— 数据模型与维度词表。
 *
 * 两类词条：
 *   1. 鼓组律动（RhythmPattern）：kick/snare/hat 三轨在 16 步网格上的触发点，
 *      即"鼓点节奏型"（四踩、Boom-bap、Trap、Dembow 等）。
 *   2. 琶音模式（ArpPattern）：和弦内音的索引序列（-1 = 休止），
 *      实际音高由试听时的当前和弦（根音+性质+八度跨度）决定。
 *
 * 维度词表（DRUM_GENRES / MOODS / ARP_FORMS）是筛选胶囊的唯一来源，
 * 词条只能从词表取值，保证筛选集合可控（由 data-integrity.test.ts 强制）。
 * MOOD_EN / GENRE_EN 用于拼装英文 AI 提示词。
 */

// ───────────── 维度词表（顺序即 UI 展示顺序）─────────────

/** 鼓组律动的流派谱系 */
export const DRUM_GENRES = ['电子', '嘻哈', '摇滚', '放克', '流行', '世界'] as const;
export type DrumGenre = (typeof DRUM_GENRES)[number];

/** 情绪：这段律动/琶音给人的心理感受 */
export const MOODS = [
  '律动',
  '慵懒',
  '紧张',
  '欢快',
  '空灵',
  '史诗',
  '迷幻',
  '硬朗',
  '温暖',
  '暗黑',
  '俏皮',
  '奔放',
] as const;
export type Mood = (typeof MOODS)[number];

/** 琶音形态：音符在时间和音高上的组织方式 */
export const ARP_FORMS = [
  '上行',
  '下行',
  '上下行',
  '波浪',
  '跳音',
  '阿尔贝蒂',
  '分解柱式',
  '驱动',
  '点缀',
  '回声',
] as const;
export type ArpForm = (typeof ARP_FORMS)[number];

// ───────────── 提示词用的英文映射 ─────────────

export const GENRE_EN: Record<DrumGenre, string> = {
  电子: 'electronic',
  嘻哈: 'hip-hop',
  摇滚: 'rock',
  放克: 'funk',
  流行: 'pop',
  世界: 'world',
};

export const MOOD_EN: Record<Mood, string> = {
  律动: 'groovy',
  慵懒: 'laid-back',
  紧张: 'tense',
  欢快: 'uplifting',
  空灵: 'ethereal',
  史诗: 'epic',
  迷幻: 'psychedelic',
  硬朗: 'hard-hitting',
  温暖: 'warm',
  暗黑: 'dark',
  俏皮: 'playful',
  奔放: 'exuberant',
};

// ───────────── 词条 ─────────────

/** 三轨鼓点：值为 16 步网格（0-15）上的触发步索引，升序 */
export interface RhythmTracks {
  kick: number[];
  snare: number[];
  hat: number[];
}

/**
 * 一条鼓组律动。MVP 统一 4/4 拍 16 步网格（steps 字段固定 16，预留扩展）。
 * swing 为 16 分摇摆量（0-0.5，延迟所有偶数位的第二个 16 分音符）。
 */
export interface RhythmPattern {
  /** kebab-case 全局唯一 id */
  id: string;
  /** 中文名 */
  name: string;
  /** 英文名（提示词常用写法） */
  nameEn: string;
  /** 卡片小图标（emoji） */
  icon: string;
  genre: DrumGenre;
  /** 情绪词（1-3 个，取自 MOODS） */
  moods: Mood[];
  steps: 16;
  /** 推荐 BPM 区间 [最低, 最高] */
  bpmRange: readonly [number, number];
  tracks: RhythmTracks;
  /** 16 分摇摆量（0 = 严格直拍），不传即 0 */
  swing?: number;
  /** 一句话简介（卡片展示，约 40 字） */
  desc: string;
  /** 英文提示词片段（名词短语，嵌入组合提示词） */
  promptFragment: string;
  /** 中文提示词片段 */
  promptFragmentZh: string;
}

/**
 * 一条琶音模式。notes 是"和弦内音索引"序列：0 = 根音、1 = 三音、2 = 五音…
 * 超出当前和弦音数时按取模环绕（含八度扩展后的音列），-1 表示休止。
 * 为保证与 16 步鼓网格相位对齐，策展约定 notes 长度取 4 / 8 / 16。
 */
export interface ArpPattern {
  id: string;
  name: string;
  nameEn: string;
  icon: string;
  form: ArpForm;
  moods: Mood[];
  /** 和弦内音索引序列（-1 = 休止），长度约定为 4 / 8 / 16 */
  notes: number[];
  /** 细分：8 = 八分音符（每两步触发一次），16 = 十六分（每步触发） */
  subdivision: 8 | 16;
  /** 八度跨度：1 = 单八度和弦音，2 = 扩展两个八度 */
  octaves: 1 | 2;
  desc: string;
  promptFragment: string;
  promptFragmentZh: string;
}

// ───────────── 筛选维度 ─────────────

export type RhythmFacetKey = 'genre' | 'moods';
export type ArpFacetKey = 'form' | 'moods';

export interface RhythmFacet {
  key: RhythmFacetKey;
  label: string;
  icon: string;
  values: readonly string[];
}

export interface ArpFacet {
  key: ArpFacetKey;
  label: string;
  icon: string;
  values: readonly string[];
}

export const RHYTHM_FACETS: RhythmFacet[] = [
  { key: 'genre', label: '流派', icon: '🥁', values: DRUM_GENRES },
  { key: 'moods', label: '情绪', icon: '💭', values: MOODS },
];

export const ARP_FACETS: ArpFacet[] = [
  { key: 'form', label: '形态', icon: '🎹', values: ARP_FORMS },
  { key: 'moods', label: '情绪', icon: '💭', values: MOODS },
];
