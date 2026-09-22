/**
 * 步进调度器 —— 以 16 步网格为一小节循环推进。
 *
 * 用「setInterval 25ms 轮询 + 0.12s 前瞻排程」的经典方案：
 * 主线程抖动只影响排程时机，不影响已排程音频的播放精度。
 * 播放头位置从音频时钟反推（currentStep），UI 用低频率 setInterval 轮询即可
 * （不用 rAF：后台标签页 rAF 停摆，而音频调度不受影响，会造成音画脱节）。
 *
 * swing：延迟每个八分音符内的第二个 16 分步（奇数步），0-0.5。
 */
export interface SchedulerOptions {
  /** 获取 AudioContext（由 synth.ensure 提供，首次调用即初始化） */
  getContext: () => AudioContext;
  /** 每一步回调：step 0-15，time 为音频时钟上的精确触发时刻（已含 swing） */
  onStep: (step: number, time: number) => void;
}

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.12;
const STEPS_PER_BAR = 16;

export class StepScheduler {
  /** BPM 可运行中随时改，下一步即生效 */
  bpm = 120;
  /** 16 分摇摆量 0-0.5，运行中可改 */
  swing = 0;

  private readonly getContext: () => AudioContext;
  private readonly onStep: (step: number, time: number) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextStep = 0;
  private nextTime = 0;
  /** 已排程的 (step, time) 环形记录，供播放头反推；最多保留最近几十条 */
  private scheduled: { step: number; time: number }[] = [];

  constructor(opts: SchedulerOptions) {
    this.getContext = opts.getContext;
    this.onStep = opts.onStep;
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  /** 单个 16 分步的时长（秒） */
  stepDur(): number {
    return 60 / this.bpm / 4;
  }

  start(): void {
    if (this.playing) return;
    const ctx = this.getContext();
    this.nextStep = 0;
    this.nextTime = ctx.currentTime + 0.06;
    this.scheduled = [];
    this.timer = setInterval(() => this.tick(), LOOKAHEAD_MS);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.scheduled = [];
  }

  /** 当前应高亮的步（0-15）；未播放或播头已过排程窗口时返回 null */
  currentStep(): number | null {
    if (!this.playing) return null;
    const now = this.getContext().currentTime;
    for (let i = this.scheduled.length - 1; i >= 0; i--) {
      if (this.scheduled[i]!.time <= now) return this.scheduled[i]!.step;
    }
    return null;
  }

  private tick(): void {
    const ctx = this.getContext();
    while (this.nextTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      const time = this.swingTime(this.nextStep, this.nextTime);
      this.onStep(this.nextStep, time);
      this.scheduled.push({ step: this.nextStep, time });
      if (this.scheduled.length > 64) this.scheduled.splice(0, this.scheduled.length - 64);
      this.nextTime += this.stepDur();
      this.nextStep = (this.nextStep + 1) % STEPS_PER_BAR;
    }
  }

  /** 奇数步（八分音符的"后半个 16 分"）按 swing 量向后拖 */
  private swingTime(step: number, time: number): number {
    return step % 2 === 1 ? time + this.swing * this.stepDur() : time;
  }
}
