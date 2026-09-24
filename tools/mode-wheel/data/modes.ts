/**
 * 调式罗盘 —— 调式与招牌进行曲库（策展数据）。
 *
 * 每个调式 = 音程偏移表 + 相对自然大调的度数标签；和弦表由 theory 的
 * buildModeTable 自动生成，这里只管"这条音阶是什么、听起来怎样、
 * 配哪几条能体现它性格的进行"。
 *
 * 进行的步（WheelStep.d）是级下标 0-6；alt 取该级的备用和弦。
 * 配方原则：必须落到有和弦的级上（有 data 测试兜底），并且尽量让
 * 特征音级（signature）出场——听到它，才算听到这个调式。
 */

import type { ModeDef } from '../theory';

export const MODES: readonly ModeDef[] = [
  {
    id: 'ionian',
    name: 'Ionian',
    zhName: '伊奥尼亚',
    icon: '☀️',
    flavor: '自然大调，明亮稳定的"标准色"，所有调式的参照系。',
    offsets: [0, 2, 4, 5, 7, 9, 11],
    degreeLabels: ['1', '2', '3', '4', '5', '6', '7'],
    signature: -1,
  },
  {
    id: 'dorian',
    name: 'Dorian',
    zhName: '多利亚',
    icon: '🌆',
    flavor: '小调骨架里藏着明亮的大六度，爵士与放克的都会夜色。',
    offsets: [0, 2, 3, 5, 7, 9, 10],
    degreeLabels: ['1', '2', '♭3', '4', '5', '6', '♭7'],
    signature: 5,
  },
  {
    id: 'phrygian',
    name: 'Phrygian',
    zhName: '弗里几亚',
    icon: '🏜️',
    flavor: '♭2 一响就是西班牙与金属，紧绷的异域暗色。',
    offsets: [0, 1, 3, 5, 7, 8, 10],
    degreeLabels: ['1', '♭2', '♭3', '4', '5', '♭6', '♭7'],
    signature: 1,
  },
  {
    id: 'lydian',
    name: 'Lydian',
    zhName: '利底亚',
    icon: '🎈',
    flavor: '♯4 让大调失去重力，电影配乐最爱的漂浮与梦幻。',
    offsets: [0, 2, 4, 6, 7, 9, 11],
    degreeLabels: ['1', '2', '3', '♯4', '5', '6', '7'],
    signature: 3,
  },
  {
    id: 'mixolydian',
    name: 'Mixolydian',
    zhName: '混合利底亚',
    icon: '🛣️',
    flavor: '大调换上 ♭7 的皮夹克，摇滚与民谣的公路之声。',
    offsets: [0, 2, 4, 5, 7, 9, 10],
    degreeLabels: ['1', '2', '3', '4', '5', '6', '♭7'],
    signature: 6,
  },
  {
    id: 'aeolian',
    name: 'Aeolian',
    zhName: '爱奥利亚',
    icon: '🌧️',
    flavor: '自然小调，流行乐半壁江山都在用的忧伤底色。',
    offsets: [0, 2, 3, 5, 7, 8, 10],
    degreeLabels: ['1', '2', '♭3', '4', '5', '♭6', '♭7'],
    signature: -1,
  },
  {
    id: 'locrian',
    name: 'Locrian',
    zhName: '洛克里亚',
    icon: '🌑',
    flavor: '连五度都是减的，悬在半空拒绝解决的极端暗色。',
    offsets: [0, 1, 3, 5, 6, 8, 10],
    degreeLabels: ['1', '♭2', '♭3', '4', '♭5', '♭6', '♭7'],
    signature: 4,
  },
  {
    id: 'mixolydian-s2',
    name: 'Mixolydian ♯2',
    zhName: '混合利底亚 ♯2',
    icon: '🎸',
    flavor: '♯2 等音于 ♭3——大小三度同框的"蓝调音"，主和弦可大可小，♯Ⅱ 是意外之美。',
    offsets: [0, 3, 4, 5, 7, 9, 10],
    degreeLabels: ['1', '♯2', '3', '4', '5', '6', '♭7'],
    signature: 1,
  },
  {
    id: 'phrygian-dom',
    name: 'Phrygian Dominant',
    zhName: '弗里几亚属',
    icon: '🕌',
    flavor: '和声小调第五式：大三主和弦撞上 ♭2 与 ♭6，沙漠与弗拉门戈之门。',
    offsets: [0, 1, 4, 5, 7, 8, 10],
    degreeLabels: ['1', '♭2', '3', '4', '5', '♭6', '♭7'],
    signature: 1,
  },
  {
    id: 'lydian-dom',
    name: 'Lydian Dominant',
    zhName: '利底亚属',
    icon: '🎷',
    flavor: '♯4 与 ♭7 同居一室，爵士里属和弦最时髦的打开方式。',
    offsets: [0, 2, 4, 6, 7, 9, 10],
    degreeLabels: ['1', '2', '3', '♯4', '5', '6', '♭7'],
    signature: 3,
  },
] as const;

