/**
 * 识谱琴房 —— 内置曲库（策展数据）。
 *
 * 三个阶段共用一份 Score 模型，但来源不同：
 *   识谱（read）  —— 手写数字简谱字符串，经自家 jianpu 解析器构建
 *                    （曲库即解析器的狗粮测试）。按调性难度分组：
 *                    C（无升降）→ G（1♯）→ F（1♭）→ D（2♯）→ 降B（2♭），
 *                    这正是视奏教学里调号的经典引入顺序。
 *   和弦（chord） —— 经典走向在当前调下的整小节和弦块（全音符堆叠），
 *                    就近 voicing 平滑连接
 *   琶音（arp）   —— 走向 × 琶音模式展开成八分音符流
 */

import { parseJianpu, type ParsedSheet } from '../parsers/jianpu';
import { buildScore, type RawEvent, type Score, type Stage } from '../score';
import {
  nearestVoicing,
  stepChordName,
  stepLabel,
  stepQuality,
  stepRootPc,
  QUALITY_MAP,
  type ProgStep,
  type Tonality,
} from '../theory';

// ───────────── 识谱曲目（数字简谱） ─────────────

interface SongSeed {
  id: string;
  title: string;
  /** 数字简谱（含 1=X 调号 / 拍号 / 速度头） */
  jianpu: string;
  group: string;
  /** 一句学习提示（选曲后显示在读数区） */
  tip: string;
}

