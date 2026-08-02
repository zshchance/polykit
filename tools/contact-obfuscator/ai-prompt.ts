/**
 * AI 还原提示词 —— 帮接收方用 AI 把变换后的联系方式还原回原文。
 *
 * 【反向 AI 范式】
 *   本工具之前的 AI 玩法都是「用户描述 → 工具生成 prompt → AI 生成内容」。
 *   这里反过来：工具已经把文本变换成「机器难识别、人难直接读」的形态，
 *   接收方拿到后，把这段 prompt + 变换文本一起发给豆包/DeepSeek/ChatGPT，
 *   AI 按 prompt 描述的还原规则，把文本还原成原始联系方式。
 *
 * 【不泄露原文】
 *   prompt 只描述「应用了哪些变换、该怎么还原」，不含任何原始联系方式内容。
 *   原文只存在于变换文本里（且已被变换）。完全符合「数据不出本地」。
 *
 * 【动态生成】
 *   根据当前 ObfuscateOptions 的开关状态，只描述实际开启的变换的还原规则。
 *   全部关闭（纯原文）时返回空串，调用方据此提示「无需还原」。
 */

import type { ObfuscateOptions } from './obfuscate';

/**
 * 根据当前变换开关 + 实际生效的 applied，组装一段给 AI 的「还原提示词」。
 * 接收方把这段 prompt 和变换后的文字一起发给 AI，即可还原出原始联系方式。
 *
 * @param opts 当前开关状态
 * @param applied 本次变换实际生效的标签（来自 obfuscate 返回值的 applied 字段）。
 *                用于精确判断：如原文大小写混杂时 applied 含 '大小写已保留' 而非
 *                '大小写打乱'，prompt 据此不要求 AI 还原大小写。
 * @returns prompt 文本；若所有变换都关闭（无需还原）则返回空串
 */
export function buildDecodePrompt(opts: ObfuscateOptions, applied: string[] = []): string {
  const rules: string[] = [];
  // applied 含 '大小写已保留' 说明原文混杂，caseShuffle 实际未生效 → 不要求还原大小写
  const caseShuffleEffective = opts.caseShuffle && !applied.includes('大小写已保留');

  if (caseShuffleEffective) {
    rules.push('字母大小写被打乱过（原本应是小写），请全部还原为小写字母');
  }
  if (opts.digitToWords) {
    rules.push(
      '部分阿拉伯数字被替换成了中文数字（〇一二三四五六七八九，或大写的 零壹贰叁肆伍陆柒捌玖），请还原成对应的阿拉伯数字',
    );
  }
  // 穿插类：只要任一开启，统一描述为「忽略干扰字符」
  const hasInsertion = opts.insertHan || opts.insertEmoji || opts.insertSymbol;
  if (hasInsertion) {
    const parts: string[] = [];
    if (opts.insertHan) parts.push('汉字标点（如 · 「 」 『 』 ～ — 等）');
    if (opts.insertEmoji) parts.push('emoji 表情');
    if (opts.insertSymbol) parts.push('特殊符号（如 ★ ◆ ※ ◎ ○ ● △ 等）');
    rules.push(`文本中穿插了无关的干扰字符（${parts.join('、')}），请全部忽略、不要出现在还原结果里`);
  }
  if (opts.visibleSeparator) {
    rules.push('数字之间可能插入了全角空格或制表符，请忽略这些分隔符、把数字连起来');
  }
  if (opts.zeroWidth || opts.shuffleWords) {
    rules.push('文本中可能含有肉眼不可见的零宽字符（U+200B/200C/200D/2060），请先全部去除再还原');
  }
  if (opts.homoglyph) {
    rules.push(
      '部分拉丁字母被替换成了视觉上几乎一样的西里尔/希腊字母（如 а↔a、е↔e、о↔o、с↔c），请还原成 ASCII 英文字母',
    );
  }
  // —— 变态层 ——
  if (opts.leetReplace) {
    rules.push('部分字母被替换成了形近符号（a→@、e→3、o→0、s→$、t→7、l→1、i→!、b→8、g→9 等 leet），请反向还原为字母');
  }
  if (opts.digitToRoman) {
    rules.push('部分数字串被转成了罗马数字（如 CXXXVIII）或二进制（如 10001010），请还原成阿拉伯数字');
  }
  if (opts.shuffleWords) {
    rules.push('文本段落顺序被打乱了，请按语义（电话/微信/邮箱等）重新排列成通顺顺序');
  }
  if (opts.base64Encode) {
    rules.push('整段文本经过 Base64 编码，请先用 atob 解码，再按上述其它规则还原');
  }

  // 全部关闭：无需还原
  if (rules.length === 0) return '';

  return `下面这段文字是我的联系方式，经过了字符变换以避开自动识别。请帮我还原成原始的、可直接使用的联系方式。

应用的变换规则（请反向还原）：
${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

请只输出还原后的原始联系方式本身，不要加解释、不要加引号、不要分多条。如果包含多种联系方式（手机/微信/邮箱等），按原样一起输出即可。`;
}

