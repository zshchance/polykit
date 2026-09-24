import type { Register } from '../theory';

/**
 * 调式罗盘 —— Looper 步进编排仓库（不碰 DOM / Web Audio，可单测）。
 *
 * 模型：每层层是一条 loopBeats 格的格子带——一格 = 一拍。
 * 格子里放「级数 + 把位 / 旋律度数 + 八度」——不存具体 MIDI 音高，
 * 播放与导出时才在当前调式里解析，所以编排好的 loop 依然支持调式变形。
 *
 * 每格有独立的时值设置（cellTv）：<1 = 把这一拍细分成 1/tv 个音
 * （1/2 装 2 个、1/4 装 4 个，格内均分依次发声）；>=1 = 单音延音 tv 拍。
 *
 * 层分两种：和弦层（从级数调色板填三和弦，可备用和弦）与旋律层
 * （从旋律垫填单音，带八度）。每层至多 8 层，可独立静音/删除。
 */

/** 一格 = 一拍 */
export const STEPS_PER_BEAT = 1;

export type LayerKind = 'chord' | 'melody';

export interface ChordEvent {
  kind: 'chord';
  /** 级下标 0-6 */
  d: number;
  /** true = 备用和弦（如 ⅰ、ⅵ°） */
  alt?: boolean;
  register: Register;
  /** 距循环起点的拍位置（一格 = 一拍，数值上 = 格下标） */
  beat: number;
  /** 延音长度（拍），缺省按 DEFAULT_EVENT_LEN.chord */
  len?: number;
  /** 格内追加的后续和弦：长格被均分成 len/(1+extra.length) 段，首和弦仍是 d/alt */
  extra?: { d: number; alt?: boolean }[];
}

export interface MelodyEvent {
  kind: 'melody';
  /** 调式度数下标 0-6 */
  deg: number;
  /** 相对旋律基准八度的偏移（-1/0/+1） */
  octave: number;
  beat: number;
  /** 音符长度（拍） */
  len: number;
  /** 格内追加的后续音符：长格均分依次发声，首音仍是 deg/octave */
  extra?: { deg: number; octave: number }[];
}

export type LoopEvent = ChordEvent | MelodyEvent;

export interface LoopLayer {
  id: number;
  kind: LayerKind;
  name: string;
  muted: boolean;
  events: LoopEvent[];
  /** 每格时值（格下标 → tv）：<1 = 细分（容量 1/tv 个音），>=1 = 单音延音 tv 拍；缺省 1 */
  cellTv?: Record<number, number>;
}

/** 每层事件数上限（防误操作撑爆持久化） */
const MAX_EVENTS_PER_LAYER = 256;
/** 层数上限 */
const MAX_LAYERS = 8;

export const LAYER_KIND_LABEL: Record<LayerKind, string> = {
  chord: '和弦层',
  melody: '旋律层',
};

/** 事件缺省延音（拍）：一格一拍，默认占满本格 */
export const DEFAULT_EVENT_LEN: Record<LayerKind, number> = {
  chord: 1,
  melody: 1,
};

/**
 * 格内容量（个）由该格时值 tv 决定：tv < 1 = 细分，这一拍装 round(1/tv) 个音；
 * tv >= 1 = 延音，单音持续 tv 拍、容量恒 1（不引入连按交互）。
 */
export function tvCapacity(tv: number): number {
  if (tv >= 1) return 1;
  return Math.max(1, Math.round(1 / tv));
}

/** 格内最多装 16 个音（时值 1/16），追加与持久化共用此上限 */
export const MAX_SUB_PER_CELL = 16;

/** 事件内的发声次数（1 = 单发，>1 = 格内序列） */
export function subCount(ev: LoopEvent): number {
  return 1 + (ev.extra?.length ?? 0);
}

/** 把和弦事件展开成均分的发声序列（播放 / 导出 / 预听共用，位置均为绝对拍） */
export function chordStrokes(
  ev: ChordEvent,
): { at: number; len: number; d: number; alt?: boolean }[] {
  const items = [{ d: ev.d, alt: ev.alt }, ...(ev.extra ?? [])];
  const sub = (ev.len ?? DEFAULT_EVENT_LEN.chord) / items.length;
  return items.map((c, i) => ({ at: ev.beat + i * sub, len: sub, d: c.d, alt: c.alt }));
}

/** 把旋律事件展开成均分的发声序列 */
export function melodyStrokes(
  ev: MelodyEvent,
): { at: number; len: number; deg: number; octave: number }[] {
  const items = [{ deg: ev.deg, octave: ev.octave }, ...(ev.extra ?? [])];
  const sub = ev.len / items.length;
  return items.map((n, i) => ({ at: ev.beat + i * sub, len: sub, deg: n.deg, octave: n.octave }));
}

