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

/** 试跑校验结果：给「添加」模态的预览/保存用，提前暴露问题代码 */
export interface DryRunResult {
  ok: boolean;
  /** 失败原因（ok=false 时有值） */
  reason?: string;
  /** 返回的动画是否是真实可用的 Animation */
  returnedAnimation?: Animation;
}

/**
 * 在一段【content 的克隆副本】上试跑代码，检查三件事：
 *   1. 编译 + 运行不抛错；
 *   2. 返回的是有效的 Animation（有 play/finish 方法）；
 *   3. 不破坏 content 的结构（克隆后 childElementCount 与原文一致，且没把文本节点
 *      揉成一团——用子元素数变化作破坏性 DOM 操作的代理信号）。
 *
 * 在副本上跑是为了不污染真实卡片。返回详细结果供 UI 展示。
 */
export function dryRunCheck(code: string, content: HTMLElement, quote: QuoteData): DryRunResult {
  // 克隆真实 content 做试跑（深克隆，保留结构与文本）
  const clone = content.cloneNode(true) as HTMLElement;
  const beforeChildCount = clone.childElementCount;
  const beforeTextLength = (clone.textContent ?? '').length;
  let build: (c: HTMLElement, q: QuoteData) => Animation;
  try {
    build = compileCustomBuild(code);
  } catch (e) {
    return { ok: false, reason: '代码语法有误：' + (e instanceof Error ? e.message : String(e)) };
  }
  let anim: Animation;
  try {
    anim = build(clone, quote);
  } catch (e) {
    return {
      ok: false,
      reason: '运行时报错：' + (e instanceof Error ? e.message : String(e)) + '（常见：用了 GroupEffect 等浏览器不支持的 API）',
    };
  }
  // 返回值是否真实 Animation
  if (!anim || typeof anim.play !== 'function' || typeof anim.finish !== 'function') {
    return { ok: false, reason: '代码未返回有效的 Animation（请用 return content.animate(...) 结尾）' };
  }
  // 结构破坏检测：清空/替换 content 的代码会让 childElementCount 或文本长度剧变
  const afterChildCount = clone.childElementCount;
  const afterTextLength = (clone.textContent ?? '').length;
  if (afterChildCount < beforeChildCount || afterTextLength < beforeTextLength * 0.5) {
    return {
      ok: false,
      reason: '代码破坏了卡片结构（疑似清空/替换了 content，会丢失作者落款和排版）。请只对文本节点拆字，不要改 content 的 DOM 结构。',
    };
  }
  // 立即取消试跑产生的动画（副本未挂载到文档，但保险起见）
  try {
    anim.cancel();
  } catch {
    // 忽略
  }
  return { ok: true, returnedAnimation: anim };
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

【⚠ 最关键的禁令（违反任何一条，卡片布局会彻底毁掉）】
1. 绝对不要执行 content.textContent = ''、content.innerHTML = '...'、content.replaceChildren()、
   或任何会【清空/替换 content 内部 DOM】的操作。
   原因：content 里除了名言正文，还有作者落款、出处、装饰元素（强调竖条/光斑等），它们共同
   构成排版。一旦清空重建，所有样式结构和布局都会消失，卡片会变得很难看。
2. 你的代码只能【读取】或【包裹】已有的文本，不能改动 content 的结构。如果要做逐字动画，
   只能把【现有文本节点的内容】替换成等价的字符 <span>（保持父元素、样式、位置不变），
   而不是把整个 content 的文本揉成一团重新铺。
3. 不要用 GroupEffect / new Animation(groupEffect,...)。这两个 API 在绝大多数浏览器里
   【根本不存在】（会抛 ReferenceError）。逐字动画请用下面的"占位 controller"写法。

【本工具的代码约定（务必严格遵守）】
你只需返回一个【函数体】的 JavaScript 代码，不要写 function 包裹，不要写外层括号。
该函数会被这样调用：new Function('content', 'quote', <你的代码>)(content, quote)。
两个参数：
- content：HTMLElement，卡片的内容层。内部已经渲染好：可能有装饰元素、名言正文、作者落款等
  多个子节点。你只能在其上【加】动画，不要【改】它的 DOM 结构。
- quote：{ text: string; author: string; source?: string }，当前名言文本。

你的函数体必须用 Web Animations API（element.animate(...)）并 return 出一个 Animation 对象。
这是硬性要求——工具的视频导出靠 animation.currentTime 判定结束、图片导出靠 animation.finish() 跳终态。

【两种推荐写法，按效果复杂度二选一】

写法 A —— 整体动画（简单，推荐优先）：
\`\`\`js
return content.animate(
  [{ opacity: 0, transform: 'translateY(24px)' },
   { opacity: 1, transform: 'translateY(0)' }],
  { duration: 2400, easing: 'cubic-bezier(0.22,1,0.36,1)', fill: 'both' }
);
\`\`\`

写法 B —— 逐字错峰（复杂，务必照抄"占位 controller"结构）：
  原理：用 TreeWalker 收集 content 里所有【文本节点】，把每个文本节点的字符替换成 inline-block
  的 <span>（只动这个文本节点、不动其它元素），对每个 span 调 element.animate() 错峰播放；
  最后在 content 上播一个【总时长 = 各字动画的总时长】的"占位 controller" Animation 并 return 它。
  （这个 controller 不产生视觉效果，只是为了让工具有一个可控的总 Animation；视频导出按它的
   currentTime 判结束。绝不要尝试用 GroupEffect 合并——那个 API 不存在。）
\`\`\`js
// 1) 收集 content 内所有文本节点（不动装饰元素/作者落款的结构）
const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
  acceptNode: (n) => n.textContent && n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
});
const textNodes = [];
let tn;
while ((tn = walker.nextNode())) textNodes.push(tn);
// 2) 把每个文本节点就地替换成逐字 span（保持父元素与样式不变）
const spans = [];
for (const node of textNodes) {
  const parent = node.parentNode;
  for (const ch of Array.from(node.textContent)) {
    const s = document.createElement('span');
    s.textContent = ch === ' ' ? '\\u00A0' : ch; // 空格用不换行空格，防 inline-block 间空白折叠
    s.style.display = 'inline-block';
    s.style.opacity = '0';
    parent.insertBefore(s, node);
    spans.push(s);
  }
  parent.removeChild(node);
}
// 3) 逐字错峰播放（末帧 opacity 必须 = 1，否则字符消失）
const perChar = 1400;
const step = 45;
spans.forEach((s, i) => s.animate(
  [{ opacity: 0, transform: 'translateY(-20px)' },
   { opacity: 1, transform: 'translateY(0)' }],
  { duration: perChar, delay: i * step, fill: 'forwards', easing: 'cubic-bezier(0.22,1,0.36,1)' }
));
// 4) 占位 controller：总时长 = 最后一字播完的时间，return 它供工具控制
const total = perChar + Math.max(0, spans.length - 1) * step;
return content.animate([{ opacity: 1 }, { opacity: 1 }],
  { duration: Math.min(2400, Math.max(total, 2400)), fill: 'both' });
\`\`\`

其它技术要点：
- 建议总时长 ~2400ms，fill 用 'both'/'forwards'，末帧稳定（视频尾帧才干净）。
- 缓动用 cubic-bezier(0.22,1,0.36,1) 之类，整体观感更顺滑。
- 不要用 CSS @keyframes（无法被视频导出精确控时）。只用 element.animate()。

【输出格式】
直接给出可粘贴的代码块（用 \`\`\`js 包裹），不要多余解释，不要复述上面的约定。`;
}
