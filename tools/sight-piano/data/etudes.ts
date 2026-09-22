/**
 * 识谱琴房 —— 练习曲工坊（程序化生成的视奏训练条）。
 *
 * 视奏教学的经典做法：在真曲之间穿插「只练一个点」的短练习条——
 * 音阶、模进、分解和弦、跳进、节奏认读、随机漂流。这里全部用
 * 确定性算法生成（固定种子的 mulberry32，刷新/换机结果一致），
 * 每条练习只针对一种读谱形状，音域和节奏模板随难度爬坡。
 *
 * 排版约定：所有节奏模板都是「每小节恰好 4 个音位、合计 4 拍」，
 * 级数流按 4 个一小节切段铺上去，因此任何形状 × 任何模板都严格
 * 对齐小节线；收尾统一补一个全音符主音「回家」。
 */

import type { Tonality } from '../theory';

export interface EtudeSeed {
  id: string;
  title: string;
  level: 1 | 2 | 3;
  tip: string;
  keyPc: number;
  tonality: Tonality;
  beatsPerBar: number;
  beatUnit: number;
  bpm: number;
  events: { beat: number; dur: number; midi: number | null }[];
}

const MAJOR_OFFSETS = [0, 2, 4, 5, 7, 9, 11] as const;
const MINOR_OFFSETS = [0, 2, 3, 5, 7, 8, 10] as const;

