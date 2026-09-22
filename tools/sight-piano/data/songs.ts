/**
 * 识谱琴房 —— 内置曲库总装。
 *
 * 三个阶段的曲目来源：
 *   识谱（read）  —— 旋律库（48 首策展简谱）+ 练习曲工坊（程序化训练条）
 *                    + 双手改编（arrange.ts 自动配左手的大谱表版本）
 *   和弦（chord） —— 走向素材 × 10 个调，整小节和弦块就近 voicing 连接
 *   琶音（arp）   —— 走向 × 琶音织体 × 调，八分/十六分音符流
 * 每首都带 level（1 入门 / 2 进阶 / 3 挑战），LCD 难度页签据此二级分类；
 * 分组（group）按调性自动命名，呼应视奏教学的调号爬坡路径。
 */

import { parseJianpu, type ParsedSheet } from '../parsers/jianpu';
import { buildScore, type RawEvent, type Score, type Stage } from '../score';
import {
  keyDisplayName,
  keyFifths,
  nearestVoicing,
  stepChordName,
  stepLabel,
  stepQuality,
  stepRootPc,
  QUALITY_MAP,
  TONALITY_LABEL,
  type Tonality,
} from '../theory';
import { PROGS, type ProgDef } from './progs';
import { MELODIES, MELODY_MAP, type MelodySeed } from './melodies';
import { buildEtudes, type EtudeSeed } from './etudes';
import { arrangeLeftHand, ARRANGE_LABEL, type ArrangeStyle } from './arrange';

// ───────────── 分组命名（调号爬坡：C → G/F → D/降B → 更多） ─────────────

function keyGroupName(keyPc: number, tonality: Tonality): string {
  const fifths = keyFifths(keyPc, tonality);
  const n = Math.abs(fifths);
  const acc = n === 0 ? '无升降号' : fifths > 0 ? `${n} 个升号` : `${n} 个降号`;
  return `${keyDisplayName(keyPc, tonality)} ${TONALITY_LABEL[tonality]} · ${acc}`;
}

// ───────────── 识谱：旋律 / 练习曲 / 双手 ─────────────

function jianpuToScore(
  parsed: ParsedSheet,
  opts: { id: string; title: string; level: 1 | 2 | 3; bpm?: number },
): Score {
  return buildScore(
    parsed.events.map((e) => ({ beat: e.beat, dur: e.dur, midis: e.midi === null ? [] : [e.midi] })),
    {
      id: opts.id,
      title: opts.title,
      stage: 'read',
      level: opts.level,
      keyPc: parsed.keyPc ?? 0,
      tonality: parsed.tonality,
      beatsPerBar: parsed.beatsPerBar,
      beatUnit: parsed.beatUnit,
      bpm: opts.bpm ?? parsed.bpm,
      group: keyGroupName(parsed.keyPc ?? 0, parsed.tonality),
    },
  );
}

function melodyToScore(seed: MelodySeed): Score {
  return jianpuToScore(parseJianpu(seed.jianpu), { id: seed.id, title: seed.title, level: seed.level });
}

function etudeToScore(seed: EtudeSeed): Score {
  return buildScore(
    seed.events.map((e) => ({ beat: e.beat, dur: e.dur, midis: e.midi === null ? [] : [e.midi] })),
    {
      id: seed.id,
      title: seed.title,
      stage: 'read',
      level: seed.level,
      keyPc: seed.keyPc,
      tonality: seed.tonality,
      beatsPerBar: seed.beatsPerBar,
      beatUnit: seed.beatUnit,
      bpm: seed.bpm,
      group: `练习曲 · ${keyDisplayName(seed.keyPc, seed.tonality)} ${TONALITY_LABEL[seed.tonality]}`,
    },
  );
}

