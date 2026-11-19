/**
 * 可编辑歌词文档模型：统一解析、序列化 LRC 与 SRT。
 *
 * 本模块只处理字符串和纯数据，不依赖 DOM 或其他工具。每行的 id 由文档内容
 * 顺序确定，便于编辑界面稳定地选中、移动和修改歌词。
 */

export type LyricFormat = 'lrc' | 'srt';

export interface LyricLine {
  /** 文档内稳定且唯一的标识 */
  id: string;
  /** 开始时间（秒） */
  start: number;
  /** 结束时间（秒，必须大于 start） */
  end: number;
  /** 歌词文本；SRT 的多行文本以 \n 分隔 */
  text: string;
}

export interface LyricDocument {
  format: LyricFormat;
  fileName: string;
  metadata: Record<string, string>;
  lines: LyricLine[];
}

/** 文件无法解析或文档时间轴无效时抛出 */
export class LyricParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LyricParseError';
  }
}

/** 排序前暂存歌词，顺序号用于保证相同开始时间的排序稳定性 */
interface SourceLine {
  start: number;
  end: number;
  text: string;
  order: number;
}

/** LRC 时间标签 [mm:ss] / [mm:ss.xx] / [mm:ss.xxx] → 秒 */
function parseLrcTime(tag: string): number | null {
  const match = /^(\d+):(\d{1,2})(?:[.:](\d{1,3}))?$/.exec(tag);
  if (!match) return null;

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = match[3] ? Number(match[3]) / 10 ** match[3].length : 0;
  if (!Number.isFinite(minutes) || seconds >= 60) return null;
  return minutes * 60 + seconds + fraction;
}

/** SRT 时间 HH:MM:SS,mmm（也兼容点和不足三位的毫秒）→ 秒 */
function parseSrtTime(value: string): number | null {
  const match = /^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]) * 10 ** (3 - match[4].length);
  if (!Number.isFinite(hours) || minutes >= 60 || seconds >= 60) return null;
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

/** 只剥离增强 LRC 的词级时间标签，不误伤普通歌词里的尖括号文本 */
function cleanLrcText(value: string): string {
  return value.replace(/<\d+:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
}

/** 解码常见命名实体及数值实体，不依赖浏览器 DOM */
function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };

  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    const lower = code.toLowerCase();
    if (!lower.startsWith('#')) return named[lower] ?? entity;

    const radix = lower.startsWith('#x') ? 16 : 10;
    const digits = lower.startsWith('#x') ? lower.slice(2) : lower.slice(1);
    const point = Number.parseInt(digits, radix);
    if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return entity;
    return String.fromCodePoint(point);
  });
}

/** SRT 内嵌 HTML 先删标签再解码实体，避免把 &lt;i&gt; 当成标签删除 */
function cleanSrtRow(value: string): string {
  return decodeHtmlEntities(value.replace(/<\/?[a-z][^>]*>/gi, '')).trim();
}

/** 稳定排序并分配确定性的文档内唯一 id */
function finalizeLines(lines: SourceLine[]): LyricLine[] {
  return lines
    .slice()
    .sort((a, b) => a.start - b.start || a.order - b.order)
    .map((line, index) => ({
      id: `lyric-${index + 1}`,
      start: line.start,
      end: line.end,
      text: line.text,
    }));
}

/** 合法的 offset 是整数毫秒；非法值不参与时间换算 */
function parseOffset(value: string | undefined): number {
  if (!value || !/^[+-]?\d+$/.test(value.trim())) return 0;
  const offset = Number(value);
  return Number.isFinite(offset) ? offset / 1000 : 0;
}

