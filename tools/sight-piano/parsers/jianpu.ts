/**
 * 识谱琴房 —— 数字简谱（ASCII 变体）解析器。
 *
 * 语法（面向中文用户的文本简谱，粘贴即弹）：
 *   1=C 4/4 ♩=96        头部：调号 / 拍号 / 速度，均可选、可省略
 *   1 2 3 4 5 6 7       唱名 do–ti（首调），四分音符
 *   0                   休止符
 *   #4 / b7             临时升降（前缀）
 *   1'  1,              高八度 / 低八度（后缀，可叠写如 1''、1,,）
 *   1_  1__             下划线减半：八分 / 十六分
 *   1.                  附点（时值 ×1.5）
 *   -                   延长前一个音一拍（四分）
 *   |                   小节线（对不齐时自动包容到下一小节）
 *   //                  行注释
 *
 * 第一行若不含任何音符/头部记号，视为标题。
 * 解析输出裸事件流（beat/dur/midi），拼写与排版交给 score.buildScore。
 */

export interface ParsedSheet {
  title: string;
  keyPc: number | null; // null = 未指定，交给判调
  tonality: 'major' | 'minor';
  beatsPerBar: number;
  beatUnit: number;
  bpm: number;
  events: { beat: number; dur: number; midi: number | null }[];
  warnings: string[];
}

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_OFFSETS = [0, 2, 4, 5, 7, 9, 11] as const;

/** 主音落点：让「1」落在中央 C 附近（55–67 之间取最接近 C4 的） */
function tonicMidi(keyPc: number): number {
  let best = 60;
  let bestD = Infinity;
  for (let k = 36; k <= 84; k += 12) {
    const m = keyPc + k;
    const d = Math.abs(m - 60);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

export function parseJianpu(text: string): ParsedSheet {
  const warnings: string[] = [];
  let keyPc: number | null = null;
  let beatsPerBar = 4;
  let beatUnit = 4;
  let bpm = 96;
  let title = '';

  const lines = text.split(/\r?\n/);
  const bodyLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (!line) continue;

    // 头部记号（整行都是头部时吃掉，混排则在音符扫描时识别）
    const keyMatch = line.match(/(?:^|\s)1\s*=\s*([A-Ga-g])([#b♯♭]?)(?=\s|$)/);
    if (keyMatch) {
      const base = LETTER_PC[keyMatch[1]!.toUpperCase()]!;
      const acc = keyMatch[2];
      keyPc = (base + (acc === '#' || acc === '♯' ? 1 : acc === 'b' || acc === '♭' ? -1 : 0) + 12) % 12;
    }
    const timeMatch = line.match(/(?:^|\s)([1-9])\s*\/\s*([248])(?=\s|$)/);
    if (timeMatch) {
      beatsPerBar = Number(timeMatch[1]);
      beatUnit = Number(timeMatch[2]);
    }
    const bpmMatch = line.match(/(?:♩|bpm|q)\s*=\s*(\d{2,3})/i);
    if (bpmMatch) bpm = Math.min(220, Math.max(40, Number(bpmMatch[1])));

    // 标题行：没有任何数字音符/小节线的行
    if (!title && !/[0-7|]/.test(line) && !keyMatch && !timeMatch && !bpmMatch) {
      title = line.slice(0, 40);
      continue;
    }
    bodyLines.push(line);
  }

  const tonic = tonicMidi(keyPc ?? 0);
  const events: ParsedSheet['events'] = [];
  let cursor = 0;

  /** 上一个事件（供 - 延长）；跨小节允许延长 */
  const lastNote = (): { beat: number; dur: number; midi: number | null } | null =>
    events.length ? events[events.length - 1]! : null;

  for (const line of bodyLines) {
    for (const token of line.split(/\s+/)) {
      if (!token) continue;
      if (token === '|') {
        // 小节线：不在边界上时温柔地吸到下一小节
        const rem = cursor % beatsPerBar;
        if (rem > 1e-6) cursor += beatsPerBar - rem;
        continue;
      }
      // 头部记号混排在音符里（已在上面记过，跳过）
      if (/^1\s*=\s*[A-Ga-g]/.test(token) || /^[1-9]\/[248]$/.test(token) || /^(?:♩|bpm|q)=/i.test(token)) {
        continue;
      }
      if (token === '-') {
        const prev = lastNote();
        if (prev) prev.dur += 1;
        else warnings.push('孤立的延长号「-」已忽略');
        cursor += 1;
        continue;
      }

      const m = token.match(/^(#|♯|b|♭)?([0-7])((?:['`,._]*))$/);
      if (!m) {
        warnings.push(`无法识别的记号「${token}」已跳过`);
        continue;
      }
      const acc = m[1] === '#' || m[1] === '♯' ? 1 : m[1] === 'b' || m[1] === '♭' ? -1 : 0;
      const degree = Number(m[2]);
      let octaveShift = 0;
      let halvings = 0;
      let dotted = false;
      for (const ch of m[3]!) {
        if (ch === "'") octaveShift += 12;
        else if (ch === '`' || ch === ',') octaveShift -= 12;
        else if (ch === '_') halvings++;
        else if (ch === '.') dotted = true;
      }
      let dur = 1 / Math.pow(2, halvings);
      if (dotted) dur *= 1.5;
      dur = Math.round(dur * 1000) / 1000;

      const midi =
        degree === 0 ? null : tonic + MAJOR_OFFSETS[degree - 1]! + acc + octaveShift;
      events.push({ beat: Math.round(cursor * 1000) / 1000, dur, midi });
      cursor += dur;
    }
  }

  if (events.filter((e) => e.midi !== null).length < 2) {
    throw new Error('没有解析出足够的音符，请检查简谱格式（示例：1 1 5 5 6 6 5 -）');
  }
  if (events.length > 800) {
    throw new Error('谱面太长了（超过 800 个记号），请截取一个段落导入');
  }

  return { title, keyPc, tonality: 'major', beatsPerBar, beatUnit, bpm, events, warnings };
}
