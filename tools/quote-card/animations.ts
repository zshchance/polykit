/**
 * 名言卡片入场动画效果（Web Animations API 驱动）。
 *
 * 用 WAAPI 而非纯 CSS keyframes 的原因：
 *   - 视频导出需要精确控制时间轴（pause + 设 currentTime），WAAPI 的 Animation 对象可直接操控；
 *     纯 CSS animation 无法被 JS 精确 scrub。
 *   - 每个效果 build() 返回一个 Animation，主预览正常播放，视频导出时复用/重建并实时录制。
 *
 * 效果统一时长 ~2.4s（视频长度稳定），fill:'both'。
 * 文字类效果（逐字/打字机）会把文本拆成单字 span 以便逐字错峰。
 */

import type { QuoteData } from './templates/types';

export type AnimId = 'fade' | 'zoom' | 'slide-up' | 'typewriter' | 'typing' | 'blur';

export interface AnimEffect {
  id: AnimId;
  /** 展示名 */
  name: string;
  /**
   * 在 content 容器上构建动画并返回 Animation 对象。
   * @param content 卡片内容层（模板已渲染完毕）
   * @param quote 当前名言（逐字类效果需要文本）
   */
  build: (content: HTMLElement, quote: QuoteData) => Animation;
}

/** 统一动画时长（ms）—— 视频长度稳定 */
export const ANIM_DURATION = 2400;

/** prefers-reduced-motion 时用极短 fade（几乎瞬时），避免不适 */
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const dur = () => (reduced() ? 1 : ANIM_DURATION);

/** 通用整块效果（fade/zoom/slide/blur）的构建器 */
function blockEffect(
  content: HTMLElement,
  keyframes: Keyframe[],
): Animation {
  return content.animate(keyframes, {
    duration: dur(),
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    fill: 'both',
  });
}

/**
 * 逐字显现：把 content 内所有文本节点拆成单字 span，按顺序错峰 opacity。
 * 打字机（typing）在此基础上追加闪烁光标。
 *
 * 实现注意：先快照所有文本节点（避免遍历中修改 DOM 破坏迭代），
 * 再统一替换；并对每个字符 span 用 animation-delay 错峰（单个 WAAPI 动画
 * 作用于 content 整体的 opacity 不适用，故逐 span 动画，但限制总字符数防卡顿）。
 */
function perCharEffect(content: HTMLElement, withCursor: boolean): Animation {
  // 1. 先快照所有非空文本节点（不在此过程中改 DOM，避免 TreeWalker 失稳）
  const textNodes: { parent: Node; node: Text }[] = [];
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.textContent && n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  let tn: Text | null;
  while ((tn = walker.nextNode() as Text | null)) {
    textNodes.push({ parent: tn.parentNode!, node: tn });
  }

  // 2. 把每个文本节点替换为「逐字 span」序列，收集所有字符 span（保持文档顺序）
  const charSpans: HTMLElement[] = [];
  for (const { parent, node } of textNodes) {
    const chars = Array.from(node.textContent ?? '');
    for (const ch of chars) {
      const s = document.createElement('span');
      s.textContent = ch;
      s.style.opacity = '0';
      charSpans.push(s);
      parent.insertBefore(s, node);
    }
    parent.removeChild(node);
  }

  // 3. 打字机：在 content 末尾追加闪烁光标
  let cursor: HTMLElement | null = null;
  if (withCursor) {
    cursor = document.createElement('span');
    cursor.textContent = '▍';
    cursor.style.display = 'inline-block';
    cursor.style.marginLeft = '0.1em';
    cursor.style.opacity = '0';
    cursor.style.animation = 'qc-cursor-blink 0.7s steps(1) infinite';
    content.appendChild(cursor);
  }

  const all = cursor ? [...charSpans, cursor] : charSpans;
  if (all.length === 0) {
    // 无文本可拆，回退淡入
    return blockEffect(content, [{ opacity: 0 }, { opacity: 1 }]);
  }

  if (reduced()) {
    all.forEach((s) => (s.style.opacity = '1'));
    return content.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 1, fill: 'both' });
  }

  // 4. 每字错峰：用单个 animation-delay 实现（每个 span 一个动画，delay 按序递增）。
  //    为防超长文本卡顿，封顶参与动画的字符数（多余的与最后一位同时显现）。
  const MAX_CHARS = 80;
  const participating = all.slice(0, MAX_CHARS);
  const perCharDuration = ANIM_DURATION * 0.82;
  const step = participating.length > 1 ? perCharDuration / (participating.length - 1) : 0;
  const eachDur = Math.max(120, step * 2); // 单字显现持续时长

  const subAnims: Animation[] = participating.map((s, i) =>
    s.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: eachDur,
      delay: i * step,
      easing: 'ease-out',
      fill: 'forwards',
    }),
  );
  // 超出封顶的字符：在参与段结束时统一显现（避免超长文本卡顿）
  if (all.length > MAX_CHARS) {
    const overflowDelay = perCharDuration;
    for (const s of all.slice(MAX_CHARS)) {
      subAnims.push(
        s.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 200,
          delay: overflowDelay,
          fill: 'forwards',
        }),
      );
    }
  }

  // 5. 占位 controller：对外暴露统一的 currentTime / finish 控制（视频录制按它判定结束）
  const controller = content.animate([{ opacity: 1 }, { opacity: 1 }], {
    duration: ANIM_DURATION,
    fill: 'both',
  });
  controller.addEventListener('finish', () => subAnims.forEach((a) => a.cancel()));
  return controller;
}

/** 动画效果注册表（顺序即选择器展示顺序） */
export const ANIMATIONS: AnimEffect[] = [
  {
    id: 'fade',
    name: '淡入',
    build: (c) => blockEffect(c, [{ opacity: 0 }, { opacity: 1 }]),
  },
  {
    id: 'zoom',
    name: '缩放',
    build: (c) =>
      blockEffect(c, [
        { opacity: 0, transform: 'scale(0.92)' },
        { opacity: 1, transform: 'scale(1)' },
      ]),
  },
  {
    id: 'slide-up',
    name: '上滑',
    build: (c) =>
      blockEffect(c, [
        { opacity: 0, transform: 'translateY(24px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ]),
  },
  {
    id: 'blur',
    name: '模糊聚焦',
    build: (c) =>
      blockEffect(c, [
        { opacity: 0, filter: 'blur(14px)' },
        { opacity: 1, filter: 'blur(0)' },
      ]),
  },
  {
    id: 'typewriter',
    name: '逐字',
    build: (c) => perCharEffect(c, false),
  },
  {
    id: 'typing',
    name: '打字机',
    build: (c) => perCharEffect(c, true),
  },
];

const DEFAULT: AnimEffect = ANIMATIONS[0]!;

/** 按 id 取效果，非法 id 回退淡入 */
export function getAnimation(id: string | undefined): AnimEffect {
  return ANIMATIONS.find((a) => a.id === id) ?? DEFAULT;
}

/** 判断 id 是否合法 */
export function isValidAnimId(id: unknown): id is AnimId {
  return typeof id === 'string' && ANIMATIONS.some((a) => a.id === id);
}

/**
 * 视频导出用：在 content 上构建一个「从头播放」的可控动画并返回。
 * 与预览 build 行为一致，但调用方可 pause()/play()/监听 finish。
 */
export function buildForExport(effect: AnimEffect, content: HTMLElement, quote: QuoteData): Animation {
  return effect.build(content, quote);
}