const READ_SONGS: readonly SongSeed[] = [
  // ── C 大调 · 无升降号：先认熟中央 C 附近的音 ──
  {
    id: 'twinkle',
    title: '小星星',
    group: 'C 大调 · 无升降号',
    jianpu: `1=C 4/4 ♩=92
1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |
5 5 4 4 | 3 3 2 - | 5 5 4 4 | 3 3 2 - |
1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |`,
    tip: '全是白键。先找中央 C（两个黑键左边的白键），跟着 1→5 的五度跳进熟悉线间关系。',
  },
  {
    id: 'mary',
    title: '玛丽有只小羊羔',
    group: 'C 大调 · 无升降号',
    jianpu: `1=C 4/4 ♩=100
3 2 1 2 | 3 3 3 - | 2 2 2 - | 3 5 5 - |
3 2 1 2 | 3 3 3 3 | 2 2 3 2 | 1 - - - |`,
    tip: '只有 1 2 3 5 四个音。注意 3→2→1 的级进下行，是视奏里最常见的形状。',
  },
  {
    id: 'ode',
    title: '欢乐颂',
    group: 'C 大调 · 无升降号',
    jianpu: `1=C 4/4 ♩=104
3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 3 2_ 2_ 2 - |
3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 2 1_ 1_ 1 - |
2 2 3 1 | 2 3_ 4_ 3 1 | 2 3_ 4_ 3 2 | 1 2 5, - |
3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 2 1_ 1_ 1 - |`,
    tip: '贝多芬的旋律几乎全是级进。注意第 4 小节出现的八分音符（带符尾），时值减半。',
  },
  {
    id: 'jingle',
    title: '铃儿响叮当',
    group: 'C 大调 · 无升降号',
    jianpu: `1=C 4/4 ♩=108
3 3 3 - | 3 3 3 - | 3 5 1 2 | 3 - - - |
4 4 4 4 | 4 4 3 3 | 3 3 3 2 | 2 5 2 - |
3 3 3 - | 3 3 3 - | 3 5 1 2 | 3 - - - |
4 4 4 4 | 4 4 3 3 | 5 5 4 2 | 1 - - - |`,
    tip: '同音反复 + 级进的组合。三个连着的 3 在同一线上，手不动、指头来。',
  },
  {
    id: 'farewell',
    title: '送别',
    group: 'C 大调 · 无升降号',
    jianpu: `1=C 4/4 ♩=84
5 3 5 1' | 6 1' 5 - | 5 1 2 3 | 2 1 2 - |
5 3 5 1' | 6 1' 5 - | 5 1 2 3 | 2 3 1 - |`,
    tip: '出现高音 1′（上加线的音）。谱面往上加线，键盘也往上挪——指示条会跟着你。',
  },
  {
    id: 'firefly',
    title: '虫儿飞',
    group: 'C 大调 · 无升降号',
    jianpu: `1=C 4/4 ♩=88
3 3 3 2 | 1 2 1 - | 6, 6, 6, 5, | 1 6, - - |
3 3 4 5 | 4 3 2 - | 1 2 3 2 | 1 - - - |`,
    tip: '带低音逗号（6, 5,）的音在谱表下方加线。练习低音区的识谱定位。',
  },
  // ── G 大调 · 一个升号：F♯ 上线 ──
  {
    id: 'rowboat',
    title: '划小船',
    group: 'G 大调 · 一个升号',
    jianpu: `1=G 4/4 ♩=104
1 1 1 2 | 3 - 3 2 | 3 4 5 - |
1' 1' 5 5 | 3 3 1 1 | 5 - 4 - | 3 - 2 - | 1 - - - |`,
    tip: '调号多了一个 ♯（F♯）。本曲没用到它，但谱号旁的 ♯ 已经在提醒你：这不是 C 大调。',
  },
  {
    id: 'birthday',
    title: '生日歌',
    group: 'G 大调 · 一个升号',
    jianpu: `1=G 3/4 ♩=120
5_ 5_ | 6 5 1' | 7 - 5_ 5_ | 6 5 2' | 1' - 5_ 5_ |
5' 3' 1' | 7 6 4_ 4_ | 3' 1' 2' | 1' - - |`,
    tip: '三拍子 + 弱起小节。7 在 G 大调里是 F♯——琴键上它右边的黑键，谱面上它还是写在 F 的线上。',
  },
  // ── F 大调 · 一个降号：B♭ 上线 ──
  {
    id: 'twinkle-f',
    title: '小星星（F 调）',
    group: 'F 大调 · 一个降号',
    jianpu: `1=F 4/4 ♩=92
1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |
5 5 4 4 | 3 3 2 - | 5 5 4 4 | 3 3 2 - |
1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |`,
    tip: '熟悉的旋律换了个家。4 现在是 B♭——弹黑键，但谱面上音符还在 B 的线上，记号藏在谱号里。',
  },
  {
    id: 'ode-f',
    title: '欢乐颂（F 调）',
    group: 'F 大调 · 一个降号',
    jianpu: `1=F 4/4 ♩=104
3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 3 2_ 2_ 2 - |
3 3 4 5 | 5 4 3 2 | 1 1 2 3 | 2 1_ 1_ 1 - |`,
    tip: '第 1 小节就有 4（B♭）。看谱时先想调号里降了谁，手指就不会找错白键。',
  },
  // ── D 大调 · 两个升号 ──
  {
    id: 'canon-d',
    title: '卡农主题（简化）',
    group: 'D 大调 · 两个升号',
    jianpu: `1=D 4/4 ♩=96
3 2 1 7 | 6, 5, 6, 7 | 1 7 6, 5, | 4, 3, 4, 2, |
1 - 3 2 | 1 7 6, 7 | 1 2 3 2 | 1 - - - |`,
    tip: '帕赫贝尔的原调。F♯ 和 C♯ 两个升号都在调号里，下行的低音线条像台阶一样好认。',
  },
  // ── 降 B 大调 · 两个降号 ──
  {
    id: 'edelweiss-bb',
    title: '雪绒花（降 B 调）',
    group: '降 B 大调 · 两个降号',
    jianpu: `1=Bb 3/4 ♩=92
3 - 5 | 2 - 1 | 5 - 3 | 3 4 5 | 5 - 5 |
3 - 5 | 2 - 1 | 5 6 7 | 1' - - |`,
    tip: '三拍子的摇曳感。B♭ 和 E♭ 都降了，看到 4 和 7 的邻居时先想调号。',
  },
  {
    id: 'moon-bb',
    title: '月亮代表我的心（简化）',
    group: '降 B 大调 · 两个降号',
    jianpu: `1=Bb 4/4 ♩=84
3 2 1 2 | 3 5 3 - | 2 1 6, 5, | 6, 1, - - |
3 2 1 2 | 3 5 3 - | 2 1 6, 5, | 1 - - - |`,
    tip: '长音多，适合开节拍器练稳定。两个降号的调号读法和降 B 雪绒花互相印证。',
  },
];

// ───────────── 和弦走向 / 琶音的素材 ─────────────

interface ProgDef {
  id: string;
  name: string;
  steps: readonly ProgStep[];
  /** 一句话听感 */
  desc: string;
}

