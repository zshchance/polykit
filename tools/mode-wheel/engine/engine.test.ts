import { describe, it, expect } from 'vitest';
import {
  LooperStore,
  tvCapacity,
  subCount,
  chordStrokes,
  melodyStrokes,
  type LoopEvent,
} from './looper';
import { writeSmf, vlq, PPQ } from './midifile';

describe('LooperStore（步进编排）', () => {
  it('格子与拍位置互算（节拍网格：一格 = 一拍）', () => {
    expect(LooperStore.beatOfCell(0)).toBe(0);
    expect(LooperStore.beatOfCell(3)).toBe(3);
    expect(LooperStore.cellOfBeat(3)).toBe(3);
    const store = new LooperStore();
    store.loopBeats = 4;
    expect(store.totalCells).toBe(4);
    store.loopBeats = 16;
    expect(store.totalCells).toBe(16);
  });

  it('建层：kind 命名与上限', () => {
    const store = new LooperStore();
    const c1 = store.addLayer('chord')!;
    const m1 = store.addLayer('melody')!;
    const c2 = store.addLayer('chord')!;
    expect([c1.name, m1.name, c2.name]).toEqual(['和弦层 1', '旋律层 1', '和弦层 2']);
    for (let i = 0; i < 5; i++) store.addLayer('chord');
    expect(store.addLayer('chord')).toBeNull();
  });

  it('setCell 写入/覆盖/清空，eventAtCell 读取', () => {
    const store = new LooperStore();
    store.loopBeats = 4;
    const layer = store.addLayer('chord')!;

    expect(store.eventAtCell(layer.id, 0)).toBeNull();
    expect(store.setCell(layer.id, 0, { kind: 'chord', d: 0, register: 'low', beat: 0 })).toBe(
      true,
    );
    expect(store.eventAtCell(layer.id, 0)).toMatchObject({ kind: 'chord', d: 0, beat: 0 });

    // 同格再写 = 覆盖（不会堆两个事件）
    expect(
      store.setCell(layer.id, 0, { kind: 'chord', d: 3, alt: true, register: 'high', beat: 0 }),
    ).toBe(true);
    expect(layer.events).toHaveLength(1);
    expect(store.eventAtCell(layer.id, 0)).toMatchObject({ d: 3, alt: true });

    // beat 由格子折算，调用方传什么都会被归一
    store.setCell(layer.id, 3, { kind: 'chord', d: 1, register: 'low', beat: 99 });
    expect(store.eventAtCell(layer.id, 3)?.beat).toBe(3);

    // 清空
    expect(store.setCell(layer.id, 0, null)).toBe(true);
    expect(store.eventAtCell(layer.id, 0)).toBeNull();

    // 越界格
    expect(store.setCell(layer.id, 4, { kind: 'chord', d: 0, register: 'low', beat: 0 })).toBe(
      false,
    );
  });

  it('静音/删除/清空与可听事件计数', () => {
    const store = new LooperStore();
    const l1 = store.addLayer('chord')!;
    const l2 = store.addLayer('melody')!;
    store.setCell(l1.id, 0, { kind: 'chord', d: 0, register: 'low', beat: 0 });
    store.setCell(l2.id, 2, { kind: 'melody', deg: 2, octave: 0, beat: 0, len: 0.5 });
    expect(store.audibleEvents()).toBe(2);

    store.toggleMute(l1.id);
    expect(store.audibleEvents()).toBe(1);

    store.removeLayer(l1.id);
    expect(store.layers).toHaveLength(1);
    store.clear();
    expect(store.layers).toHaveLength(0);
  });

  it('层摘要', () => {
    const layer = {
      id: 1,
      kind: 'chord' as const,
      name: '和弦层 1',
      muted: false,
      events: [] as LoopEvent[],
    };
    expect(LooperStore.summarize(layer)).toBe('空');
    layer.events.push({ kind: 'chord', d: 0, register: 'low', beat: 0 });
    layer.events.push({ kind: 'melody', deg: 1, octave: 0, beat: 0.5, len: 0.5 });
    expect(LooperStore.summarize(layer)).toBe('1 和弦 · 1 旋律');
  });

  it('层 id 唯一：删后再建、恢复后再建都不撞号（撞号会串层读写）', () => {
    const store = new LooperStore();
    const c1 = store.addLayer('chord')!;
    store.addLayer('melody')!;
    store.removeLayer(c1.id);
    const m2 = store.addLayer('melody')!;
    // 删除后的空洞可复用，但数组内必须唯一
    expect(new Set(store.layers.map((l) => l.id)).size).toBe(store.layers.length);
    expect(m2.id).not.toBe(2);

    // 模拟刷新页面：持久化的层恢复进来后再建层，不得与旧层撞号
    const restored = new LooperStore();
    restored.restoreLayers(store.layers);
    const added = restored.addLayer('chord')!;
    expect(restored.layers.filter((l) => l.id === added.id)).toHaveLength(1);
  });

  it('restoreLayers：重复/非法 id 重排为最小空号', () => {
    const store = new LooperStore();
    store.restoreLayers([
      { id: 1, kind: 'chord', name: '和弦层 1', muted: false, events: [] },
      { id: 1, kind: 'melody', name: '旋律层 1', muted: false, events: [] },
      { id: -3, kind: 'chord', name: '和弦层 2', muted: false, events: [] },
    ]);
    expect(store.layers.map((l) => l.id)).toEqual([1, 2, 3]);
    // 重排后按 id 写入互不串层
    const [a, b] = store.layers;
    store.setCell(a!.id, 0, { kind: 'chord', d: 0, register: 'low', beat: 0 });
    expect(store.eventAtCell(b!.id, 0)).toBeNull();
  });
});

