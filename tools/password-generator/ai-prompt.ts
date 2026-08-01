import type { PasswordOptions } from './generator';

/**
 * AI 密码提示词 —— 帮用户用 AI 生成「好记」或「够强」的口令。
 *
 * 【定位】
 *   本工具主功能是【本地密码学随机】生成强密码（crypto.getRandomValues，数据不出本地）。
 *   但纯随机密码的最大痛点是「记不住」。这里提供一条辅助路径：用户描述需求/主题，工具
 *   组装一段提示词，用户复制到自己的 AI 对话（ChatGPT/豆包/DeepSeek 等），AI 直接返回
 *   一段可用的口令 —— 无需回填本程序。
 *
 * 【携带页面设置】
 *   用户可选择是否把主页面上设好的参数（长度、字符类型勾选、每类至少一个）作为硬性约束
 *   注入提示词（默认携带）。不携带时，长度与字符组成完全交由 AI 自由发挥。长度选项只在
 *   主页面有一处，对话框里不再重复出现，避免两处长度互相打架。
 *
 * 【安全边界（呼应全站「纯浏览器运行、数据不出本地」）】
 *   - 工具本身只生成「提示词文本」，不联网、不上传任何数据；发不发出去、发给哪个 AI，
 *     完全由用户自己决定。
 *   - AI 生成的密码会经过第三方 AI 服务，且非密码学随机，强度弱于本工具的主生成器。
 *     因此 UI 会给出醒目提示：重要账号请用主生成器；AI 路径适合「好记优先、够用即可」
 *     的低敏感场景（如临时账号、笔记软件、家庭 WiFi 等）。
 */

/** 提示词风格预设 —— 决定 AI 生成口令的取向 */
export interface PromptStyle {
  id: string;
  name: string;
  /** 一句话说明，给 UI 选项展示用 */
  hint: string;
}

/** 风格预设列表（顺序即 UI 展示顺序） */
export const PROMPT_STYLES: PromptStyle[] = [
  {
    id: 'memorable',
    name: '好记（推荐）',
    hint: '由若干相关词 + 少量数字符号拼接，像 Correct-Horse-Battery!2 那样易记',
  },
  {
    id: 'phrase',
    name: '句子口令',
    hint: '用一句通顺的话改写，首字母 + 标点 + 数字，像 MyCat@2024SleepsAlot',
  },
  {
    id: 'random',
    name: '高随机',
    hint: '尽量无规律的字母数字符号串，强度更高但仍非密码学随机',
  },
];

export type PromptStyleId = (typeof PROMPT_STYLES)[number]['id'];

export function isPromptStyleId(v: unknown): v is PromptStyleId {
  return typeof v === 'string' && PROMPT_STYLES.some((s) => s.id === v);
}

export interface BuildPromptInput {
  /** 用户输入的需求/主题描述（可空，空时按通用强口令处理） */
  description: string;
  /** 风格 id */
  style: PromptStyleId;
  /**
   * 携带的页面设置。为 undefined 表示不携带——提示词完全不提长度/字符限制，AI 自由发挥。
   * 传入时把其中的长度、字符类型勾选、每类至少一个作为硬性要求注入提示词。
   */
  pageOptions?: PasswordOptions;
}

/**
 * 组装让 AI 直接生成口令的提示词。
 *
 * 提示词会：① 给出风格化生成规则；② 在携带页面设置时约束长度与字符组成；③ 要求只给
 * 口令、不给解释；④ 给出多个候选方便挑选。用户把这段提示词复制给 AI，即可直接拿到
 * 可用口令。
 */
export function buildAIPrompt(input: BuildPromptInput): string {
  const desc = input.description.trim();
  const styleBlock = STYLE_RULES[input.style] ?? STYLE_RULES.memorable;

  const descLine = desc
    ? `【我的需求 / 主题】\n${desc}`
    : '【我的需求 / 主题】\n（用户未指定具体主题，请按一个常见、好记的主题自由发挥）';

  const requirements = input.pageOptions
    ? buildHardRequirementsWithPage(input.pageOptions)
    : buildHardRequirementsFree();

  return `你是一个口令生成助手。请按下面的要求，为我生成 ${CANDIDATE_COUNT} 个互不相同的口令。

${descLine}

【生成风格】${styleBlock.name}
${styleBlock.rule}

${requirements}`;
}

/** 字符类标签：键为 PasswordOptions 中的字符类型开关，值为给 AI 看的中文名 */
const CHARSET_LABELS: { key: keyof PasswordOptionsCharKeys; label: string }[] = [
  { key: 'useLower', label: '小写字母 a-z' },
  { key: 'useUpper', label: '大写字母 A-Z' },
  { key: 'useDigits', label: '数字 0-9' },
  { key: 'useSymbols', label: '符号（如 ! @ # $ % & * ? - _）' },
];
type PasswordOptionsCharKeys = Pick<
  PasswordOptions,
  'useLower' | 'useUpper' | 'useDigits' | 'useSymbols'
