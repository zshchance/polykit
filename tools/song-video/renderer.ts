/**
 * 帧绘制引擎 —— 预览与视频录制共用的纯 canvas 绘制函数。
 *
 * 设计要点：
 *   - drawFrame(ctx, W, H, input, t, dt, bands, wave) 完全由参数驱动（无内部定时器），
 *     同一个函数既服务实时预览，也服务 MediaRecorder 录制的每一帧，保证所见即所得。
 *   - 时间轴 t 为「视频时间轴」（秒）：[0, intro) 开场段 → [intro, intro+audio) 主段 →
 *     之后结尾段。歌词/进度条/频谱统一换算到音频时间 ta = t - intro。
 *   - 所有尺寸以 S = min(W,H) 为基准的比例单位，任意宽高比/分辨率下构图一致。
 *   - 频谱数据（bands 频域 / wave 时域）由播放侧从 AnalyserNode 读取后传入，
 *     本模块不接触 AudioContext；传 null 时按静音绘制（开场段/无音频静态帧）。
 *
 * 开场/结尾动画只作用于「内容层」（封面/标题/可视化/歌词/进度条/署名），
 * 背景层（渐变+背景图）始终满幅，避免变换露边。
 */

import { findLyricIndex, type LyricLine } from './lyrics';
import type { Aspect, SongVideoOptions, Theme, Timeline } from './options';

// ─────────────────────────── 输入类型 ───────────────────────────

/** 已加载的图片资源（img 为可直接 drawImage 的来源） */
export interface ImageAsset {
  img: CanvasImageSource;
  /** 原始像素宽（计算 cover 裁剪用） */
  w: number;
  h: number;
}

export interface RenderInput {
  opts: SongVideoOptions;
  /** 主题（accent 已应用自定义覆盖色） */
  theme: Theme;
  aspect: Aspect;
  timeline: Timeline;
  /** 已解析歌词；null=无 */
  lyrics: LyricLine[] | null;
  /** 标题文本（showTitle 才绘制） */
  title: string;
  bgImage: ImageAsset | null;
  coverImage: ImageAsset | null;
}

// ─────────────────────────── 频谱分组 ───────────────────────────

/**
 * 把 Analyser 的原始频域数据按对数间隔聚合为 count 个频段（0-255）。
 * 对数分组贴合听感（低频细、高频粗）；取组内最大值让柱状更「跳」。
 * out 可复用调用方的缓冲，避免每帧分配。
 */
export function computeBands(freq: Uint8Array, count: number, out: Uint8Array): Uint8Array {
  const lo = 1; // 跳过 DC 分量
  const hi = Math.max(lo + count, Math.floor(freq.length * 0.72)); // 高频听感弱，截去顶部
  for (let i = 0; i < count; i++) {
    const a = lo + Math.floor(Math.pow(i / count, 1.6) * (hi - lo));
    const b = Math.max(a + 1, lo + Math.floor(Math.pow((i + 1) / count, 1.6) * (hi - lo)));
    let max = 0;
    for (let j = a; j < b && j < freq.length; j++) {
      if (freq[j]! > max) max = freq[j]!;
    }
    out[i] = max;
  }
  return out;
}

// ─────────────────────────── 绘制辅助 ───────────────────────────

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** cubic-out 缓动（开场入场更利落） */
const easeOut = (p: number): number => 1 - Math.pow(1 - p, 3);

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function fontOf(weight: string, size: number): string {
  return `${weight} ${size}px ui-sans-serif, system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif`;
}

/** CSS cover 语义：等比铺满 (cx, cy) 为中心的 (cw × ch) 区域后裁剪绘制 */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  asset: ImageAsset,
  x: number,
  y: number,
  cw: number,
  ch: number,
): void {
  const scale = Math.max(cw / asset.w, ch / asset.h);
  const dw = asset.w * scale;
  const dh = asset.h * scale;
  ctx.drawImage(asset.img, x + (cw - dw) / 2, y + (ch - dh) / 2, dw, dh);
}

/** 圆角矩形路径（兼容个别不支持 roundRect 的环境） */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ─────────────────────────── 歌词列表滚动动画 ───────────────────────────
// drawFrame 是纯参数驱动，但「滚动列表」需要跨帧状态：每次当前句切换时，
// 从当前位置向新目标行做一段固定时长的缓动滚动（ease-out 带轻微回弹，
// 类音乐 App 的歌单滚动），到时后稳稳定格；seek/换歌时整体复位。
// 帧率无关：以累计 dt 推进进度，预览与逐帧录制表现一致。

let listScroll = 0;
let animFrom = 0;
let animTarget = 0;
let animElapsed = Number.MAX_SAFE_INTEGER;