export class LooperStore {
  layers: LoopLayer[] = [];
  /** 循环长度（拍）：4 / 8 / 16 */
  loopBeats = 8;

  /** 当前循环的格子总数 */
  get totalCells(): number {
    return this.loopBeats * STEPS_PER_BEAT;
  }

  static cellOfBeat(beat: number): number {
    return Math.round(beat * STEPS_PER_BEAT);
  }

  static beatOfCell(cell: number): number {
    return cell / STEPS_PER_BEAT;
  }

  /** 发层 id：数组内最小空正整数。所有读写都按 id 命中第一层，唯一即可，删除后的空洞可复用 */
  private freshId(): number {
    const used = new Set(this.layers.map((l) => l.id));
    let id = 1;
    while (used.has(id)) id++;
    return id;
  }

  /** 新建一层并返回（达到上限时返回 null，调用方提示用户） */
  addLayer(kind: LayerKind): LoopLayer | null {
    if (this.layers.length >= MAX_LAYERS) return null;
    const layer: LoopLayer = {
      id: this.freshId(),
      kind,
      name: `${LAYER_KIND_LABEL[kind]} ${this.countKind(kind)}`,
      muted: false,
      events: [],
    };
    this.layers.push(layer);
    return layer;
  }

  /**
   * 恢复持久化的层。必须走这里而不是直接给 layers 赋值：
   * 重复/非正整数的 id（旧版直接赋值 + 内部计数器脱节会产出撞号层）统一换最小空号，
   * 保证数组内唯一，否则按 id 的查找会命中另一层——读写串层。
   */
  restoreLayers(layers: LoopLayer[]): void {
    this.layers = [];
    for (const layer of layers.slice(0, MAX_LAYERS)) {
      const keepId =
        Number.isInteger(layer.id) && layer.id > 0 && !this.layers.some((l) => l.id === layer.id);
      this.layers.push({ ...layer, id: keepId ? layer.id : this.freshId() });
    }
  }

  private countKind(kind: LayerKind): number {
    return this.layers.filter((l) => l.kind === kind).length + 1;
  }

  /** 某层某格已有的事件（无 = 空格） */
  eventAtCell(layerId: number, cell: number): LoopEvent | null {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return null;
    return layer.events.find((ev) => LooperStore.cellOfBeat(ev.beat) === cell) ?? null;
  }

  /** 读某格的时值设置（缺省 1：一格一拍一个音） */
  cellTv(layerId: number, cell: number): number {
    const layer = this.layers.find((l) => l.id === layerId);
    return layer?.cellTv?.[cell] ?? 1;
  }

  /** 设置某格时值；tv=1 时清掉记录回退缺省。越界/非法格忽略 */
  setCellTv(layerId: number, cell: number, tv: number): boolean {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer || cell < 0 || cell >= this.totalCells || !(tv > 0) || tv > 16) return false;
    layer.cellTv ??= {};
    if (tv === 1) delete layer.cellTv[cell];
    else layer.cellTv[cell] = tv;
    return true;
  }

  /**
   * 写入/清空一格：event 为 null 时清空该格。
   * 写入时会覆盖该格原事件，beat 由格下标折算，调用方不用管坐标。
   */
  setCell(layerId: number, cell: number, event: LoopEvent | null): boolean {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer || cell < 0 || cell >= this.totalCells) return false;
    layer.events = layer.events.filter((ev) => LooperStore.cellOfBeat(ev.beat) !== cell);
    if (event) {
      if (layer.events.length >= MAX_EVENTS_PER_LAYER) return false;
      layer.events.push({ ...event, beat: LooperStore.beatOfCell(cell) });
    }
    return true;
  }

  toggleMute(layerId: number): boolean {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return false;
    layer.muted = !layer.muted;
    return true;
  }

  removeLayer(layerId: number): void {
    this.layers = this.layers.filter((l) => l.id !== layerId);
  }

  clear(): void {
    this.layers = [];
  }

  /** 未静音层的事件总数（导出/播放前判空用） */
  audibleEvents(): number {
    return this.layers.reduce((acc, l) => acc + (l.muted ? 0 : l.events.length), 0);
  }

  /** 层摘要：'3 和弦 · 2 旋律' */
  static summarize(layer: LoopLayer): string {
    const chords = layer.events.filter((e) => e.kind === 'chord').length;
    const melodies = layer.events.length - chords;
    const parts: string[] = [];
    if (chords > 0) parts.push(`${chords} 和弦`);
    if (melodies > 0) parts.push(`${melodies} 旋律`);
    return parts.join(' · ') || '空';
  }
}