/** 双手改编清单：旋律 id → 织体（whole=根音长音 L2，broken/alberti=L3） */
const TWOHAND_PLAN: Readonly<Record<string, readonly ArrangeStyle[]>> = {
  twinkle: ['whole', 'broken'],
  mary: ['whole', 'broken'],
  ode: ['whole', 'broken', 'alberti'],
  jingle: ['whole', 'broken'],
  tigers: ['whole', 'broken'],
  painter: ['whole', 'broken'],
  newyear: ['whole', 'broken'],
  london: ['whole', 'broken'],
  macdonald: ['whole'],
  rowboat: ['whole'],
  birthday: ['whole', 'broken'],
  'twinkle-f': ['whole'],
  redriver: ['whole', 'broken'],
  silentnight: ['whole', 'broken'],
  susanna: ['whole', 'broken'],
  yankee: ['broken'],
  auldlangsyne: ['broken', 'alberti'],
  wewish: ['broken'],
  minuet: ['broken', 'alberti'],
  cancan: ['broken'],
  greensleeves: ['broken', 'alberti'],
  scarborough: ['broken', 'alberti'],
  farewell: ['broken'],
  'canon-d': ['broken', 'alberti'],
  'edelweiss-bb': ['broken'],
  'moon-bb': ['alberti'],
  elise: ['alberti'],
};

const TWOHAND_TIP: Record<ArrangeStyle, string> = {
  whole: '左手登场！每小节只管按住一个低音根音，右手旋律照旧——双手的第一次分工。',
  broken: '左手 1-5-8-5 四分分解，像钟摆一样稳。先单手练熟再合手。',
  alberti: '古典钢琴的左手标配（低-高-中-高）。八分音符别抢拍，跟着节拍器走。',
};

function twoHandScore(seed: MelodySeed, style: ArrangeStyle): Score {
  const parsed = parseJianpu(seed.jianpu);
  const keyPc = parsed.keyPc ?? 0;
  const tonality = parsed.tonality;
  const beatsPerBar = parsed.beatsPerBar;
  const rh: RawEvent[] = parsed.events.map((e) => ({
    beat: e.beat,
    dur: e.dur,
    midis: e.midi === null ? [] : [e.midi],
  }));
  const last = rh[rh.length - 1];
  const totalBeats = Math.ceil(((last?.beat ?? 0) + (last?.dur ?? 0)) / beatsPerBar) * beatsPerBar;
  const lh = arrangeLeftHand(
    parsed.events.filter((e) => e.midi !== null).map((e) => ({ beat: e.beat, dur: e.dur, midi: e.midi! })),
    { keyPc, tonality, beatsPerBar, totalBeats, style },
  );
  const level: 1 | 2 | 3 = style === 'whole' ? 2 : 3;
  return buildScore([...rh, ...lh], {
    id: `${seed.id}-2h-${style}`,
    title: `${seed.title}（${ARRANGE_LABEL[style]}）`,
    stage: 'read',
    level,
    keyPc,
    tonality,
    beatsPerBar,
    beatUnit: parsed.beatUnit,
    bpm: Math.max(56, parsed.bpm - (style === 'whole' ? 8 : style === 'broken' ? 12 : 16)),
    group: `${ARRANGE_LABEL[style]} · ${keyDisplayName(keyPc, tonality)} ${TONALITY_LABEL[tonality]}`,
  });
}

// ───────────── 和弦走向：走向 × 调 ─────────────

/** 走向 → 和弦块谱面（每小节一个和弦，就近 voicing 连接，弹两轮） */
function buildChordScore(
  prog: ProgDef,
  keyPc: number,
  tonality: Tonality,
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
    id: `ch-${prog.id}-${keyPc}`,
    title: `${prog.name} · ${keyDisplayName(keyPc, tonality)} ${TONALITY_LABEL[tonality]}`,
    stage: 'chord',
    level: prog.level,
    keyPc,
    tonality,
    beatsPerBar,
    bpm,
    group: keyGroupName(keyPc, tonality),
  });
}

