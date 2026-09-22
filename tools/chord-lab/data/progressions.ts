/**
 * 和弦琴房 —— 走向曲库（策展数据）。
 *
 * 每条走向是一串级数步（ProgStep）：d = 级数 1-7，acc = 临时升降，
 * q = 性质覆盖（缺省取调式自然三和弦）。级数相对当前调性解释——
 * 同一条「1564」在 C 大调是 C-G-Am-F，在 a 小调是 Am-E-F-Dm，
 * 这正是走向学习要体会的「同一骨架，不同情绪」。
 *
 * defaultColor 指向 settings.PALETTE 的索引；数组顺序即默认优先级。
 */

import type { Progression } from '../theory';

export const PROGRESSIONS: readonly Progression[] = [
  {
    id: 'p-1564',
    name: '经典流行',
    icon: '🌟',
    desc: 'I–V–vi–IV：从《Let It Be》到《演员》，流行乐的万能骨架，明朗中带一点怀念。',
    steps: [{ d: 1 }, { d: 5 }, { d: 6 }, { d: 4 }],
    defaultColor: 2, // 天蓝
    defaultEnabled: true,
  },
  {
    id: 'p-4536',
    name: '华语套路',
    icon: '🎧',
    desc: 'IV–V–iii–vi：华语情歌出现率最高的上半句，悬在半空、引人想听下文。',
    steps: [{ d: 4 }, { d: 5 }, { d: 3 }, { d: 6 }],
    defaultColor: 6, // 玫红
    defaultEnabled: true,
  },
  {
    id: 'p-4536251',
    name: '完整套路',
    icon: '🧵',
    desc: 'IV–V–iii–vi–ii–V–I：套路的完全体，七步走一轮终于回家，满足感拉满。',
    steps: [{ d: 4 }, { d: 5 }, { d: 3 }, { d: 6 }, { d: 2 }, { d: 5 }, { d: 1 }],
    defaultColor: 3, // 紫
    defaultEnabled: true,
  },
  {
    id: 'p-6415',
    name: '抒情循环',
    icon: '🌧',
    desc: 'vi–IV–I–V：从小调色彩出发再回到光明，《Apologize》式的伤感循环。',
    steps: [{ d: 6 }, { d: 4 }, { d: 1 }, { d: 5 }],
    defaultColor: 0, // 绿
    defaultEnabled: true,
  },
  {
    id: 'p-6451',
    name: '民谣叙事',
    icon: '🍂',
    desc: 'vi–IV–V–I：民谣与摇滚叙事常用，像讲完一个故事后抬头看天。',
    steps: [{ d: 6 }, { d: 4 }, { d: 5 }, { d: 1 }],
    defaultColor: 5, // 橙
    defaultEnabled: true,
  },
  {
    id: 'p-canon',
    name: '卡农走向',
    icon: '⛪',
    desc: 'I–V–vi–iii–IV–I–IV–V：帕赫贝尔《卡农》的下行低音，古典又治愈。',
    steps: [{ d: 1 }, { d: 5 }, { d: 6 }, { d: 3 }, { d: 4 }, { d: 1 }, { d: 4 }, { d: 5 }],
    defaultColor: 8, // 青
    defaultEnabled: true,
  },
  {
    id: 'p-1645',
    name: '黄金时代',
    icon: '📻',
    desc: 'I–vi–IV–V：50 年代 Doo-wop 的标准循环，《Stand by Me》的心跳。',
    steps: [{ d: 1 }, { d: 6 }, { d: 4 }, { d: 5 }],
    defaultColor: 4, // 琥珀
    defaultEnabled: true,
  },
  {
    id: 'p-1625',
    name: '经典回转',
    icon: '🔄',
    desc: 'I–vi–ii–V：爵士 Turnaround，一圈兜完立刻想再来一遍。',
    steps: [{ d: 1 }, { d: 6 }, { d: 2 }, { d: 5 }],
    defaultColor: 7, // 桃粉
    defaultEnabled: true,
  },
  {
    id: 'p-251',
    name: '爵士归家',
    icon: '🎷',
    desc: 'ii–V–I：爵士乐的地基句，两步的张力在一步上落地。',
    steps: [{ d: 2 }, { d: 5 }, { d: 1 }],
    defaultColor: 1, // 淡绿
    defaultEnabled: true,
  },
  {
    id: 'p-4365',
    name: '英伦起伏',
    icon: '🌊',
    desc: 'IV–iii–vi–V：先扬后抑再推起来，英伦摇滚副歌的起伏感。',
    steps: [{ d: 4 }, { d: 3 }, { d: 6 }, { d: 5 }],
    defaultColor: 9, // 灰蓝
    defaultEnabled: false,
  },
  {
    id: 'p-6543',
    name: '下行低语',
    icon: '🌒',
    desc: 'vi–V–IV–iii：低音一路下行，像把心事一层层收起来。',
    steps: [{ d: 6 }, { d: 5 }, { d: 4 }, { d: 3 }],
    defaultColor: 10, // 玫紫
    defaultEnabled: false,
  },
  {
    id: 'p-epic',
    name: '史诗终止',
    icon: '⚔️',
    desc: '♭VI–♭VII–I：借自同主音小调的两个大块头，电影配乐式凯旋收尾。',
    steps: [{ d: 6, acc: -1, q: 'maj' }, { d: 7, acc: -1, q: 'maj' }, { d: 1 }],
    defaultColor: 11, // 金
    defaultEnabled: false,
  },
];

export const PROGRESSION_MAP: ReadonlyMap<string, Progression> = new Map(
  PROGRESSIONS.map((p) => [p.id, p]),
);
