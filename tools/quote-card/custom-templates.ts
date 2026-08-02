/**
 * 自定义卡片模板 —— 让用户用一段「渲染函数体」自定义卡片样式，
 * 保存到浏览器本地存储（数据不出本地），并在模板选择器里像内置模板一样选用。
 *
 * 【为什么是「函数体」而非 JSON 配置】
 *   内置模板（minimal/gradient/paper/dark）每个都是一段 render(el, quote) 代码：
 *   设 cssText、replaceChildren 摆放装饰/正文/落款、可选地注入 SVG。模板的视觉
 *   表现力（渐变、纹理、装饰图形、SVG 描边）远超结构化配置能描述的范围。函数体形式
 *   能力最全，且与内置模板完全同构——AI 生成的自定义模板和内置模板走同一条渲染路径，
 *   PNG/视频导出、入场动画叠加都走得通。
 *
 * 【SVG 支持】
 *   本工具的 h() 构造器用 document.createElement（HTML 命名空间），建不了 SVG 命名空间
 *   节点。所以自定义模板里的 SVG 必须用「字符串注入」：el.insertAdjacentHTML(...) 或
 *   wrapper 的 innerHTML。提示词明确要求 AI 这样写，dryRun 会校验注入的 svg 非空。
 *
 * 【安全边界】
 *   代码用 new Function('el','quote', code) 在用户自己的浏览器内执行，不联网、不上传。
 *   与本项目「纯浏览器运行、数据不出本地」一致。dryRun 在保存前静态扫描危险模式
 *   （document.body / window.location / fetch / 动态 import 等），运行时抛错或没产出
 *   可见内容时拒绝保存。真正渲染时若抛错，回退极简白底，不让整页崩溃。
 */

import { h } from '@/core/components/element';
import type { CardTemplate, QuoteData } from './templates/types';

const STORAGE_KEY = 'quote-card:custom-templates';
const CURRENT_VERSION = 1;
const ID_PREFIX = 'ctmpl:';

/** 一条自定义模板（本地存储形态） */
export interface CustomTemplate {
  /** 形如 ctmpl:abcd1234，与内置模板 id / 自定义动画 id(custom:) 均不冲突 */
  id: string;
  /** 用户填的展示名 */
  name: string;
  /** 函数体代码：签名 (el, quote)，无返回值（渲染即副作用） */
  code: string;
  /** 缩略图背景（CSS 值，纯色或渐变；由 AI 注释声明，须与模板实际背景一致） */
  background: string;
  /** 缩略图引号图标色（hex，由 AI 注释声明） */
  iconColor: string;
  /** 创建时间戳（排序用） */
  createdAt: number;
}

interface CustomTemplateBlob {
  version: number;
  items: CustomTemplate[];
}

/** 读取全部自定义模板；存储损坏/为空时返回 [] */
export function loadCustomTemplates(): CustomTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<CustomTemplateBlob>;
    if (!parsed || typeof parsed !== 'object') return [];
    const items = parsed.items;
    if (!Array.isArray(items)) return [];
    // 逐条校验：id 必须带前缀、name/code/background/iconColor 非空字符串
    return items.filter(
      (it): it is CustomTemplate =>
        !!it &&
        typeof it.id === 'string' &&
        it.id.startsWith(ID_PREFIX) &&
        typeof it.name === 'string' &&
        it.name.trim().length > 0 &&
        typeof it.code === 'string' &&
        it.code.trim().length > 0 &&
        typeof it.background === 'string' &&
        it.background.trim().length > 0 &&
        typeof it.iconColor === 'string' &&
        it.iconColor.trim().length > 0 &&
        typeof it.createdAt === 'number',
    );
  } catch {
    return [];
  }
}

/** 持久化全部自定义模板（隐私模式 / 配额满时静默忽略） */
function persist(items: CustomTemplate[]): void {
  try {
    const blob: CustomTemplateBlob = { version: CURRENT_VERSION, items };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // 容量满 / 隐私模式：静默忽略，不影响功能
  }
}