/** 主音落点：让「1」落在中央 C 附近（与 jianpu 解析器同一约定） */
function tonicMidi(keyPc: number): number {
  let best = 60;
  let bestD = Infinity;
  for (let k = 36; k <= 84; k += 12) {
    const m = keyPc + k;
    const d = Math.abs(m - 60);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

/** 级数（可越出 0-6，负数 = 低八度方向）→ MIDI */
function degMidi(tonic: number, offsets: readonly number[], deg: number): number {
  const oct = Math.floor(deg / 7);
  const step = ((deg % 7) + 7) % 7;
  return tonic + offsets[step]! + oct * 12;
}

/** mulberry32：小小的确定性伪随机（练习条的可复现性靠它） */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────── 节奏模板：每小节 4 个音位、合计 4 拍 ─────────────
const PA = [1, 1, 1, 1] as const; // 四平八稳
const PB = [0.5, 0.5, 1, 2] as const; // 前八后长
const PC = [1.5, 0.5, 1, 1] as const; // 前附点
const PD = [1, 0.5, 0.5, 2] as const; // 中八分
const PE = [2, 1, 0.5, 0.5] as const; // 尾八分
const PF = [0.5, 1, 0.5, 2] as const; // 切分感（半拍起步）
const PG = [1, 1.5, 0.5, 1] as const; // 中附点

interface BuildOpts {
  id: string;
  title: string;
  level: 1 | 2 | 3;
  tip: string;
  keyPc: number;
  tonality?: Tonality;
  bpm: number;
}

/**
 * 级数流（长度必须是 4 的倍数）× 节奏模板序列 → 事件流，
 * 末尾自动补一个全音符主音（0 级）。
 */
function makeSeed(
  opts: BuildOpts,
  degrees: readonly number[],
  patterns: readonly (readonly number[])[],
  opts2: { finalWhole?: boolean } = {},
): EtudeSeed {
  if (degrees.length % 4 !== 0) throw new Error(`级数流不是 4 的倍数：${opts.id}`);
  const tonic = tonicMidi(opts.keyPc);
  const offsets = opts.tonality === 'minor' ? MINOR_OFFSETS : MAJOR_OFFSETS;
  const events: EtudeSeed['events'] = [];
  let beat = 0;
  for (let bar = 0; bar < degrees.length / 4; bar++) {
    const tpl = patterns[bar % patterns.length]!;
    for (let i = 0; i < 4; i++) {
      const dur = tpl[i]!;
      events.push({ beat, dur, midi: degMidi(tonic, offsets, degrees[bar * 4 + i]!) });
      beat += dur;
    }
  }
  if (opts2.finalWhole !== false) {
    events.push({ beat, dur: 4, midi: degMidi(tonic, offsets, 0) });
  }
  return {
    id: opts.id,
    title: opts.title,
    level: opts.level,
    tip: opts.tip,
    keyPc: opts.keyPc,
    tonality: opts.tonality ?? 'major',
    beatsPerBar: 4,
    beatUnit: 4,
    bpm: opts.bpm,
    events,
  };
}

// ───────────── 形状生成器（返回值都是 4 的倍数） ─────────────

/** 音阶上下行（一个八度，4 小节） */
function scale1Degs(): number[] {
  return [0, 1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1, 0];
}

/** 音阶上下行（两个八度，7 小节） */
function scale2Degs(): number[] {
  return [
    0, 1, 2, 3, 4, 5, 6, 7,
    8, 9, 10, 11, 12, 13, 14, 13,
    12, 11, 10, 9, 8, 7, 6, 5,
    4, 3, 2, 1,
  ];
}

/** 三度模进：每小节往上挪一度 */
function thirdsDegs(): number[] {
  const out: number[] = [];
  for (let i = 0; i <= 6; i++) out.push(i, i + 1, i + 2, i + 1);
  return out;
}

/** 分解三和弦：每小节一个级数的 1-3-5-3 */
function arpsDegs(): number[] {
  const out: number[] = [];
  for (let i = 0; i <= 6; i++) out.push(i, i + 2, i + 4, i + 2);
  return out;
}

/** 五声音阶波浪 */
function pentaDegs(): number[] {
  return [
    0, 1, 2, 4, 7, 4, 2, 1,
    0, 2, 4, 7, 9, 7, 4, 2,
    0, 1, 2, 4, 7, 4, 2, 1,
    0, 2, 4, 2, 1, 0, 1, 2,
  ];
}

/** 三度跳进（上下行各 4 小节） */
function leapDegs(): number[] {
  const out: number[] = [];
  for (let b = 0; b <= 3; b++) out.push(b, b + 2, b + 1, b + 3);
  for (let b = 3; b >= 0; b--) out.push(b + 3, b + 1, b + 2, b);
  return out;
}

/** 随机漂流：级进为主、偶有小跳的随机漫步（确定性种子） */
function waveDegs(seed: number, bars: number, lo: number, hi: number, leapiness: number): number[] {
  const rand = rng(seed);
  const out: number[] = [];
  let cur = Math.floor((lo + hi) / 2);
  for (let b = 0; b < bars * 4; b++) {
    out.push(cur);
    const r = rand();
    let step: number;
    if (r < 0.5 - leapiness / 2) step = 1;
    else if (r < 0.62) step = -1;
    else if (r < 0.74) step = rand() < 0.5 ? 2 : -2;
    else if (r < 0.84) step = rand() < 0.5 ? 3 : -3;
    else if (r < 0.9) step = 0;
    else step = rand() < 0.5 ? 4 : -4;
    cur += step;
    if (cur > hi) cur = hi - (cur - hi);
    if (cur < lo) cur = lo + (lo - cur);
  }
  // 收尾落在主音上，练习条也要有「回家」的感觉
  out[out.length - 1] = 0;
  return out;
}

/** 回声：两小节动机，向上三度、向下三度各模仿一次，最后回原位 */
function echoDegs(seed: number): number[] {
  const motif = waveDegs(seed, 2, 0, 7, 0.1).slice(0, 8);
  const out: number[] = [];
  for (const shift of [0, 2, -2, 0]) {
    for (const d of motif) out.push(d + shift);
  }
  out[out.length - 1] = 0;
  return out;
}

/** 节奏认读：音高只是小幅级进上下，注意力全给节奏 */
function scaleWaveDegs(bars: number): number[] {
  const out: number[] = [];
  let d = 0;
  let dir = 1;
  for (let i = 0; i < bars * 4; i++) {
    out.push(d);
    d += dir;
    if (d >= 5) dir = -1;
    if (d <= 0) dir = 1;
  }
  out[out.length - 1] = 0;
  return out;
}

/** 十六分跑动：每小节 16 个十六分音符上下行，起点逐小节上移 */
function run16Events(tonic: number, offsets: readonly number[]): EtudeSeed['events'] {
  const events: EtudeSeed['events'] = [];
  let beat = 0;
  for (let b = 0; b <= 3; b++) {
    const degs: number[] = [];
    for (let d = b; d <= b + 7; d++) degs.push(d);
    for (let d = b + 7; d >= b; d--) degs.push(d);
    for (const d of degs) {
      events.push({ beat, dur: 0.25, midi: degMidi(tonic, offsets, d) });
      beat += 0.25;
    }
  }
  events.push({ beat, dur: 4, midi: degMidi(tonic, offsets, 0) });
  return events;
}

// ───────────── 调性阵容 ─────────────
const KEYS_L1 = [
  { pc: 0, name: 'C' },
  { pc: 7, name: 'G' },
  { pc: 5, name: 'F' },
] as const;
const KEYS_L2 = [
  { pc: 2, name: 'D' },
  { pc: 10, name: 'Bb' },
  { pc: 9, name: 'A' },
  { pc: 3, name: 'Eb' },
] as const;
const KEYS_L3_MINOR = [
  { pc: 9, name: 'a' },
  { pc: 4, name: 'e' },
  { pc: 2, name: 'd' },
] as const;
const KEYS_RUN16 = [
  { pc: 0, name: 'C' },
  { pc: 7, name: 'G' },
  { pc: 2, name: 'D' },
] as const;
const KEYS_LEAP3 = [
  { pc: 4, name: 'E' },
  { pc: 10, name: 'Bb' },
] as const;

export function buildEtudes(): EtudeSeed[] {
  const out: EtudeSeed[] = [];

  // ── 入门（L1）：C/G/F，四分音符为主的单一形状 ──
  for (const k of KEYS_L1) {
    const c = { keyPc: k.pc, level: 1 as const };
    out.push(makeSeed({ ...c, bpm: 76, id: `et-scale-${k.name}`, title: '音阶上下行', tip: 'do 到 do′ 再回来。线在间、间在线，一格一格走，别数错台阶。' }, scale1Degs(), [PA]));
    out.push(makeSeed({ ...c, bpm: 76, id: `et-thirds-${k.name}`, title: '三度模进', tip: '1 2 3、2 3 4……每小节往上挪一度，认出「同一形状在平移」就快了。' }, thirdsDegs(), [PA]));
    out.push(makeSeed({ ...c, bpm: 76, id: `et-arps-${k.name}`, title: '分解三和弦', tip: '三个音全在线上（或全在间上），像排队。换和弦时整排平移。' }, arpsDegs(), [PA]));
    out.push(makeSeed({ ...c, bpm: 80, id: `et-penta-${k.name}`, title: '五声音阶', tip: '只有 do re mi sol la 五个音，中国民歌的骨架，跳进变多了。' }, pentaDegs(), [PA, PB]));
    const echo = echoDegs(40 + k.pc);
    out.push(makeSeed({ ...c, bpm: 80, id: `et-echo-${k.name}`, title: '回声练习', tip: '两小节动机，向上、向下各「回声」一次。听到重复的形状了吗？' }, echo, [PA]));
    out.push(makeSeed({ ...c, bpm: 76, id: `et-leap-${k.name}`, title: '三度跳进', tip: '1-3、2-4 的三度接力。线跳线、间跳间，手指提前张开。' }, leapDegs(), [PA]));
    out.push(makeSeed({ ...c, bpm: 84, id: `et-rhythm-${k.name}`, title: '节奏认读', tip: '音高故意简单，专心对付二分音符、附点和八分音符的第一次照面。' }, scaleWaveDegs(8), [PA, PB, PC, PD]));
  }
  for (const k of KEYS_L1) {
    for (const [vi, seed] of [11, 23].entries()) {
      out.push(makeSeed(
        { keyPc: k.pc, level: 1, bpm: 80, id: `et-wave-${k.name}-${vi + 1}`, title: `小溪漂流 ${vi + 1}`, tip: '没有歌词的旋律线：以级进为主偶尔小跳。放松，让眼睛牵着手指走。' },
        waveDegs(seed * 100 + k.pc, 8, 0, 7, 0.05),
        [PA],
      ));
    }
  }

  // ── 进阶（L2）：D/降B/A/降E，八分音符混入 ──
  for (const k of KEYS_L2) {
    const c = { keyPc: k.pc, level: 2 as const };
    out.push(makeSeed({ ...c, bpm: 88, id: `et-scale2-${k.name}`, title: '音阶上下行 · 两个八度', tip: '跨过 do′ 继续往上。加线一根一根数，别急。' }, scale2Degs(), [PA]));
    out.push(makeSeed({ ...c, bpm: 88, id: `et-thirds2-${k.name}`, title: '三度模进 · 八分混入', tip: '模进形状不变，节奏换上了前八后长的小碎步。' }, thirdsDegs(), [PB, PA]));
    out.push(makeSeed({ ...c, bpm: 88, id: `et-arps2-${k.name}`, title: '分解三和弦 · 流动版', tip: '分解和弦配上尾巴的八分音符，像水波一层层推。' }, arpsDegs(), [PE, PA]));
  }
  for (const k of [KEYS_L2[0], KEYS_L2[1], KEYS_L2[2]]) {
    out.push(makeSeed(
      { keyPc: k.pc, level: 2, bpm: 92, id: `et-wave2-${k.name}`, title: '溪流蜿蜒', tip: '跳进更频繁、节奏更多变。先哼一遍节奏再上手。' },
      waveDegs(90 + k.pc, 8, -2, 9, 0.15),
      [PD, PA, PE, PA],
    ));
    out.push(makeSeed(
      { keyPc: k.pc, level: 2, bpm: 92, id: `et-rhythm2-${k.name}`, title: '节奏认读 · 切分入门', tip: '半拍起步的音是切分的雏形：脚打拍子，音落在拍缝上。' },
      scaleWaveDegs(8),
      [PF, PD, PG, PA],
    ));
  }

  // ── 挑战（L3）：小调 + 十六分 + 大跳 ──
  for (const k of KEYS_L3_MINOR) {
    const c = { keyPc: k.pc, tonality: 'minor' as const, level: 3 as const };
    out.push(makeSeed({ ...c, bpm: 96, id: `et-scalem-${k.name}`, title: '小调音阶', tip: '小调的 3、6、7 比大调低半音，音阶颜色一下子暗下来。' }, scale2Degs(), [PA]));
    out.push(makeSeed({ ...c, bpm: 96, id: `et-thirdsm-${k.name}`, title: '小调三度模进', tip: '模进在小调里会路过减三和弦的音响，耳朵别慌。' }, thirdsDegs(), [PB, PA]));
    out.push(makeSeed({ ...c, bpm: 96, id: `et-arpsm-${k.name}`, title: '小调分解和弦', tip: '主和弦变成了小三和弦——中间那个音低半音。' }, arpsDegs(), [PE, PA]));
  }
  for (const k of KEYS_RUN16) {
    const tonic = tonicMidi(k.pc);
    out.push({
      id: `et-run16-${k.name}`,
      title: '十六分跑动',
      level: 3,
      tip: '四个音挤一拍。慢练是唯一的捷径：开 60 的节拍器先过关。',
      keyPc: k.pc,
      tonality: 'major',
      beatsPerBar: 4,
      beatUnit: 4,
      bpm: 72,
      events: run16Events(tonic, MAJOR_OFFSETS),
    });
  }
  for (const k of KEYS_LEAP3) {
    out.push(makeSeed(
      { keyPc: k.pc, level: 3, bpm: 96, id: `et-leap3-${k.name}`, title: '大跳练习', tip: '跳进加大、节奏加快。眼睛永远落在「下一个音」上。' },
      leapDegs().map((d) => d + 2),
      [PB, PD],
    ));
  }

  return out;
}
