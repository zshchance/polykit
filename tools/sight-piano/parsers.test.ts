import { describe, it, expect } from 'vitest';
import { parseJianpu } from './parsers/jianpu';
import { parseAbc } from './parsers/abc';
import { parseMidiFile } from './parsers/midifile';
import { importSheet } from './parsers/index';

describe('数字简谱解析', () => {
  it('小星星：调号/拍号/速度头 + 时值序列', () => {
    const p = parseJianpu(`小星星
1=C 4/4 ♩=100
1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |`);
    expect(p.title).toBe('小星星');
    expect(p.keyPc).toBe(0);
    expect(p.beatsPerBar).toBe(4);
    expect(p.bpm).toBe(100);
    // 1 1 5 5 | 6 6 5 - = 7 个事件，两小节共 14 个
    expect(p.events.length).toBe(14);
    expect(p.events[0]).toMatchObject({ beat: 0, dur: 1, midi: 60 });
    expect(p.events[4]).toMatchObject({ beat: 4, dur: 1, midi: 69 }); // 6
    expect(p.events[6]).toMatchObject({ beat: 6, dur: 2, midi: 67 }); // 5 - 延长
  });

  it('八度/升降/减时/附点/休止', () => {
    const p = parseJianpu(`1=C
1' 1, #4 b7 1_ 1__ 1. 0`);
    expect(p.events[0]!.midi).toBe(72); // 1' 高八度
    expect(p.events[1]!.midi).toBe(48); // 1, 低八度
    expect(p.events[2]!.midi).toBe(66); // #4
    expect(p.events[3]!.midi).toBe(70); // b7
    expect(p.events[4]!.dur).toBe(0.5); // 八分
    expect(p.events[5]!.dur).toBe(0.25); // 十六分
    expect(p.events[6]!.dur).toBe(1.5); // 附点
    expect(p.events[7]!.midi).toBeNull(); // 休止
  });

  it('小节线不齐时自动吸附', () => {
    const p = parseJianpu('1=C 4/4\n1 1 1 | 2 2 |'); // 第一小节只有 3 拍
    expect(p.events[3]!.beat).toBe(4); // 吸到第 2 小节头
  });

  it('G 大调主音落位与非法输入', () => {
    const g = parseJianpu('1=G\n1 2 3');
    expect(g.keyPc).toBe(7);
    expect(g.events[0]!.midi).toBe(55); // G3（最靠近 C4 的落点，给高音留窗口）
    expect(() => parseJianpu('hello world')).toThrow();
    const warn = parseJianpu('1=C\n1 @ 2');
    expect(warn.warnings.length).toBeGreaterThan(0);
  });
});

describe('ABC 解析', () => {
  it('头部 + 音符 + 时值', () => {
    const p = parseAbc(`X:1
T:Twinkle
M:4/4
L:1/4
K:C
C C G G | A A G2 |`);
    expect(p.title).toBe('Twinkle');
    expect(p.keyPc).toBe(0);
    expect(p.beatsPerBar).toBe(4);
    expect(p.events[0]).toMatchObject({ beat: 0, dur: 1, midi: 60 }); // L:1/4 → 单位 1 拍
    expect(p.events[4]).toMatchObject({ beat: 4, dur: 1, midi: 69 });
    expect(p.events[6]).toMatchObject({ beat: 6, dur: 2, midi: 67 }); // G2 双拍
  });

  it('L:1/8 默认值、八度记号、升降号、休止与连线', () => {
    const p = parseAbc(`M:4/4
K:G
c d e/2 f/2 ^f _B z c-D |`);
    // K:G → keyPc 7；c = C5 = 72
    expect(p.keyPc).toBe(7);
    expect(p.events[0]!.midi).toBe(72);
    expect(p.events[2]!.dur).toBe(0.25); // e/2（L:1/8 单位 0.5 拍，再 /2）
    expect(p.events[4]!.midi).toBe(66 + 12); // ^f → F♯5
    expect(p.events[5]!.midi).toBe(70); // _B → B♭4（大写不加八度）
    expect(p.events[6]!.midi).toBeNull(); // z
    // 连线 c-D：D 并入前一个 c（共 8 个事件：c d e f ^f _B z c-D）
    expect(p.events.length).toBe(8);
    expect(p.events[7]!.midi).toBe(72);
    expect(p.events[7]!.dur).toBe(1); // 0.5 + 0.5 连线合并
  });

  it('小调调号', () => {
    const p = parseAbc('K:Am\nA B c');
    expect(p.keyPc).toBe(9);
    expect(p.tonality).toBe('minor');
  });
});

