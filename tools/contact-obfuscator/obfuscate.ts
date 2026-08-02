/**
 * 文字夹私货 —— 核心变换逻辑（与 UI 解耦）。
 *
 * 【定位】
 *   把用户写的联系方式（手机/微信/QQ/邮箱）经多层随机字符变换，使其对「机器正则识别」
 *   失效，同时对人保持可读。所有变换纯本地、确定性（密码学随机种子），不联网。
 *
 * 【两层策略】
 *   - 稳健层（可见变换，默认开）：大小写随机、数字转中文、穿插可见符号/表情/汉字、
 *     可见分隔符（全角空格/制表符）。这些能扛 NFKC 规范化——即便平台把不可见字符过滤
 *     掉、把文本归一化后重新扫描，可见变换仍然有效，是「兜底」。
 *   - 激进层（不可见变换，默认关）：零宽字符穿插、同形字替换。对抗更强，但部分平台会
 *     过滤零宽字符再做识别，所以默认关闭、由用户自行开启。
 *
 * 【实现】
 *   把输入拆成码点数组（用 [...str] 正确处理 Unicode），逐个应用启用的变换，
 *   每个变换独立、可任意组合，最后 join。note 字段智能汇总「实际生效了哪些变换」，
 *   只提示对人有意义的、确实改变了文本的变换。
 */

import { secureRandomInt, securePick, secureShuffle } from '@/core/utils/random';

/** 变换选项：每个开关独立控制一种变换策略 */
export interface ObfuscateOptions {
  // —— 可见变换（稳健层，默认开，能扛规范化）——
  /** 字母大小写随机打乱（大小写混合 → 主要改大写），原值需以小写理解 */
  caseShuffle: boolean;
  /** 数字随机转中文数字（0→〇 / 1→一 / 也可能用大写 零壹贰…） */
  digitToWords: boolean;
  /** 随机穿插可见汉字干扰符（如 「」·※ 等） */
  insertHan: boolean;
  /** 随机穿插 emoji 表情 */
  insertEmoji: boolean;
  /** 随机穿插可见特殊符号（★◆※◎ 等） */
  insertSymbol: boolean;
  /** 用全角空格/制表符打断连续数字串（机器正则常靠 \d{11} 抓手机号） */
  visibleSeparator: boolean;
  /** 邮箱混淆：@ 替换成 emoji + 域名点号打断（x.com→x◆com），让邮箱正则失效 */
  emailObfuscate: boolean;
  // —— 不可见变换（激进层，默认关，可能被平台过滤）——
  /** 零宽字符穿插（U+200B/200C/200D/2060） */
  zeroWidth: boolean;
  /** 同形字替换（拉丁 a/e/o 等 → 西里尔/希腊同形字） */
  homoglyph: boolean;
  // —— 变态变换（人难读、AI 易解，默认关）——
  /** leet 字母替换（a→@ s→$ o→0 e→3 等，经典可逆变换） */
  leetReplace: boolean;
  /** 数字串转罗马数字或二进制（138→CXXXVIII 或 10001010） */
  digitToRoman: boolean;
  /** 段落顺序打乱 + 字符间密集插入零宽字符 */
  shuffleWords: boolean;
  /** 整段 Base64 编码（终态变换，最后一步） */
  base64Encode: boolean;
  /** 敏感词伪装：把「电话/微信/邮箱/QQ」等关键词替换成表情/反写/夹乱码 */
  keywordDisguise: boolean;
}

/** 单次变换结果 */
export interface ObfuscateResult {
  /** 变换后的文本 */
  text: string;
  /** 给人的示意说明（已生效变换的汇总，附在文本后帮助人理解原值） */
  note: string;
  /** 实际生效的变换标签（去重），供 buildInlineRules 精确生成还原规则 */
  applied: string[];
}

// ════════════════════════════════════════════════════════════════
// 字符表
// ════════════════════════════════════════════════════════════════

/** 数字 → 简体中文数字（适合零散穿插，笔画少、人眼易读） */
const DIGIT_TO_HAN_SIMPLE: readonly string[] = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
/** 数字 → 大写财务数字（更难被正则识别，笔画多） */
const DIGIT_TO_HAN_FORMAL: readonly string[] = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];

/** 穿插用的可见汉字干扰符（弱干扰、不破坏可读性） */
const HAN_FILLERS: readonly string[] = ['·', '。', '「', '」', '『', '』', '（', '）', '～', '—', '•'];