/** 解析 LRC 元数据、多个行首时间戳和结束时间 */
function parseLrc(
  raw: string,
  audioDuration?: number,
): {
  metadata: Record<string, string>;
  lines: LyricLine[];
} {
  const metadata: Record<string, string> = {};
  const pending: SourceLine[] = [];
  let order = 0;

  for (const row of raw.split(/\r?\n/)) {
    const metadataMatch = /^\s*\[([a-z][\w-]*):([^\]]*)\]\s*$/i.exec(row);
    if (metadataMatch) {
      metadata[metadataMatch[1].toLowerCase()] = metadataMatch[2].trim();
      continue;
    }

    // 连续抓取下时间标签，允许标签之间有空格；歌词正文只取一次。
    const prefix = /^\s*(?:\[\d+:\d{1,2}(?:[.:]\d{1,3})?\]\s*)+/.exec(row);
    if (!prefix) continue;
    const text = cleanLrcText(row.slice(prefix[0].length));
    if (!text) continue;

    const tagPattern = /\[(\d+:\d{1,2}(?:[.:]\d{1,3})?)\]/g;
    let tag: RegExpExecArray | null;
    while ((tag = tagPattern.exec(prefix[0])) !== null) {
      const start = parseLrcTime(tag[1]);
      if (start !== null) pending.push({ start, end: start, text, order: order++ });
    }
  }

  const offset = parseOffset(metadata.offset);
  const shifted = pending.map((line) => ({ ...line, start: line.start + offset, end: 0 }));
  if (shifted.some((line) => !Number.isFinite(line.start) || line.start < 0)) {
    throw new LyricParseError('offset 换算后歌词时间不能为负数');
  }

  shifted.sort((a, b) => a.start - b.start || a.order - b.order);
  for (let index = 0; index < shifted.length; index++) {
    const line = shifted[index];
    const next = shifted[index + 1];
    if (next) {
      line.end = next.start;
    } else {
      const hasDuration =
        typeof audioDuration === 'number' &&
        Number.isFinite(audioDuration) &&
        audioDuration > line.start;
      line.end = hasDuration ? audioDuration : line.start + 4;
    }
    if (line.end <= line.start) {
      throw new LyricParseError('相同开始时间的 LRC 行无法形成有效区间');
    }
  }

  return { metadata, lines: finalizeLines(shifted) };
}

/** 按空行分块解析 SRT；每块独立保留自己的结束时间与文本间隙 */
function parseSrt(raw: string): LyricLine[] {
  const lines: SourceLine[] = [];
  const normalized = raw.replace(/\r\n?/g, '\n');
  let order = 0;

  for (const block of normalized.split(/\n[\t ]*\n+/)) {
    const rows = block.split('\n');
    const timeIndex = rows.findIndex((row) => row.includes('-->'));
    if (timeIndex < 0) continue;

    const timing = /^(.*?)\s*-->\s*(.*?)$/.exec(rows[timeIndex]);
    if (!timing) continue;
    const start = parseSrtTime(timing[1]);
    const end = parseSrtTime(timing[2]);
    if (start === null || end === null || start < 0 || end <= start) continue;

    // 不再用空格连接，逐行清理后以换行保留字幕排版。
    const text = rows
      .slice(timeIndex + 1)
      .map(cleanSrtRow)
      .join('\n')
      .trim();
    if (!text) continue;
    lines.push({ start, end, text, order: order++ });
  }

  return finalizeLines(lines);
}

/**
 * 按内容嗅探格式：包含 --> 即 SRT，否则按 LRC；扩展名不参与判断。
 * audioDuration 仅用于补齐 LRC 末行，SRT 始终使用文件自带的独立结束时间。
 */
export function parseLyrics(raw: string, fileName: string, audioDuration?: number): LyricDocument {
  const text = raw.replace(/^\uFEFF/, '').trim();
  if (!text) throw new LyricParseError('文件内容为空');

  if (text.includes('-->')) {
    const lines = parseSrt(text);
    if (lines.length === 0) throw new LyricParseError('未解析到任何有效 SRT 字幕行');
    return { format: 'srt', fileName, metadata: {}, lines };
  }

  const { metadata, lines } = parseLrc(text, audioDuration);
  if (lines.length === 0) throw new LyricParseError('未解析到任何有效 LRC 歌词行');
  return { format: 'lrc', fileName, metadata, lines };
}

