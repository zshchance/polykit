/**
 * 识谱琴房 —— ABC 记谱子集解析器。
 *
 * 支持民谣/教学场景最常用的 ABC 子集：
 *   头部：X: T: M:4/4 L:1/8 Q:1/4=100 K:C（K 之后进入正文）
 *   正文：CDEFGAB（中音区，C = 中央 C）/ cdefgab（高八度）
 *         ^F _B =C    临时升 / 降 / 还原
 *         C'  C,      八度上 / 下移
 *         C2 C3 C/2 C/  时值倍数 / 除法（相对 L 单位音长）
 *         z  Z        休止 / 整小节休止
 *         C-D         连线（并入前一音时值）
 *         |  :| |]    小节线 / 反复（忽略反复，顺铺一遍）
 *   不支持的构造（和弦组、装饰音、变音拍号内联切换等）跳过并记 warnings。
 *
 * 输出与 jianpu 解析器同形的裸事件流。
 */

import type { ParsedSheet } from './jianpu';

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

interface AbcHeaders {
  title: string;
  beatsPerBar: number;
  beatUnit: number;
  /** 单位音长对应的拍数（四分 = 1 拍） */
  unitBeats: number;
  bpm: number;
  keyPc: number | null;
  tonality: 'major' | 'minor';
}