/** 穿插用的 emoji（中性、小巧，不抢眼） */
const EMOJI_FILLERS: readonly string[] = ['✨', '🌟', '💫', '🔹', '🔸', '▪️', '◾', '◇', '◆', '✦'];

/** 穿插用的可见特殊符号 */
const SYMBOL_FILLERS: readonly string[] = ['★', '☆', '※', '◎', '◇', '◆', '○', '●', '△', '▲'];

/** 零宽字符集（激进层用） */
const ZERO_WIDTH_CHARS: readonly string[] = ['\u200B', '\u200C', '\u200D', '\u2060'];

/** 可见分隔符（打断连续数字用） */
const SEPARATORS: readonly string[] = ['\u3000', '\t']; // 全角空格 / 制表符

/**
 * leet 字母映射：经典可逆替换，人需辨别但 AI 一看就懂。
 * 只选一对一映射（保证无损还原）。
 */
const LEET_MAP: Readonly<Record<string, string>> = {
  a: '@', e: '3', i: '!', o: '0', s: '$', t: '7', l: '1', b: '8', g: '9',
};

/**
 * 敏感联系方式关键词 → 伪装策略。
 * 机器靠这些关键词识别「这里藏着联系方式」，所以把它们替换成
 * 人能联想、但机器正则匹配不上的形态。
 *
 * 【百分百混淆原则】替换后的结果里绝对不能出现原始关键词的连续
 * 字符序列。三种策略都保证打散原词：
 * - emoji：用相关表情完全替代（微信→💚，原词字符全部消失）
 * - 反写+夹码：倒序且每个字符间插符号（电话→话◆电，原序列被打断）
 * - 拆字夹码：每个字符之间都插符号（邮箱→邮★箱◇，非连续）
 */
interface KeywordDisguiseEntry {
  /** 原始关键词（中文原样，英文区分大小写变体） */
  keyword: string;
  /** emoji 替代 */
  emoji: string;
}

const KEYWORD_DISGUISES: readonly KeywordDisguiseEntry[] = [
  { keyword: '微信', emoji: '💚' },
  { keyword: '加微', emoji: '💚' },
  { keyword: '电话', emoji: '📞' },
  { keyword: '手机', emoji: '📱' },
  { keyword: '号码', emoji: '#️⃣' },
  { keyword: '邮箱', emoji: '✉️' },
  { keyword: '邮件', emoji: '📧' },
  { keyword: 'qq', emoji: '🐧' },
  { keyword: 'QQ', emoji: '🐧' },
  { keyword: 'Q群', emoji: '🐧' },
  { keyword: 'tel', emoji: '☎️' },
  { keyword: 'Tel', emoji: '☎️' },
  { keyword: 'email', emoji: '📧' },
  { keyword: 'Email', emoji: '📧' },
  { keyword: 'wx', emoji: '💚' },
  { keyword: 'Wx', emoji: '💚' },
  { keyword: 'WX', emoji: '💚' },
  { keyword: 'contact', emoji: '👤' },
  { keyword: 'Contact', emoji: '👤' },
];

/**
 * 伪装单个关键词：保证替换后不出现原始字符序列。
 * 随机用三种方式之一，每种都彻底打断原词：
 */
function disguiseKeyword(keyword: string, emoji: string): string {
  const mode = secureRandomInt(0, 2);
  if (mode === 0) {
    // emoji 完全替代（原词字符全部消失）
    return emoji;
  }
  const chars = Array.from(keyword);
  if (mode === 1) {
    // 反写 + 每字间插符号（原序列彻底打断，如 电话→话◆电）
    return chars.reverse().map((c, i) => (i < chars.length - 1 ? c + securePick(SYMBOL_FILLERS) : c)).join('');
  }
  // 拆字 + 每字间插符号（如 邮箱→邮★箱，单字间有符号不连续）
  if (chars.length < 2) return emoji;
  return chars.map((c, i) => (i < chars.length - 1 ? c + securePick(SYMBOL_FILLERS) : c)).join('');
}

/**
 * 对整段文本做敏感词伪装（强制层，始终生效）：
 * 扫描所有关键词，每个出现都替换，保证百分百混淆。
 * 返回 { text, count } —— count 是伪装了几个关键词。
 */
