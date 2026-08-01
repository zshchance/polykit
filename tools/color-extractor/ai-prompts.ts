/**
 * AI 玩法提示词 —— 把提取出的色（hex + 占比）注入成可复制的趣味/实用提示词。
 *
 * 设计与 color-prompt/templates.ts 一致：每个玩法一个 buildXxxPrompt(colors)，
 * 输入 ExtractedColor[]，输出注入好色值的提示词文本。纯函数，无副作用。
 *
 * 这些提示词可丢给任意 AI（GLM/Kimi/通义/ChatGPT/Midjourney 等），
 * 利用「本地提取的真实配色」驱动各种玩法：颜色迁移、风格统一、配色重造……
 *
 * 色值由用户在浏览器本地提取，提示词里明示这一点，强化「数据不出本地」的定位。
 */

import type { ExtractedColor } from './extractor';

/** 玩法条目：id + 芯片文案 + 构建函数。id 用于 chip 切换状态。 */
export interface PromptRecipe {
  id: string;
  /** 芯片显示文案（含 emoji） */
  label: string;
  /** 一句话玩法说明（卡片/tooltip 用） */
  hint: string;
  /** 实用(true) 或 趣味(false)，仅作分组提示，UI 暂不强制分组 */
  practical: boolean;
  build: (colors: ExtractedColor[]) => string;
}

// ────────── 色值文本辅助 ──────────

/** 占比 → 百分比字符串，如 0.452 → "45.2%" */
function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** hex 列表，逗号分隔：#1A2B3C, #4D5E6F, ... */
function hexList(colors: ExtractedColor[]): string {
  return colors.map((c) => c.hex).join(', ');
}

/** 带 hex 的占比清单，每色一行：#1A2B3C —— 45.2% */
function ratioList(colors: ExtractedColor[]): string {
  return colors.map((c) => `- ${c.hex} —— ${pct(c.ratio)}`).join('\n');
}

/**
 * 按占比自动分配色彩角色（60-30-10 法则的简化版）：
 *   - 占比最大 → 主背景/铺底
 *   - 第二大 → 主强调色（主按钮/标题）
 *   - 第三大 → 次要强调/点缀
 *   - 其余 → 辅助色
 * 返回人类可读的角色分配说明，用于「风格统一」玩法。
 */
function roleAssignment(colors: ExtractedColor[]): string {
  if (colors.length === 0) return '';
  const lines: string[] = [];
  colors.forEach((c, i) => {
    let role: string;
    if (i === 0) role = '主背景/大面积铺底';
    else if (i === 1) role = '主强调色（标题/主按钮/核心元素）';
    else if (i === 2) role = '次要强调/点缀';
    else role = '辅助色（分隔/图标/次要文字）';
    lines.push(`- ${c.hex}（${pct(c.ratio)}）→ ${role}`);
  });
  return lines.join('\n');
}

// ────────── 6 个玩法构建器 ──────────

/**
 * 【实用·颜色迁移】把这组配色（含占比）作为颜色映射源，
 * 把另一张/另一批图重绘成相同色调。
 */
function buildColorTransfer(colors: ExtractedColor[]): string {
  return `请把下面这组配色（含每色占比）作为「颜色映射源」，把我接下来提供的图片重绘成相同的色调与气质。这组色是从一张我喜欢的图里本地提取的真实主色及占比，请忠实参考。

【源配色（hex + 在原图中的占比）】
${ratioList(colors)}

【hex 列表（便于直接调用）】
${hexList(colors)}

【任务】
1. 把我提供的图的主色，按"相近映射 + 占比权重"替换成上面这组源色：
   占比大的色对应原图大面积色，占比小的色对应点缀/细节。
2. 保持原图的构图、明暗结构、纹理不变，只迁移"色彩气质"。
3. 如果有多张图，让它们迁移后色调统一、像同一套视觉。
4. 先简要说明你的迁移思路（每张图的主色如何映射），再给出重绘结果。

请基于这组源配色重绘我接下来上传的图。`;
}

/**
 * 【实用·PPT/网页风格统一】用这组配色统一美化 PPT/网页，
 * 给出每色用法 + 配色比例建议。
 */
function buildStyleUnify(colors: ExtractedColor[]): string {
  return `请用下面这组我本地提取的真实配色，统一美化我的 PPT / 网页，使其整体气质统一、专业且富有美感。

【配色方案（已按占比降序排列）】
${roleAssignment(colors)}

【风格关键词（请你根据这组色的色相/明度/饱和度自行归纳）】
（请用 3-5 个词概括这组配色传达的气质，如"沉稳、商务、克制"或"清新、活泼、年轻"）

【设计要求】
1. 背景使用占比最大的色「${colors[0]?.hex ?? ''}」大面积铺底，保持留白与呼吸感。
2. 主强调色「${colors[1]?.hex ?? ''}」用于标题、主按钮、核心强调，控制使用面积以保持克制。
3. 次要强调「${colors[2]?.hex ?? ''}」用于标签、小图标、装饰细节，起画龙点睛作用。
4. 正文与次要文字用其余辅助色，确保与背景对比度满足可读性（正文对比度建议 ≥ 4.5:1）。
5. 色块比例建议约 60% 背景 / 30% 主色与强调 / 10% 点缀，对应提取出的真实占比。

请基于这组配色，输出美化后的设计方案（配色后的界面描述、搭配示例或具体 hex 用法均可）。`;
}

