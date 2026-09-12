/**
 * 歌词/字幕解析 —— 把 LRC 或 SRT 文本统一解析为带起止时间的行数组。
 *
 * 纯函数模块（不依赖 DOM），供渲染层按时间取当前行；vitest 覆盖边界。
 *
 * 支持格式：
 *   - LRC：`[mm:ss.xx]歌词` / `[mm:ss]歌词`，一行可带多个时间标签；
 *     兼容增强型词级标签 `<mm:ss.xx>`（直接剥离）；忽略 `[ti:]/[ar:]` 等元数据行。
 *   - SRT：`序号 + HH:MM:SS,mmm --> HH:MM:SS,mmm + 文本行`，文本去 HTML 标签。
 *
 * 输出行按开始时间排序；每行的结束时间 = 下一行开始时间（无缝衔接），
 * 最后一行结束时间 = 音频结束（由调用方传入 duration 补齐，不在这里猜）。
 */

export interface LyricLine {
  /** 开始时间（秒） */
  start: number;
  /** 结束时间（秒；补齐后=下一行 start 或音频时长） */
  end: number;
  /** 歌词文本（已清理标签与空白） */
  text: string;
}

/** 解析失败/无有效行时抛错，调用方提示用户检查文件 */
export class LyricParseError extends Error {}

/** 时间标签 [mm:ss] / [mm:ss.xx] / [mm:ss.xxx] → 秒；非法返回 null */
function parseLrcTime(tag: string): number | null {
  const m = /^(\d+):(\d{1,2})(?:[.:](\d{1,3}))?$/.exec(tag);
  if (!m) return null;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  const frac = m[3] ? Number(m[3]) / Math.pow(10, m[3].length) : 0;
  if (sec >= 60) return null;
  return min * 60 + sec + frac;
}

/** SRT 时间 `HH:MM:SS,mmm` 或 `HH:MM:SS.mmm` → 秒；非法返回 null */
function parseSrtTime(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(s.trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

/** 清理歌词文本：去增强型词级标签、SRT 的 HTML 标签与实体、首尾空白 */
function cleanText(s: string): string {
  return s
    .replace(/<\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?>/g, '') // LRC 词级标签 <00:01.50>
    .replace(/<\/?[^>]{1,40}>/g, '') // SRT 内嵌 HTML（<i>、<font ...> 等）
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** LRC 单文件解析：返回乱序收集后的 {start,text} 数组 */
function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // 逐个抓取行首连续时间标签，如 [00:12.00][01:30.50]共享同一句歌词
    const tags = raw.match(/^\s*((?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+)/);
    if (!tags) continue; // 元数据行（[ti:…]）与空行自然跳过
    const body = cleanText(raw.slice(tags[0].length));
    if (!body) continue;
    const tagRe = /\[(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)\]/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(tags[0])) !== null) {
      const t = parseLrcTime(m[1]);
      if (t !== null) lines.push({ start: t, end: t, text: body });
    }
  }
  return lines;
}

/** SRT 解析：按空行分块，块内取时间轴行 + 余下文本行 */
function parseSrt(text: string): LyricLine[] {
  const out: LyricLine[] = [];
  const blocks = text.replace(/^\uFEFF/, '').split(/\r?\n\r?\n+/);
  for (const block of blocks) {
    const rows = block.split(/\r?\n/);
    const timeRow = rows.find((r) => r.includes('-->'));
    if (!timeRow) continue;
    const [from, to] = timeRow.split('-->');
    if (!from || !to) continue;
    const start = parseSrtTime(from);
    const end = parseSrtTime(to);
    if (start === null || end === null || end <= start) continue;
    const body = cleanText(rows.slice(rows.indexOf(timeRow) + 1).join(' '));
    if (!body) continue;
    out.push({ start, end, text: body });
  }
  return out;
}

/**
 * 按内容自动嗅探格式：含 `-->` 视为 SRT，否则按 LRC 处理。
 * （文件扩展名可能不可靠，内容嗅探更稳；两者特征互斥。）
 */
export function parseLyrics(raw: string, audioDuration: number): LyricLine[] {
  const trimmed = raw.replace(/^\uFEFF/, '').trim();
  if (!trimmed) throw new LyricParseError('文件内容为空');

  const lines = trimmed.includes('-->') ? parseSrt(trimmed) : parseLrc(trimmed);
  if (lines.length === 0) throw new LyricParseError('未解析到任何歌词行，请检查文件格式');

  lines.sort((a, b) => a.start - b.start);
  // 补齐结束时间：= 下一行 start（无缝滚动）；最后一行到音频结束
  const dur = Number.isFinite(audioDuration) && audioDuration > 0 ? audioDuration : Infinity;
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    lines[i].end = next ? Math.min(next.start, dur) : dur;
  }
  return lines;
}

/**
 * 二分查找时刻 t 的当前行下标；无命中返回 -1（t 在首行前或超出最后一行）。
 * 行数组必须已按 start 升序（parseLyrics 的输出保证）。
 */
export function findLyricIndex(lines: LyricLine[], t: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const line = lines[mid];
    if (!line) break;
    if (t < line.start) {
      hi = mid - 1;
    } else if (t >= line.end && line.end !== Infinity) {
      // end 为 Infinity 的末行：t 一直命中它
      lo = mid + 1;
    } else {
      found = mid;
      hi = mid - 1; // 时间标签可能重叠，继续向左找更早的命中行
    }
  }
  return found;
}