/** 输出 LRC 的 [mm:ss.xx]，四舍五入到百分之一秒 */
function formatLrcTime(value: number): string {
  const centiseconds = Math.round(value * 100);
  const minutes = Math.floor(centiseconds / 6000);
  const seconds = Math.floor(centiseconds / 100) % 60;
  const fraction = centiseconds % 100;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(
    fraction,
  ).padStart(2, '0')}`;
}

/** 输出 SRT 的 HH:MM:SS,mmm，小时可超过两位 */
function formatSrtTime(value: number): string {
  const total = Math.round(value * 1000);
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor(total / 60000) % 60;
  const seconds = Math.floor(total / 1000) % 60;
  const milliseconds = total % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    seconds,
  ).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

/** 校验可编辑文档，并按开始时间稳定排序副本而不改动原数组 */
function validatedLines(lines: LyricLine[]): LyricLine[] {
  if (lines.length === 0) throw new LyricParseError('没有可序列化的歌词行');

  const copy = lines.map((line, order) => ({ line, order }));
  for (const { line } of copy) {
    if (
      !Number.isFinite(line.start) ||
      !Number.isFinite(line.end) ||
      line.start < 0 ||
      line.end <= line.start
    ) {
      throw new LyricParseError('歌词时间不能为负数，且 end 必须大于 start');
    }
    if (!line.text.trim()) throw new LyricParseError('歌词文本不能为空');
  }

  return copy
    .sort((a, b) => a.line.start - b.line.start || a.order - b.order)
    .map(({ line }) => line);
}

/** 元数据键必须能重新被 [key:value] 语法识别；offset 单独规范为 0 */
function serializeMetadata(metadata: Record<string, string>): string[] {
  const rows: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (!/^[a-z][\w-]*$/i.test(key) || key.toLowerCase() === 'offset') continue;
    rows.push(`[${key}:${value.replace(/[\r\n]/g, ' ').trim()}]`);
  }
  rows.push('[offset:0]');
  return rows;
}

/**
 * 序列化文档，默认沿用 doc.format，也可显式转换格式。
 * LRC 时间已经应用过 offset，因此始终写 [offset:0]，避免二次偏移。
 */
export function serializeLyrics(doc: LyricDocument, format: LyricFormat = doc.format): string {
  const lines = validatedLines(doc.lines);

  if (format === 'lrc') {
    const metadata = serializeMetadata(doc.metadata);
    const lyrics = lines.map(
      (line) => `[${formatLrcTime(line.start)}]${line.text.replace(/\r\n?|\n/g, ' ').trim()}`,
    );
    return [...metadata, ...lyrics].join('\n');
  }

  return lines
    .map((line, index) => {
      const text = line.text.replace(/\r\n?/g, '\n').trim();
      return `${index + 1}\n${formatSrtTime(line.start)} --> ${formatSrtTime(line.end)}\n${text}`;
    })
    .join('\n\n');
}

/** 返回与查询区间 [start, end) 有任何重叠的歌词 ID，保持原数组顺序 */
export function linesInRange(lines: LyricLine[], start: number, end: number): string[] {
  return lines.filter((line) => start < line.end && end > line.start).map((line) => line.id);
}

const SUGGEST_LINE_LENGTH = 2;
const SUGGEST_LINE_MIN = 0.5;
const SUGGEST_LINE_MAX = 4;

/**
 * 手动新增一句时的默认时间：
 * - 空列表：从播放头位置起给 2 秒占位；
 * - 追加在末句后：顺延 2 秒；
 * - 插入两句之间：优先吃掉真实空隙（不足 0.5 秒时允许轻微重叠，最长 4 秒）。
 * 已知音频时长时不越过末尾。
 */
export function suggestLineRange(
  lines: LyricLine[],
  afterIndex: number,
  playhead: number,
  duration: number,
): { start: number; end: number } {
  const prev = afterIndex >= 0 && afterIndex < lines.length ? lines[afterIndex] : null;
  const next = prev ? (lines[afterIndex + 1] ?? null) : null;
  let start = prev ? prev.end : Math.max(0, Number.isFinite(playhead) ? playhead : 0);
  let length = SUGGEST_LINE_LENGTH;
  if (prev && next)
    length = Math.min(Math.max(next.start - prev.end, SUGGEST_LINE_MIN), SUGGEST_LINE_MAX);
  if (Number.isFinite(duration) && duration > 0) {
    start = Math.min(start, Math.max(0, duration - 0.02));
    if (start + length > duration) length = Math.max(0.02, duration - start);
  }
  return { start, end: start + length };
}