const PROGS: readonly ProgDef[] = [
  {
    id: 'p1564',
    name: '经典流行 1564',
    desc: 'I–V–vi–IV：流行乐万能骨架',
    steps: [{ d: 1 }, { d: 5 }, { d: 6 }, { d: 4 }],
  },
  {
    id: 'p4536',
    name: '华语套路 4536',
    desc: 'IV–V–iii–vi：情歌上半句标配',
    steps: [{ d: 4 }, { d: 5 }, { d: 3 }, { d: 6 }],
  },
  {
    id: 'p1645',
    name: '黄金时代 1645',
    desc: 'I–vi–IV–V：50 年代心跳',
    steps: [{ d: 1 }, { d: 6 }, { d: 4 }, { d: 5 }],
  },
  {
    id: 'pcanon',
    name: '卡农走向',
    desc: 'I–V–vi–iii–IV–I–IV–V：下行低音的治愈',
    steps: [{ d: 1 }, { d: 5 }, { d: 6 }, { d: 3 }, { d: 4 }, { d: 1 }, { d: 4 }, { d: 5 }],
  },
  {
    id: 'p6415m',
    name: '小调抒情 6415',
    desc: 'i–VI–III–VII：小调暗色循环',
    steps: [{ d: 1 }, { d: 6 }, { d: 3 }, { d: 7 }],
  },
  {
    id: 'p251',
    name: '爵士归家 251',
    desc: 'ii–V–I：两步张力一步落地',
    steps: [{ d: 2 }, { d: 5 }, { d: 1 }],
  },
];

const PROG_MAP: ReadonlyMap<string, ProgDef> = new Map(PROGS.map((p) => [p.id, p]));

/** 走向 → 和弦块谱面（每小节一个和弦，就近 voicing 连接，弹两轮） */
function buildChordScore(
  id: string,
  title: string,
  prog: ProgDef,
  keyPc: number,
  tonality: Tonality,
  group: string,
  bpm: number,
): Score {
  const beatsPerBar = 4;
  const events: RawEvent[] = [];
  let center = 64;
  for (let round = 0; round < 2; round++) {
    prog.steps.forEach((st, i) => {
      const rootPc = stepRootPc(keyPc, tonality, st);
      const q = stepQuality(tonality, st);
      const voicing = nearestVoicing(rootPc, QUALITY_MAP.get(q)!.intervals, center, 52, 76);
      if (voicing.length) center = Math.round(voicing.reduce((a, b) => a + b, 0) / voicing.length);
      events.push({
        beat: (round * prog.steps.length + i) * beatsPerBar,
        dur: beatsPerBar,
        midis: voicing,
        label: `${stepLabel(tonality, st)} ${stepChordName(keyPc, tonality, st)}`,
        bassPc: rootPc,
      });
    });
  }
  return buildScore(events, {
    id,
    title,
    stage: 'chord',
    keyPc,
    tonality,
    beatsPerBar,
    bpm,
    group,
  });
}

type ArpPattern = 'up' | 'updown' | 'alberti' | 'bounce';

const ARP_NAME: Record<ArpPattern, string> = {
  up: '上行楼梯',
  updown: '上下来回',
  alberti: '阿尔贝蒂',
  bounce: '民谣分解',
};

/** 模式池：把和弦三音 + 高八度根音铺成索引序列，循环取 */
const ARP_SEQ: Record<ArpPattern, readonly number[]> = {
  up: [0, 1, 2, 3, 0, 1, 2, 3],
  updown: [0, 1, 2, 3, 2, 1, 0, 1],
  alberti: [0, 2, 1, 2, 0, 2, 1, 2],
  bounce: [0, 1, 2, 1, 3, 1, 2, 1],
};

/** 走向 × 琶音模式 → 八分音符流谱面（每小节一个和弦，弹两轮） */
function buildArpScore(
  id: string,
  prog: ProgDef,
  pattern: ArpPattern,
  keyPc: number,
  tonality: Tonality,
  group: string,
  bpm: number,
): Score {
  const beatsPerBar = 4;
  const seq = ARP_SEQ[pattern];
  const events: RawEvent[] = [];
  let center = 62;
  for (let round = 0; round < 2; round++) {
    prog.steps.forEach((st, i) => {
      const rootPc = stepRootPc(keyPc, tonality, st);
      const q = stepQuality(tonality, st);
      const voicing = nearestVoicing(rootPc, QUALITY_MAP.get(q)!.intervals, center, 52, 72);
      if (voicing.length < 3) return;
      center = Math.round(voicing.reduce((a, b) => a + b, 0) / voicing.length);
      const pool = [...voicing, voicing[0]! + 12];
      const barBeat = (round * prog.steps.length + i) * beatsPerBar;
      for (let s = 0; s < beatsPerBar * 2; s++) {
        events.push({
          beat: barBeat + s * 0.5,
          dur: 0.5,
          midis: [pool[seq[s % seq.length]!]!],
          ...(s === 0
            ? { label: stepChordName(keyPc, tonality, st), bassPc: rootPc }
            : {}),
        });
      }
    });
  }
  return buildScore(events, {
    id,
    title: `${prog.name} · ${ARP_NAME[pattern]}`,
    stage: 'arp',
    keyPc,
    tonality,
    beatsPerBar,
    bpm,
    group,
  });
}

