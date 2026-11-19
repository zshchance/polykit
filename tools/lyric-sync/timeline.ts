import { h } from '@/core/components/element';
import { drawSpectrogram, type SpectrogramData, type TimeRange } from './spectrogram';

export type TimelineMode = 'range' | 'line';

export interface TimelineState {
  duration: number;
  view: TimeRange;
  selection: TimeRange | null;
  playhead: number;
  detailWindow: TimeRange | null;
  mode: TimelineMode;
}

interface TimelineEvents {
  onSeek: (time: number) => void;
  onSelectionChange: (range: TimeRange, final: boolean) => void;
}

type DragKind = 'create' | 'move' | 'start' | 'end';

interface DragState {
  kind: DragKind;
  pointerId: number;
  anchor: number;
  /** 一次手势固定使用按下时的窗口，防止局部视图跟随导致位移被重复累计。 */
  view: TimeRange;
  origin: TimeRange;
  startX: number;
  moved: boolean;
}

const MIN_RANGE = 0.02;
const HANDLE_HIT_PX = 9;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 指针位置到音频时间的唯一换算；调用方传入手势起点快照以固定缩放。 */
export function pointerTime(
  clientX: number,
  trackLeft: number,
  trackWidth: number,
  view: TimeRange,
): number {
  const fraction = trackWidth > 0 ? clamp((clientX - trackLeft) / trackWidth, 0, 1) : 0;
  return view.start + fraction * (view.end - view.start);
}

/** 在固定窗口内计算拖动结果；start/end 与移动选区都遵循音频边界。 */
export function dragRange(
  kind: DragKind,
  pointer: number,
  anchor: number,
  origin: TimeRange,
  duration: number,
): TimeRange | null {
  const { start, end } = origin;
  if (kind === 'create') {
    const next = {
      start: clamp(Math.min(anchor, pointer), 0, duration),
      end: clamp(Math.max(anchor, pointer), 0, duration),
    };
    return next.end - next.start >= MIN_RANGE ? next : null;
  }
  if (kind === 'start') return { start: clamp(pointer, 0, end - MIN_RANGE), end };
  if (kind === 'end') return { start, end: clamp(pointer, start + MIN_RANGE, duration) };
  const length = end - start;
  const nextStart = clamp(pointer - (anchor - start), 0, Math.max(0, duration - length));
  return { start: nextStart, end: nextStart + length };
}

/** 可复用的全曲/局部时间线；两种视图通过同一组回调编辑同一选区。 */
export class Timeline {
  readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly kind: 'overview' | 'detail';
  private readonly events: TimelineEvents;
  private data: SpectrogramData | null = null;
  private state: TimelineState = {
    duration: 0,
    view: { start: 0, end: 1 },
    selection: null,
    playhead: 0,
    detailWindow: null,
    mode: 'range',
  };
  private drag: DragState | null = null;
  private readonly observer: ResizeObserver;

  constructor(kind: 'overview' | 'detail', events: TimelineEvents) {
    this.kind = kind;
    this.events = events;
    this.canvas = h('canvas', {
      class: 'ls-spectrum-canvas',
      tabindex: '0',
      'aria-label':
        kind === 'overview'
          ? '全曲频谱。拖动选择时间段，拖动选区边缘调整起止时间。'
          : '局部精细频谱。与全曲频谱共享选区，可拖动手柄精确校准。',
    });
    this.el = h('div', { class: `ls-spectrum-wrap ls-spectrum-${kind}` }, [this.canvas]);

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('lostpointercapture', this.onLostCapture);
    this.canvas.addEventListener('keydown', this.onKeyDown);
    this.observer = new ResizeObserver(() => this.render());
    this.observer.observe(this.el);
  }

  setData(data: SpectrogramData | null): void {
    this.data = data;
    this.render();
  }

  update(state: TimelineState): void {
    this.state = state;
    this.render();
  }

  destroy(): void {
    this.observer.disconnect();
  }

  private timeAt(clientX: number, view = this.state.view): number {
    const rect = this.canvas.getBoundingClientRect();
    return pointerTime(clientX, rect.left, rect.width, view);
  }