>;

/**
 * 携带页面设置时的「硬性要求」：把长度、启用的字符类、每类至少一个写进约束。
 * 若用户在主页面只勾了部分字符类，明确告诉 AI「只允许使用…、不要使用未列出的类型」，
 * 与主生成器行为一致。
 */
function buildHardRequirementsWithPage(page: PasswordOptions): string {
  const len = clampLength(page.length);
  const enabled = CHARSET_LABELS.filter((c) => page[c.key]);
  const disabled = CHARSET_LABELS.filter((c) => !page[c.key]);

  const lines: string[] = [];
  lines.push(`1. 每个口令长度约 ${len} 个字符（±2 字符以内）。`);

  // 字符组成：列出启用类；若有禁用类，明确排除。
  // 「每类至少一个」并入同一条，避免单独成行显得啰嗦。
  if (enabled.length === 0) {
    // 极端情况：主页面所有字符类型都被取消勾选。如实告知，交由 AI 权衡。
    lines.push('2. 字符类型未作限定，请自行选择能保证强度的字符组成。');
  } else if (disabled.length === 0) {
    lines.push(
      `2. 必须同时包含：${enabled.map((c) => c.label).join('、')} 至少各一个。`,
    );
  } else {
    const enabledText = enabled.map((c) => c.label).join('、');
    const disabledText = disabled.map((c) => c.label).join('、');
    lines.push(
      `2. 只允许使用：${enabledText}${page.requireEachEnabled ? '，且每类至少出现一个字符' : ''}；不要使用：${disabledText}。`,
    );
  }

  // 强度提示（沿用原 len<12 逻辑）
  if (len < 12) {
    lines.push(
      '3. 长度较短，优先保证强度：避免连续重复字符、避免 keyboard walk（如 qwerty、1234）。',
    );
  } else {
    lines.push(
      '3. 可适当加入主题相关词或短语，提升可记忆性，但不要牺牲上面的字符多样性要求。',
    );
  }

  lines.push(
    `4. 只输出 ${CANDIDATE_COUNT} 个口令本身，每行一个，放在一个 \`\`\`text 代码块里。不要编号、不要解释、不要给「这是为你生成的…」之类的引导语。`,
  );
  lines.push(
    `5. ${CANDIDATE_COUNT} 个口令要明显不同（不同词、不同结构、不同数字符号位置），不要只是改一两个字符的变体。`,
  );

  return `【硬性要求】\n${lines.join('\n')}

【输出格式（务必照此结构）】
\`\`\`text
口令1
口令2
口令3
\`\`\`
代码块之外不要写任何文字。`;
}

/**
 * 不携带页面设置时的「硬性要求」：不提长度、不提字符限制，让 AI 自由发挥，
 * 但仍要求「可用且足够强度」，避免用户取消后拿到一堆弱口令。
 */
function buildHardRequirementsFree(): string {
  return `【要求】
1. 长度与字符组成由你自行决定，但应保证是一段可用、足够强度的口令（建议同时含大小写字母、数字，可酌情加符号）。
2. 只输出 ${CANDIDATE_COUNT} 个口令本身，每行一个，放在一个 \`\`\`text 代码块里。不要编号、不要解释、不要给「这是为你生成的…」之类的引导语。
3. ${CANDIDATE_COUNT} 个口令要明显不同（不同词、不同结构、不同数字符号位置），不要只是改一两个字符的变体。

【输出格式（务必照此结构）】
\`\`\`text
口令1
口令2
口令3
\`\`\`
代码块之外不要写任何文字。`;
}

/** 候选口令数量 */
const CANDIDATE_COUNT = 3;

/** 各风格的生成规则文案 */
const STYLE_RULES: Record<PromptStyleId, { name: string; rule: string }> = {
  memorable: {
    name: '可记忆（词组 + 数字符号）',
    rule: '由若干个【与主题相关、好认好记】的词组成，词之间用分隔符（如 - _ .）连接，再在某处插入 1-2 位数字和 1 个符号。词用常见英文单词或 2-4 字中文词；可对部分字母做大小写变化提升强度但保持可读。例：Orbit-Nebula!7、星空-航海-42#',
  },
  phrase: {
    name: '句子口令',
    rule: '基于一句【与主题相关、通顺好记】的短句改写：取各词首字母（或整词）、保留标点、把某些词换成数字或符号（如 to→2、at→@、and→&），并在句首或句末加数字。例：MyCat@2024Sleeps、I<3CoffeeEveryAM',
  },
  random: {
    name: '高随机',
    rule: '尽量无规律的字母、数字、符号混合串，不追求语义可读，但避免键盘连续键位（qwerty/asdf）和常见单词。例：k9@Qv2#mLp7!xR',
  },
};

/** 把长度限制在合法区间 [4, 64] */
function clampLength(n: number): number {
  if (!Number.isFinite(n)) return 16;
  return Math.max(4, Math.min(64, Math.round(n)));
}
