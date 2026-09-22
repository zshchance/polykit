import type { RhythmPattern } from '../../types';

/** 电子流派鼓律动：四踩、Techno、浩室、DnB、合成波 */
export const ELECTRONIC_RHYTHMS: RhythmPattern[] = [
  {
    id: 'four-on-floor',
    name: '四踩律动',
    nameEn: 'Four on the Floor',
    icon: '🕺',
    genre: '电子',
    moods: ['律动', '欢快'],
    steps: 16,
    bpmRange: [118, 128],
    tracks: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14] },
    desc: '每拍一脚底鼓的电子基石，反拍踩镲让舞池立刻律动起来',
    promptFragment:
      'a four-on-the-floor groove with a deep kick on every beat and crisp offbeat hi-hats',
    promptFragmentZh: '四踩律动：底鼓每拍压实，反拍踩镲清脆',
  },
  {
    id: 'techno-pulse',
    name: '科技脉冲',
    nameEn: 'Techno Pulse',
    icon: '🤖',
    genre: '电子',
    moods: ['硬朗', '紧张'],
    steps: 16,
    bpmRange: [125, 135],
    tracks: {
      kick: [0, 4, 8, 12],
      snare: [4, 12],
      hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    },
    desc: '底鼓持续冲压、十六分踩镲密不透风，工业质感的推进机器',
    promptFragment:
      'a relentless techno pulse with pounding kicks and driving sixteenth-note hi-hats',
    promptFragmentZh: '科技脉冲：底鼓持续冲压，十六分踩镲密不透风',
  },
  {
    id: 'house-swing',
    name: '浩室摇摆',
    nameEn: 'House Swing',
    icon: '🏠',
    genre: '电子',
    moods: ['律动', '温暖'],
    steps: 16,
    bpmRange: [118, 126],
    tracks: { kick: [0, 4, 8, 11, 12], snare: [4, 12], hat: [2, 6, 10, 14] },
    swing: 0.3,
    desc: '第三拍尾的切分底鼓是灵魂，配上摇摆踩镲，松弛又性感',
    promptFragment:
      'a swinging house groove with a syncopated extra kick and shuffled offbeat hats',
    promptFragmentZh: '浩室摇摆：切分附加底鼓配摇晃的反拍踩镲',
  },
  {
    id: 'dnb-break',
    name: '鼓打贝斯',
    nameEn: 'Drum & Bass',
    icon: '⚡',
    genre: '电子',
    moods: ['紧张', '硬朗'],
    steps: 16,
    bpmRange: [170, 176],
    tracks: {
      kick: [0, 10],
      snare: [4, 12],
      hat: [0, 2, 4, 6, 7, 8, 10, 12, 14, 15],
    },
    desc: '高速碎拍：切分底鼓躲着军鼓走，幽灵踩镲制造失重飞驰感',
    promptFragment:
      'a fast breakbeat with syncopated kicks, snares on two and four, and busy ghosted hats',
    promptFragmentZh: '高速碎拍：切分底鼓、二四拍军鼓与密集幽灵踩镲',
  },
  {
    id: 'synthwave-drive',
    name: '合成波驱动',
    nameEn: 'Synthwave Drive',
    icon: '🌆',
    genre: '电子',
    moods: ['史诗', '迷幻'],
    steps: 16,
    bpmRange: [100, 118],
    tracks: { kick: [0, 4, 8, 12, 14], snare: [4, 12], hat: [2, 6, 10, 14] },
    desc: '小节末的抢先底鼓不断蓄力，霓虹夜色里一脚踩到底的公路感',
    promptFragment:
      'a driving synthwave beat with an anticipating extra kick and punchy gated snares',
    promptFragmentZh: '合成波驱动：抢先附加底鼓配有力门控军鼓',
  },
];
