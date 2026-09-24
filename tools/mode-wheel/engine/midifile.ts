/**
 * 调式罗盘 —— 标准 MIDI 文件（SMF Type 1）编码器。
 *
 * 零依赖手写实现，只覆盖导出所需的最小集：多轨、音名轨名、速度
 * （tempo meta）、note on/off。PPQ 480。输出可直接给 a.download 或
 * 拖进任何 DAW。字节布局参考 MIDI 1.0 规范：
 *   MThd: 'MThd' + len(6) + format(1) + ntracks + division
 *   MTrk: 'MTrk' + len + (delta-time + event)* + EOT
 */

export interface MidiNote {
  /** MIDI 音高 0-127 */
  midi: number;
  /** 起拍（四分音符为单位，从 0 起） */
  beat: number;
  /** 长度（拍） */
  len: number;
  /** 力度 1-127，缺省 96 */
  vel?: number;
}

export interface MidiTrackInput {
  name: string;
  channel: number;
  notes: MidiNote[];
}

export const PPQ = 480;

/** 可变长度数量（VLQ）编码 */
export function vlq(n: number): number[] {
  const bytes = [n & 0x7f];
  n = Math.floor(n / 128);
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  return bytes;
}

function u16(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0) & 0x7f);
}

interface TimedEvent {
  tick: number;
  /** 同 tick 时的排序优先级（小在前：off < meta < on） */
  order: number;
  bytes: number[];
}

function trackChunk(events: TimedEvent[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let lastTick = 0;
  for (const ev of events) {
    body.push(...vlq(Math.max(0, ev.tick - lastTick)), ...ev.bytes);
    lastTick = ev.tick;
  }
  body.push(0x00, 0xff, 0x2f, 0x00); // End of Track
  return [...ascii('MTrk'), ...u32(body.length), ...body];
}

/**
 * 生成 SMF Type 1 文件字节。
 * 第 0 轨只放速度表（conductor track），后续轨放音符。
 */
export function writeSmf(tracks: MidiTrackInput[], bpm: number): Uint8Array {
  const chunks: number[][] = [];

  // conductor track：曲名 + tempo
  const microsecondsPerQuarter = Math.round(60_000_000 / bpm);
  chunks.push(
    trackChunk([
      { tick: 0, order: 1, bytes: [0xff, 0x03, 0x0a, ...ascii('mode-wheel')] },
      {
        tick: 0,
        order: 1,
        bytes: [
          0xff,
          0x51,
          0x03,
          (microsecondsPerQuarter >> 16) & 0xff,
          (microsecondsPerQuarter >> 8) & 0xff,
          microsecondsPerQuarter & 0xff,
        ],
      },
    ]),
  );

  for (const track of tracks) {
    const events: TimedEvent[] = [
      {
        tick: 0,
        order: 1,
        bytes: [0xff, 0x03, ...vlq(track.name.length), ...ascii(track.name)],
      },
    ];
    for (const note of track.notes) {
      const on = Math.round(note.beat * PPQ);
      const off = Math.max(on + 1, Math.round((note.beat + note.len) * PPQ));
      const vel = Math.min(127, Math.max(1, Math.round(note.vel ?? 96)));
      events.push({ tick: on, order: 2, bytes: [0x90 | (track.channel & 0x0f), note.midi, vel] });
      events.push({ tick: off, order: 0, bytes: [0x80 | (track.channel & 0x0f), note.midi, 0] });
    }
    chunks.push(trackChunk(events));
  }

  const header = [
    ...ascii('MThd'),
    ...u32(6),
    ...u16(1), // format 1
    ...u16(chunks.length),
    ...u16(PPQ),
  ];
  return Uint8Array.from([...header, ...chunks.flat()]);
}
