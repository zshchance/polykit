import { describe, expect, it } from 'vitest';

import { computeTimeline, pageAt } from './options';

describe('computeTimeline · 约束收窄', () => {
  it('常规档位不收窄', () => {
    const tl = computeTimeline({ pageDur: 4, flipDur: 0.6, enter: 'fade' }, 10);
    expect(tl).toEqual({ pages: 10, pageDur: 4, flipDur: 0.6, enterDur: 0.5, total: 40 });
  });

  it('时长收窄保持既有播放节奏（极限档）', () => {
    // pageDur=1、flipDur=1.2：翻页被收窄到 (1-0.3)/2 = 0.35
    const tl = computeTimeline({ pageDur: 1, flipDur: 1.2, enter: 'fade' }, 3);
    expect(tl.flipDur).toBeCloseTo(0.35, 6);
    // 入场 = min(0.5, 1 - 2×0.35 - 0.1) = 0.2
    expect(tl.enterDur).toBeCloseTo(0.2, 6);
    expect(2 * tl.flipDur + tl.enterDur).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('无入场动画时 enterDur = 0', () => {
    const tl = computeTimeline({ pageDur: 2, flipDur: 0.6, enter: 'none' }, 5);
    expect(tl.enterDur).toBe(0);
  });

  it('总时长 = 页数 × 每页时长；0 页安全', () => {
    expect(computeTimeline({ pageDur: 4, flipDur: 0.6, enter: 'fade' }, 0).total).toBe(0);
  });
});

describe('pageAt · 状态机', () => {
  const tl = computeTimeline({ pageDur: 4, flipDur: 0.6, enter: 'fade' }, 3);

  it('第 0 页开头：从空白翻入', () => {
    const st = pageAt(0.3, tl)!;
    expect(st.mode).toBe('flip-in');
    expect(st.page).toBe(0);
    expect(st.fromPage).toBe(-1);
    expect(st.p).toBeCloseTo(0.5, 6);
  });

  it('关闭首页翻入后首页直接呈现，文字入场从 0 秒开始', () => {
    const st = pageAt(0.3, tl, false)!;
    expect(st.mode).toBe('hold');
    expect(st.page).toBe(0);
    expect(st.enterP).toBeCloseTo(0.6, 6);
    const second = pageAt(4.1, tl, false)!;
    expect(second.mode).toBe('flip-in');
    expect(second.page).toBe(1);
  });

  it('翻页完成后进入停留段，入场从 0 渐进到 1', () => {
    const st0 = pageAt(0.61, tl)!;
    expect(st0.mode).toBe('hold');
    expect(st0.enterP).toBeCloseTo(0.02, 6);
    const st1 = pageAt(0.6 + 0.5, tl)!;
    expect(st1.enterP).toBe(1);
  });

  it('页边界处：新页从前一页翻入', () => {
    const st = pageAt(4.3, tl)!;
    expect(st.mode).toBe('flip-in');
    expect(st.page).toBe(1);
    expect(st.fromPage).toBe(0);
    expect(st.remain).toBeCloseTo(3.7, 6);
  });

  it('末页结尾保持最后一页，不插入空白页', () => {
    const total = tl.total; // 12
    const st = pageAt(total - 0.3, tl)!;
    expect(st.mode).toBe('hold');
    expect(st.page).toBe(2);
    expect(st.enterP).toBe(1);
    expect(st.remain).toBeCloseTo(0.3, 6);
  });

  it('t 超界仍停留最后一页，而不是显示空白', () => {
    const st = pageAt(999, tl)!;
    expect(st.mode).toBe('hold');
    expect(st.page).toBe(2);
    expect(st.p).toBe(1);
    expect(st.remain).toBe(0);
  });

  it('0 页返回 null', () => {
    expect(pageAt(0, computeTimeline({ pageDur: 4, flipDur: 0.6, enter: 'fade' }, 0))).toBeNull();
  });
});