/**
 * 【实用·配色重造】在保留气质的前提下，生成 3 套衍生配色。
 */
function buildPaletteRemix(colors: ExtractedColor[]): string {
  return `下面这组配色是我从一张图里本地提取的真实主色。请在"保留这组配色整体气质"的前提下，微调生成 3 套衍生配色方案，每套都要可以直接使用。

【原配色】
${ratioList(colors)}

【要求】
1. 衍生方案一「更和谐」：色相更接近、对比更柔和，适合长时间阅读的界面。
2. 衍生方案二「更对比」：强化主次、提升视觉冲击，适合海报/封面。
3. 衍生方案三「更柔和」：降低饱和度、整体更高级灰，适合文艺/克制风格。
4. 每套给 4-6 个 hex，并标注每个色在方案里的角色（背景/主色/点缀等）。
5. 简要说明每套相比原配色调整了什么。

请输出这 3 套衍生配色。`;
}

/**
 * 【实用·渐变/主题】用这组色生成 CSS 渐变方案。
 */
function buildGradientTheme(colors: ExtractedColor[]): string {
  return `请用下面这组我本地提取的真实配色，生成一套可直接用的 CSS 渐变主题方案。

【配色（hex 列表）】
${hexList(colors)}

【要求】
1. 主背景渐变（页面大面积用）。
2. 卡片/面板渐变（次要容器）。
3. 按钮渐变（主按钮 + 次要按钮各一个）。
4. 每条渐变给出 CSS 代码（linear-gradient 或 radial-gradient），注明用到的 hex。
5. 顺带给出这组渐变适合的页面气质（如"科技感/温暖/商务"）。

请输出这套 CSS 渐变方案。`;
}

/**
 * 【趣味·图说故事】推测这组色对应的画面，生成 3 个描述。
 */
function buildImageStory(colors: ExtractedColor[]): string {
  return `下面这组色是从一张图里本地提取出来的真实主色及占比，但我没把原图给你。请仅根据这组色，反推这张图可能是什么样，发挥想象生成画面描述。

【配色（hex + 占比）】
${ratioList(colors)}

【任务】
1. 先简要分析这组色给你什么感受（季节/时间/情绪/材质）。
2. 生成 3 个截然不同的"画面猜想"，每个 2-3 句话：
   设想这张图的主题、场景、主体、光线。
3. 第三个猜想请尽量反常规、有戏剧性，越出乎意料越好。

请用这组色反推画面。`;
}

/**
 * 【趣味·人物性格色】把这组色拟人化，生成性格画像。
 */
function buildPersonaColor(colors: ExtractedColor[]): string {
  return `请把下面这组我本地提取的真实配色"拟人化"——如果这组色是一个人，TA 会是什么样？

【配色（hex + 占比）】
${ratioList(colors)}

【任务】
1. 性格画像：内向/外向、气质、MBTI（猜一个并说明理由）、口头禅。
2. 穿搭风格：日常会穿什么色系、什么单品。
3. 一天的生活片段：用 3 句话描绘 TA 的一天。
4. 一句话台词：TA 最可能说出口的一句金句。

请把这组色拟人化，写得鲜活、有画面感。`;
}

/** 所有玩法（顺序即芯片顺序）。UI 据此渲染芯片与切换预览。 */
export const PROMPT_RECIPES: PromptRecipe[] = [
  {
    id: 'color-transfer',
    label: '🎨 颜色迁移',
    hint: '把这组配色迁移到其它图，统一色调',
    practical: true,
    build: buildColorTransfer,
  },
  {
    id: 'style-unify',
    label: '🖥️ 风格统一',
    hint: '用这组配色统一美化 PPT / 网页',
    practical: true,
    build: buildStyleUnify,
  },
  {
    id: 'palette-remix',
    label: '🔧 配色重造',
    hint: '衍生 3 套更和谐/对比/柔和的配色',
    practical: true,
    build: buildPaletteRemix,
  },
  {
    id: 'gradient-theme',
    label: '🌈 渐变主题',
    hint: '生成可直接用的 CSS 渐变方案',
    practical: true,
    build: buildGradientTheme,
  },
  {
    id: 'image-story',
    label: '📖 图说故事',
    hint: '仅凭这组色反推画面，写 3 个猜想',
    practical: false,
    build: buildImageStory,
  },
  {
    id: 'persona-color',
    label: '👤 人物性格色',
    hint: '把这组色拟人化，写性格画像',
    practical: false,
    build: buildPersonaColor,
  },
];