// ───────────── 琶音：走向 × 织体 × 调 ─────────────

type ArpPattern = 'up' | 'down' | 'updown' | 'alberti' | 'bounce' | 'swing' | 'wave' | 'run16';

const ARP_NAME: Record<ArpPattern, string> = {
  up: '上行楼梯',
  down: '下行瀑布',
  updown: '上下来回',
  alberti: '阿尔贝蒂',
  bounce: '民谣分解',
  swing: '秋千摆动',
  wave: '波浪环绕',
  run16: '十六分跑动',
};

/** 模式池：把和弦三音 + 高八度根音铺成索引序列，循环取（run16 是十六分） */
const ARP_SEQ: Record<ArpPattern, readonly number[]> = {
  up: [0, 1, 2, 3, 0, 1, 2, 3],
  down: [3, 2, 1, 0, 3, 2, 1, 0],
  updown: [0, 1, 2, 3, 2, 1, 0, 1],
  alberti: [0, 2, 1, 2, 0, 2, 1, 2],
  bounce: [0, 1, 2, 1, 3, 1, 2, 1],
  swing: [0, 3, 1, 3, 2, 3, 1, 3],
  wave: [0, 1, 3, 2, 0, 1, 3, 2],
  run16: [0, 1, 2, 3, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1],
};

/** 走向 × 琶音织体 → 音符流谱面（每小节一个和弦，弹两轮） */
function buildArpScore(
  prog: ProgDef,
  pattern: ArpPattern,
  keyPc: number,
  tonality: Tonality,
  bpm: number,
): Score {
  const beatsPerBar = 4;
  const seq = ARP_SEQ[pattern];
  const unit = pattern === 'run16' ? 0.25 : 0.5;
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
      const stepsInBar = Math.round(beatsPerBar / unit);
      for (let s = 0; s < stepsInBar; s++) {
        events.push({
          beat: barBeat + s * unit,
          dur: unit,
          midis: [pool[seq[s % seq.length]!]!],
          ...(s === 0
            ? { label: stepChordName(keyPc, tonality, st), bassPc: rootPc }
            : {}),
        });
      }
    });
  }
  return buildScore(events, {
    id: `arp-${prog.id}-${pattern}-${keyPc}`,
    title: `${prog.name} · ${ARP_NAME[pattern]}（${keyDisplayName(keyPc, tonality)}）`,
    stage: 'arp',
    level: prog.level,
    keyPc,
    tonality,
    beatsPerBar,
    bpm,
    group: `${ARP_NAME[pattern]} · ${keyDisplayName(keyPc, tonality)} ${TONALITY_LABEL[tonality]}`,
  });
}

// ───────────── 曲库总装 ─────────────

export interface BuiltinSong {
  score: Score;
  tip: string;
}

/** 大调走向的 10 个调（五度圈两侧铺开，调号逐步加码） */
const MAJOR_KEYS = [0, 7, 5, 2, 10, 9, 3, 4, 8, 1] as const;
/** 小调走向的 10 个调 */
const MINOR_KEYS = [9, 4, 2, 11, 6, 7, 0, 5, 10, 3] as const;

function readSongs(): BuiltinSong[] {
  const out: BuiltinSong[] = [];
  for (const seed of MELODIES) {
    out.push({ score: melodyToScore(seed), tip: seed.tip });
  }
  for (const seed of buildEtudes()) {
    out.push({ score: etudeToScore(seed), tip: seed.tip });
  }
  for (const [id, styles] of Object.entries(TWOHAND_PLAN)) {
    const seed = MELODY_MAP.get(id);
    if (!seed) continue;
    for (const style of styles) {
      out.push({ score: twoHandScore(seed, style), tip: TWOHAND_TIP[style] });
    }
  }
  out.sort((a, b) => (a.score.level ?? 2) - (b.score.level ?? 2));
  return out;
}