/** 每次歌词切换的滚动时长（秒） */
const LYRIC_SCROLL_DUR = 0.55;
/** ease-out 带轻微回弹（back-out，过冲约 6%），比纯 cubic 更有滚动惯性 */
function easeLyricScroll(p: number): number {
  const s = 1.2;
  const t = p - 1;
  return 1 + t * t * ((s + 1) * t + s);
}

/** 重置滚动动画（换歌/seek 到明显不同位置时调用，避免长距离滑动掠过） */
export function resetListScroll(): void {
  listScroll = 0;
  animFrom = 0;
  animTarget = 0;
  animElapsed = Number.MAX_SAFE_INTEGER;
}

// ─────────────────────────── 主绘制函数 ───────────────────────────

/** 封面圆盘布局（drawFrame / drawVisualizer 共用，保证环形频谱与盘面同心） */
interface Layout {
  coverCx: number;
  coverCy: number;
  coverR: number;
}

function layoutOf(W: number, H: number, S: number): Layout {
  const isPortrait = H > W;
  return {
    coverCx: W / 2,
    coverCy: H * (isPortrait ? 0.3 : 0.36),
    coverR: S * (isPortrait ? 0.24 : 0.17),
  };
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  input: RenderInput,
  t: number,
  dt: number,
  bands: Uint8Array | null,
  wave: Uint8Array | null,
): void {
  const { opts, theme, timeline } = input;
  const S = Math.min(W, H);

  // —— 时间轴换算 ——
  const ta = t - timeline.intro; // 音频时间（<0 = 开场段）
  const outroStart = timeline.intro + timeline.audio;
  const inOutro = timeline.audio > 0 && t >= outroStart;

  // —— 1. 背景层：主题渐变 + 背景图（cover）+ 压暗遮罩 ——
  const bgGrad = ctx.createLinearGradient(0, 0, W * 0.35, H);
  bgGrad.addColorStop(0, theme.bg[0]);
  bgGrad.addColorStop(1, theme.bg[1]);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  if (input.bgImage) {
    ctx.save();
    // 轻微呼吸缩放（随第一频段脉动），让背景更有生命感
    const pulse = 1 + ((bands?.[2] ?? 0) / 255) * 0.02;
    ctx.translate(W / 2, H / 2);
    ctx.scale(pulse, pulse);
    ctx.translate(-W / 2, -H / 2);
    drawImageCover(ctx, input.bgImage, -S * 0.02, -S * 0.02, W + S * 0.04, H + S * 0.04);
    ctx.restore();
    ctx.fillStyle = theme.light ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
  } else if (input.coverImage) {
    // 无背景图时：用专辑封面做毛玻璃播放背景（放大裁剪 + 高斯模糊 + 压暗）
    ctx.save();
    // 四周外扩绘制：避免模糊边缘露出底色；ctx.filter 不支持时直接铺原图（遮罩兜底）
    const supportsFilter = typeof ctx.filter === 'string';
    if (supportsFilter) ctx.filter = `blur(${Math.round(S * 0.06)}px)`;
    drawImageCover(ctx, input.coverImage, -S * 0.1, -S * 0.1, W + S * 0.2, H + S * 0.2);
    ctx.restore();
    ctx.fillStyle = theme.light ? 'rgba(255,255,255,0.42)' : 'rgba(0,0,0,0.52)';
    ctx.fillRect(0, 0, W, H);
  }

  // —— 2. 内容层入场/退场变换 ——
  let alpha = 1;
  let scale = 1;
  let shiftY = 0;
  if (timeline.intro > 0 && t < timeline.intro) {
    const p = easeOut(clamp01(t / timeline.intro));
    if (opts.introAnim === 'fade') alpha = p;
    if (opts.introAnim === 'zoom') {
      alpha = p;
      scale = 1.07 - 0.07 * p;
    }
    if (opts.introAnim === 'slide') {
      alpha = p;
      shiftY = (1 - p) * S * 0.06;
    }
  } else if (inOutro) {
    const t2 = t - outroStart;
    // 淡出固定在结尾段开头 0.8s 内完成；none 也需在滚动字幕前快速让位
    const fadeDur = opts.outroAnim === 'none' ? 0.5 : 0.8;
    const p = clamp01(t2 / fadeDur);
    if (opts.outroAnim === 'zoom') scale = 1 - 0.04 * easeOut(p);
    if (p > 0) alpha = 1 - easeOut(p);
  }

  ctx.save();
  if (alpha < 1 || scale !== 1 || shiftY !== 0) {
    ctx.globalAlpha = clamp01(alpha);
    ctx.translate(W / 2, H / 2 + shiftY);
    ctx.scale(scale, scale);
    ctx.translate(-W / 2, -H / 2);
  }

  // —— 3. 标题 ——
  if (opts.showTitle && input.title) {
    ctx.save();
    ctx.fillStyle = theme.fg;
    ctx.font = fontOf('700', S * 0.046);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = theme.light ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = S * 0.02;
    drawClippedText(ctx, input.title, W / 2, S * 0.095, W * 0.86);
    ctx.restore();
  }

  // —— 4. 发行者署名（右上角） ——
  if (opts.publisher.trim()) {
    ctx.save();
    ctx.fillStyle = theme.muted;
    ctx.font = fontOf('500', S * 0.026);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.publisher.trim().slice(0, 30), W - S * 0.05, S * 0.09);
    ctx.restore();
  }

  // —— 5. 专辑封面（黑胶圆盘）——
  const layout = layoutOf(W, H, S);
  drawCoverDisc(ctx, layout, input, t, theme);

  // —— 6. 音频可视化 ——
  drawVisualizer(ctx, W, H, S, layout, input, bands, wave);

  // —— 7. 歌词 ——
  drawLyrics(ctx, W, H, S, layout, input, ta, dt);

  // —— 8. 进度条 ——
  drawProgress(ctx, W, H, S, input, t);

  ctx.restore(); // 内容层变换结束

  // —— 9. 片尾滚动字幕（不参与内容层动画；淡入绘制在背景之上） ——
  if (inOutro && opts.endRollEnabled) {
    drawEndRoll(ctx, W, H, S, input, t - outroStart, theme);
  }
}

