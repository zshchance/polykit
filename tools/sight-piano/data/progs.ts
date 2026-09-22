/**
 * 识谱琴房 —— 走向素材库（和弦/琶音两个阶段的策展原料）。
 *
 * 每条走向是一串级数步（d = 级数，acc = 临时升降，q = 性质覆盖），
 * 相对当前调性解释：同一条「1564」在 C 大调是 C-G-Am-F，在 a 小调是
 * Am-E-F-Dm。level 决定它出现在哪个难度页签：
 *   1 入门 —— 3-4 个和弦的短循环
 *   2 进阶 —— 5-8 个和弦 / 低音线条更长
 *   3 挑战 —— 完整套路、借用和弦、12 小节蓝调、小调走向
 */

import type { ProgStep } from '../theory';

export interface ProgDef {
  id: string;
  name: string;
  steps: readonly ProgStep[];
  /** 一句话听感 */
  desc: string;
  level: 1 | 2 | 3;
  /** true = 小调走向（配小调调性使用） */
  minor?: boolean;
}

export const PROGS: readonly ProgDef[] = [
  // ── 入门：短循环 ──
  {
    id: 'p1564',
    name: '经典流行 1564',
    desc: 'I–V–vi–IV：流行乐万能骨架',
    level: 1,
    steps: [{ d: 1 }, { d: 5 }, { d: 6 }, { d: 4 }],
  },
  {
    id: 'p1645',
    name: '黄金时代 1645',
    desc: 'I–vi–IV–V：50 年代心跳',
    level: 1,
    steps: [{ d: 1 }, { d: 6 }, { d: 4 }, { d: 5 }],
  },
  {
    id: 'p6415',
    name: '抒情循环 6415',
    desc: 'vi–IV–I–V：伤感循环',
    level: 1,
    steps: [{ d: 6 }, { d: 4 }, { d: 1 }, { d: 5 }],
  },
  {
    id: 'p6451',
    name: '民谣叙事 6451',
    desc: 'vi–IV–V–I：讲完故事抬头看天',
    level: 1,
    steps: [{ d: 6 }, { d: 4 }, { d: 5 }, { d: 1 }],
  },
  {
    id: 'p251',
    name: '爵士归家 251',
    desc: 'ii–V–I：两步张力一步落地',
    level: 1,
    steps: [{ d: 2 }, { d: 5 }, { d: 1 }],
  },
  // ── 进阶：更长的线 ──
  {
    id: 'p4536',
    name: '华语套路 4536',
    desc: 'IV–V–iii–vi：情歌上半句标配',
    level: 2,
    steps: [{ d: 4 }, { d: 5 }, { d: 3 }, { d: 6 }],
  },
  {
    id: 'pcanon',
    name: '卡农走向',
    desc: 'I–V–vi–iii–IV–I–IV–V：下行低音的治愈',
    level: 2,
    steps: [{ d: 1 }, { d: 5 }, { d: 6 }, { d: 3 }, { d: 4 }, { d: 1 }, { d: 4 }, { d: 5 }],
  },
  {
    id: 'p1625',
    name: '经典回转 1625',
    desc: 'I–vi–ii–V：兜完一圈立刻想再来',
    level: 2,
    steps: [{ d: 1 }, { d: 6 }, { d: 2 }, { d: 5 }],
  },
  {
    id: 'p4365',
    name: '英伦起伏 4365',
    desc: 'IV–iii–vi–V：先扬后抑再推起来',
    level: 2,
    steps: [{ d: 4 }, { d: 3 }, { d: 6 }, { d: 5 }],
  },
  {
    id: 'p6543',
    name: '下行低语 6543',
    desc: 'vi–V–IV–iii：心事一层层收起来',
    level: 2,
    steps: [{ d: 6 }, { d: 5 }, { d: 4 }, { d: 3 }],
  },
  // ── 挑战：长套路 / 借用 / 蓝调 / 小调 ──
  {
    id: 'p4536251',
    name: '完整套路 4536251',
    desc: 'IV–V–iii–vi–ii–V–I：七步终于回家',
    level: 3,
    steps: [{ d: 4 }, { d: 5 }, { d: 3 }, { d: 6 }, { d: 2 }, { d: 5 }, { d: 1 }],
  },
  {
    id: 'pepic',
    name: '史诗终止 ♭VI♭VII',
    desc: '♭VI–♭VII–I：电影配乐式凯旋',
    level: 3,
    steps: [{ d: 6, acc: -1, q: 'maj' }, { d: 7, acc: -1, q: 'maj' }, { d: 1 }],
  },
  {
    id: 'pblues',
    name: '十二小节蓝调',
    desc: 'I×4–IV×2–I×2–V–IV–I–V：蓝调的骨架',
    level: 3,
    steps: [
      { d: 1 }, { d: 1 }, { d: 1 }, { d: 1 },
      { d: 4 }, { d: 4 }, { d: 1 }, { d: 1 },
      { d: 5 }, { d: 4 }, { d: 1 }, { d: 5 },
    ],
  },
  {
    id: 'pm6415',
    name: '小调抒情 6415',
    desc: 'i–VI–III–VII：小调暗色循环',
    level: 3,
    minor: true,
    steps: [{ d: 1 }, { d: 6 }, { d: 3 }, { d: 7 }],
  },
  {
    id: 'pm1645',
    name: '小调归家 1645',
    desc: 'i–VI–iv–V：和声小调的 V 落地',
    level: 3,
    minor: true,
    steps: [{ d: 1 }, { d: 6 }, { d: 4, q: 'min' }, { d: 5, q: 'maj' }],
  },
];

export const PROG_MAP: ReadonlyMap<string, ProgDef> = new Map(PROGS.map((p) => [p.id, p]));