function chordSongs(): BuiltinSong[] {
  const out: BuiltinSong[] = [];
  const bpmOf = (level: number): number => (level === 1 ? 66 : level === 2 ? 76 : 88);
  for (const prog of PROGS) {
    const keys = prog.minor ? MINOR_KEYS : MAJOR_KEYS;
    const tonality: Tonality = prog.minor ? 'minor' : 'major';
    for (const keyPc of keys) {
      out.push({
        score: buildChordScore(prog, keyPc, tonality, bpmOf(prog.level)),
        tip: `${prog.desc}。跟着谱面每小节按齐三和弦，听根音（贝斯）的走向。`,
      });
    }
  }
  out.sort((a, b) => (a.score.level ?? 2) - (b.score.level ?? 2));
  return out;
}

const ARP_L1 = {
  patterns: ['up', 'down', 'updown'] as const,
  progs: ['p1564', 'p1645', 'p6415', 'p6451'],
  keys: [0, 7, 5, 2, 10] as const,
};
const ARP_L2 = {
  patterns: ['alberti', 'bounce', 'swing'] as const,
  progs: ['p4536', 'pcanon', 'p1625', 'p4365'],
  keys: [0, 7, 5, 9, 3] as const,
};
const ARP_L3_MAJOR = {
  patterns: ['wave', 'run16'] as const,
  progs: ['p4536251', 'pepic', 'pblues'],
  keys: [0, 7, 2, 9, 5] as const,
};
const ARP_L3_MINOR = {
  patterns: ['wave', 'run16'] as const,
  progs: ['pm6415', 'pm1645'],
  keys: [9, 4, 2, 11, 7] as const,
};

function arpSongs(): BuiltinSong[] {
  const out: BuiltinSong[] = [];
  const progOf = (id: string): ProgDef => PROGS.find((p) => p.id === id)!;
  for (const pattern of ARP_L1.patterns) {
    for (const pid of ARP_L1.progs) {
      for (const keyPc of ARP_L1.keys) {
        out.push({
          score: buildArpScore(progOf(pid), pattern, keyPc, 'major', 72),
          tip: `${ARP_NAME[pattern]}型八分音符。稳住均匀，伴奏会跟着你走。`,
        });
      }
    }
  }
  for (const pattern of ARP_L2.patterns) {
    for (const pid of ARP_L2.progs) {
      for (const keyPc of ARP_L2.keys) {
        out.push({
          score: buildArpScore(progOf(pid), pattern, keyPc, 'major', 80),
          tip: `${ARP_NAME[pattern]}型：先哼出 pattern 的轮廓再上手，注意和弦切换的小节线。`,
        });
      }
    }
  }
  for (const pattern of ARP_L3_MAJOR.patterns) {
    for (const pid of ARP_L3_MAJOR.progs) {
      for (const keyPc of ARP_L3_MAJOR.keys) {
        out.push({
          score: buildArpScore(progOf(pid), pattern, keyPc, 'major', pattern === 'run16' ? 64 : 92),
          tip: `${ARP_NAME[pattern]}型挑战：慢练是唯一的捷径，先跟弹再演奏。`,
        });
      }
    }
  }
  for (const pattern of ARP_L3_MINOR.patterns) {
    for (const pid of ARP_L3_MINOR.progs) {
      for (const keyPc of ARP_L3_MINOR.keys) {
        out.push({
          score: buildArpScore(progOf(pid), pattern, keyPc, 'minor', pattern === 'run16' ? 64 : 92),
          tip: `小调的${ARP_NAME[pattern]}：暗色织体，适合配圆舞曲或民谣节奏。`,
        });
      }
    }
  }
  out.sort((a, b) => (a.score.level ?? 2) - (b.score.level ?? 2));
  return out;
}

export const BUILTIN_SONGS: Record<Stage, BuiltinSong[]> = {
  read: readSongs(),
  chord: chordSongs(),
  arp: arpSongs(),
};