function applyKeywordDisguise(text: string): { text: string; count: number } {
  let result = text;
  let count = 0;
  // 按关键词长度降序处理（避免短词先匹配破坏长词）
  const sorted = [...KEYWORD_DISGUISES].sort((a, b) => b.keyword.length - a.keyword.length);
  for (const entry of sorted) {
    while (result.includes(entry.keyword)) {
      result = result.replace(entry.keyword, disguiseKeyword(entry.keyword, entry.emoji));
      count++;
    }
  }
  return { text: result, count };
}

/** 罗马数字基本符号（1-10、50、100、500、1000） */
const ROMAN_VALUES: readonly [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
  [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

/** 阿拉伯数字 → 罗马数字（仅 1-3999 有意义；0 或超大返回原数字串） */
function toRoman(n: number): string {
  if (n < 1 || n > 3999) return String(n);
  let result = '';
  let remaining = n;
  for (const [value, symbol] of ROMAN_VALUES) {
    while (remaining >= value) {
      result += symbol;
      remaining -= value;
    }
  }
  return result;
}

/** 段落分隔正则：按逗号/空格/换行/中文标点拆段（保留分隔符） */
const SEGMENT_SPLIT_RE = /([,，\s、；;]+)/;

/**
 * 邮箱混淆：@ 替换成 emoji + 域名点号打断。
 *
 * 两步处理，让 \S+@\S+\.\S+ 这类邮箱正则彻底失效：
 * 1. @ 替换：只匹配邮箱格式的 @（前后是字母/数字），换成 📧/✉️/💌/📨/📮。
 *    避免误伤 @用户名、代码装饰器等。
 * 2. 域名点号打断：把邮箱域名里的 . 替换成可见符号（如 x.com→x◆com）。
 *    只处理 @ 之后域名部分的点（用户名部分的点如 first.last@ 不动，
 *    避免破坏邮箱语义）。点号换成符号后人仍能辨认（x◆com = x.com）。
 */
const AT_EMOJIS: readonly string[] = ['📧', '✉️', '💌', '📨', '📮'];
/** 匹配邮箱格式的 @：前一位是字母/数字/下划线，后一位也是 */
const EMAIL_AT_RE = /([a-zA-Z0-9_])@([a-zA-Z0-9])/g;
/** 匹配域名里的点：字母/数字 后跟 . 再跟字母（如 x.com 的 .com） */
const DOMAIN_DOT_RE = /([a-zA-Z0-9])\.([a-zA-Z])/g;

/** 对整段文本做邮箱混淆（@ 替换 + 域名点号打断），返回替换次数 */
function applyEmailObfuscate(text: string): { text: string; count: number } {
  let count = 0;
  // 1) @ 替换成 emoji
  let result = text.replace(EMAIL_AT_RE, (_m, before: string, after: string) => {
    count++;
    return before + securePick(AT_EMOJIS) + after;
  });
  // 2) 域名点号打断（只处理字母.字母模式，如 x.com 的点）
  result = result.replace(DOMAIN_DOT_RE, (_m, before: string, after: string) => {
    count++;
    return before + securePick(SYMBOL_FILLERS) + after;
  });
  return { text: result, count };
}

/**
 * 同形字映射：拉丁字母 → 视觉上几乎一样的西里尔/希腊字母。
 * 机器按 ASCII 码点匹配会失败（码点完全不同），人眼几乎看不出差别。
 */
const HOMOGLYPH_MAP: Readonly<Record<string, string>> = {
  a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', y: 'у', x: 'х',
  A: 'А', E: 'Е', O: 'О', P: 'Р', C: 'С', Y: 'У', X: 'Х',
};

// ════════════════════════════════════════════════════════════════
// 变换核心
// ════════════════════════════════════════════════════════════════

/** 概率命中（[0,100] 闭区间百分比） */
function chance(percent: number): boolean {
  return secureRandomInt(1, 100) <= percent;
}

/**
 * 主变换函数。对同一输入 + 同一 options 多次调用会产出不同结果（随机性），
 * 这是设计如此——用户每次点「生成」拿到 3 条不同候选挑最满意的。
 */
export function obfuscate(input: string, opts: ObfuscateOptions): ObfuscateResult {
  /** 记录实际生效的变换，用于生成 note */
  const applied: string[] = [];

  // —— 敏感词伪装（强制层，始终生效）：在字符级变换之前，先把「电话/微信/
  //    邮箱/QQ」等关键词替换成 emoji/反写夹码/拆字夹码。保证百分百混淆，
  //    替换后不出现原始关键词的连续字符序列。必须最先做，否则后续变换会
  //    打散关键词，导致部分漏网。
  let sourceText = input;
  const { text: disguisedText, count: disguiseCount } = applyKeywordDisguise(input);
  sourceText = disguisedText;
  if (disguiseCount > 0) applied.push('敏感词伪装');

  // —— 邮箱混淆（可见层）：@ 替换成 emoji + 域名点号打断。
  //    让 \S+@\S+\.\S+ 邮箱正则失效。受 emailObfuscate 开关控制。
  if (opts.emailObfuscate) {
    const { text: emailObfText, count: emailObfCount } = applyEmailObfuscate(sourceText);
    sourceText = emailObfText;
    if (emailObfCount > 0) applied.push('邮箱混淆');
  }

  const codePoints = Array.from(sourceText); // 正确按 Unicode 码点拆分（含 emoji 不被拆碎）
  const out: string[] = [];

  // —— 大小写混杂检测。若原文同时含大小写字母，说明用户原值就有大小写
  //    区分（如微信号 AbcDef），打乱会丢失信息 → 强制跳过 caseShuffle。
  const hasMixedCase = /[a-z]/.test(sourceText) && /[A-Z]/.test(sourceText);
  const effectiveCaseShuffle = opts.caseShuffle && !hasMixedCase;
  if (opts.caseShuffle && hasMixedCase) {
    applied.push('大小写已保留');
  }

  // 数字转中文：每条结果随机选用简体或大写财务版（避免单一映射被识破）
  const useFormalDigits = opts.digitToWords && chance(50);

  for (let i = 0; i < codePoints.length; i++) {
    const ch = codePoints[i]!;

    // —— 先决定是否在字符「之前」插入穿插物（间隙插入）——
    // 用 i>0 确保不在开头插（开头插干扰符太突兀）
    if (i > 0) {
      // 可见穿插：每个间隙低概率命中，避免文本被塞爆
      if (opts.insertHan && chance(25)) {
        out.push(securePick(HAN_FILLERS));
        applied.push('穿插汉字');
      }
      if (opts.insertEmoji && chance(15)) {
        out.push(securePick(EMOJI_FILLERS));
        applied.push('穿插表情');
      }
      if (opts.insertSymbol && chance(20)) {
        out.push(securePick(SYMBOL_FILLERS));
        applied.push('穿插符号');
      }
      // 不可见穿插：更高概率（反正看不见，多塞点对抗更强）
      if (opts.zeroWidth && chance(60)) {
        out.push(securePick(ZERO_WIDTH_CHARS));
        applied.push('零宽字符');
      }
    }

    // —— 字符本体变换 ——
    let transformed = ch;

    // 同形字替换（激进层）：命中映射表的字母有概率替换
    if (opts.homoglyph && HOMOGLYPH_MAP[ch] && chance(60)) {
      transformed = HOMOGLYPH_MAP[ch]!;
      applied.push('同形字');
    }

    // 大小写随机：字母有概率改大写（原本小写→大写，打乱规律）
    // 用 effectiveCaseShuffle：原文大小写混杂时自动失效（需求2）
    if (effectiveCaseShuffle && /[a-z]/.test(transformed) && chance(55)) {
      transformed = transformed.toUpperCase();
      applied.push('大小写打乱');
    }

    // leet 字母替换（变态层）：命中映射表的小写字母有概率替换成形近符号
    if (opts.leetReplace && LEET_MAP[transformed.toLowerCase()] && chance(50)) {
      transformed = LEET_MAP[transformed.toLowerCase()]!;
      applied.push('leet替换');
    }

    // 数字转中文：有概率转（不全部转，保留部分阿拉伯数字，识别难度更高）
    if (opts.digitToWords && /[0-9]/.test(transformed) && chance(60)) {
      const n = transformed.charCodeAt(0) - 48; // '0'.charCodeAt = 48
      transformed = (useFormalDigits ? DIGIT_TO_HAN_FORMAL : DIGIT_TO_HAN_SIMPLE)[n]!;
      applied.push('数字转中文');
    }

    out.push(transformed);

    // —— 可见分隔符：连续数字（3+ 位）之后插入，打断 \d{11} 这类正则 ——
    if (opts.visibleSeparator && /[0-9]/.test(ch)) {
      // 往后看是否还有连续数字
      const nextCh = codePoints[i + 1];
      if (/[0-9]/.test(nextCh ?? '') && chance(30)) {
        out.push(securePick(SEPARATORS));
        applied.push('可见分隔');
      }
    }
  }

  // 末尾零宽字符兜底（让文本末尾也带一点干扰）
  if (opts.zeroWidth && chance(70)) {
    out.push(securePick(ZERO_WIDTH_CHARS));
    if (!applied.includes('零宽字符')) applied.push('零宽字符');
  }

  // —— 变态层后处理（作用于 join 后的完整文本）——
  let text = out.join('');

  // 数字串转罗马/二进制：找出连续阿拉伯数字串（未被 digitToWords 转走的），
  // 整体转罗马数字或二进制（二选一，按串独立随机）。
  if (opts.digitToRoman) {
    text = text.replace(/\d{2,}/g, (match) => {
      const n = Number(match);
      // 随机选罗马或二进制；罗马对 0 或超大无意义时退回原数字
      if (chance(50)) {
        const roman = toRoman(n);
        if (roman !== match) {
          if (!applied.includes('罗马数字')) applied.push('罗马数字');
          return roman;
        }
        return match;
      }
      if (!applied.includes('二进制')) applied.push('二进制');
      return n.toString(2);
    });
  }

  // 段落打乱 + 密集零宽：按分隔符拆段，段序随机打乱，再在字符间密集插零宽。
  if (opts.shuffleWords) {
    const segments = text.split(SEGMENT_SPLIT_RE).filter((s) => s.length > 0);
    // 只打乱「内容段」（非分隔符），分隔符位置保留
    const contentSegs = segments.filter((s) => !SEGMENT_SPLIT_RE.test(s));
    const sepSegs = segments.filter((s) => SEGMENT_SPLIT_RE.test(s));
    if (contentSegs.length > 1) {
      const shuffledContent = secureShuffle(contentSegs);
      // 重新交错：内容段 + 分隔符交替（分隔符不足时直接拼接）
      const rebuilt: string[] = [];
      for (let i = 0; i < shuffledContent.length; i++) {
        rebuilt.push(shuffledContent[i]!);
        if (i < sepSegs.length) rebuilt.push(sepSegs[i]!);
      }
      text = rebuilt.join('');
      applied.push('段序打乱');
    }
    // 密集零宽：每个字符间都插一个零宽字符（比激进档密集得多）
    text = Array.from(text)
      .join(securePick(ZERO_WIDTH_CHARS));
    applied.push('密集零宽');
  }

  // Base64 终态编码（最后一步）：整段编码，人完全看不懂，AI 一眼识别。
  if (opts.base64Encode) {
    try {
      // 用 UTF-8 安全编码（支持中文）
      const bytes = new TextEncoder().encode(text);
      let binary = '';
      for (const b of bytes) binary += String.fromCharCode(b);
      text = btoa(binary);
      applied.push('Base64编码');
    } catch {
      // btoa 失败（极端情况）：保留原文本
    }
  }

  // —— 生成 note：去重 + 汇总 ——
  const uniqueApplied = [...new Set(applied)];
  const note = buildNote(uniqueApplied);

  return { text, note, applied: uniqueApplied };
}

/**
 * 智能生成示意说明。只提示确实改变了文本的变换，给读者还原原值的线索。
 * 呼应需求：「修改后在字符串后面追加说明(所有字母改成小写)这类给人示意的文字描述」。
 */
function buildNote(applied: string[]): string {
  const hints: string[] = [];

  if (applied.includes('大小写打乱')) {
    hints.push('字母大小写已打乱，原值请全部按小写理解');
  }
  if (applied.includes('数字转中文')) {
    hints.push('部分数字已转为中文数字');
  }
  if (applied.includes('同形字')) {
    hints.push('部分字母已替换为视觉相同的其它语言字符');
  }
  if (applied.includes('穿插汉字') || applied.includes('穿插表情') || applied.includes('穿插符号')) {
    hints.push('文本中穿插了干扰符号，请忽略非联系方式字符');
  }
  if (applied.includes('可见分隔')) {
    hints.push('数字间可能插入了空格/制表符');
  }
  if (applied.includes('零宽字符')) {
    hints.push('含不可见字符（部分平台可能已过滤）');
  }
  // —— 变态层 ——
  if (applied.includes('大小写已保留')) {
    hints.push('原文已含大小写区分，未做大小写变换');
  }
  if (applied.includes('leet替换')) {
    hints.push('部分字母已替换为形近符号（a→@、e→3、o→0 等 leet）');
  }
  if (applied.includes('罗马数字')) {
    hints.push('部分数字串已转为罗马数字（如 138→CXXXVIII）');
  }
  if (applied.includes('二进制')) {
    hints.push('部分数字串已转为二进制（如 138→10001010）');
  }
  if (applied.includes('段序打乱')) {
    hints.push('文本段落顺序已被打乱，请按语义重排');
  }
  if (applied.includes('密集零宽')) {
    hints.push('字符间密集插入了零宽字符，请全部去除');
  }
  if (applied.includes('Base64编码')) {
    hints.push('整段已 Base64 编码，请先解码（atob）');
  }
  if (applied.includes('敏感词伪装')) {
    hints.push('电话/微信/邮箱/QQ 等关键词已替换为 emoji 或反写或夹乱码，请还原原词');
  }
  if (applied.includes('邮箱混淆')) {
    hints.push('邮箱地址中的 @ 已替换为 emoji（📧/✉️/💌 等），域名点号已替换为符号，请还原（@ 和 .）');
  }

  if (hints.length === 0) return '';
  return '（' + hints.join('；') + '）';
}

// ════════════════════════════════════════════════════════════════
// 预设档位
// ════════════════════════════════════════════════════════════════

/** 预设档位定义 */
export interface Preset {
  id: string;
  name: string;
  /** 一句话说明这个档位开了什么 */
  hint: string;
  options: ObfuscateOptions;
}

/**
 * 默认选项：可见层全开（稳健、能扛规范化）、不可见层全关（避免被严格平台过滤）。
 * 对齐用户决策：可见变换为主，不可见字符默认关闭 + 警示。
 */
export const DEFAULT_OPTIONS: ObfuscateOptions = {
  caseShuffle: true,
  digitToWords: true,
  insertHan: true,
  insertEmoji: true,
  insertSymbol: true,
  visibleSeparator: true,
  emailObfuscate: true,
  zeroWidth: false,
  homoglyph: false,
  leetReplace: false,
  digitToRoman: false,
  shuffleWords: false,
  base64Encode: false,
  keywordDisguise: false,
};

/** 全部可见层开关 true、不可见层全 false（= DEFAULT_OPTIONS，预设内部复用别名） */
const VISIBLE_ALL_ON: ObfuscateOptions = { ...DEFAULT_OPTIONS };

export const PRESETS: Preset[] = [
  {
    id: 'mild',
    name: '温和',
    hint: '大小写打乱 + 数字转中文 + 邮箱混淆，最稳、文本最干净',
    options: {
      caseShuffle: true,
      digitToWords: true,
      insertHan: false,
      insertEmoji: false,
      insertSymbol: false,
      visibleSeparator: false,
      emailObfuscate: true,
      zeroWidth: false,
      homoglyph: false,
      leetReplace: false,
      digitToRoman: false,
      shuffleWords: false,
      base64Encode: false,
      keywordDisguise: false,
    },
  },
  {
    id: 'balanced',
    name: '均衡',
    hint: '可见变换全开，能扛平台规范化，推荐',
    options: { ...VISIBLE_ALL_ON },
  },
  {
    id: 'aggressive',
    name: '激进',
    hint: '可见 + 不可见全开，对抗最强但可能被严格平台过滤',
    options: {
      ...VISIBLE_ALL_ON,
      zeroWidth: true,
      homoglyph: true,
    },
  },
  {
    id: 'insane',
    name: '变态',
    hint: '人几乎看不懂，但 AI 按附带规则可精准还原（敏感词伪装/leet/罗马数字/打乱）',
    options: {
      ...VISIBLE_ALL_ON,
      zeroWidth: true,
      homoglyph: true,
      leetReplace: true,
      digitToRoman: true,
      shuffleWords: true,
      base64Encode: false,
      keywordDisguise: true,
    },
  },
];

/** 当前 options 是否与某预设完全一致（用于 UI 高亮当前档位） */
export function matchesPreset(opts: ObfuscateOptions, preset: Preset): boolean {
  return (Object.keys(preset.options) as (keyof ObfuscateOptions)[]).every(
    (k) => opts[k] === preset.options[k],
  );
}