// ─────────────────────────── 子绘制 ───────────────────────────

/** 标题绘制：超宽自动缩字号（最多两行以内的整体缩放，不换行） */
function drawClippedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
): void {
  let size = Number(/([\d.]+)px/.exec(ctx.font)?.[1] ?? 24);
  ctx.fillText(text, x, y);
  // 简单收缩：超宽按比例缩字号重画一次
  const w = ctx.measureText(text).width;
  if (w > maxW && w > 0) {
    size = Math.max(12, size * (maxW / w));
    const weight = /^(.*?)\d+px/.exec(ctx.font)?.[1] ?? '700 ';
    ctx.font = fontOf(weight.trim() || '700', size);
    ctx.fillText(text, x, y);
  }
}

/** 黑胶唱片式封面圆盘（盘面随唱片旋转；高光/阴影固定不转，玻璃罩质感） */
function drawCoverDisc(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  input: RenderInput,
  t: number,
  theme: Theme,
): void {
  const { coverCx: cx, coverCy: cy, coverR: R } = layout;
  const spin = input.opts.coverSpin ? t * 0.9 : 0; // 唱片转速（rad/s）
  const accent = theme.accent;

  // —— a. 落地软阴影（双层：大范围柔影 + 近距实影，营造悬浮厚度） ——
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.42)';
  ctx.shadowBlur = R * 0.32;
  ctx.shadowOffsetY = R * 0.1;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = '#101114';
  ctx.fill();
  ctx.restore();

  // —— b. 胶盘主体：左上受光的径向渐变 + 边缘亮环（金属厚度感） ——
  const vinyl = ctx.createRadialGradient(
    cx - R * 0.4,
    cy - R * 0.45,
    R * 0.08,
    cx,
    cy,
    R * 1.02,
  );
  vinyl.addColorStop(0, '#33363f');
  vinyl.addColorStop(0.55, '#1a1c22');
  vinyl.addColorStop(1, '#0a0b0e');
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = vinyl;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = Math.max(1, R * 0.008);
  ctx.stroke();

  // —— 唱片细纹（同心圆，弱反射纹理） ——
  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth = Math.max(1, R * 0.005);
  for (let i = 1; i <= 4; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * (0.72 + i * 0.065), 0, Math.PI * 2);
    ctx.stroke();
  }

  // —— c. 盘面内容（旋转坐标系：封面/首字随唱片转） ——
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(spin);
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.66, 0, Math.PI * 2);
  ctx.clip();
  if (input.coverImage) {
    const d = R * 1.32;
    drawImageCover(ctx, input.coverImage, -d / 2, -d / 2, d, d);
  } else {
    // 无封面：主题渐变盘面 + 标题首字符
    const g = ctx.createLinearGradient(-R, -R, R, R);
    g.addColorStop(0, accent);
    g.addColorStop(1, theme.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(-R, -R, R * 2, R * 2);
    const ch = [...input.title.trim()][0] ?? '♪';
    ctx.fillStyle = theme.light ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.9)';
    ctx.font = fontOf('700', R * 0.62);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, 0, R * 0.04);
  }
  // 封面玻璃感：对角高光（左上亮、右下暗），模拟覆盖在封面上的弧面玻璃
  const glass = ctx.createLinearGradient(-R * 0.66, -R * 0.66, R * 0.66, R * 0.66);
  glass.addColorStop(0, 'rgba(255,255,255,0.30)');
  glass.addColorStop(0.32, 'rgba(255,255,255,0.06)');
  glass.addColorStop(0.62, 'rgba(0,0,0,0)');
  glass.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = glass;
  ctx.fillRect(-R, -R, R * 2, R * 2);
  ctx.restore();

  // 封面与胶盘交界的内缘环：外亮内暗两圈细线（凹陷层次）
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.66, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = Math.max(1, R * 0.012);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.66 + R * 0.012, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = Math.max(1, R * 0.004);
  ctx.stroke();

  // —— d. 中心金属孔：暗孔 + 双圈金属反光 ——
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.055, 0, Math.PI * 2);
  ctx.fillStyle = '#08090b';
  ctx.fill();
  const hub = ctx.createLinearGradient(cx - R * 0.06, cy - R * 0.06, cx + R * 0.06, cy + R * 0.06);
  hub.addColorStop(0, 'rgba(255,255,255,0.5)');
  hub.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  hub.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.055, 0, Math.PI * 2);
  ctx.strokeStyle = hub;
  ctx.lineWidth = Math.max(1, R * 0.012);
  ctx.stroke();

  // —— e. 整体顶部反光（固定不随唱片转：像罩在唱片上的玻璃罩受顶光） ——
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  const sheen = ctx.createLinearGradient(cx, cy - R, cx, cy + R * 0.25);
  sheen.addColorStop(0, 'rgba(255,255,255,0.13)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 1.25);
  ctx.restore();
}

