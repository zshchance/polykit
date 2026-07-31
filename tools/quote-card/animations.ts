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

export type AnimId =
  | 'fade'
  | 'zoom'
  | 'slide-up'
  | 'typewriter'
  | 'typing'
  | 'blur'
  | 'glint-char'
  | 'glitch'
  | 'rotate-in'
  | 'bounce';

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
 * 把 content 内所有文本节点拆成单字 span（保持文档顺序），返回所有字符 span。
 * 供逐字类动画（typewriter / 炫光逐字）共用。
 *
 * 实现注意：先快照所有文本节点（避免遍历中修改 DOM 破坏迭代），再统一替换。
 * 每个 span 初始 opacity:0，由调用方按各自效果错峰显现。
 */
function splitIntoCharSpans(content: HTMLElement): HTMLElement[] {
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
  return charSpans;
}

/**
 * 逐字错峰动画通用构建器（炫光逐字 / 故障 / 旋转 / 弹跳共用）。
 *
 * 把 content 内文本拆成单字 span，对每个 span 按序播放给定 keyframes，
 * delay 递增错峰，fill:forwards 保持终态。单字 span 设为 inline-block 让
 * transform 生效（换行行为同 inline，不影响排版）。超长文本封顶 80 字防卡顿，
 * 溢出字符在参与段结束时统一淡入。
 *
 * 返回占位 controller：对外暴露统一的 currentTime / finish 控制，视频录制按它
 * 判定结束；不在 finish 时取消子动画（否则字符消失回初态）。
 *
 * @param perCharKeyframes 每字动画关键帧（终态 opacity 需为 1，否则字符消失）
 * @param eachDurMin 单字动画持续时长下限（ms）；实际取 max(下限, step×2)
 * @param easing 单字动画缓动
 */
function staggerPerChar(
  content: HTMLElement,
  perCharKeyframes: Keyframe[],
  eachDurMin: number,
  easing: string = 'ease-out',
): Animation {
  const charSpans = splitIntoCharSpans(content);
  charSpans.forEach((s) => (s.style.display = 'inline-block'));

  if (charSpans.length === 0) {
    return blockEffect(content, [{ opacity: 0 }, { opacity: 1 }]);
  }
  if (reduced()) {
    charSpans.forEach((s) => (s.style.opacity = '1'));
    return content.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 1, fill: 'both' });
  }

  const MAX_CHARS = 80;
  const participating = charSpans.slice(0, MAX_CHARS);
  const perCharDuration = ANIM_DURATION * 0.82;
  const step = participating.length > 1 ? perCharDuration / (participating.length - 1) : 0;
  const eachDur = Math.max(eachDurMin, step * 2);

  participating.forEach((s, i) =>
    s.animate(perCharKeyframes, {
      duration: eachDur,
      delay: i * step,
      easing,
      fill: 'forwards',
      iterations: 1,
    }),
  );
  // 超出封顶的字符：在参与段结束时统一淡入（避免超长文本卡顿）
  if (charSpans.length > MAX_CHARS) {
    const overflowDelay = perCharDuration;
    for (const s of charSpans.slice(MAX_CHARS)) {
      s.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 200,
        delay: overflowDelay,
        fill: 'forwards',
        iterations: 1,
      });
    }
  }

  return content.animate([{ opacity: 1 }, { opacity: 1 }], {
    duration: ANIM_DURATION,
    fill: 'forwards',
    iterations: 1,
  });
}

/**
 * 逐字显现：把 content 内所有文本节点拆成单字 span，按顺序错峰 opacity。
 * 打字机（typing）在此基础上追加闪烁光标。
 *
 * 对每个字符 span 用 animation-delay 错峰（单个 WAAPI 动画作用于 content 整体的
 * opacity 不适用，故逐 span 动画，但限制总字符数防卡顿）。
 */
function perCharEffect(content: HTMLElement, withCursor: boolean): Animation {
  const charSpans = splitIntoCharSpans(content);

  // 打字机：在 content 末尾追加闪烁光标
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

  // 每字错峰：每个 span 一个动画，delay 按序递增，fill:forwards 保持终态。
  //    重要：动画只执行一次（iterations 默认 1），结束后字符停在 opacity:1，
  //    不取消子动画（取消会把 fill 效果清掉、字符消失回 opacity:0）。
  //    为防超长文本卡顿，封顶参与动画的字符数（多余的与最后一位同时显现）。
  const MAX_CHARS = 80;
  const participating = all.slice(0, MAX_CHARS);
  const perCharDuration = ANIM_DURATION * 0.82;
  const step = participating.length > 1 ? perCharDuration / (participating.length - 1) : 0;
  const eachDur = Math.max(120, step * 2); // 单字显现持续时长

  participating.forEach((s, i) =>
    s.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: eachDur,
      delay: i * step,
      easing: 'ease-out',
      fill: 'forwards',
      iterations: 1,
    }),
  );
  // 超出封顶的字符：在参与段结束时统一显现（避免超长文本卡顿）
  if (all.length > MAX_CHARS) {
    const overflowDelay = perCharDuration;
    for (const s of all.slice(MAX_CHARS)) {
      s.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 200,
        delay: overflowDelay,
        fill: 'forwards',
        iterations: 1,
      });
    }
  }

  // 占位 controller：对外暴露统一的 currentTime / finish 控制（视频录制按它判定结束）。
  //    不在 finish 时取消子动画（否则字符消失）；controller 自身也只播一次。
  const controller = content.animate([{ opacity: 1 }, { opacity: 1 }], {
    duration: ANIM_DURATION,
    fill: 'forwards',
    iterations: 1,
  });
  return controller;
}