function parseKey(raw: string): { keyPc: number | null; tonality: 'major' | 'minor' } {
  const m = raw.trim().match(/^([A-Ga-g])([#b♯♭])?\s*(m|min|minor)?/i);
  if (!m) return { keyPc: null, tonality: 'major' };
  const base = LETTER_PC[m[1]!.toUpperCase()];
  if (base === undefined) return { keyPc: null, tonality: 'major' };
  const acc = m[2];
  const pc =
    (base + (acc === '#' || acc === '♯' ? 1 : acc === 'b' || acc === '♭' ? -1 : 0) + 12) % 12;
  const minor = !!m[3];
  return { keyPc: pc, tonality: minor ? 'minor' : 'major' };
}

export function parseAbc(text: string): ParsedSheet {
  const warnings: string[] = [];
  const headers: AbcHeaders = {
    title: '',
    beatsPerBar: 4,
    beatUnit: 4,
    unitBeats: 0.5, // L:1/8 默认
    bpm: 100,
    keyPc: null,
    tonality: 'major',
  };

  const lines = text.split(/\r?\n/);
  let bodyStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/%.*$/, '').trim();
    if (!line) continue;
    const hm = line.match(/^([A-Za-z])\s*:\s*(.*)$/);
    if (hm) {
      const field = hm[1]!.toUpperCase();
      const value = hm[2]!;
      if (field === 'T') headers.title = value.slice(0, 40);
      else if (field === 'M') {
        const tm = value.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
        if (tm) {
          headers.beatsPerBar = Number(tm[1]);
          headers.beatUnit = Number(tm[2]);
        }
      } else if (field === 'L') {
        const lm = value.match(/1\s*\/\s*(\d{1,2})/);
        if (lm) headers.unitBeats = 4 / Number(lm[1]);
      } else if (field === 'Q') {
        const qm = value.match(/(\d+)\s*$/);
        if (qm) headers.bpm = Math.min(220, Math.max(40, Number(qm[1])));
      } else if (field === 'K') {
        const k = parseKey(value);
        headers.keyPc = k.keyPc;
        headers.tonality = k.tonality;
        // ABC 约定 K 是最后一个头字段，同行剩余部分是正文开头
        bodyStart = i;
        break;
      }
      continue;
    }
    // 无 K 行也能解析：遇到非头字段行即正文
    bodyStart = i - 1;
    break;
  }

  if (bodyStart < 0) throw new Error('没有找到 ABC 正文（需要 K: 调号行或音符行）');

  const body = lines
    .slice(bodyStart)
    .map((l) => l.replace(/%.*$/, ''))
    .join(' ')
    // 去掉 K: 行头部本身（K:C 后面的内容才是正文）
    .replace(/^\s*K\s*:[^\s]*\s*/, '');

  const events: ParsedSheet['events'] = [];
  let cursor = 0;
  let tie = false;
  let i = 0;

  const extendLast = (dur: number): void => {
    const prev = events[events.length - 1];
    if (prev) prev.dur = Math.round((prev.dur + dur) * 1000) / 1000;
  };

  while (i < body.length) {
    const ch = body[i]!;

    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '|' || ch === ':' || ch === ']' || ch === '[') {
      // 反复/段落记号全部忽略，顺铺一遍；和弦组 [..] 标记跳过
      if (ch === '[') {
        const close = body.indexOf(']', i);
        if (close > i) {
          warnings.push('和弦组 [..] 已跳过（只取单旋律）');
          i = close + 1;
          continue;
        }
      }
      i++;
      continue;
    }
    if (ch === '-') {
      tie = true;
      i++;
      continue;
    }

    // 临时记号前缀
    let acc = 0;
    while (i < body.length && (body[i] === '^' || body[i] === '_' || body[i] === '=')) {
      const a = body[i]!;
      if (a === '^') acc += 1;
      else if (a === '_') acc -= 1;
      // '=' 还原：相对调号归零，换算成 MIDI 时直接取自然音
      else acc = 0;
      i++;
    }

    if (i >= body.length) break;
    const letter = body[i]!;

    if (letter === 'z' || letter === 'Z' || letter === 'x') {
      i++;
      const dur = letter === 'Z' ? headers.beatsPerBar : readLength(body, () => headers.unitBeats, (n) => (i = n), i);
      if (tie) {
        extendLast(dur);
        tie = false;
      } else {
        events.push({ beat: cursor, dur, midi: null });
      }
      cursor += dur;
      continue;
    }

    const pcBase = LETTER_PC[letter.toUpperCase()];
    if (pcBase === undefined) {
      // 装饰音 {..} 与其它记号
      if (letter === '{') {
        const close = body.indexOf('}', i);
        if (close > i) {
          i = close + 1;
          continue;
        }
      }
      warnings.push(`无法识别的记号「${letter}」已跳过`);
      i++;
      continue;
    }
    i++;

    let midi = 12 * 5 + pcBase; // C = 中央 C（C4 = 60）
    if (letter === letter.toLowerCase()) midi += 12;
    midi += acc;
    while (i < body.length && (body[i] === "'" || body[i] === ',')) {
      midi += body[i] === "'" ? 12 : -12;
      i++;
    }

    const dur = readLength(body, () => headers.unitBeats, (n) => (i = n), i);

    if (tie) {
      extendLast(dur);
      tie = false;
    } else {
      events.push({ beat: Math.round(cursor * 1000) / 1000, dur, midi });
    }
    cursor += dur;
  }

  if (events.filter((e) => e.midi !== null).length < 2) {
    throw new Error('没有解析出足够的音符，请检查 ABC 记谱（示例：K:C\\nC D E F G2 G2）');
  }
  if (events.length > 800) {
    throw new Error('谱面太长了（超过 800 个记号），请截取一个段落导入');
  }

  return {
    title: headers.title,
    keyPc: headers.keyPc,
    tonality: headers.tonality,
    beatsPerBar: headers.beatsPerBar,
    beatUnit: headers.beatUnit,
    bpm: headers.bpm,
    events,
    warnings,
  };
}

/** 读音符后面的长度修饰：数字 = 乘，/n 或 / = 除 */
function readLength(
  body: string,
  unitBeats: () => number,
  setI: (n: number) => void,
  start: number,
): number {
  let i = start;
  let mult = 1;
  let div = 1;
  let numBuf = '';
  while (i < body.length && /[0-9]/.test(body[i]!)) numBuf += body[i++]!;
  if (numBuf) mult = Number(numBuf);
  if (body[i] === '/') {
    i++;
    let dBuf = '';
    while (i < body.length && /[0-9]/.test(body[i]!)) dBuf += body[i++]!;
    div = dBuf ? Number(dBuf) : 2;
  }
  setI(i);
  return Math.round(((unitBeats() * mult) / div) * 1000) / 1000;
}