/**
 * 可视化纵向几何（bars/mirror/wave 的基线与振幅），drawVisualizer 与 drawLyrics 共用。
 *
 * 竖版（9:16）的画面高度远大于宽度，若仍按 H 百分比定位会把频谱推得离歌词很远：
 * 这里竖版改为「贴底 + 以宽度 S 计量高度」，歌词带相应以唱片为锚（见 drawLyrics），
 * 保证唱片 → 歌词 → 频谱 → 进度条自上而下均匀分布、互不干涉。
 * 横版保持原构图：频谱底缘 0.92H 与胶囊进度条（0.948H）仅留一线间距。
 */
interface VisMetrics {
  /** 条形/声波的底部基线 */
  baseY: number;
  /** 条形柱最大高度 */
  maxH: number;
  /** 镜像频谱中轴 */
  midY: number;
  /** 声波振幅 */
  amp: number;
  /** 可视化顶界（ px）：滚动列表歌词可用带的下边界 */
  top: number;
}

function visMetrics(input: RenderInput, H: number, S: number): VisMetrics {
  const isPortrait = H > S;
  const list =
    input.opts.lyricMode === 'list' && !!input.lyrics && input.lyrics.length > 0;
  switch (input.opts.visualizer) {
    case 'bars': {
      const baseY = isPortrait ? H - S * 0.12 : H * 0.92;
      const maxH = S * (list ? 0.12 : 0.17);
      return { baseY, maxH, midY: 0, amp: 0, top: baseY - maxH };
    }
    case 'mirror': {
      const midY = isPortrait ? H - S * 0.115 : H * 0.83;
      const maxH = S * 0.085;
      return { baseY: 0, maxH, midY, amp: 0, top: midY - maxH };
    }
    default: {
      // wave
      const baseY = isPortrait ? H - S * (list ? 0.11 : 0.125) : H * (list ? 0.855 : 0.845);
      const amp = S * (list ? 0.045 : 0.055);
      return { baseY, maxH: 0, midY: 0, amp, top: baseY - amp };
    }
  }
}