describe('格内序列（时值语义：一格一拍，<1 细分 / >=1 延音）', () => {
  it('容量由格时值决定：tv<1 细分装 1/tv 个，tv>=1 延音恒 1', () => {
    expect(tvCapacity(1)).toBe(1);
    expect(tvCapacity(1 / 2)).toBe(2);
    expect(tvCapacity(1 / 4)).toBe(4);
    expect(tvCapacity(1 / 8)).toBe(8);
    expect(tvCapacity(1 / 16)).toBe(16);
    // 延音档（2拍/4拍）不引入连按交互，容量恒 1
    expect(tvCapacity(2)).toBe(1);
    expect(tvCapacity(4)).toBe(1);
  });

  it('每格时值独立：setCellTv 读写、tv=1 回退缺省、越界忽略', () => {
    const store = new LooperStore();
    const layer = store.addLayer('melody')!;
    store.setCellTv(layer.id, 2, 1 / 2);
    store.setCellTv(layer.id, 5, 4);
    expect(store.cellTv(layer.id, 2)).toBe(0.5);
    expect(store.cellTv(layer.id, 5)).toBe(4);
    // 点其他格子不影响：未设置的格永远回缺省 1
    expect(store.cellTv(layer.id, 3)).toBe(1);
    store.setCellTv(layer.id, 2, 1);
    expect(store.cellTv(layer.id, 2)).toBe(1);
    expect(layer.cellTv?.[2]).toBeUndefined();
    expect(store.setCellTv(layer.id, -1, 1 / 2)).toBe(false);
    expect(store.setCellTv(layer.id, 999, 1 / 2)).toBe(false);
  });

  it('细分格均分这一拍：首音 + extra 依次发声（len=1 拍）', () => {
    const ev = {
      kind: 'melody' as const,
      deg: 0,
      octave: 0,
      beat: 2,
      len: 1,
      extra: [
        { deg: 2, octave: 0 },
        { deg: 4, octave: 1 },
        { deg: 1, octave: -1 },
      ],
    };
    expect(subCount(ev)).toBe(4);
    expect(melodyStrokes(ev)).toEqual([
      { at: 2, len: 0.25, deg: 0, octave: 0 },
      { at: 2.25, len: 0.25, deg: 2, octave: 0 },
      { at: 2.5, len: 0.25, deg: 4, octave: 1 },
      { at: 2.75, len: 0.25, deg: 1, octave: -1 },
    ]);
  });

  it('延音格单发持续 len 拍；细分和弦格一拍内均分', () => {
    expect(chordStrokes({ kind: 'chord', d: 0, register: 'low', beat: 0, len: 4 })).toEqual([
      { at: 0, len: 4, d: 0, alt: undefined },
    ]);
    const seq = chordStrokes({
      kind: 'chord',
      d: 0,
      register: 'high',
      beat: 1,
      len: 1,
      extra: [{ d: 3, alt: true }],
    });
    expect(seq).toEqual([
      { at: 1, len: 0.5, d: 0, alt: undefined },
      { at: 1.5, len: 0.5, d: 3, alt: true },
    ]);
  });
});

