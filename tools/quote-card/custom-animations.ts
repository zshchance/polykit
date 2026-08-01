/**
 * 自定义动画效果 —— 让用户用一段「Web Animations API 函数体」自定义入场动画，
 * 保存到浏览器本地存储（数据不出本地），并在选择器里像内置效果一样选用。
 *
 * 【为什么是「函数体」而非 keyframes 字符串】
 *   名言卡片的动画统一用 Web Animations API（见 animations.ts），原因：视频导出
 *   要靠 `Animation.currentTime` 精确控时，PNG 导出要靠 `Animation.finish()` 跳终态。
 *   所以自定义效果也必须 `return` 一个真实的 WAAPI `Animation` 对象。函数体形式
 *   （`return content.animate(...)`）能力最全：支持逐字错峰、能访问 quote 文本、
 *   视频/图片导出都走得通。
 *
 * 【安全边界】
 *   代码用 `new Function('content','quote', code)` 在用户自己的浏览器内执行，
 *   不联网、不上传。与本项目「纯浏览器运行、数据不出本地」一致。这是「用户自己
 *   （或 AI 帮自己）生成代码自己用」的语境，仅影响本人浏览器。运行时抛错或返回值
 *   不是 Animation 时，静默回退淡入，不让整页崩溃。
 */

import type { QuoteData } from './templates/types';
import { fallbackFade, type AnimEffect } from './animations';

const STORAGE_KEY = 'quote-card:custom-animations';
const CURRENT_VERSION = 1;
const ID_PREFIX = 'custom:';

/** 一条自定义动画效果（本地存储形态） */
export interface CustomAnim {
  /** 形如 custom:abcd1234，与内置 AnimId 不冲突 */
  id: string;
  /** 用户填的展示名 */
  name: string;
  /** 函数体代码：签名 (content, quote)，return 一个 Animation */
  code: string;
  /** 创建时间戳（排序用） */
  createdAt: number;
}

interface CustomAnimBlob {
  version: number;
  items: CustomAnim[];
}

/** 读取全部自定义效果；存储损坏/为空时返回 [] */
export function loadCustomAnims(): CustomAnim[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<CustomAnimBlob>;
    if (!parsed || typeof parsed !== 'object') return [];
    const items = parsed.items;
    if (!Array.isArray(items)) return [];
    // 逐条校验：id 必须带前缀、name/code 非空字符串
    return items.filter(
      (it): it is CustomAnim =>
        !!it &&
        typeof it.id === 'string' &&
        it.id.startsWith(ID_PREFIX) &&
        typeof it.name === 'string' &&
        it.name.trim().length > 0 &&
        typeof it.code === 'string' &&
        it.code.trim().length > 0 &&
        typeof it.createdAt === 'number',
    );
  } catch {
    return [];
  }
}

/** 持久化全部自定义效果（隐私模式 / 配额满时静默忽略） */
function persist(items: CustomAnim[]): void {
  try {
    const blob: CustomAnimBlob = { version: CURRENT_VERSION, items };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // 容量满 / 隐私模式：静默忽略，不影响功能
  }
}

