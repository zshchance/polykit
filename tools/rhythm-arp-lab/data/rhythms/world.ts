import type { RhythmPattern } from '../../types';

/** 世界流派鼓律动：雷鬼动 Dembow、非洲节拍 */
export const WORLD_RHYTHMS: RhythmPattern[] = [
  {
    id: 'dembow',
    name: '雷鬼动',
    nameEn: 'Dembow',
    icon: '🌴',
    genre: '世界',
    moods: ['律动', '奔放'],
    steps: 16,
    bpmRange: [88, 102],
    tracks: { kick: [0, 4, 8, 12], snare: [3, 7, 11, 15], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
    desc: '军鼓永远压在每拍反拍的拉丁引擎，一响起就想晃胯',
    promptFragment: 'a dembow reggaeton groove with snares hitting the and of every beat',
    promptFragmentZh: '雷鬼动 Dembow：军鼓压在每拍的反拍',
  },
  {
    id: 'afro-groove',
    name: '非洲律动',
    nameEn: 'Afro Groove',
    icon: '🪘',
    genre: '世界',
    moods: ['律动', '俏皮'],
    steps: 16,
    bpmRange: [100, 116],
    tracks: { kick: [0, 6, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
    desc: '底鼓交错互锁如对话，稳健踩镲兜底，午后阳光般的多声部律动',
    promptFragment: 'a syncopated afrobeat groove with interlocking kicks and steady hats',
    promptFragmentZh: '非洲节拍：交错底鼓与稳健踩镲',
  },
];