/**
 * 炫光逐字：每个字符带着高光闪亮、自下而上逐个进入画布。
 *
 * 每字三段：极亮高光（brightness 4 + drop-shadow 大光晕，opacity 0）→ 半亮小光晕
 * （opacity 1，已显现）→ 正常无光晕（稳定）。光晕颜色用 currentColor 自适应模板配色，
 * 暗色模板上金/白光醒目、亮色模板上同色光自然。
 */
function glintCharEffect(content: HTMLElement): Animation {
  return staggerPerChar(
    content,
    [
      {
        opacity: 0,
        transform: 'translateY(14px) scale(0.7)',
        filter: 'brightness(4) drop-shadow(0 0 18px currentColor)',
      },
      {
        opacity: 1,
        transform: 'translateY(0) scale(1)',
        filter: 'brightness(1.8) drop-shadow(0 0 8px currentColor)',
        offset: 0.55,
      },
      {
        opacity: 1,
        transform: 'translateY(0) scale(1)',
        filter: 'brightness(1) drop-shadow(0 0 0 transparent)',
      },
    ],
    420, // 单字炫光持续时长（略长于普通逐字，光晕需要时间收敛）
    'cubic-bezier(0.22, 1, 0.36, 1)',
  );
}

/**
 * 故障艺术（逐字 Glitch Art）：每字 RGB 色散（红 #ff0040 / 青 #00ffff）+ 位置抖动
 * + 轻微倾斜，错峰出现后收敛稳定。
 *
 * 用 textShadow 模拟 chromatic aberration，transform translate + skewX 制造抖动与撕裂感。
 * 每字故障集中在动画前段，末帧回到无色散、零偏移的稳定态，视频导出尾帧干净。
 */
function glitchEffect(content: HTMLElement): Animation {
  return staggerPerChar(
    content,
    [
      { opacity: 0, transform: 'translate(0,0) skewX(0deg)', textShadow: '0 0 0 transparent' },
      { opacity: 0.6, transform: 'translate(-6px,1px) skewX(-3deg)', textShadow: '4px 0 #ff0040, -4px 0 #00ffff', offset: 0.2 },
      { opacity: 0.9, transform: 'translate(5px,-1px) skewX(2deg)', textShadow: '-4px 0 #ff0040, 4px 0 #00ffff', offset: 0.45 },
      { opacity: 0.7, transform: 'translate(-3px,0) skewX(-1deg)', textShadow: '3px 0 #ff0040, -3px 0 #00ffff', offset: 0.65 },
      { opacity: 1, transform: 'translate(0,0) skewX(0deg)', textShadow: '0 0 0 transparent', offset: 0.85 },
      { opacity: 1, transform: 'translate(0,0) skewX(0deg)', textShadow: '0 0 0 transparent' },
    ],
    360,
    'linear',
  );
}

/**
 * 旋转入场（逐字）：每字从 -12° 缩放 0.8 旋转归位，错峰出现。
 */
function rotateInEffect(content: HTMLElement): Animation {
  return staggerPerChar(
    content,
    [
      { opacity: 0, transform: 'rotate(-12deg) scale(0.8)' },
      { opacity: 1, transform: 'rotate(0deg) scale(1)' },
    ],
    300,
    'cubic-bezier(0.22, 1, 0.36, 1)',
  );
}

/**
 * 弹跳（逐字）：每字自上方下落 + 两次回弹，错峰出现。
 */
function bounceEffect(content: HTMLElement): Animation {
  return staggerPerChar(
    content,
    [
      { opacity: 0, transform: 'translateY(-50px) scale(0.8)' },
      { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.4 },
      { opacity: 1, transform: 'translateY(-18px) scale(1)', offset: 0.55 },
      { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.7 },
      { opacity: 1, transform: 'translateY(-6px) scale(1)', offset: 0.82 },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ],
    500,
    'ease-out',
  );
}

/** 动画效果注册表（顺序即选择器展示顺序） */
export const ANIMATIONS: AnimEffect[] = [
  {
    id: 'fade',
    name: '淡入',
    build: (c) => staggerPerChar(c, [{ opacity: 0 }, { opacity: 1 }], 300),
  },
  {
    id: 'zoom',
    name: '缩放',
    build: (c) =>
      staggerPerChar(
        c,
        [
          { opacity: 0, transform: 'scale(0.92)' },
          { opacity: 1, transform: 'scale(1)' },
        ],
        300,
      ),
  },
  {
    id: 'slide-up',
    name: '上滑',
    build: (c) =>
      staggerPerChar(
        c,
        [
          { opacity: 0, transform: 'translateY(24px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        300,
      ),
  },
  {
    id: 'blur',
    name: '模糊聚焦',
    build: (c) =>
      staggerPerChar(
        c,
        [
          { opacity: 0, filter: 'blur(14px)' },
          { opacity: 1, filter: 'blur(0)' },
        ],
        360,
      ),
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
  {
    id: 'glint-char',
    name: '炫光逐字',
    build: (c) => glintCharEffect(c),
  },
  {
    id: 'glitch',
    name: '故障艺术',
    build: (c) => glitchEffect(c),
  },
  {
    id: 'rotate-in',
    name: '旋转入场',
    build: (c) => rotateInEffect(c),
  },
  {
    id: 'bounce',
    name: '弹跳',
    build: (c) => bounceEffect(c),
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
