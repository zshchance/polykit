/**
 * 文字排版 —— 折行与自动缩字号（纯函数，measure 回调注入）。
 *
 * vitest 是 node 环境没有 canvas，measureText 无法直接用；因此所有函数
 * 接受注入的宽度测量回调（渲染端绑定 ctx.font 后传 (s) => ctx.measureText(s).width，
 * 单测传「字符数 × 定宽」假实现）。渲染端据此保证任何长文都能装进页面。
 */

/** 宽度测量（已绑定字号：调用方先设定 font 再传入） */
export type MeasureFn = (s: string) => number;

/** 行高倍数（相对字号） */
export const LINE_HEIGHT = 1.5;

/** 可打印 ASCII 连续串（拉丁词 / 数字 / 网址等，断行时不拆散） */
const ASCII_RUN = /^[\x21-\x7E]+/;

/** 把一段（无换行）文本拆成断行原子：拉丁串 / 单个 CJK 或全角字符 / 空白串 */
function tokenize(para: string): string[] {
  const units: string[] = [];
  let i = 0;
  while (i < para.length) {
    const rest = para.slice(i);
    if (rest[0] === ' ') {
      let j = 0;
      while (rest[j] === ' ') j++;
      units.push(rest.slice(0, j));
      i += j;
      continue;
    }
    const run = ASCII_RUN.exec(rest);
    if (run) {
      units.push(run[0]);
      i += run[0].length;
    } else {
      units.push(rest[0]!);
      i += 1;
    }
  }
  return units;
}

/**
 * 把文本折成不超过 maxWidth 的行（显式 \n 保留为硬换行）。
 * CJK 逐字断行、拉丁串整词断行；行首空白丢弃；超行宽的拉丁串按字符硬切。
 */
export function wrapLines(text: string, maxWidth: number, measure: MeasureFn): string[] {
  if (maxWidth <= 0) return text.split('\n');
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (!para) {
      lines.push('');
      continue;
    }
    let line = '';
    const pushLine = (): void => {
      lines.push(line.replace(/\s+$/, ''));
      line = '';
    };
    for (const u of tokenize(para)) {
      // 中文闭合标点不落在行首；允许最多一个标点的微小悬挂，好过出现孤标点。
      if (line.trim() && /^[，。！？；：、）》】」’”…,.!?;:%]/.test(u)) {
        line += u;
        continue;
      }
      if (!u.trim()) {
        if (line.trim()) line += u; // 行尾空白暂留，push 时裁掉
        continue;
      }
      if (measure(u) > maxWidth) {
        // 原子本身超行宽（长网址等）：先封行，再按字符硬切
        if (line.trim()) pushLine();
        let chunk = '';
        for (const ch of u) {
          if (chunk && measure(chunk + ch) > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        line = chunk;
        continue;
      }
      if (!line.trim() || measure(line + u) <= maxWidth) {
        line += u;
      } else {
        pushLine();
        line = u;
      }
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines;
}

export interface FitTextResult {
  /** 最终字号（未装下时 = minSize，渲染端以裁剪兜底） */
  size: number;
  lines: string[];
  /** 行列是否完整装进 maxHeight */
  fits: boolean;
}

/**
 * 自动缩字号：从 startSize 起，装不下（折行后总高 > maxHeight）就按 shrink
 * 比例缩小，直到装下或到 minSize。
 *
 * withFont：给定字号返回绑定该字号的测宽函数（渲染端设 ctx.font，
 * 单测返回 (s) => s.length * size * 系数）。
 */
export function fitText(
  text: string,
  opts: {
    maxWidth: number;
    maxHeight: number;
    startSize: number;
    minSize: number;
    shrink?: number;
    /** 行高倍数；缺省保持经典排版的 1.5 */
    lineHeight?: number;
    withFont: (size: number) => MeasureFn;
  },
): FitTextResult {
  const shrink = opts.shrink ?? 0.94;
  const lineHeight = opts.lineHeight ?? LINE_HEIGHT;
  let size = opts.startSize;
  for (;;) {
    const lines = wrapLines(text, opts.maxWidth, opts.withFont(size));
    const height = lines.length * size * lineHeight;
    if (height <= opts.maxHeight) {
      return { size, lines, fits: true };
    }
    if (size <= opts.minSize) {
      return { size: opts.minSize, lines, fits: false };
    }
    size = Math.max(opts.minSize, size * shrink);
  }
}