/**
 * 从实际生效的变换标签（applied）生成精炼的自解密规则，拼进复制文本。
 * 基于「实际生效了什么」而非「开了什么开关」，所以更精确
 * （如原文混杂时 applied 含 '大小写已保留' 而非 '大小写打乱'，不会误提还原大小写）。
 *
 * 措辞面向 AI：用紧凑指令式（「转小写」「忽略X」），AI 一看就懂。
 *
 * @param applied obfuscate 返回的 applied 字段（去重标签数组）
 * @returns 紧凑规则串（无则空串）
 */
export function buildInlineRules(applied: string[]): string {
  if (!applied || applied.length === 0) return '';
  const rules: string[] = [];

  // 解码优先级：Base64 必须最先（解码后才能看到其它变换）
  if (applied.includes('Base64编码')) {
    rules.push('先Base64解码(atob)');
  }
  // 去除不可见字符（在内容还原前清理）
  if (applied.includes('零宽字符') || applied.includes('密集零宽')) {
    rules.push('去零宽字符');
  }
  if (applied.includes('段序打乱')) {
    rules.push('按语义重排段落');
  }
  // 内容还原
  if (applied.includes('大小写打乱')) {
    rules.push('字母转小写');
  }
  if (applied.includes('同形字')) {
    rules.push('同形字转ASCII(а→a е→e о→o)');
  }
  if (applied.includes('leet替换')) {
    rules.push('形近符转字母(@→a 3→e 0→o $→s)');
  }
  if (applied.includes('数字转中文')) {
    rules.push('中文数字转阿拉伯');
  }
  if (applied.includes('罗马数字')) {
    rules.push('罗马数字转阿拉伯');
  }
  if (applied.includes('二进制')) {
    rules.push('二进制转十进制');
  }
  // 清理干扰
  if (applied.includes('穿插汉字') || applied.includes('穿插表情') || applied.includes('穿插符号')) {
    rules.push('删穿插的符号/表情');
  }
  if (applied.includes('可见分隔')) {
    rules.push('删数字间空格/制表符');
  }

  if (rules.length === 0) return '';
  return '〔解密规则：' + rules.join(' → ') + '〕';
}

/**
 * 随复制一起带走的暗示文案：追加在变换文本末尾，引导接收方用 AI 还原。
 * 用换行分隔，避免与正文视觉混淆。
 */
export const HINT_SUFFIX = '\n（复制给豆包 / DeepSeek / ChatGPT 等 AI，按上述规则可还原原联系方式）';

// ════════════════════════════════════════════════════════════════
// AI 加密提示词（正向：让 AI 直接产出防检测文本）
// ════════════════════════════════════════════════════════════════