/** 音频可视化（bars / mirror / wave / circle 环形） */
function drawVisualizer(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  S: number,
  layout: Layout,
  input: RenderInput,
  bands: Uint8Array | null,
  wave: Uint8Array | null,
): void {
  const { opts, theme } = input;
  const accent = theme.accent;
  const v = (i: number): number =>
    bands && i < bands.length ? (bands[i] ?? 0) / 255 : 0;

  if (opts.visualizer === 'bars') {
    const m = visMetrics(input, H, S);
    const n = bands?.length ?? 48;
    const zoneW = W * 0.78;
    const x0 = (W - zoneW) / 2;
    const gap = zoneW * 0.24 * (1 / n);
    const bw = (zoneW - gap * (n - 1)) / n;
    const grad = ctx.createLinearGradient(0, m.top, 0, m.baseY);
    grad.addColorStop(0, accent);
    grad.addColorStop(1, theme.light ? 'rgba(13,148,136,0.35)' : 'rgba(255,255,255,0.28)');
    ctx.fillStyle = grad;
    for (let i = 0; i < n; i++) {
      const h = Math.max(bw * 0.5, v(i) * m.maxH);
      roundRectPath(ctx, x0 + i * (bw + gap), m.baseY - h, bw, h, bw * 0.45);
      ctx.fill();
    }
    return;
  }

  if (opts.visualizer === 'mirror') {
    const m = visMetrics(input, H, S);
    const n = bands?.length ?? 48;
    const zoneW = W * 0.8;
    const x0 = (W - zoneW) / 2;
    const gap = zoneW * 0.22 * (1 / n);
    const bw = (zoneW - gap * (n - 1)) / n;
    // 以当前 globalAlpha 为基准（内容层淡入/淡出时随整体缩放）
    const base = ctx.globalAlpha;
    ctx.fillStyle = accent;
    for (let i = 0; i < n; i++) {
      const h = Math.max(bw * 0.4, v(i) * m.maxH);
      ctx.globalAlpha = base * 0.95;
      roundRectPath(ctx, x0 + i * (bw + gap), m.midY - h, bw, h, bw * 0.4);
      ctx.fill();
      ctx.globalAlpha = base * 0.4;
      roundRectPath(ctx, x0 + i * (bw + gap), m.midY + bw * 0.2, bw, h * 0.62, bw * 0.4);
      ctx.fill();
    }
    ctx.globalAlpha = base;
    return;
  }

  if (opts.visualizer === 'circle') {
    // 放射状频谱：环绕封面圆盘，内外两层（外长内短）营造节奏感。
    // 跳过正下方 ±40° 扇区：封面下沿中央让位给歌词带，避免放射线与歌词文字干涉。
    const n = bands?.length ?? 64;
    const innerR = layout.coverR * 1.1;
    const base = ctx.globalAlpha;
    ctx.strokeStyle = accent;
    ctx.lineCap = 'round';
    ctx.lineWidth = S * 0.009;
    const skip = (40 * Math.PI) / 180; // 正下方 = 90°，跳过 50°~130°
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      const down = Math.sin(ang); // >0 表示朝画面下方
      if (down > Math.sin(Math.PI / 2 - skip)) continue; // 底部扇区跳过
      const len = S * 0.012 + v(i) * S * 0.06;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      ctx.globalAlpha = base * 0.95;
      ctx.beginPath();
      ctx.moveTo(layout.coverCx + cos * innerR, layout.coverCy + sin * innerR);
      ctx.lineTo(layout.coverCx + cos * (innerR + len), layout.coverCy + sin * (innerR + len));
      ctx.stroke();
      // 内侧短倒影
      ctx.globalAlpha = base * 0.35;
      ctx.beginPath();
      ctx.moveTo(layout.coverCx + cos * (innerR - S * 0.008), layout.coverCy + sin * (innerR - S * 0.008));
      ctx.lineTo(layout.coverCx + cos * (innerR - S * 0.008 - len * 0.3), layout.coverCy + sin * (innerR - S * 0.008 - len * 0.3));
      ctx.stroke();
    }
    ctx.globalAlpha = base;
    return;
  }

  // wave：双层描边营造辉光（避免 canvas shadow 的性能开销）
  const m = visMetrics(input, H, S);
  const n = 96;
  const baseY = m.baseY;
  const amp = m.amp;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const idx = Math.floor(((wave?.length ?? n) - 1) * (i / n));
    const raw = wave ? (wave[idx] ?? 128) : 128;
    const y = baseY + ((raw - 128) / 128) * amp;
    const x = (W / n) * i;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = accent;
  const waveBase = ctx.globalAlpha;
  ctx.globalAlpha = waveBase * 0.3;
  ctx.lineWidth = S * 0.016;
  ctx.stroke();
  ctx.globalAlpha = waveBase;
  ctx.lineWidth = S * 0.005;
  ctx.stroke();
  ctx.restore();
}