  private xAt(time: number, width: number): number {
    const { start, end } = this.state.view;
    return ((time - start) / Math.max(0.000001, end - start)) * width;
  }

  private hitKind(clientX: number): DragKind | null {
    const selection = this.state.selection;
    if (!selection) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const startDistance = Math.abs(x - this.xAt(selection.start, rect.width));
    const endDistance = Math.abs(x - this.xAt(selection.end, rect.width));
    if (startDistance <= HANDLE_HIT_PX || endDistance <= HANDLE_HIT_PX) {
      return startDistance <= endDistance ? 'start' : 'end';
    }
    const time = this.timeAt(clientX);
    return time > selection.start && time < selection.end ? 'move' : null;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.data || this.state.duration <= 0) return;
    event.preventDefault();
    this.canvas.focus({ preventScroll: true });
    const hit = this.hitKind(event.clientX);
    const time = this.timeAt(event.clientX);
    const selection = this.state.selection;
    const kind = hit ?? (this.state.mode === 'range' ? 'create' : null);
    if (!kind) {
      this.drag = {
        kind: 'move',
        pointerId: event.pointerId,
        anchor: time,
        view: { ...this.state.view },
        origin: { start: time, end: time },
        startX: event.clientX,
        moved: false,
      };
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (kind !== 'create' && !selection) return;
    const origin = selection ?? { start: time, end: time };
    this.drag = {
      kind,
      pointerId: event.pointerId,
      anchor: time,
      view: { ...this.state.view },
      origin: { ...origin },
      startX: event.clientX,
      moved: false,
    };
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.classList.add('is-dragging');
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.drag) {
      const hit = this.hitKind(event.clientX);
      this.canvas.style.cursor =
        hit === 'start' || hit === 'end'
          ? 'ew-resize'
          : hit === 'move'
            ? 'grab'
            : this.state.mode === 'range'
              ? 'crosshair'
              : 'pointer';
      return;
    }
    if (event.pointerId !== this.drag.pointerId) return;
    event.preventDefault();
    const drag = this.drag;
    if (Math.abs(event.clientX - drag.startX) > 2) drag.moved = true;
    if (drag.kind === 'move' && drag.origin.start === drag.origin.end) return;

    const time = this.timeAt(event.clientX, drag.view);
    const next = dragRange(drag.kind, time, drag.anchor, drag.origin, this.state.duration);
    if (next) this.events.onSelectionChange(next, false);
  };

  private onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.drag = null;
    this.canvas.classList.remove('is-dragging');
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    if (!drag.moved && drag.kind !== 'start' && drag.kind !== 'end') {
      this.events.onSeek(clamp(this.timeAt(event.clientX), 0, this.state.duration));
    } else if (this.state.selection) {
      this.events.onSelectionChange({ ...this.state.selection }, true);
    }
  };

  private onLostCapture = (): void => {
    if (!this.drag) return;
    this.drag = null;
    this.canvas.classList.remove('is-dragging');
    if (this.state.selection) this.events.onSelectionChange({ ...this.state.selection }, true);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.data) return;
    const selection = this.state.selection;
    const step = event.shiftKey ? 0.1 : 0.01;
    if (!selection || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -step : step;
    const length = selection.end - selection.start;
    const start = clamp(selection.start + delta, 0, this.state.duration - length);
    this.events.onSelectionChange({ start, end: start + length }, true);
  };

  private render(): void {
    if (!this.data) return;
    drawSpectrogram(this.canvas, this.data, {
      viewStart: this.state.view.start,
      viewEnd: this.state.view.end,
      selection: this.state.selection,
      playhead: this.state.playhead,
      detailWindow: this.kind === 'overview' ? this.state.detailWindow : null,
    });
    this.drawHandles();
  }

  private drawHandles(): void {
    const selection = this.state.selection;
    if (!selection) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const [time, align] of [
      [selection.start, 1],
      [selection.end, -1],
    ] as const) {
      const x = this.xAt(time, rect.width);
      if (x < -12 || x > rect.width + 12) continue;
      const handleX = align === 1 ? x : x - 8;
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#6d5df6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(handleX, 7, 8, 22, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#6d5df6';
      ctx.fillRect(handleX + 3, 12, 2, 12);
    }
  }
}
