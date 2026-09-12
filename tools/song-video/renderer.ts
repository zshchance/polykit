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

// ─────────────────────────── 歌词列表滚动状态 ───────────────────────────
// drawFrame 是纯参数驱动，但「滚动列表」需要跨帧平滑：这里保存上一帧的
// 连续行位置，向目标行做帧率无关的指数收敛（seek 后约 0.3s 收敛，观感自然）。

let listScroll = 0;

/** 重置滚动状态（换歌/seek 到明显不同位置时调用，避免长距离滑动掠过） */
export function resetListScroll(): void {
  listScroll = 0;
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
  drawLyrics(ctx, W, H, S, input, ta, dt);

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

/** 黑胶唱片式封面圆盘（盘面随唱片旋转；环形频谱在 drawVisualizer 中叠加） */
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

  ctx.save();
  // 盘底阴影
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.02, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fill();

  // 黑胶外圈
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  const vinyl = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R);
  vinyl.addColorStop(0, 'rgba(30,32,38,0.96)');
  vinyl.addColorStop(1, 'rgba(10,11,14,0.96)');
  ctx.fillStyle = vinyl;
  ctx.fill();
  // 唱片细纹
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = Math.max(1, R * 0.006);
  for (let i = 1; i <= 4; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * (0.72 + i * 0.065), 0, Math.PI * 2);
    ctx.stroke();
  }

  // 盘面内容（旋转坐标系：封面/首字随唱片转，频谱环不转）
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
  ctx.restore();

  // 中轴孔
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.045, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(12,12,14,0.95)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.045, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = Math.max(1, R * 0.01);
  ctx.stroke();
  ctx.restore();
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
    const n = bands?.length ?? 48;
    const zoneW = W * 0.78;
    const x0 = (W - zoneW) / 2;
    const baseY = H * 0.92;
    const maxH = H * 0.2;
    const gap = zoneW * 0.24 * (1 / n);
    const bw = (zoneW - gap * (n - 1)) / n;
    const grad = ctx.createLinearGradient(0, baseY - maxH, 0, baseY);
    grad.addColorStop(0, accent);
    grad.addColorStop(1, theme.light ? 'rgba(13,148,136,0.35)' : 'rgba(255,255,255,0.28)');
    ctx.fillStyle = grad;
    for (let i = 0; i < n; i++) {
      const h = Math.max(bw * 0.5, v(i) * maxH);
      roundRectPath(ctx, x0 + i * (bw + gap), baseY - h, bw, h, bw * 0.45);
      ctx.fill();
    }
    return;
  }

  if (opts.visualizer === 'mirror') {
    const n = bands?.length ?? 48;
    const zoneW = W * 0.8;
    const x0 = (W - zoneW) / 2;
    const midY = H * 0.72;
    const maxH = H * 0.13;
    const gap = zoneW * 0.22 * (1 / n);
    const bw = (zoneW - gap * (n - 1)) / n;
    // 以当前 globalAlpha 为基准（内容层淡入/淡出时随整体缩放）
    const base = ctx.globalAlpha;
    ctx.fillStyle = accent;
    for (let i = 0; i < n; i++) {
      const h = Math.max(bw * 0.4, v(i) * maxH);
      ctx.globalAlpha = base * 0.95;
      roundRectPath(ctx, x0 + i * (bw + gap), midY - h, bw, h, bw * 0.4);
      ctx.fill();
      ctx.globalAlpha = base * 0.4;
      roundRectPath(ctx, x0 + i * (bw + gap), midY + bw * 0.2, bw, h * 0.62, bw * 0.4);
      ctx.fill();
    }
    ctx.globalAlpha = base;
    return;
  }

  if (opts.visualizer === 'circle') {
    // 放射状频谱：环绕封面圆盘，内外两层（外长内短）营造节奏感
    const n = bands?.length ?? 64;
    const innerR = layout.coverR * 1.1;
    const base = ctx.globalAlpha;
    ctx.strokeStyle = accent;
    ctx.lineCap = 'round';
    ctx.lineWidth = S * 0.009;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      const len = S * 0.012 + v(i) * S * 0.075;
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
  const n = 96;
  const baseY = H * 0.78;
  const amp = H * 0.07;
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
    // 与内容层淡入/淡出叠加（globalAlpha 是替换语义，必须显式相乘）
    ctx.globalAlpha = ctx.globalAlpha * a;
    ctx.fillStyle = theme.fg;
    ctx.font = fontOf('600', S * 0.05);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = theme.light ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = S * 0.02;
    const y = H * 0.66 + (1 - easeOut(inP)) * S * 0.02;
    drawClippedText(ctx, line.text, W / 2, y, W * 0.88);
    ctx.restore();
    return;
  }

  // —— list 滚动列表 ——
  const lineH = S * 0.062;
  const target = idx < 0 ? 0 : idx;
  // 帧率无关指数收敛
  listScroll += (target - listScroll) * Math.min(1, dt * 7);
  const cy = H * 0.7;
  const visible = 7; // 上下各显示 3 行
  const listBase = ctx.globalAlpha;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = Math.floor(listScroll) - 3; i <= Math.floor(listScroll) + 3; i++) {
    if (i < 0 || i >= lyrics.length) continue;
    const line = lyrics[i];
    if (!line) continue;
    const d = i - listScroll; // 相对当前行的行距
    if (Math.abs(d) > visible / 2 + 0.5) continue;
    const active = i === idx;
    const dist = Math.min(1, Math.abs(d) / 3);
    ctx.globalAlpha = listBase * (active ? 1 : 0.55 * (1 - dist * 0.7));
    ctx.fillStyle = active ? theme.accent : theme.fg;
    ctx.font = fontOf(active ? '700' : '500', S * (active ? 0.04 : 0.032));
    ctx.fillText(line.text, W / 2, cy + d * lineH, W * 0.86);
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

  // full：胶囊 + 两端时间
  const marginX = W * 0.12;
  const barW = W - marginX * 2;
  const y = H - S * 0.085;
  const h = S * 0.013;
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
  ctx.font = fontOf('500', S * 0.024);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText(fmtTime(Math.max(0, ta)), marginX, y - S * 0.018);
  ctx.textAlign = 'right';
  ctx.fillText(fmtTime(timeline.audio), marginX + barW, y - S * 0.018);
}

/**
 * 片尾滚动字幕：文本从画面下方匀速滚入、上方滚出。
 * rollStart 起滚，保证在 outro 结束前 0.35s 滚完（时间轴已按行数预留，见 computeTimeline）。
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
  const lines = input.opts.endRollText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return;
  const rollStart = 0.45;
  const rollEnd = Math.max(rollStart + 1, input.timeline.outro - 0.35);
  if (t2 < rollStart || t2 > rollEnd + 0.2) return;

  const lineH = S * 0.062;
  const contentH = lines.length * lineH;
  // 从画面底部之外匀速滚入、顶部之外滚出（y 随时间递减 = 向上滚动）
  const dist = H + contentH;
  const yOff = H - (t2 - rollStart) * (dist / (rollEnd - rollStart));

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const y = yOff + i * lineH + lineH / 2;
    if (y < -lineH || y > H + lineH) continue;
    // 底部入口区渐入（进入画面后保持完全不透明）
    const fadeIn = clamp01((H - y) / (H * 0.15));
    ctx.globalAlpha = clamp01(Math.min(1, fadeIn));
    ctx.fillStyle = theme.fg;
    ctx.font = fontOf(i === 0 ? '700' : '400', S * (i === 0 ? 0.038 : 0.03));
    ctx.fillText(line, W / 2, y, W * 0.84);
  }
  ctx.restore();
}
