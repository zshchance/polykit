/**
 * 文案切卡 —— 把批量粘贴的文案切成快闪卡片（纯函数，无 DOM）。
 *
 * 切卡规则（UI 提示语与此一致）：
 *   - 一行 = 一张卡；空行与 `---` 等分隔线仅作视觉分隔，不产生内容卡；
 *   - 一行里有多句时，按句读（。！？!?；;…）自动拆成多张卡；
 *   - `# 标题` 行 = 标题卡（更强调排版，不参与句读拆分）；
 *   - 整句用 `**…**` 或 `【…】` 包裹 = 强调卡（渲染时换主色/色块）；
 *   - 单句超长时按次级标点（，、：等）优先断句，仍超则按字符硬切。
 *
 * 每张卡的字符预算按画布比例给参考值（9:16 更窄，预算更小），
 * 真正的溢出保障由渲染端「自动缩字号」兜底。
 */

/** 一张快闪卡片 */
export interface Card {
  /** 纯文本（已去掉强调标记与尾部标点） */
  text: string;
  /** 强调卡 */
  em: boolean;
  /** 标题卡（来自 # 行） */
  title: boolean;
}

export interface ScriptResult {
  cards: Card[];
  /** 超出卡片数上限被丢弃（true 时 UI 提示） */
  truncated: boolean;
}

/** 卡片数上限：保护渲染性能与录制时长 */
export const MAX_CARDS = 200;
/** 标题长度上限 */
const TITLE_MAX = 32;

/** 强制分页分隔线：--- / ---- / === 等（仅作分隔，不产生卡片） */
const BREAK_RE = /^(?:-{3,}|={3,}|\*{3,}|＿{3,})$/;
/** 标题行：# 前缀（允许全半角空格） */
const TITLE_RE = /^#{1,2}\s+(.*)$/;
/** 句读（拆句依据，保留标点稍后清理） */
const SENTENCE_MARKS = '。！？!?；;…';
/** 次级标点（长句优先在此断卡） */
const CLAUSE_MARKS = '，,、：:';
/** 卡尾要剥掉的标点（保留 ？！!? 这类情绪标点） */
const TRAILING_RE = /[，,。.；;、：:]+$/;
/** 卡首要剥掉的标点 */
const LEADING_RE = /^[，,。.；;、：:]+/;
/** 只剩标点的碎片不成卡（连续句读会切出「！」「…」这类空壳） */
const PUNCT_ONLY_RE = /^[，,。.；;、：:…！!？?—\-·\s]+$/;

/** 各比例的每卡字符预算（长句切分参考值） */
export function cardBudget(aspectId: string): number {
  if (aspectId === '9:16') return 24;
  if (aspectId === '16:9') return 34;
  if (aspectId === '4:3') return 30;
  return 28;
}

/** 空内容时预填的示例文案（首屏即有效果，可编辑） */
export const SAMPLE_TEXT = `# 文字快闪
一行一句，就是一张卡

别再手打关键帧
把文案粘进来
剩下的交给节奏
**快闪，就该这么简单**

# 三步成片
粘贴文案
挑一套主题与动效
配乐一响
一键导出

文字自己会跳舞`;

/** 去除强调标记，返回「文本 + 是否强调」 */
function extractEmphasis(raw: string): { text: string; em: boolean } {
  const t = raw.trim();
  const wrapped = /^\*\*(.+?)\*\*$/.exec(t) ?? /^【(.+?)】$/.exec(t);
  if (wrapped) return { text: wrapped[1]!.trim(), em: true };
  // 未整体包裹时，禁止零散标记进入画面
  return { text: t.replace(/\*\*/g, ''), em: false };
}

/** 清理单张卡的文本：去首尾标点、去多余空白 */
function cleanCardText(raw: string, title: boolean): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  if (!title) {
    t = t.replace(LEADING_RE, '').replace(TRAILING_RE, '').trim();
  }
  return t;
}

/** 按句读拆句（保留标点） */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (SENTENCE_MARKS.includes(ch)) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/** 超预算长句拆分：优先在次级标点处断，找不到就按字符硬切 */
export function splitLongSentence(text: string, budget: number): string[] {
  const cap = Math.max(6, Math.floor(budget));
  const out: string[] = [];
  let chars = [...text];
  while (chars.length > cap) {
    let cut = -1;
    const lower = Math.max(2, Math.floor(cap * 0.35));
    for (let i = Math.min(cap, chars.length - 1); i >= lower; i--) {
      if (CLAUSE_MARKS.includes(chars[i]!)) {
        cut = i;
        break;
      }
    }
    if (cut < 0) cut = cap - 1;
    out.push(chars.slice(0, cut + 1).join(''));
    chars = chars.slice(cut + 1);
  }
  if (chars.length > 0) out.push(chars.join(''));
  return out;
}

/**
 * 主入口：文本 → 卡片列表。
 * 永不抛错：任何输入都返回合法结果（空文本返回空列表）。
 */
export function parseScript(text: string, budget: number): ScriptResult {
  const cards: Card[] = [];
  let truncated = false;

  const push = (raw: string, title: boolean, em: boolean): void => {
    if (cards.length >= MAX_CARDS) {
      truncated = true;
      return;
    }
    const cleaned = cleanCardText(raw, title);
    if (!cleaned || PUNCT_ONLY_RE.test(cleaned)) return;
    cards.push({
      text: title ? cleaned.slice(0, TITLE_MAX) : cleaned,
      em,
      title,
    });
  };

  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || BREAK_RE.test(line)) continue;

    const titleMatch = TITLE_RE.exec(line);
    if (titleMatch) {
      const { text: body, em } = extractEmphasis(titleMatch[1]!);
      push(body, true, em);
      continue;
    }

    for (const sentence of splitSentences(line)) {
      for (const piece of splitLongSentence(sentence, budget)) {
        const { text: body, em } = extractEmphasis(piece);
        push(body, false, em);
        if (truncated) break;
      }
      if (truncated) break;
    }
    if (truncated) break;
  }

  return { cards, truncated };
}
