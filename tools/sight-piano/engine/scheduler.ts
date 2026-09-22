/**
 * 识谱琴房 —— 节拍调度器（与节奏琶音工坊同源的 lookahead 方案）。
 *
 * setInterval 25ms 轮询 + 0.12s 前瞻排程：主线程抖动只影响排程时机，
 * 不影响已排程音频的精度。步进单位是 16 分音符（stepsPerBar 随拍号变化），
 * 播放头从音频时钟反推（currentStep），UI 用低频轮询同步高亮即可。
 *
 * 与节奏琶音工坊的差异：步数可变（3/4 拍 = 12 步）、支持全局步偏移
 * （演奏模式的谱面播放头从任意小节起步/循环整曲）。
 */

export interface SchedulerOptions {
  getContext: () => AudioContext;
  /** step：本小节内第几步（0..stepsPerBar-1）；bar：第几小节；time：音频时钟触发时刻 */
  onStep: (step: number, bar: number, time: number) => void;
}

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.12;

export class BeatScheduler {
  bpm = 96;
  stepsPerBar = 16;
  /** 16 分摇摆量 0-0.5（奇数步后拖） */
  swing = 0;

  private readonly getContext: () => AudioContext;
  private readonly onStep: (step: number, bar: number, time: number) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextStep = 0;
  private nextBar = 0;
  private nextTime = 0;
  private scheduled: { step: number; bar: number; time: number }[] = [];

  constructor(opts: SchedulerOptions) {
    this.getContext = opts.getContext;
    this.onStep = opts.onStep;
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  stepDur(): number {
    return 60 / this.bpm / 4;
  }

  start(): void {
    if (this.playing) return;
    const ctx = this.getContext();
    this.nextStep = 0;
    this.nextBar = 0;
    this.nextTime = ctx.currentTime + 0.08;
    this.scheduled = [];
    this.timer = setInterval(() => this.tick(), LOOKAHEAD_MS);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.scheduled = [];
  }

  /** 当前步（音频时钟反推）；未播放/播放头未进入排程窗口时返回 null */
  current(): { step: number; bar: number; time: number } | null {
    if (!this.playing) return null;
    const now = this.getContext().currentTime;
    for (let i = this.scheduled.length - 1; i >= 0; i--) {
      if (this.scheduled[i]!.time <= now) return this.scheduled[i]!;
    }
    return null;
  }

  private tick(): void {
    const ctx = this.getContext();
    while (this.nextTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      const time = this.swingTime(this.nextStep, this.nextTime);
      this.onStep(this.nextStep, this.nextBar, time);
      this.scheduled.push({ step: this.nextStep, bar: this.nextBar, time });
      if (this.scheduled.length > 96) this.scheduled.splice(0, this.scheduled.length - 96);
      this.nextTime += this.stepDur();
      this.nextStep++;
      if (this.nextStep >= this.stepsPerBar) {
        this.nextStep = 0;
        this.nextBar++;
      }
    }
  }

  private swingTime(step: number, time: number): number {
    return step % 2 === 1 ? time + this.swing * this.stepDur() : time;
  }
}
