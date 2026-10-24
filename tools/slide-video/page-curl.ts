/** 右下角拟物卷页：在 Canvas 2D 上对纸张背面做细分网格映射。 */
import type { Theme } from './options';

interface Pt {
  x: number;
  y: number;
}

const backCache = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function clipHalfPlane(poly: Pt[], axis: number, folded: boolean): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const da = a.x + a.y - axis;
    const db = b.x + b.y - axis;
    const ina = folded ? da >= 0 : da <= 0;
    const inb = folded ? db >= 0 : db <= 0;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

function pathPoly(ctx: CanvasRenderingContext2D, poly: Pt[], expand = 0): void {
  if (expand > 0) {
    const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    poly = poly.map((p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / d) * expand, y: p.y + (dy / d) * expand };
    });
  }
  ctx.beginPath();
  ctx.moveTo(poly[0]!.x, poly[0]!.y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i]!.x, poly[i]!.y);
  ctx.closePath();
}

function texturedTriangle(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  src: Pt[],
  dst: Pt[],
): void {
  const [a, b, c] = src;
  const [da, db, dc] = dst;
  if (!a || !b || !c || !da || !db || !dc) return;
  const denom = a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y);
  if (Math.abs(denom) < 0.001) return;
  const det = da.x * (db.y - dc.y) + db.x * (dc.y - da.y) + dc.x * (da.y - db.y);
  if (Math.abs(det) < 0.002) return;
  // 解仿射矩阵 [x y 1] → 目标三角形；源裁剪与目标共用同一映射。
  const m11 = (da.x * (b.y - c.y) + db.x * (c.y - a.y) + dc.x * (a.y - b.y)) / denom;
  const m21 = (da.x * (c.x - b.x) + db.x * (a.x - c.x) + dc.x * (b.x - a.x)) / denom;
  const dx =
    (da.x * (b.x * c.y - c.x * b.y) +
      db.x * (c.x * a.y - a.x * c.y) +
      dc.x * (a.x * b.y - b.x * a.y)) /
    denom;
  const m12 = (da.y * (b.y - c.y) + db.y * (c.y - a.y) + dc.y * (a.y - b.y)) / denom;
  const m22 = (da.y * (c.x - b.x) + db.y * (a.x - c.x) + dc.y * (b.x - a.x)) / denom;
  const dy =
    (da.y * (b.x * c.y - c.x * b.y) +
      db.y * (c.x * a.y - a.x * c.y) +
      dc.y * (a.x * b.y - b.x * a.y)) /
    denom;
  ctx.save();
  pathPoly(ctx, dst, 0.22);
  ctx.clip();
  ctx.transform(m11, m12, m21, m22, dx, dy);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
}

function paperBack(from: HTMLCanvasElement, theme: Theme): HTMLCanvasElement {
  const hit = backCache.get(from);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = from.width;
  cv.height = from.height;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = theme.light ? theme.bg[0] : '#c8c7bf';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = theme.light ? 'rgba(255,250,240,0.48)' : 'rgba(255,253,244,0.28)';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.globalAlpha = theme.light ? 0.08 : 0.07;
  ctx.drawImage(from, 0, 0);
  ctx.globalAlpha = 1;
  const g = ctx.createLinearGradient(0, 0, cv.width, cv.height);
  g.addColorStop(0, 'rgba(255,255,255,0.08)');
  g.addColorStop(0.55, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.08)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cv.width, cv.height);
  backCache.set(from, cv);
  return cv;
}

/**
 * 纸面以 x+y=axis 为动态折线，右下三角区经过弧形曲面反射到左上。
 * 不使用时间或随机数；seek、预览和录制在同一 p 得到完全相同的纸面。
 */
