/**
 * 名言卡片宽高比 —— 支持正方形 / 横版 / 竖版 / 传统比例。
 *
 * 短边固定 1080px（导出清晰度基准），长边按比例换算并取整。
 * 渲染与导出都基于这里的像素尺寸（aspect.w × aspect.h）。
 */

export type AspectId = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';

export interface Aspect {
  id: AspectId;
  /** 展示名 */
  label: string;
  /** 画板宽（px） */
  w: number;
  /** 画板高（px） */
  h: number;
}

const SHORT = 1080;

function aspect(id: AspectId, label: string, w: number, h: number): Aspect {
  return { id, label, w: Math.round(w), h: Math.round(h) };
}

/** 可选宽高比（顺序即选择器展示顺序） */
export const ASPECTS: Aspect[] = [
  aspect('1:1', '1:1 正方', SHORT, SHORT),
  aspect('16:9', '16:9 横版', SHORT, (SHORT * 9) / 16),
  aspect('9:16', '9:16 竖版', (SHORT * 9) / 16, SHORT),
  aspect('4:3', '4:3 传统', SHORT, (SHORT * 3) / 4),
  aspect('3:4', '3:4 竖版', (SHORT * 3) / 4, SHORT),
];

const DEFAULT: Aspect = ASPECTS[0]!;

/** 按 id 取宽高比，非法 id 回退 1:1 */
export function getAspect(id: string | undefined): Aspect {
  return ASPECTS.find((a) => a.id === id) ?? DEFAULT;
}

/** 判断 id 是否合法 */
export function isValidAspectId(id: unknown): id is AspectId {
  return typeof id === 'string' && ASPECTS.some((a) => a.id === id);
}