export const MODE_MAP: ReadonlyMap<string, ModeDef> = new Map(MODES.map((m) => [m.id, m]));

/** 各调式的招牌进行（按调式 id 归档） */
export const MODE_PROGS: Readonly<Record<string, readonly import('../theory').WheelProg[]>> = {
  ionian: [
    {
      id: 'ion-1564',
      name: '经典流行',
      icon: '🌟',
      desc: 'Ⅰ–Ⅴ–ⅵ–Ⅳ：从《Let It Be》到《演员》的万能骨架。',
      steps: [{ d: 0 }, { d: 4 }, { d: 5 }, { d: 3 }],
    },
    {
      id: 'ion-4536',
      name: '华语套路',
      icon: '🎧',
      desc: 'Ⅳ–Ⅴ–ⅲ–ⅵ：悬在半空的上半句，引人想听下文。',
      steps: [{ d: 3 }, { d: 4 }, { d: 2 }, { d: 5 }],
    },
    {
      id: 'ion-251',
      name: '爵士归家',
      icon: '🚪',
      desc: 'ⅱ–Ⅴ–Ⅰ：爵士乐里最经典的解决公式。',
      steps: [{ d: 1 }, { d: 4 }, { d: 0 }, { d: 0 }],
    },
  ],
  dorian: [
    {
      id: 'dor-sowhat',
      name: 'So What 摇摆',
      icon: '🕺',
      desc: 'ⅰ–Ⅳ：小调里的大四级，多利亚的灵魂一击。',
      steps: [{ d: 0 }, { d: 0 }, { d: 3 }, { d: 3 }],
    },
    {
      id: 'dor-walk',
      name: '都会漫步',
      icon: '🌃',
      desc: 'ⅰ–♭Ⅲ–♭Ⅶ–Ⅳ：不急不缓地滑过霓虹。',
      steps: [{ d: 0 }, { d: 2 }, { d: 6 }, { d: 3 }],
    },
  ],
  phrygian: [
    {
      id: 'phr-spain',
      name: '西班牙回响',
      icon: '💃',
      desc: 'ⅰ–♭Ⅱ：半音压下来的那一下，就是弗拉门戈。',
      steps: [{ d: 0 }, { d: 0 }, { d: 1 }, { d: 0 }],
    },
    {
      id: 'phr-andalus',
      name: '安达卢斯下行',
      icon: '🏜️',
      desc: 'ⅰ–♭Ⅶ–♭Ⅵ–♭Ⅱ：一路下行，越走越暗。',
      steps: [{ d: 0 }, { d: 6 }, { d: 5 }, { d: 1 }],
    },
  ],
  lydian: [
    {
      id: 'lyd-float',
      name: '漂浮云端',
      icon: '🎈',
      desc: 'Ⅰ–Ⅱ：两个大三和弦错开全身，失去重力的经典配方。',
      steps: [{ d: 0 }, { d: 0 }, { d: 1 }, { d: 0 }],
    },
    {
      id: 'lyd-dream',
      name: '梦中飞行',
      icon: '🎬',
      desc: 'Ⅰ–Ⅱ–Ⅴ–Ⅰ：电影配乐式的开阔与上扬。',
      steps: [{ d: 0 }, { d: 1 }, { d: 4 }, { d: 0 }],
    },
  ],
  mixolydian: [
    {
      id: 'mix-rock',
      name: '摇滚旷野',
      icon: '🤘',
      desc: 'Ⅰ–♭Ⅶ–Ⅳ：从 AC/DC 到《平凡之路》都在这条路上。',
      steps: [{ d: 0 }, { d: 6 }, { d: 3 }, { d: 0 }],
    },
    {
      id: 'mix-road',
      name: '民谣公路',
      icon: '🛻',
      desc: 'Ⅰ–ⅴ–♭Ⅶ–Ⅳ：小五级把太阳落下去一点。',
      steps: [{ d: 0 }, { d: 4 }, { d: 6 }, { d: 3 }],
    },
  ],
  aeolian: [
    {
      id: 'aeo-sad',
      name: '忧伤循环',
      icon: '🌧️',
      desc: 'ⅰ–♭Ⅵ–♭Ⅲ–♭Ⅶ：小调流行的四大件。',
      steps: [{ d: 0 }, { d: 5 }, { d: 2 }, { d: 6 }],
    },
    {
      id: 'aeo-epic',
      name: '史诗推进',
      icon: '⚔️',
      desc: 'ⅰ–♭Ⅶ–♭Ⅵ–♭Ⅶ：游戏与预告片的最爱。',
      steps: [{ d: 0 }, { d: 6 }, { d: 5 }, { d: 6 }],
    },
  ],
  locrian: [
    {
      id: 'loc-hang',
      name: '悬而未决',
      icon: '🌫️',
      desc: 'ⅰ°–♭Ⅱ：减三主和弦拒绝给你答案。',
      steps: [{ d: 0 }, { d: 0 }, { d: 1 }, { d: 0 }],
    },
    {
      id: 'loc-drift',
      name: '暗夜漂移',
      icon: '🛸',
      desc: 'ⅰ°–♭ⅲ–♭Ⅵ–♭Ⅱ：恐怖片配乐的安全带请系好。',
      steps: [{ d: 0 }, { d: 2 }, { d: 5 }, { d: 1 }],
    },
  ],
  'mixolydian-s2': [
    {
      id: 'ms2-surprise',
      name: '蓝调惊喜',
      icon: '🎁',
      desc: 'Ⅰ–♯Ⅱ–Ⅳ–Ⅰ：♯Ⅱ 那一下"错位的惊喜"就是这条音阶的全部理由。',
      steps: [{ d: 0 }, { d: 1 }, { d: 3 }, { d: 0 }],
    },
    {
      id: 'ms2-hendrix',
      name: '大小主音游戏',
      icon: '🎸',
      desc: 'Ⅰ–ⅰ–♯Ⅱ–Ⅳ：主和弦先大后小——同一个根音，两种天气。',
      steps: [{ d: 0 }, { d: 0, alt: true }, { d: 1 }, { d: 3 }],
    },
    {
      id: 'ms2-slide',
      name: '半音滑行',
      icon: '🛝',
      desc: '♯Ⅱ–ⅲ°–Ⅳ：根音 D♯→E→F 半音爬行，怪得有理。',
      steps: [{ d: 1 }, { d: 2 }, { d: 3 }, { d: 0 }],
    },
  ],
  'phrygian-dom': [
    {
      id: 'phd-storm',
      name: '沙漠风暴',
      icon: '🏜️',
      desc: 'Ⅰ–♭Ⅱ：大三主和弦撞上半音邻居，金属与弗拉门戈共用。',
      steps: [{ d: 0 }, { d: 0 }, { d: 1 }, { d: 0 }],
    },
    {
      id: 'phd-gate',
      name: '弗拉门戈之门',
      icon: '🚪',
      desc: 'Ⅰ–♭Ⅱ–ⅳ–♭Ⅱ：♭2 级进进出出，门框都要磨亮了。',
      steps: [{ d: 0 }, { d: 1 }, { d: 3 }, { d: 1 }],
    },
  ],
  'lydian-dom': [
    {
      id: 'lyd-jazz',
      name: '爵士街头',
      icon: '🎷',
      desc: 'Ⅰ–Ⅱ–♭Ⅶ+：增三和弦收尾，悬着才时髦。',
      steps: [{ d: 0 }, { d: 1 }, { d: 6 }, { d: 0 }],
    },
    {
      id: 'lyd-simpson',
      name: '辛普森步伐',
      icon: '🍩',
      desc: 'Ⅰ–Ⅱ–ⅴ–Ⅰ：得意洋洋地迈错每一步。',
      steps: [{ d: 0 }, { d: 1 }, { d: 4 }, { d: 0 }],
    },
  ],
};
