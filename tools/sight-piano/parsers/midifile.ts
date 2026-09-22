/**
 * 识谱琴房 —— 标准 MIDI 文件（SMF）零依赖解析器。
 *
 * 只提取「旋律线」需要的最小信息：
 *   MThd（PPQ）→ MTrk（VLQ delta、running status、note on/off 配对、
 *   tempo / 拍号 meta）→ 同刻多音取最高音（旋律通常在最上方）
 *   → tick 换算拍 → 量化到 1/4、1/2 或 1/4 拍网格
 * CC / 弯音 / SysEx / 歌词等全部忽略；SMPTE 时基不支持（教学 MIDI 几乎都是 PPQ）。
 */

import type { ParsedSheet } from './jianpu';

interface RawNote {
  startTick: number;
  endTick: number;
  midi: number;
}

function readVlq(view: DataView, pos: number): { value: number; next: number } {
  let value = 0;
  let p = pos;
  for (;;) {
    const b = view.getUint8(p++);
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) break;
    if (p - pos > 4) throw new Error('VLQ 过长，文件可能损坏');
  }
  return { value, next: p };
}

export function parseMidiFile(buf: ArrayBuffer): ParsedSheet {
  const view = new DataView(buf);
  const warnings: string[] = [];
  if (view.byteLength < 14 || view.getUint32(0) !== 0x4d546864) {
    throw new Error('不是有效的 MIDI 文件（缺少 MThd 头）');
  }
  const headerLen = view.getUint32(4);
  const format = view.getUint16(8);
  const ntrks = view.getUint16(10);
  const division = view.getUint16(12);
  if (division & 0x8000) throw new Error('暂不支持 SMPTE 时基的 MIDI 文件');
  const ppq = division;
  if (ppq <= 0) throw new Error('MIDI 文件 PPQ 非法');

  const notes: RawNote[] = [];
  let bpm = 100;
  let beatsPerBar = 4;
  let beatUnit = 4;
  let tempoFound = false;

  let pos = 8 + headerLen;
  for (let t = 0; t < ntrks && pos < view.byteLength - 8; t++) {
    if (view.getUint32(pos) !== 0x4d54726b) {
      // 跳过未知 chunk
      pos += 8 + view.getUint32(pos + 4);
      continue;
    }
    const trackLen = view.getUint32(pos + 4);
    let p = pos + 8;
    const trackEnd = p + trackLen;
    let tick = 0;
    let status = 0;
    const open = new Map<number, { startTick: number; midi: number }>(); // channel<<8|note

    while (p < trackEnd) {
      const delta = readVlq(view, p);
      p = delta.next;
      tick += delta.value;

      const b = view.getUint8(p);
      if (b & 0x80) {
        status = b;
        p++;
      } else if (status === 0) {
        throw new Error('running status 前缺少状态字节');
      }
      // 否则为 running status：当前字节是数据，不前进 p
      const cmd = status & 0xf0;

      if (cmd === 0x90 || cmd === 0x80) {
        const note = view.getUint8(p);
        const vel = view.getUint8(p + 1);
        p += 2;
        const key = ((status & 0x0f) << 8) | note;
        if (cmd === 0x90 && vel > 0) {
          open.set(key, { startTick: tick, midi: note });
        } else {
          const started = open.get(key);
          if (started) {
            open.delete(key);
            if (tick > started.startTick) {
              notes.push({ startTick: started.startTick, endTick: tick, midi: started.midi });
            }
          }
        }
      } else if (cmd === 0xa0 || cmd === 0xb0 || cmd === 0xe0) {
        p += 2;
      } else if (cmd === 0xc0 || cmd === 0xd0) {
        p += 1;
      } else if (status === 0xff) {
        const metaType = view.getUint8(p);
        const len = readVlq(view, p + 1);
        const dataStart = len.next;
        if (metaType === 0x51 && len.value === 3 && !tempoFound) {
          const usPerQuarter =
            (view.getUint8(dataStart) << 16) |
            (view.getUint8(dataStart + 1) << 8) |
            view.getUint8(dataStart + 2);
          bpm = Math.round(60000000 / usPerQuarter);
          tempoFound = true;
        } else if (metaType === 0x58 && len.value >= 2) {
          beatsPerBar = view.getUint8(dataStart);
          beatUnit = Math.pow(2, view.getUint8(dataStart + 1));
        } else if (metaType === 0x2f) {
          break;
        }
        p = dataStart + len.value;
      } else if (status === 0xf0 || status === 0xf7) {
        const len = readVlq(view, p);
        p = len.next + len.value;
      } else {
        throw new Error(`无法识别的 MIDI 事件 0x${status.toString(16)}`);
      }
    }
    pos = trackEnd;
  }

  if (notes.length === 0) throw new Error('MIDI 文件里没有音符事件');
  if (format > 1) warnings.push('Format 2 MIDI 已按单旋律尽力提取');

  // 旋律提取：同刻（容差 1 tick）多音取最高；同音重叠去重
  notes.sort((a, b) => a.startTick - b.startTick || a.midi - b.midi);
  const melody: RawNote[] = [];
  let i = 0;
  while (i < notes.length) {
    const groupStart = notes[i]!.startTick;
    let top = notes[i]!;
    let j = i;
    while (j < notes.length && notes[j]!.startTick <= groupStart + 1) {
      if (notes[j]!.midi > top.midi) top = notes[j]!;
      j++;
    }
    const lastMel = melody[melody.length - 1];
    if (!(lastMel && lastMel.midi === top.midi && lastMel.endTick >= top.startTick)) {
      melody.push(top);
    } else if (top.endTick > lastMel.endTick) {
      lastMel.endTick = top.endTick;
    }
    i = j;
  }

  // tick → 拍
  const raw = melody.map((n) => ({
    beat: n.startTick / ppq,
    dur: Math.max(0.05, (n.endTick - n.startTick) / ppq),
    midi: n.midi,
  }));

  // 量化网格：先试 1 拍，再 1/2、1/4，取误差可接受的最细网格
  const grid = chooseGrid(raw);
  const events = raw.map((n) => ({
    beat: Math.round(n.beat / grid) * grid,
    dur: Math.max(grid, Math.round(n.dur / grid) * grid),
    midi: n.midi,
  }));

  if (events.length > 800) throw new Error('旋律太长（超过 800 音），请截取一个段落的 MIDI');

  return {
    title: '',
    keyPc: null, // 交给判调
    tonality: 'major',
    beatsPerBar,
    beatUnit,
    bpm: Math.min(220, Math.max(40, bpm)),
    events,
    warnings,
  };
}

function chooseGrid(raw: readonly { beat: number; dur: number }[]): number {
  for (const g of [1, 0.5, 0.25]) {
    let off = 0;
    for (const n of raw) {
      const err =
        Math.abs(n.beat / g - Math.round(n.beat / g)) +
        Math.abs(n.dur / g - Math.round(n.dur / g));
      if (err > 0.08) off++;
    }
    if (off / raw.length <= 0.05) return g;
  }
  return 0.25;
}