export function drawCornerCurl(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  p: number,
  from: HTMLCanvasElement,
  to: HTMLCanvasElement,
  theme: Theme,
): void {
  if (p <= 0.0001) {
    ctx.drawImage(from, 0, 0);
    return;
  }
  if (p >= 0.9999) {
    ctx.drawImage(to, 0, 0);
    return;
  }
  const S = Math.min(W, H);
  const envelope = Math.sin(Math.PI * p);
  // 多频但极小：像手指捻页时的轻微不稳定，接近落页时衰减为一次回弹。
  const tremor = Math.sin(p * Math.PI * 7) * envelope * S * 0.0022;
  const settle = p > 0.78 ? -Math.sin(((p - 0.78) / 0.22) * Math.PI) * S * 0.005 : 0;
  const qMax = (W + H) / Math.SQRT2;
  const q0 = qMax * (1 - p) - S * 0.29 * p + tremor + settle;
  const axis = q0 * Math.SQRT2;
  const radius = S * (0.085 + envelope * 0.055);
  const back = paperBack(from, theme);

  ctx.drawImage(to, 0, 0);
  // 折线在新页上的接触阴影，强度与掀页高度同步。
  const contact = ctx.createLinearGradient(
    axis / 2,
    axis / 2,
    axis / 2 + S * 0.13,
    axis / 2 + S * 0.13,
  );
  contact.addColorStop(0, `rgba(12,17,23,${0.25 * envelope})`);
  contact.addColorStop(1, 'rgba(12,17,23,0)');
  ctx.save();
  const exposed = clipHalfPlane(
    [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ],
    axis,
    true,
  );
  if (exposed.length >= 3) {
    pathPoly(ctx, exposed);
    ctx.clip();
  }
  ctx.fillStyle = contact;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  const flat = clipHalfPlane(
    [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ],
    axis,
    false,
  );
  if (flat.length >= 3) {
    ctx.save();
    pathPoly(ctx, flat);
    ctx.clip();
    ctx.drawImage(from, 0, 0);
    ctx.restore();
  }

  const curlPoint = (v: Pt): Pt => {
    const q = (v.x + v.y) / Math.SQRT2;
    const t = (v.x - v.y) / Math.SQRT2;
    const d = Math.max(0, q - q0);
    const bend = 1 - Math.exp(-d / radius);
    // 全程可导：折线附近完全反射，远离折线时逐渐舒展，不产生分段硬折。
    const mappedQ = q0 - d * (0.72 + 0.28 * Math.exp(-d / radius));
    const mappedT = t + bend * envelope * S * 0.018 * (t / Math.max(W, H));
    return { x: (mappedQ + mappedT) / Math.SQRT2, y: (mappedQ - mappedT) / Math.SQRT2 };
  };

  // 仅右下折叠区需要网格；左上未掀起区域仍是一张完整快照。
  const N = W * H > 1_400_000 ? 32 : 28;
  const curlSurface: Pt[][] = [];
  const dx = W / N;
  const dy = H / N;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const x0 = x * dx;
      const y0 = y * dy;
      const x1 = x === N - 1 ? W : (x + 1) * dx;
      const y1 = y === N - 1 ? H : (y + 1) * dy;
      const a = { x: x0, y: y0 };
      const b = { x: x1, y: y0 };
      const c = { x: x1, y: y1 };
      const d = { x: x0, y: y1 };
      for (const tri of [
        [a, b, c],
        [a, c, d],
      ]) {
        const folded = clipHalfPlane(tri, axis, true);
        if (folded.length < 3) continue;
        for (let i = 1; i < folded.length - 1; i++) {
          const src = [folded[0]!, folded[i]!, folded[i + 1]!];
          const mapped = src.map(curlPoint);
          texturedTriangle(ctx, back, src, mapped);
          curlSurface.push(mapped);
        }
      }
    }
  }

  // 连续圆柱光照覆盖整个曲面，避免逐三角形明暗造成阶梯感。
  if (curlSurface.length > 0) {
    ctx.save();
    ctx.beginPath();
    for (const poly of curlSurface) {
      ctx.moveTo(poly[0]!.x, poly[0]!.y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i]!.x, poly[i]!.y);
      ctx.closePath();
    }
    ctx.clip();
    const light = ctx.createLinearGradient(
      axis / 2 - radius * 1.8,
      axis / 2 - radius * 1.8,
      axis / 2 + radius * 0.7,
      axis / 2 + radius * 0.7,
    );
    light.addColorStop(0, 'rgba(20,25,30,0.2)');
    light.addColorStop(0.38, 'rgba(255,252,241,0.2)');
    light.addColorStop(0.62, 'rgba(255,252,241,0.04)');
    light.addColorStop(1, 'rgba(20,25,30,0.16)');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // 折痕的细高光只贴着纸边，不做生硬的白色粗线。
  ctx.save();
  ctx.globalAlpha = 0.18 * envelope;
  ctx.strokeStyle = theme.light ? '#fffdf4' : '#e8f0f5';
  ctx.lineWidth = Math.max(0.6, S * 0.0014);
  ctx.beginPath();
  ctx.moveTo(Math.min(W, axis), Math.max(0, axis - W));
  ctx.lineTo(Math.max(0, axis - H), Math.min(H, axis));
  ctx.stroke();
  ctx.restore();
}

/** 供单元测试验证颤动和落页回弹的端点约束。 */
export function curlMotion(p: number, S = 1000): { tremor: number; settle: number } {
  const pc = clamp01(p);
  return {
    tremor: Math.sin(pc * Math.PI * 7) * Math.sin(Math.PI * pc) * S * 0.0022,
    settle: pc > 0.78 ? -Math.sin(((pc - 0.78) / 0.22) * Math.PI) * S * 0.005 : 0,
  };
}