/** 歌词：fade 单行淡入 / list 平滑滚动列表 */
function drawLyrics(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  S: number,
  layout: Layout,
  input: RenderInput,
  ta: number,
  dt: number,
): void {
  const { opts, theme, lyrics } = input;
  if (opts.lyricMode === 'none' || !lyrics || lyrics.length === 0) return;
  const idx = findLyricIndex(lyrics, ta);

  if (opts.lyricMode === 'fade') {
    if (idx < 0) return;
    const line = lyrics[idx];
    if (!line) return;
    // 行首 0.35s 淡入上移，行尾 0.35s 淡出
    const inP = clamp01((ta - line.start) / 0.35);
    const remain = line.end - ta;
    const outP = line.end === Infinity ? 0 : clamp01(1 - remain / 0.35);
    const a = easeOut(inP) * (1 - easeOut(outP));
    if (a <= 0.01) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = theme.light ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = S * 0.02;

    // 前一句 / 后一句（弱化小字，随当前句一起淡入淡出；跟随整体内容层 alpha）
    const layerAlpha = ctx.globalAlpha; // 内容层整体 alpha（开场/结尾动画）
    const contextAlpha = layerAlpha * a;
    // 锚定唱片下缘 + 固定间距：横版约 0.655H，竖版自动跟随唱片（避免中带出现大空隙）
    const contextY = layout.coverCy + layout.coverR + S * 0.125;
    if (opts.showPrevLyric && idx > 0) {
      const prev = lyrics[idx - 1];
      if (prev) {
        ctx.globalAlpha = contextAlpha * 0.42;
        ctx.fillStyle = theme.muted;
        ctx.font = fontOf('500', S * 0.028);
        drawClippedText(ctx, prev.text, W / 2, contextY - S * 0.05, W * 0.82);
      }
    }
    if (opts.showNextLyric && idx < lyrics.length - 1) {
      const next = lyrics[idx + 1];
      if (next) {
        ctx.globalAlpha = contextAlpha * 0.42;
        ctx.fillStyle = theme.muted;
        ctx.font = fontOf('500', S * 0.028);
        drawClippedText(ctx, next.text, W / 2, contextY + S * 0.05, W * 0.82);
      }
    }

    ctx.globalAlpha = contextAlpha;
    ctx.fillStyle = theme.fg;
    ctx.font = fontOf('600', S * 0.05);
    const y = contextY + (1 - easeOut(inP)) * S * 0.02;
    drawClippedText(ctx, line.text, W / 2, y, W * 0.88);
    ctx.restore();
    return;
  }

  // —— list 滚动列表 ——
  // 行数可配（上方 opts.lyricAbove 行 / 当前行 / 下方 opts.lyricBelow 行，默认上 1 下 3）。
  // 可用带：环形频谱模式 = 唱片下方到胶囊进度条之间的整块空白（放射线已跳过正下方
  // 扇区，上界只需避开左右两侧放射线的最低端点）；其余模式 = 唱片下缘到可视化顶界
  // （list 模式频谱自动压扁，见 visMetrics）。行高按带高自适应压缩（下限），仍放不下
  // 时距当前行最远的行自动省略。当前行基准取「块在带内居中」，上下留白均衡。
  const isPortrait = H > S;
  const isCircle = opts.visualizer === 'circle';
  const coverBottom = layout.coverCy + layout.coverR;
  let boundBottom: number;
  let boundTop: number;
  if (isCircle) {
    const progressY = H - S * (isPortrait ? 0.065 : 0.052);
    boundTop = coverBottom + S * 0.035; // 左右放射线最低端点（±50°）之下
    boundBottom = progressY - H * 0.02; // 胶囊进度条之上
  } else {
    boundBottom = visMetrics(input, H, S).top - H * 0.012;
    boundTop = coverBottom + S * 0.03;
  }
  const n = opts.lyricAbove + 1 + opts.lyricBelow;
  const lineH = Math.max(S * 0.03, Math.min(S * 0.048, (boundBottom - boundTop) / n));
  // —— 句间切换滚动动画：目标行变化时从当前位置缓动滚向新目标（带轻微回弹） ——
  const target = idx < 0 ? 0 : idx;
  if (target !== animTarget) {
    animFrom = listScroll;
    animTarget = target;
    animElapsed = 0;
  }
  if (animElapsed < LYRIC_SCROLL_DUR) {
    animElapsed += dt;
    const p = clamp01(animElapsed / LYRIC_SCROLL_DUR);
    listScroll = animFrom + (animTarget - animFrom) * easeLyricScroll(p);
  } else {
    listScroll = animTarget;
  }
  // 当前行基准：整块在带内居中（上留白 = 下留白），并保证上/下方行各自有位
  let curY =
    boundTop + opts.lyricAbove * lineH + (boundBottom - boundTop - (n - 1) * lineH) / 2;
  curY = Math.min(curY, boundBottom - opts.lyricBelow * lineH);
  curY = Math.max(curY, boundTop + opts.lyricAbove * lineH);
  curY = Math.min(Math.max(curY, boundTop), boundBottom);
  const listBase = ctx.globalAlpha;
  // 可用带裁剪 + 双重渐隐：行从带边缘/配置窗口边缘平滑滑入滑出。
  // 修复「切换瞬间闪现一行」：此前绘制圈比配置窗口多一行余量，行进入可见区
  // 只靠硬性 y 阈值瞬时出现/消失（回弹过冲时尤其明显），无裁剪无渐变。
  const clipTop = boundTop - lineH * 0.55;
  const clipH = boundBottom - boundTop + lineH * 1.1;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, clipTop, W, clipH);
  ctx.clip();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const from = Math.max(0, Math.floor(listScroll) - opts.lyricAbove - 1);
  const to = Math.min(lyrics.length - 1, Math.ceil(listScroll) + opts.lyricBelow + 1);
  for (let i = from; i <= to; i++) {
    const line = lyrics[i];
    if (!line) continue;
    const d = i - listScroll; // 相对当前行的连续行距
    // 行位置锚定连续滚动位置 listScroll（而非整数 idx）：切换动画期间整块
    // 随缓动插值平移，滚到位后各行恰好落在 curY 上/下方的整数行槽位上
    const y = curY + d * lineH;
    if (i !== idx && (y < clipTop - lineH * 0.1 || y > clipTop + clipH + lineH * 0.1)) continue;
    // 带边缘渐隐：贴近可用带边缘的行淡出（配合裁剪 = 滑入滑出，不空降）
    const edgeFade = Math.min(
      clamp01((y - clipTop) / (lineH * 0.95)),
      clamp01((clipTop + clipH - y) / (lineH * 0.95)),
    );
    // 窗口渐隐：超出「上 above / 下 below」配置窗口的行（动画余量扫过的边缘行）渐隐至 0
    const winFade = Math.min(
      clamp01(d + opts.lyricAbove + 0.5),
      clamp01(opts.lyricBelow + 0.5 - d),
    );
    const active = i === idx;
    const dist = Math.min(1, Math.abs(d) / (opts.lyricAbove + opts.lyricBelow + 1));
    ctx.globalAlpha =
      listBase * (active ? 1 : 0.55 * (1 - dist * 0.7)) * edgeFade * winFade;
    ctx.fillStyle = active ? theme.accent : theme.fg;
    ctx.font = fontOf(active ? '700' : '500', S * (active ? 0.038 : 0.03));
    ctx.fillText(line.text, W / 2, y, W * 0.86);
  }
  ctx.restore();
}