/**
 * 组装一段让 AI 直接生成「防检测联系方式文本」的提示词。
 * 携带用户的原文 + 当前变换设置，AI 据此产出一段保持人类可读、
 * 但能避开机器正则识别的文本。
 *
 * 与 buildDecodePrompt（反向还原）相反，这是正向生成：
 * 用户把这段 prompt 发给豆包/DeepSeek/ChatGPT，AI 直接返回加密后的文本。
 *
 * 【数据出本地说明】
 *   此 prompt 携带用户原文，发给 AI 意味着原文经第三方。
 *   UI 会提示用户这一点（与本地变换引擎的「数据不出本地」不同）。
 *
 * @param input 用户输入的原始联系方式
 * @param opts 当前变换开关
 * @returns prompt 文本
 */
export function buildEncryptPrompt(input: string, opts: ObfuscateOptions): string {
  const desc = input.trim() || '（用户未填写联系方式，请示例生成一段）';
  const techniques: string[] = [];

  if (opts.caseShuffle) {
    techniques.push('把字母大小写随机打乱（主要改大写），但保持可读——读者按小写理解即可');
  }
  if (opts.digitToWords) {
    techniques.push('把部分数字替换成中文数字（如 1→一、8→八，也可用大写 壹捌），不要全部替换以增加识别难度');
  }
  if (opts.insertHan) {
    techniques.push('在字符间随机穿插少量汉字标点（如 · 「 」 ～ 等）作干扰');
  }
  if (opts.insertEmoji) {
    techniques.push('在字符间随机穿插少量 emoji 作干扰');
  }
  if (opts.insertSymbol) {
    techniques.push('在字符间随机穿插少量特殊符号（如 ★ ◆ ※ 等）作干扰');
  }
  if (opts.visibleSeparator) {
    techniques.push('在连续数字之间随机插入全角空格或制表符，打断连续数字串');
  }
  if (opts.zeroWidth) {
    techniques.push('在字符间插入零宽不可见字符（U+200B/200C/200D/2060）');
  }
  if (opts.homoglyph) {
    techniques.push('把部分拉丁字母替换成视觉相同的西里尔/希腊字母（如 a→а、e→е、o→о）');
  }
  if (opts.leetReplace) {
    techniques.push('把部分字母替换成形近符号（leet：a→@、e→3、o→0、s→$、t→7、l→1）');
  }
  if (opts.digitToRoman) {
    techniques.push('把部分数字串转成罗马数字（如 138→CXXXVIII）或二进制（如 138→10001010）');
  }
  if (opts.shuffleWords) {
    techniques.push('把文本段落顺序打乱，并在字符间密集插入零宽字符');
  }
  if (opts.base64Encode) {
    techniques.push('最后把整段文本做 Base64 编码');
  }

  const techBlock = techniques.length > 0
    ? techniques.map((t, i) => `${i + 1}. ${t}`).join('\n')
    : '（用户未选择任何变换，请自由发挥：打乱大小写 + 数字转中文 + 少量穿插符号）';

  // 根据激进程度给不同的「可读性」要求
  const isInsane = opts.base64Encode || opts.shuffleWords || opts.digitToRoman || opts.leetReplace;
  const readabilityReq = isInsane
    ? '可读性要求低：优先对抗效果，人眼难读没关系，但要能在脑中/AI辅助下还原'
    : '必须保持人类可读：读者扫一眼能认出这是联系方式，只是机器正则识别不出来';

  return `你是一个文本加密助手。请把下面这段联系方式，用指定的字符变换技术改写一遍，
目标是：让自动化程序/正则识别不出来这是联系方式，但${readabilityReq}。

【我的联系方式（原文）】
${desc}

【请应用的变换技术】
${techBlock}

【重要约束】
- 只对联系方式本身做变换，不要改变联系方式的内容含义（号码/账号/邮箱地址不能变）。
- 变换要有随机性：同样的字母有的变有的不变，不要机械地全变或全不变。
- 如果原文同时含大小写字母（如 AbcDef），说明大小写有区分意义，不要打乱大小写。
- 直接输出变换后的文本本身，不要加解释、不要加引号、不要加「以下是加密结果」之类的引导语。
- 给出 3 个不同的变换版本，每行一个，方便我挑选。`;
}
