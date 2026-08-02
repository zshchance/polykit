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
 * 根据当前变换开关，组装一段给 AI 的「还原提示词」。
 * 接收方把这段 prompt 和变换后的文字一起发给 AI，即可还原出原始联系方式。
 *
 * @returns prompt 文本；若所有变换都关闭（无需还原）则返回空串
 */
export function buildDecodePrompt(opts: ObfuscateOptions): string {
  const rules: string[] = [];

  if (opts.caseShuffle) {
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
  if (opts.zeroWidth) {
    rules.push('文本中可能含有肉眼不可见的零宽字符（U+200B/200C/200D/2060），请先全部去除再还原');
  }
  if (opts.homoglyph) {
    rules.push(
      '部分拉丁字母被替换成了视觉上几乎一样的西里尔/希腊字母（如 а↔a、е↔e、о↔o、с↔c），请还原成 ASCII 英文字母',
    );
  }

  // 全部关闭：无需还原
  if (rules.length === 0) return '';

  return `下面这段文字是我的联系方式，经过了字符变换以避开自动识别。请帮我还原成原始的、可直接使用的联系方式。

应用的变换规则（请反向还原）：
${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

请只输出还原后的原始联系方式本身，不要加解释、不要加引号、不要分多条。如果包含多种联系方式（手机/微信/邮箱等），按原样一起输出即可。`;
}

/**
 * 随复制一起带走的暗示文案：追加在变换文本末尾，引导接收方用 AI 还原。
 * 用换行分隔，避免与正文视觉混淆。
 */
export const HINT_SUFFIX = '\n（复制给豆包 / DeepSeek / ChatGPT 等 AI，可还原原联系方式）';