/** 生成一个新的自定义 id（ctmpl: + 随机串） */
function newId(): string {
  return ID_PREFIX + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** 新增或同名覆盖一条；返回更新后的完整列表 */
export function addCustomTemplate(
  name: string,
  code: string,
  background: string,
  iconColor: string,
): CustomTemplate[] {
  const trimmedName = name.trim();
  const items = loadCustomTemplates();
  const existingIdx = items.findIndex((it) => it.name.trim() === trimmedName);
  const entry: CustomTemplate = {
    id: existingIdx >= 0 ? items[existingIdx]!.id : newId(),
    name: trimmedName,
    code: code.trim(),
    background: background.trim(),
    iconColor: iconColor.trim(),
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
export function removeCustomTemplate(id: string): CustomTemplate[] {
  const items = loadCustomTemplates().filter((it) => it.id !== id);
  persist(items);
  return items;
}

/** 按 id 取一条；不存在返回 null */
export function findCustomTemplate(id: string): CustomTemplate | null {
  return loadCustomTemplates().find((it) => it.id === id) ?? null;
}

/** 是否自定义模板 id（供 UI 区分内置/自定义用） */
export function isCustomTemplateId(id: string): boolean {
  return id.startsWith(ID_PREFIX);
}

/**
 * 编译代码为 render 函数（语法错会抛 Error，供 UI 在保存前即时校验）。
 * 编译出的函数签名：(el, quote) => void（无返回值，渲染即副作用）。
 */
export function compileTemplateRender(
  code: string,
): (el: HTMLElement, quote: QuoteData) => void {
  // new Function 的函数体即用户代码；模板代码只负责把内容画进 el，不需要 return。
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('el', 'quote', code) as (el: HTMLElement, quote: QuoteData) => unknown;
  return (el, quote) => {
    fn(el, quote);
  };
}

/**
 * 危险模式静态扫描：模板代码只应操作传入的 el，不应触碰页面其它部分或发网络请求。
 * 命中任一模式即拒绝保存。这是模板代码的安全边界（动画侧同等约束：只操作 content）。
 */
const DANGER_PATTERNS: RegExp[] = [
  /document\s*\.\s*body\b/,
  /document\s*\.\s*documentElement\b/,
  /window\s*\.\s*location\b/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bimport\s*\(/, // 动态 import（静态 import 在函数体里写不了）
  /\beval\s*\(/,
  /navigator\s*\.\s*sendBeacon\b/,
];

/** 代码是否含越界操作（供 dryRun 与运行时回退前统一判定） */
function hasDangerousCode(code: string): boolean {
  return DANGER_PATTERNS.some((re) => re.test(code));
}

/** 试跑校验结果：给「添加」模态的保存用，提前暴露问题代码 */
export interface TemplateDryRunResult {
  ok: boolean;
  /** 失败原因（ok=false 时有值） */
  reason?: string;
}

/**
 * 在一个【离屏挂载的 1080×1080 容器】上试跑代码，检查五件事：
 *   1. 危险模式扫描通过（不操作 document.body / 不发网络请求等）；
 *   2. 编译不抛错；
 *   3. 运行不抛错；
 *   4. 产出了可见内容：el 至少有 1 个子元素，且 textContent 非空（quote.text 应被画进去）；
 *   5. 若注入了 svg，每个 svg 都非空（防 <svg></svg> 空壳）。
 *
 * 容器需【挂载到文档】（离屏 left:-99999px）才能让 svg 有真实 boundingBox、
 * 让 AI 代码里可能的 getBoundingClientRect 不报错；校验完即移除。
 */
export function dryRunCheck(code: string, el: HTMLElement, quote: QuoteData): TemplateDryRunResult {
  if (hasDangerousCode(code)) {
    return {
      ok: false,
      reason: '代码含越界操作（document.body / 网络请求 / 动态 import 等）。模板代码只能操作传入的 el，不能触碰页面其它部分。',
    };
  }
  let render: (e: HTMLElement, q: QuoteData) => void;
  try {
    render = compileTemplateRender(code);
  } catch (e) {
    return { ok: false, reason: '代码语法有误：' + (e instanceof Error ? e.message : String(e)) };
  }
  try {
    render(el, quote);
  } catch (e) {
    return {
      ok: false,
      reason: '运行时报错：' + (e instanceof Error ? e.message : String(e)),
    };
  }
  // 产出可见内容？
  if (el.childElementCount === 0) {
    return { ok: false, reason: '代码没有往容器里放任何内容（应调用 el.replaceChildren(...) 摆放正文与装饰）。' };
  }
  const text = (el.textContent ?? '').trim();
  if (text.length === 0) {
    return { ok: false, reason: '代码产出的内容没有文本（名言正文应被画进容器）。' };
  }
  // svg 完整性
  const svgs = el.querySelectorAll('svg');
  for (const svg of Array.from(svgs)) {
    if ((svg.innerHTML ?? '').trim().length === 0 && (svg.childNodes.length ?? 0) === 0) {
      return { ok: false, reason: '代码注入了一个空的 <svg>（没有子元素）。请补全 svg 内部的图形元素。' };
    }
  }
  return { ok: true };
}

/**
 * 把一条 CustomTemplate 包成内置同款的 CardTemplate：id/name/preview/render 四件套。
 * render 内 try/catch：编译或运行时出错 → 回退极简白底，避免整页崩。
 * 名称前加 ⭐ 标识，与内置模板区分。
 */
export function toCardTemplate(c: CustomTemplate): CardTemplate {
  return {
    id: c.id,
    name: '⭐ ' + c.name,
    preview: { background: c.background, iconColor: c.iconColor },
    render: (el, quote) => {
      try {
        compileTemplateRender(c.code)(el, quote);
      } catch {
        // 运行时失败（编译错/抛错）：回退极简白底黑字，避免整页崩
        el.style.cssText =
          'background:#ffffff;color:#0f172a;font-family:Georgia,"Songti SC","Noto Serif SC",serif;display:flex;flex-direction:column;justify-content:center;padding:96px;box-sizing:border-box;position:relative;';
        el.replaceChildren(
          h('div', { style: 'font-size:46px;line-height:1.45;font-weight:600;word-break:break-word;overflow-wrap:anywhere;', textContent: quote.text }),
          h('div', { style: 'margin-top:48px;font-size:30px;color:#64748b;font-style:italic;', textContent: `— ${quote.author}${quote.source ? ` · ${quote.source}` : ''}` }),
        );
      }
    },
  };
}

/**
 * 组装「用 AI 生成自定义模板」的提示词。
 * 用户把它粘到 ChatGPT/DeepSeek/豆包等普通 AI 对话，AI 按本工具代码约定返回一段
 * 函数体代码（首三行注释声明名称/缩略图背景/图标色），用户再复制回「粘贴」框即可。
 *
 * @param description 用户对想要的卡片风格的自由描述
 */
export function buildTemplatePrompt(description: string): string {
  const desc = description.trim() || '（用户未填写具体描述，请按高级感、耐看的名言卡片风格生成一个）';

  return `你是一个前端 + 视觉设计专家。请帮我为「名言卡片」工具设计一个卡片模板的渲染代码。

【我想要的卡片风格】
${desc}

【⚠ 最关键的禁令（违反会导致卡片崩坏或保存失败）】
1. 绝对不要操作 document.body / document.documentElement / window / 发网络请求（fetch/XHR/WebSocket）
   / 动态 import。模板代码【只能操作传入的 el】，触碰页面其它部分会被保存校验直接拒绝。
2. 不要写 return 语句。模板是「渲染即副作用」——把内容画进 el 即可，没有返回值。
3. 不要用 CSS @keyframes / animation。入场动画由工具的动画系统单独管，与模板是两个独立维度；
   模板里写动画会和它冲突。只用静态样式。
4. 不要用 h('svg', ...) 之类的 DOM 构造器建 SVG——本工具的 h() 只能建 HTML 元素，建不了 SVG
   命名空间节点。SVG 必须【用字符串注入】（见下方"内嵌 SVG"）。

【本工具的代码约定（务必严格遵守）】
你只需返回一个【函数体】的 JavaScript 代码，不要写 function 包裹，不要写外层括号。
该函数会被这样调用：new Function('el', 'quote', <你的代码>)(el, quote)。两个参数：
- el：HTMLElement，卡片内容层。容器尺寸【已固定】（短边 1080px，宽高随用户选的宽高比）。
  你只负责填内部布局与配色，不要改 el 自身的 width/height。
- quote：{ text: string; author: string; source?: string }，当前名言数据。

【必须遵守的渲染步骤（与内置模板对齐，保证导出/动画都走得通）】
1. 先设 el 的基础样式：
   el.style.cssText = 'background:...;color:...;font-family:...;display:flex;flex-direction:column;justify-content:center;padding:...;box-sizing:border-box;position:relative;overflow:hidden;';
   （justify-content:center 让内容垂直居中；position:relative 给装饰层定位用；overflow:hidden 防装饰溢出）
2. 用 el.replaceChildren(...) 摆放子元素：装饰元素（如有，用 div + 绝对定位）+ 名言正文 + 作者落款。
   装饰元素放前面、正文与落款放后面，正文/落款加 position:relative;z-index:1; 浮在装饰之上。
3. 【⚠ 必须渲染作者和出处，不能漏】落款必须包含 quote.author；若 quote.source 存在（非空字符串），
   必须一并显示出处。推荐把作者和出处拼进同一个落款元素，例如：
     authorEl.textContent = quote.author + (quote.source ? ' · ' + quote.source : '');
   或分成两个元素（作者一行、出处一行）。绝不能只显示作者而丢掉出处——用户填了出处就是要展示的。
4. 名言正文必须有 word-break:break-word;overflow-wrap:anywhere;（防长文本撑破画板被裁切）。
5. 【防长文本裁切】正文不要用固定 px 的 max-width（如 max-width:900px），它在横版宽画板（如 16:9 = 1920×1080）
   上会把文本挤窄、被迫换更多行、总高超过画板高度，导致底部的出处被 overflow:hidden 裁掉看不到。
   正文宽度用百分比（如 max-width:92%）让它随画板宽度自适应；或干脆不设 max-width、靠 padding 控制留白。
6. 所有颜色/字体用【具体值】（如 #0f172a、Georgia），不要用 CSS 变量 var(--xxx)、不要依赖暗色模式——
   截图要在任何页面主题下都一致。

【字号自适应（重要，照抄这两个工具函数）】
名言长度不固定，请用下面两个函数决定字号与内边距，避免长文本溢出 1080×1080 画板：
\`\`\`js
function pickQuoteFontSize(text) {
  const len = text.length;
  if (len <= 24) return 60;
  if (len <= 60) return 46;
  if (len <= 120) return 36;
  if (len <= 200) return 28;
  return 22;
}
function isLongQuote(text) { return text.length > 60; }
\`\`\`
用法：const fontSize = pickQuoteFontSize(quote.text); const long = isLongQuote(quote.text);
长文本时 padding 用 64（const padding = long ? 64 : 96;），并收紧各元素的 margin。

【内嵌 SVG 图形（鼓励使用，提升设计感）】
装饰图形（几何线条、光斑、纹理、波纹、抽象图标、星空等）推荐用 SVG 画。注入方式：
\`\`\`js
// 在 replaceChildren 之后，用 insertAdjacentHTML 把 svg 字符串追加进 el
el.insertAdjacentHTML('beforeend', \`
  <svg viewBox="0 0 1080 1080" preserveAspectRatio="xMidYMid slice"
       style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;">
    <defs>
      <linearGradient id="bg-glow" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#6366f1" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="#ec4899" stop-opacity="0.2"/>
      </linearGradient>
    </defs>
    <circle cx="540" cy="540" r="300" fill="url(#bg-glow)"/>
    <path d="M200 800 L400 500 L600 700 L880 400" stroke="#d4af37" stroke-width="3" fill="none" opacity="0.5"/>
  </svg>
\`);
\`\`\`
要点：
- viewBox 用画板坐标系（基准 1080×1080），让图形随画板缩放。
- style 用 position:absolute;inset:0;width:100%;height:100%;pointer-events:none; —— 不占文本布局空间、不拦截点击。
- z-index:0（或默认）让 svg 在下层；正文/落款加 position:relative;z-index:1; 浮在其上。
- preserveAspectRatio="xMidYMid slice" 让 svg 在不同宽高比下铺满并居中裁剪。
- 渐变/滤镜的 id 用唯一前缀（如 bg-glow），避免多个模板同 id 冲突。
- SVG 要【内联】（<svg>...</svg> 直接写在字符串里），不要用 <img src="*.svg"> 外链（导出时可能丢图）。

【完整示例（参考结构，按你的风格改）】
\`\`\`js
// 名称：星河
// 背景：radial-gradient(circle at 50% 30%,#1e293b,#0f172a)
// 图标色：#d4af37
function pickQuoteFontSize(text) {
  const len = text.length;
  if (len <= 24) return 60;
  if (len <= 60) return 46;
  if (len <= 120) return 36;
  if (len <= 200) return 28;
  return 22;
}
function isLongQuote(text) { return text.length > 60; }

const long = isLongQuote(quote.text);
const padding = long ? 64 : 96;
const fontSize = pickQuoteFontSize(quote.text);

el.style.cssText = 'background:radial-gradient(circle at 50% 30%,#1e293b 0%,#0f172a 100%);color:#e2e8f0;font-family:"PingFang SC","Helvetica Neue",Arial,sans-serif;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:' + padding + 'px;box-sizing:border-box;position:relative;overflow:hidden;text-align:center;';

// 名言正文：先 createElement，再设 style 和 textContent，最后放进 replaceChildren。
// 注意 max-width 用百分比（92%）而非固定 px——横版宽画板上固定 px 会把文本挤窄、
// 换更多行、总高超过画板，导致底部出处被 overflow:hidden 裁掉。
const quoteEl = document.createElement('div');
quoteEl.style.cssText = 'font-size:' + fontSize + 'px;line-height:1.5;font-weight:500;max-width:92%;word-break:break-word;overflow-wrap:anywhere;position:relative;z-index:1;';
quoteEl.textContent = quote.text;

// 作者落款（⚠ 必须把出处 source 也带上，不能只显示作者）
const authorEl = document.createElement('div');
authorEl.style.cssText = 'margin-top:' + (long ? 24 : 48) + 'px;font-size:32px;color:#d4af37;font-weight:600;position:relative;z-index:1;';
authorEl.textContent = quote.author + (quote.source ? ' · ' + quote.source : '');

el.replaceChildren(quoteEl, authorEl);

// 装饰 SVG（金色光晕 + 抽象线条，浮在文本下层）
el.insertAdjacentHTML('beforeend', \`
  <svg viewBox="0 0 1080 1080" preserveAspectRatio="xMidYMid slice"
       style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;">
    <defs>
      <radialGradient id="star-glow" cx="50%" cy="30%" r="50%">
        <stop offset="0%" stop-color="#d4af37" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="#d4af37" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1080" height="1080" fill="url(#star-glow)"/>
    <path d="M150 850 L380 520 L580 700 L920 380" stroke="#d4af37" stroke-width="2" fill="none" opacity="0.4"/>
  </svg>
\`);
\`\`\`
（注意：createElement 建的 div、设好 .style.cssText 和 .textContent 后，作为 replaceChildren 的参数传入。SVG 用 insertAdjacentHTML 字符串注入，不要用 h() 建svg。）

【输出格式（务必照此结构，不要加其它说明）】
只输出一个代码块（用 \`\`\`js 包裹）。代码块【前三行】必须是注释，格式严格为：
    // 名称：xxx
    // 背景：<CSS 背景值>
    // 图标色：<hex>
这三行注释工具会自动解析，用于选择器缩略图。务必注意：
- 「背景」必须是【完整的、可直接用作 CSS background 的值】，整行写完，不要换行、不要截断。
  纯色用 hex（如 #1e293b）；渐变必须【括号完整、配对】，例如：
    linear-gradient(135deg,#6366f1,#8b5cf6)         ← 正确，左括号 ( 和右括号 ) 配对
    radial-gradient(circle at 50% 30%,#1e293b,#0f172a)  ← 正确
  不要写成 linear-gradient(135deg,#6366f1,#8b5cf6   ← ❌ 缺右括号，会让缩略图背景渲染失败
  不要在值里加引号、不要在值后加多余说明（如「// 背景：#fff 白色」会把「白色」也解析进背景值）。
- 「图标色」是缩略图上引号 " 图标的颜色（hex），要和背景有足够对比（深底用浅色、浅底用深色）。
- 「名称」不要带引号或书名号，直接写名字（如「星河」，不要写「"星河"」或「《星河》」）。
其后是函数体。上方的"完整示例"已经演示了这个三行头的写法，照那个格式输出即可。
代码块之外不要写任何文字。不要复述上面的约定。`;
}

/** 用户粘贴内容解析结果：拆出名称 + 缩略图信息 + 代码函数体 */
export interface ParsedTemplateAIOutput {
  /** 模板名称（去除「名称：」前缀后）；解析不到则为空串 */
  name: string;
  /** 代码函数体（已 trim，已剥离声明注释）；解析不到则为空串 */
  code: string;
  /** 缩略图背景（解析不到给默认渐变） */
  background: string;
  /** 缩略图图标色（解析不到给默认白色） */
  iconColor: string;
}

/** 匹配一行「名称：xxx」（可有 // 前缀，中英文冒号）。捕获组 = 名称文本 */
const NAME_LINE_RE = /^[ \t]*(?:(?:\/\/|#)\s*)?(?:名称|模板名(?:称)?|name)[ \t]*[:：][ \t]*(.+?)[ \t]*$/i;
/** 匹配一行「背景：xxx」 */
const BG_LINE_RE = /^[ \t]*(?:(?:\/\/|#)\s*)?(?:背景|缩略图背景|background|bg)[ \t]*[:：][ \t]*(.+?)[ \t]*$/i;
/** 匹配一行「图标色：xxx」 */
const ICON_LINE_RE = /^[ \t]*(?:(?:\/\/|#)\s*)?(?:图标色|缩略图图标色|图标|icon(?:color)?)[ \t]*[:：][ \t]*(.+?)[ \t]*$/i;

const DEFAULT_BACKGROUND = 'linear-gradient(135deg,#6366f1,#8b5cf6)';
const DEFAULT_ICON_COLOR = '#ffffff';

/** 从一行匹配结果里提取干净的值（去首尾引号包裹）。
 *  ⚠ 只去引号类字符（" ' 「 」 『 』），不去圆括号 ( ) ——
 *  背景值常含渐变如 linear-gradient(...)/radial-gradient(...)，去右括号会让 CSS 失效、
 *  缩略图背景渲染不出来。引号是用户/AI 给名称加的包裹，去掉无副作用；括号是合法值的一部分。 */
function cleanMetaValue(line: string, re: RegExp): string | null {
  const m = line.trim().match(re);
  if (!m) return null;
  return m[1]!.trim().replace(/^["'「『]+|["'」』]+$/g, '').trim();
}

/**
 * 解析用户从 AI 那里复制回来、粘进「粘贴 AI 代码」框的内容，
 * 拆出【模板名称】+【缩略图背景】+【图标色】+【代码函数体】。
 *
 * 提示词要求 AI 把这三项写成【代码块内的首三行注释】（// 名称：xxx 等）。
 * 解析同时兼容「写在代码块外」的旧式。
 *
 * 容错策略：
 *   - 代码：优先取首个 \`\`\`js / \`\`\`javascript / \`\`\` 代码块里的内容；
 *     若没有围栏，则把去掉 ``` 标记行后的剩余文本当作代码。
 *   - 名称/背景/图标色：优先取代码块内的注释行；其次取代码块外的同名行。
 *   - 取到后，从代码体里剥掉这三条声明注释（不污染真正要执行的函数体）。
 *   - 背景缺省给默认渐变，图标色缺省给白色；name/code 缺失由调用方报错。
 */
export function parseTemplateAIOutput(raw: string): ParsedTemplateAIOutput {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return { name: '', code: '', background: DEFAULT_BACKGROUND, iconColor: DEFAULT_ICON_COLOR };

  // 1) 代码：优先 ```js / ```javascript / ``` 围栏
  let codeBody = '';
  const fence = text.match(/```(?:js|javascript)?\s*\n([\s\S]*?)\n?```/i);
  if (fence) {
    codeBody = fence[1]!.trim();
  } else {
    // 无围栏：去掉 ``` 标记行，剩余当作代码（声明注释稍后统一剥离）
    codeBody = text
      .split('\n')
      .filter((l) => !/^```/.test(l.trim()))
      .join('\n')
      .trim();
  }

  // 2) 从代码块内注释行优先取名称/背景/图标色；取不到再扫代码块外
  const codeLines = codeBody.split('\n');
  const outsideLines = text.split('\n');

  let name = '';
  let background = '';
  let iconColor = '';

  for (const l of codeLines) {
    if (!name) {
      const v = cleanMetaValue(l, NAME_LINE_RE);
      if (v && /^\s*(?:\/\/|#)/.test(l)) name = v;
    }
    if (!background) {
      const v = cleanMetaValue(l, BG_LINE_RE);
      if (v && /^\s*(?:\/\/|#)/.test(l)) background = v;
    }
    if (!iconColor) {
      const v = cleanMetaValue(l, ICON_LINE_RE);
      if (v && /^\s*(?:\/\/|#)/.test(l)) iconColor = v;
    }
  }
  // 代码块外兜底
  if (!name) {
    const line = outsideLines.find((l) => NAME_LINE_RE.test(l.trim()));
    if (line) name = cleanMetaValue(line, NAME_LINE_RE) ?? '';
  }
  if (!background) {
    const line = outsideLines.find((l) => BG_LINE_RE.test(l.trim()));
    if (line) background = cleanMetaValue(line, BG_LINE_RE) ?? '';
  }
  if (!iconColor) {
    const line = outsideLines.find((l) => ICON_LINE_RE.test(l.trim()));
    if (line) iconColor = cleanMetaValue(line, ICON_LINE_RE) ?? '';
  }

  // 3) 从代码体里剥掉三条声明注释行（不污染真正要 new Function 执行的函数体）
  const isMetaLine = (l: string): boolean =>
    NAME_LINE_RE.test(l.trim()) || BG_LINE_RE.test(l.trim()) || ICON_LINE_RE.test(l.trim());
  const code = codeBody
    .split('\n')
    .filter((l) => !isMetaLine(l))
    .join('\n')
    .trim();

  return {
    name,
    code,
    background: background || DEFAULT_BACKGROUND,
    iconColor: iconColor || DEFAULT_ICON_COLOR,
  };
}
