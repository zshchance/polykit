/**
 * 识谱琴房 —— Web MIDI 桥接（与和弦琴房同一套约定）。
 *
 * 把任意通道的 note on / note off / 延音踏板（CC64）翻译成回调。
 * 浏览器支持参差（Chrome/Edge 原生），全部状态经 onStatus 外露给指示灯，
 * 失败静默降级——没有 MIDI 设备时工具照常可用。
 */

export interface MidiCallbacks {
  onNoteOn(midi: number, velocity: number): void;
  onNoteOff(midi: number): void;
  onPedal(down: boolean): void;
  onStatus(text: string, online: boolean): void;
}

export class MidiBridge {
  private access: MIDIAccess | null = null;
  private requested = false;

  constructor(private cb: MidiCallbacks) {}

  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  async connect(): Promise<void> {
    if (!this.supported) {
      this.cb.onStatus('此浏览器不支持 MIDI', false);
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      this.cb.onStatus('MIDI 访问被拒绝', false);
      return;
    }
    this.requested = true;
    this.access.onstatechange = () => this.attach();
    this.attach();
  }

  private attach(): void {
    if (!this.access) return;
    let first: string | null = null;
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (e) => this.handle(e);
      if (!first) first = input.name ?? 'MIDI 设备';
    }
    if (first) this.cb.onStatus(`已连接 ${first}`, true);
    else this.cb.onStatus(this.requested ? '等待 MIDI 设备…' : '未连接', false);
  }

  private handle(e: MIDIMessageEvent): void {
    const data = e.data;
    if (!data || data.length < 2) return;
    const cmd = data[0]! & 0xf0;
    const note = data[1]!;
    const vel = data.length > 2 ? data[2]! : 0;
    if (cmd === 0x90 && vel > 0) {
      this.cb.onNoteOn(note, vel / 127);
    } else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) {
      this.cb.onNoteOff(note);
    } else if (cmd === 0xb0 && note === 64) {
      this.cb.onPedal(vel >= 64);
    }
  }
}