/** 生成一个新的自定义 id（custom: + 随机串） */
function newId(): string {
  return ID_PREFIX + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** 新增或同名覆盖一条；返回更新后的完整列表 */
export function addCustomAnim(name: string, code: string): CustomAnim[] {
  const trimmedName = name.trim();
  const items = loadCustomAnims();
  const existingIdx = items.findIndex((it) => it.name.trim() === trimmedName);
  const entry: CustomAnim = {
    id: existingIdx >= 0 ? items[existingIdx]!.id : newId(),
    name: trimmedName,
    code: code.trim(),
    createdAt: existingIdx >= 0 ? items[existingIdx]!.createdAt : Date.now(),
  };
  if (existingIdx >= 0) {
    items[existingIdx] = entry;
  } else {
    items.push(entry);
  }
  persist(items);
  return items;
}

/** 删除一条；返回更新后的完整列表 */
export function removeCustomAnim(id: string): CustomAnim[] {
  const items = loadCustomAnims().filter((it) => it.id !== id);
  persist(items);
  return items;
}

/** 按 id 取一条；不存在返回 null */
export function findCustomAnim(id: string): CustomAnim | null {
  return loadCustomAnims().find((it) => it.id === id) ?? null;
}

/** 是否自定义 id（供 UI 区分内置/自定义用） */
export function isCustomAnimId(id: string): boolean {
  return id.startsWith(ID_PREFIX);
}

/**
 * 编译代码为 build 函数（语法错会抛 Error，供 UI 在保存前即时校验）。
 * 编译出的函数签名：(content, quote) => Animation。
 */
export function compileCustomBuild(
  code: string,
): (content: HTMLElement, quote: QuoteData) => Animation {
  // new Function 的函数体即用户代码；用户在代码里 return 一个 Animation。
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('content', 'quote', code) as (
    content: HTMLElement,
    quote: QuoteData,
  ) => unknown;
  return (content, quote) => {
    const result = fn(content, quote);
    if (!result || typeof (result as Animation).play !== 'function') {
      throw new Error('代码未返回有效的 Animation（请用 return content.animate(...)）');
    }
    return result as Animation;
  };
}

/**
 * 把一条 CustomAnim 包成内置同款的 AnimEffect：id/name/build 三件套。
 * build 内 try/catch：编译或运行时出错 → 回退淡入，避免整页崩。
 * 名称前加 ⭐ 标识，与内置效果区分。
 */
export function toAnimEffect(c: CustomAnim): AnimEffect {
  return {
    id: c.id,
    name: '⭐ ' + c.name,
    build: (content, quote) => {
      try {
        return compileCustomBuild(c.code)(content, quote);
      } catch {
        // 运行时失败（编译错/抛错/未返回 Animation）：静默回退淡入
        return fallbackFade(content);
      }
    },
  };
}

/**
 * 组装「用 AI 生成自定义效果」的提示词。
 * 用户把它粘到 ChatGPT/DeepSeek/豆包等普通 AI 对话，AI 按本工具代码约定返回一段
 * 函数体代码，用户再复制回「+」框即可。
 *
 * @param description 用户对想要的动画效果的自由描述
 */
export function buildAIPrompt(description: string): string {
  const desc = description.trim() || '（用户未填写具体描述，请按常见入场动画生成一个）';

  return `你是一个前端动画专家。请帮我为「名言卡片」工具写一段自定义文字入场动画的代码。

【我想要的动画效果】
${desc}

【本工具的代码约定（务必严格遵守）】
你只需返回一个【函数体】的 JavaScript 代码，不要写 function 包裹，不要写外层括号。
该函数会被这样调用：new Function('content', 'quote', <你的代码>)(content, quote)。
两个参数：
- content：HTMLElement，是卡片的内容层（文字已经渲染在里面）。注意：动画每次播放前内容会被重新渲染，所以你的代码不应依赖之前留下的副作用。
- quote：{ text: string; author: string; source?: string }，当前名言文本。

你的函数体必须用 Web Animations API（element.animate(...)）并 return 出一个 Animation 对象。
这是硬性要求——工具的视频导出靠 animation.currentTime 判定结束、图片导出靠 animation.finish() 跳终态，所以必须 return 真实的 Animation。

技术要点：
- 整体效果示例：
    return content.animate(
      [{ opacity: 0, transform: 'translateY(24px)' },
       { opacity: 1, transform: 'translateY(0)' }],
      { duration: 2400, easing: 'ease-out', fill: 'both' }
    );
- 建议总时长 ~2400ms，fill 用 'both' 或 'forwards'，保证末帧稳定（视频尾帧才干净）。
- 如需逐字错峰，可把 content 内文本节点拆成 inline-block 的 <span> 再逐个 animate，每个 span 用 delay 错峰；末帧 opacity 必须 = 1，否则字符会消失。
- 缓动用 cubic-bezier(0.22,1,0.36,1) 之类，整体观感更顺滑。
- 适配 prefers-reduced-motion 不是必须的（工具会兜底），但加分。
- 不要用 CSS @keyframes（无法被视频导出精确控时）。只用 element.animate()。

【输出格式】
直接给出可粘贴的代码块（用 \`\`\`js 包裹），不要多余解释。函数体里以 return content.animate(...) 结尾。
示例输出形如：
\`\`\`js
return content.animate([...], {...});
\`\`\`

【安全边界】
这段代码只在我自己的浏览器里运行，不联网、不上传任何数据。`;
}