describe('MIDI 文件解析', () => {
  /** 手工拼一个最小 format 0 SMF：4/4，PPQ=96，tempo=120，C4 四分 + E4 四分 */
  function makeSmf(): ArrayBuffer {
    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96];
    const track = [
      0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // tempo 500000μs = 120bpm
      0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08, // 4/4
      0x00, 0x90, 60, 100, // note on C4
      0x60, 0x80, 60, 0, // +96 tick note off（四分）
      0x00, 0x90, 64, 100, // E4
      0x60, 0x80, 64, 0,
      0x00, 0xff, 0x2f, 0x00,
    ];
    const len = track.length;
    const chunk = [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255];
    return new Uint8Array([...header, ...chunk, ...track]).buffer;
  }

  it('提取旋律、换算拍、读速度与拍号', () => {
    const p = parseMidiFile(makeSmf());
    expect(p.bpm).toBe(120);
    expect(p.beatsPerBar).toBe(4);
    expect(p.events).toEqual([
      { beat: 0, dur: 1, midi: 60 },
      { beat: 1, dur: 1, midi: 64 },
    ]);
  });

  it('同刻多音取最高（旋律线）', () => {
    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96];
    const track = [
      0x00, 0x90, 48, 100, // C3（低声部）
      0x00, 0x90, 64, 100, // E4（旋律）
      0x60, 0x80, 48, 0,
      0x00, 0x80, 64, 0,
      0x00, 0xff, 0x2f, 0x00,
    ];
    const len = track.length;
    const chunk = [0x4d, 0x54, 0x72, 0x6b, 0, 0, (len >>> 8) & 255, len & 255];
    const p = parseMidiFile(new Uint8Array([...header, ...chunk, ...track]).buffer);
    expect(p.events.length).toBe(1);
    expect(p.events[0]!.midi).toBe(64);
  });

  it('坏文件报错', () => {
    expect(() => parseMidiFile(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer)).toThrow();
  });
});

describe('统一导入入口', () => {
  it('格式自动识别：ABC 指纹 vs 简谱', () => {
    const abc = importSheet({ kind: 'text', text: 'K:C\nC D E F' }, 'u1', 'read');
    expect(abc.format).toBe('ABC');
    const jp = importSheet({ kind: 'text', text: '1=C\n1 2 3 4' }, 'u2', 'read');
    expect(jp.format).toBe('简谱');
  });

  it('无调号时自动判调 + 音区居中', () => {
    // 超低音区的 C 大调音阶（C2 起）
    const res = importSheet({ kind: 'text', text: '1, 2, 3, 4, 5, 6, 7, 1' }, 'u3', 'read');
    expect(res.score.keyPc).toBe(0);
    const midis = res.score.events.flatMap((e) => e.midis);
    const median = midis[Math.floor(midis.length / 2)]!;
    expect(median).toBeGreaterThanOrEqual(58);
    expect(median).toBeLessThanOrEqual(76);
  });

  it('导入结果带拼写（可直接渲染）', () => {
    const res = importSheet({ kind: 'text', text: '1=G 4/4\n1 2 3 7' }, 'u4', 'read');
    expect(res.score.keyPc).toBe(7);
    // G 大调的 7 = F♯，拼写应是 F 线位无临时记号（调号覆盖）
    const last = res.score.events[3]!;
    expect(last.spelled[0]!.acc).toBe(0);
    expect(last.spelled[0]!.letter).toBe(3); // F
  });
});
