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

import { secureRandomInt, securePick } from '@/core/utils/random';

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
  // —— 不可见变换（激进层，默认关，可能被平台过滤）——
  /** 零宽字符穿插（U+200B/200C/200D/2060） */
  zeroWidth: boolean;
  /** 同形字替换（拉丁 a/e/o 等 → 西里尔/希腊同形字） */
  homoglyph: boolean;
}

/** 单次变换结果 */
export interface ObfuscateResult {
  /** 变换后的文本 */
  text: string;
  /** 给人的示意说明（已生效变换的汇总，附在文本后帮助人理解原值） */
  note: string;
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
  const codePoints = Array.from(input); // 正确按 Unicode 码点拆分（含 emoji 不被拆碎）
  const out: string[] = [];
  /** 记录实际生效的变换，用于生成 note */
  const applied: string[] = [];

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
    if (opts.caseShuffle && /[a-z]/.test(transformed) && chance(55)) {
      transformed = transformed.toUpperCase();
      applied.push('大小写打乱');
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

  // —— 生成 note：去重 + 汇总 ——
  const uniqueApplied = [...new Set(applied)];
  const note = buildNote(uniqueApplied);

  return { text: out.join(''), note };
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
  zeroWidth: false,
  homoglyph: false,
};

/** 全部可见层开关 true、不可见层全 false（= DEFAULT_OPTIONS，预设内部复用别名） */
const VISIBLE_ALL_ON: ObfuscateOptions = { ...DEFAULT_OPTIONS };

export const PRESETS: Preset[] = [
  {
    id: 'mild',
    name: '温和',
    hint: '只做大小写打乱 + 数字转中文，最稳、文本最干净',
    options: {
      caseShuffle: true,
      digitToWords: true,
      insertHan: false,
      insertEmoji: false,
      insertSymbol: false,
      visibleSeparator: false,
      zeroWidth: false,
      homoglyph: false,
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
];

/** 当前 options 是否与某预设完全一致（用于 UI 高亮当前档位） */
export function matchesPreset(opts: ObfuscateOptions, preset: Preset): boolean {
  return (Object.keys(preset.options) as (keyof ObfuscateOptions)[]).every(
    (k) => opts[k] === preset.options[k],
  );
}