describe('MIDI 编码', () => {
  it('VLQ 边界值', () => {
    expect(vlq(0)).toEqual([0]);
    expect(vlq(127)).toEqual([0x7f]);
    expect(vlq(128)).toEqual([0x81, 0x00]);
    expect(vlq(480)).toEqual([0x83, 0x60]);
    expect(vlq(8192)).toEqual([0xc0, 0x00]);
  });

  it('文件头：MThd + format 1 + 轨数 + PPQ', () => {
    const bytes = writeSmf([{ name: 'chords', channel: 0, notes: [] }], 120);
    const head = [...bytes.slice(0, 14)];
    expect(head).toEqual([
      0x4d,
      0x54,
      0x68,
      0x64, // 'MThd'
      0,
      0,
      0,
      6, // header len
      0,
      1, // format 1
      0,
      2, // 2 轨（conductor + chords）
      PPQ >> 8,
      PPQ & 0xff,
    ]);
  });

  it('conductor 轨含 tempo meta（120BPM = 500000µs/拍）', () => {
    const bytes = [...writeSmf([{ name: 'chords', channel: 0, notes: [] }], 120)];
    // FF 51 03 07 A1 24
    const idx = bytes.findIndex(
      (b, i) => b === 0xff && bytes[i + 1] === 0x51 && bytes[i + 2] === 0x03,
    );
    expect(idx).toBeGreaterThan(0);
    expect(bytes.slice(idx + 3, idx + 6)).toEqual([0x07, 0xa1, 0x20]);
  });

  it('单个音符的事件字节流：on@0、off 带 VLQ delta、同 tick 先 off 后 on', () => {
    const bytes = [
      ...writeSmf(
        [{ name: 'piano', channel: 0, notes: [{ midi: 60, beat: 0, len: 1, vel: 96 }] }],
        120,
      ),
    ];
    const on = bytes.findIndex((b, i) => b === 0x90 && bytes[i + 1] === 60);
    expect(on).toBeGreaterThan(0);
    expect(bytes[on - 1]).toBe(0); // delta 0
    expect(bytes[on + 2]).toBe(96); // 力度
    // note off：delta 480 = 83 60，然后 80 3C 00
    const off = bytes.findIndex((b, i) => b === 0x80 && bytes[i + 1] === 60);
    expect(off).toBeGreaterThan(on);
    expect(bytes[off - 2]).toBe(0x83);
    expect(bytes[off - 1]).toBe(0x60);
    // 轨尾必须有 End of Track
    expect(bytes.slice(-4)).toEqual([0x00, 0xff, 0x2f, 0x00]);
  });

  it('多音符排序：乱序输入按 tick 输出', () => {
    const bytes = [
      ...writeSmf(
        [
          {
            name: 't',
            channel: 1,
            notes: [
              { midi: 64, beat: 2, len: 0.5 },
              { midi: 60, beat: 0, len: 0.5 },
            ],
          },
        ],
        96,
      ),
    ];
    const onC = bytes.findIndex((b, i) => b === 0x91 && bytes[i + 1] === 60);
    const onE = bytes.findIndex((b, i) => b === 0x91 && bytes[i + 1] === 64);
    expect(onC).toBeGreaterThan(0);
    expect(onE).toBeGreaterThan(onC);
    // E 的 delta = (2-0.5)*480 = 720 = 0x85 0x50（在 C 的 off 之后）
    expect(bytes[onE - 2]).toBe(0x85);
    expect(bytes[onE - 1]).toBe(0x50);
  });
});
