import { GENRE_EN, MOOD_EN, type ArpPattern, type Mood, type RhythmPattern } from './types';
import { ROOT_NAMES, type Tonality } from './engine/harmony';
import type { MixMode } from './engine/mixer';

/**
 * 组合提示词拼装 —— 纯函数，输入当前选型输出中英双语段落，
 * 供 Suno / Udio / Stable Audio 等 AI 音乐工具直接使用。
 * 模板结构：情绪 + 流派 + 调性与拍号 BPM + 鼓组片段 + 琶音片段 + 混合方式描述。
 */

export interface ComboContext {
  rhythm: RhythmPattern;
  arp: ArpPattern;
  mixMode: MixMode;
  bpm: number;
  /** 主音音高类 0-11 */
  keyPc: number;
  tonality: Tonality;
}

/**
 * 从两个词条的情绪标签里挑提示词用词：优先取交集（组合语义最一致），
 * 无交集则各取首个，最多 2 个。
 */
export function pickMoods(rhythm: RhythmPattern, arp: ArpPattern): Mood[] {
  const shared = arp.moods.find((m) => rhythm.moods.includes(m));
  if (shared) return [shared];
  const out: Mood[] = [];
  if (rhythm.moods[0]) out.push(rhythm.moods[0]);
  if (arp.moods[0] && arp.moods[0] !== out[0]) out.push(arp.moods[0]);
  return out;
}

const LAYER_EN = 'woven steadily across the groove';
const FUSE_EN = 'locking tightly to the kick-and-snare accents';
const LAYER_ZH = '均匀铺陈在鼓点之上';
const FUSE_ZH = '紧贴底鼓与军鼓的重拍迸发';

export function buildPromptEn(ctx: ComboContext): string {
  const moods = pickMoods(ctx.rhythm, ctx.arp)
    .map((m) => MOOD_EN[m])
    .join(' and ');
  const genre = GENRE_EN[ctx.rhythm.genre];
  const key = `${ROOT_NAMES[ctx.keyPc]} ${ctx.tonality}`;
  const layering = ctx.mixMode === 'fuse' ? FUSE_EN : LAYER_EN;
  return (
    `A ${moods} ${genre} track in ${key}, 4/4 time at ${ctx.bpm} BPM. ` +
    `The drums play ${ctx.rhythm.promptFragment}. ` +
    `On top, ${ctx.arp.promptFragment}, ${layering}.`
  );
}

export function buildPromptZh(ctx: ComboContext): string {
  const moods = pickMoods(ctx.rhythm, ctx.arp).join('、');
  const genre = ctx.rhythm.genre;
  const key = `${ROOT_NAMES[ctx.keyPc]}${ctx.tonality === 'major' ? '大调' : '小调'}`;
  const layering = ctx.mixMode === 'fuse' ? FUSE_ZH : LAYER_ZH;
  return (
    `一首${moods}的${genre}作品，${key}，4/4 拍，${ctx.bpm} BPM。` +
    `鼓组是${ctx.rhythm.promptFragmentZh}；其上${ctx.arp.promptFragmentZh}，${layering}。`
  );
}