// ───────────── 曲库总装 ─────────────

function jianpuToScore(seed: SongSeed): Score {
  const parsed: ParsedSheet = parseJianpu(seed.jianpu);
  return buildScore(
    parsed.events.map((e) => ({ beat: e.beat, dur: e.dur, midis: e.midi === null ? [] : [e.midi] })),
    {
      id: seed.id,
      title: seed.title,
      stage: 'read',
      keyPc: parsed.keyPc ?? 0,
      tonality: parsed.tonality,
      beatsPerBar: parsed.beatsPerBar,
      beatUnit: parsed.beatUnit,
      bpm: parsed.bpm,
      group: seed.group,
    },
  );
}

export interface BuiltinSong {
  score: Score;
  tip: string;
}

function readSongs(): BuiltinSong[] {
  return READ_SONGS.map((seed) => {
    const score = jianpuToScore(seed);
    return { score, tip: seed.tip };
  });
}

function chordSongs(): BuiltinSong[] {
  return [
    {
      score: buildChordScore('c-canon', '卡农走向（C 大调）', PROG_MAP.get('pcanon')!, 0, 'major', '经典走向', 72),
      tip: '跟着谱面每小节按齐三和弦。低音线 C-B-A-G-F-E-F-G 一路下行再回家。',
    },
    {
      score: buildChordScore('c-1564', '经典流行（C 大调）', PROG_MAP.get('p1564')!, 0, 'major', '经典走向', 76),
      tip: 'I–V–vi–IV。弹完一轮注意情绪：明朗 → 推开 → 怀念 → 落地。',
    },
    {
      score: buildChordScore('g-1645', '黄金时代（G 大调）', PROG_MAP.get('p1645')!, 7, 'major', '经典走向', 76),
      tip: 'G 大调里 vi 是 Em。同一个走向换个调，手感和色彩都变了。',
    },
    {
      score: buildChordScore('c-4536', '华语套路（C 大调）', PROG_MAP.get('p4536')!, 0, 'major', '经典走向', 72),
      tip: 'IV–V–iii–vi：悬在半空的期待感，华语情歌的上半句。',
    },
    {
      score: buildChordScore('am-6415', '小调抒情（A 小调）', PROG_MAP.get('p6415m')!, 9, 'minor', '小调色彩', 72),
      tip: '小调版 6415：i–VI–III–VII。暗色循环，适合配圆舞曲或民谣节奏。',
    },
    {
      score: buildChordScore('c-251', '爵士归家（C 大调）', PROG_MAP.get('p251')!, 0, 'major', '小调色彩', 84),
      tip: 'ii–V–I 只有三小节一轮，张力在最后一拍落地的满足感最强。',
    },
  ];
}

function arpSongs(): BuiltinSong[] {
  return [
    {
      score: buildArpScore('arp-canon', PROG_MAP.get('pcanon')!, 'updown', 0, 'major', '卡农与流行', 76),
      tip: '上下来回型：低-中-高-中。稳住八分音符的均匀，伴奏会跟着你走。',
    },
    {
      score: buildArpScore('arp-1564', PROG_MAP.get('p1564')!, 'up', 0, 'major', '卡农与流行', 80),
      tip: '上行楼梯型：一拍一阶往上爬，到顶回到根音。试试搭配流行八拍伴奏。',
    },
    {
      score: buildArpScore('arp-4536', PROG_MAP.get('p4536')!, 'bounce', 5, 'major', '卡农与流行', 76),
      tip: 'F 大调的民谣分解。根音和五音之间的弹跳是民谣伴奏的骨架。',
    },
    {
      score: buildArpScore('arp-am', PROG_MAP.get('p6415m')!, 'alberti', 9, 'minor', '小调色彩', 72),
      tip: '阿尔贝蒂低音（低-高-中-高）是古典钢琴左手最经典的伴奏型。',
    },
    {
      score: buildArpScore('arp-251', PROG_MAP.get('p251')!, 'alberti', 0, 'major', '小调色彩', 88),
      tip: 'ii–V–I 配摇摆伴奏，三轮下来就有爵士钢琴的味道了。',
    },
  ];
}

export const BUILTIN_SONGS: Record<Stage, BuiltinSong[]> = {
  read: readSongs(),
  chord: chordSongs(),
  arp: arpSongs(),
};