/** 进度条：line 细线 / full 胶囊+时间（进度只随音频推进；开场 0%，结尾保持满格） */
function drawProgress(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  S: number,
  input: RenderInput,
  t: number,
): void {
  const { opts, timeline } = input;
  const accent = input.theme.accent;
  if (opts.progressBar === 'none' || timeline.audio <= 0) return;
  const ta = t - timeline.intro;
  const p = clamp01(ta / timeline.audio);

  if (opts.progressBar === 'line') {
    const y = H - S * 0.014;
    ctx.fillStyle = 'rgba(128,128,128,0.28)';
    ctx.fillRect(0, y, W, S * 0.007);
    ctx.fillStyle = accent;
    ctx.fillRect(0, y, W * p, S * 0.007);
    return;
  }

  // full：胶囊条紧贴可视化的下方（横版仅留一线间距，竖版按宽度计量间距），时间文字放条下方
  const isPortrait = H > S;
  const marginX = W * 0.12;
  const barW = W - marginX * 2;
  const y = H - S * (isPortrait ? 0.065 : 0.052);
  const h = S * 0.012;
  ctx.fillStyle = 'rgba(128,128,128,0.3)';
  roundRectPath(ctx, marginX, y, barW, h, h / 2);
  ctx.fill();
  if (p > 0.001) {
    ctx.fillStyle = accent;
    roundRectPath(ctx, marginX, y, Math.max(h, barW * p), h, h / 2);
    ctx.fill();
    // 播放头
    ctx.beginPath();
    ctx.arc(marginX + barW * p, y + h / 2, h * 0.85, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(200,200,200,0.85)';
  ctx.font = fontOf('500', S * 0.02);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText(fmtTime(Math.max(0, ta)), marginX, y + h + S * 0.024);
  ctx.textAlign = 'right';
  ctx.fillText(fmtTime(timeline.audio), marginX + barW, y + h + S * 0.024);
}

/**
 * 片尾字幕。三种显示方式（opts.endRollMode）：
 *   roll  整块从画面下方滚入；endRollStopCenter 开启且内容不超过一屏时，
 *         滚到「块中心与屏幕正中央对齐」后停住定格到结尾，否则贯穿滚出（原行为）
 *   fade  内容按每屏行数分页，每屏淡入 → 停留 → 淡出
 *   cut   内容分屏直接切换，无动画
 * endFreeze 开启（默认）时最终字幕状态保持显示到视频最后一帧：
 *   滚动停在中央的块、淡入淡出/无动画的最后一屏都不再消失；贯穿滚出无定格意义。
 * 关闭时维持原行为——结尾段结束前约 0.35s 字幕消失。
 * 时间轴已按显示方式预留时长（computeTimeline），节奏参数与其保持一致。
 */
function drawEndRoll(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  S: number,
  input: RenderInput,
  t2: number,
  theme: Theme,
): void {
  const { opts } = input;
  const lines = opts.endRollText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return;
  const lineH = S * 0.045;
  const regionTop = H * 0.15;
  const regionBottom = H * 0.88;
  const perScreen = Math.max(1, Math.floor((regionBottom - regionTop) / lineH));

  const rollStart = 0.45;
  const rollEnd = Math.max(rollStart + 1, input.timeline.outro - 0.35);
  const span = rollEnd - rollStart;
  // 结束定格：开启时字幕的最终状态（停在中央 / 最后一屏）保持显示到视频最后一帧；
  // 关闭时维持原行为——结尾段结束前约 0.35s 字幕消失（滚出/淡出后以空白收尾）。
  const freeze = opts.endFreeze;
  if (t2 < rollStart) return;
  if (!freeze && t2 > rollEnd + 0.2) return;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  /** 画一行（首行加粗放大，作为字幕标题） */
  const drawLine = (text: string, y: number, i: number, alpha: number): void => {
    if (y < -lineH || y > H + lineH) return;
    ctx.globalAlpha = clamp01(alpha);
    ctx.fillStyle = theme.fg;
    ctx.font = fontOf(i === 0 ? '700' : '400', S * (i === 0 ? 0.038 : 0.03));
    ctx.fillText(text, W / 2, y, W * 0.84);
  };

  if (opts.endRollMode === 'roll') {
    const contentH = lines.length * lineH;
    const stopCenter = opts.endRollStopCenter && contentH <= regionBottom - regionTop;
    if (stopCenter) {
      // 滚到「块中心 = 屏幕正中央」后停住定格；ease-out 收尾更从容
      const startCY = H + contentH / 2;
      const cy = startCY + (H / 2 - startCY) * easeOut(clamp01((t2 - rollStart) / span));
      lines.forEach((line, i) => drawLine(line, cy - contentH / 2 + i * lineH + lineH / 2, i, 1));
    } else {
      // 贯穿滚动：从画面底部之外匀速滚入、顶部之外滚出（y 随时间递减）
      const dist = H + contentH;
      const yOff = H - ((t2 - rollStart) * dist) / span;
      lines.forEach((line, i) => {
        const y = yOff + i * lineH + lineH / 2;
        // 底部入口区渐入（进入画面后保持完全不透明）
        const fadeIn = clamp01((H - y) / (H * 0.15));
        drawLine(line, y, i, fadeIn);
      });
    }
    ctx.restore();
    return;
  }

  // —— fade / cut：分屏显示 ——
  const pages = Math.max(1, Math.ceil(lines.length / perScreen));
  const pageDur = span / pages;
  const pageIdx = Math.min(pages - 1, Math.floor((t2 - rollStart) / pageDur));
  const pp = (t2 - rollStart - pageIdx * pageDur) / pageDur;
  const pageLines = lines.slice(pageIdx * perScreen, (pageIdx + 1) * perScreen);
  // 屏号角标（多屏时提示进度，如 2/3）
  const pageBadge = pages > 1 ? `${pageIdx + 1} / ${pages}` : '';

  let alpha = 1;
  if (opts.endRollMode === 'fade') {
    // 每屏前后 18% 时长淡入淡出；定格开启时最后一屏淡入后保持，不再淡出
    const lastPage = pageIdx >= pages - 1;
    const fadeOut = lastPage && freeze ? 1 : clamp01((1 - pp) / 0.18);
    alpha = Math.min(easeOut(clamp01(pp / 0.18)), fadeOut);
  }
  const contentH = pageLines.length * lineH;
  const startY = (regionTop + regionBottom) / 2 - contentH / 2 + lineH / 2;
  pageLines.forEach((line, i) => drawLine(line, startY + i * lineH, i, alpha));
  if (pageBadge) {
    ctx.globalAlpha = alpha * 0.5;
    ctx.fillStyle = theme.muted;
    ctx.font = fontOf('400', S * 0.022);
    ctx.fillText(pageBadge, W / 2, regionBottom + lineH * 0.8);
  }
  ctx.restore();
}
