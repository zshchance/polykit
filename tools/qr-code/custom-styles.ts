/**
 * 自定义二维码风格 —— 让用户用一段「逐码点绘制函数体」自定义码点叠加效果，
 * 连同一套配色打包成「AI 风格预设」，保存到浏览器本地存储（数据不出本地），
 * 并在预设区里像内置预设一样选用。
 *
 * 【为什么是「函数体」而非配置字段】
 *   内置预设（types.ts 的 PRESETS）只能切码点形状/眼形状/配色这些静态字段，
 *   无法表达「每个码点顶部积一层白雪」「码点带渐变高光」这类需要【逐码点绘制】
 *   的效果。这里允许一段函数体代码，签名 (ctx, x, y, s, r, c)，在每个 data
 *   码点画完标准形状后被调用，可在其上叠加任意 canvas 绘制。能力最强。
 *
 * 【AI 风格 = 增强版预设】
 *   一条自定义风格既带常规字段 apply（颜色/形状，同内置预设），又带可选的
 *   dotEffectCode。点击套用时：Object.assign(cfg, apply) + 挂载码点钩子，
 *   与内置预设套用体验一致；用户套用后仍可手动微调任何参数。
 *
 * 【安全边界】
 *   代码用 new Function('ctx','x','y','s','r','c', code) 在用户自己的浏览器内
 *   执行，不联网、不上传。与本项目「纯浏览器运行、数据不出本地」一致。这是
 *   「用户自己（或 AI 帮自己）生成代码自己用」的语境，仅影响本人浏览器。运行
 *   时抛错由 render 层 try/catch 兜底（跳过该码点叠加，不影响主码点绘制）。
 */

import type { DotShape, EyeShape, LogoFit, QrConfig } from './types';

const STORAGE_KEY = 'qr-code:custom-styles';
const CURRENT_VERSION = 1;
const ID_PREFIX = 'custom:';

/** 自定义风格可覆盖的常规字段（与内置 QrPreset.apply 同口径） */
export type StyleApply = Partial<Omit<QrConfig, 'text' | 'errorLevel' | 'withLogo' | 'logoRatio'>>;

/** 一条自定义风格（本地存储形态） */
export interface CustomStyle {
  /** 形如 custom:abcd1234，与内置预设 id 不冲突 */
  id: string;
  /** 展示名（不含 ⭐ 前缀，渲染时由 UI 加） */
  name: string;
  /** 预览色条 [前→背]，同内置预设 swatch */
  swatch: [string, string];
  /** 套用时覆盖的常规字段（颜色/形状等），同内置预设 apply */
  apply: StyleApply;
  /** 逐码点绘制代码（函数体）；空串表示无叠加效果，仅靠 apply 换皮 */
  dotEffectCode: string;
  /** 创建时间戳（排序用） */
  createdAt: number;
}

interface CustomStyleBlob {
  version: number;
  items: CustomStyle[];
}

/**
 * 编译后的码点钩子：在每个 data 码点画完标准形状后被调用。
 *   ctx：CanvasRenderingContext2D（已 save，可放心改 fillStyle/transform，函数返回时 restore）
 *   x,y：码点左上角的像素坐标
 *   s：码点的像素边长
 *   r,c：模块矩阵的行号、列号（从 0 开始，可用于确定性"随机"）
 */
export type DotEffectFn = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  r: number,
  c: number,
) => void;

// ─────────────────────────── localStorage 增删查 ───────────────────────────

/** 读取全部自定义风格；存储损坏/为空时返回 [] */
export function loadCustomStyles(): CustomStyle[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<CustomStyleBlob>;
    if (!parsed || typeof parsed !== 'object') return [];
    const items = parsed.items;
    if (!Array.isArray(items)) return [];
    // 逐条校验
    return items
      .filter(
        (it): it is CustomStyle =>
          !!it &&
          typeof it.id === 'string' &&
          it.id.startsWith(ID_PREFIX) &&
          typeof it.name === 'string' &&
          it.name.trim().length > 0 &&
          Array.isArray(it.swatch) &&
          it.swatch.length === 2 &&
          typeof it.swatch[0] === 'string' &&
          typeof it.swatch[1] === 'string' &&
          it.apply !== undefined &&
          it.apply !== null &&
          typeof it.dotEffectCode === 'string' &&
          typeof it.createdAt === 'number',
      )
      .sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

/** 持久化全部自定义风格（隐私模式 / 配额满时静默忽略） */
function persist(items: CustomStyle[]): void {
  try {
    const blob: CustomStyleBlob = { version: CURRENT_VERSION, items };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // 容量满 / 隐私模式：静默忽略，不影响功能
  }
}

/** 生成一个新的自定义 id（custom: + 随机串） */
function newId(): string {
  return ID_PREFIX + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/**
 * 新增或同名覆盖一条；返回更新后的完整列表。
 * swatch 缺省时根据 apply 的 fg/bg 推一个色条。
 */
export function addCustomStyle(input: {
  name: string;
  apply: StyleApply;
  dotEffectCode: string;
  swatch?: [string, string];
}): CustomStyle[] {
  const trimmedName = input.name.trim();
  const items = loadCustomStyles();
  const existingIdx = items.findIndex((it) => it.name.trim() === trimmedName);
  const swatch: [string, string] = input.swatch ?? [
    input.apply.fgColor || '#0f172a',
    input.apply.bgColor || '#ffffff',
  ];
  const entry: CustomStyle = {
    id: existingIdx >= 0 ? items[existingIdx]!.id : newId(),
    name: trimmedName,
    swatch,
    apply: input.apply,
    dotEffectCode: input.dotEffectCode.trim(),
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
export function removeCustomStyle(id: string): CustomStyle[] {
  const items = loadCustomStyles().filter((it) => it.id !== id);
  persist(items);
  return items;
}

/** 按 id 取一条；不存在返回 null */
export function findCustomStyle(id: string): CustomStyle | null {
  return loadCustomStyles().find((it) => it.id === id) ?? null;
}

/** 是否自定义 id（供 UI 区分内置/自定义用） */
export function isCustomStyleId(id: string): boolean {
  return id.startsWith(ID_PREFIX);
}

// ─────────────────────────── 代码编译 + 试跑 ───────────────────────────

/**
 * 编译码点绘制代码为函数（语法错会抛 Error，供 UI 在保存前即时校验）。
 * 编译出的函数签名：(ctx, x, y, s, r, c) => void。
 * 空串代码编译为 null（表示无叠加效果）。
 */
export function compileDotEffect(code: string): DotEffectFn | null {
  const trimmed = code.trim();
  if (!trimmed) return null;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('ctx', 'x', 'y', 's', 'r', 'c', code) as DotEffectFn;
  return fn;
}

/** 试跑校验结果：给「保存」用，提前暴露问题代码 */
export interface DryRunResult {
  ok: boolean;
  /** 失败原因（ok=false 时有值） */
  reason?: string;
}

/**
 * 在一个【离屏小 canvas】上对若干虚拟码点跑一遍代码，检查：
 *   1. 编译不抛语法错；
 *   2. 对几个不同 (r,c,x,y,s) 的调用都不抛运行时错。
 *
 * canvas 绘制没有 DOM 结构破坏风险，所以只查「不抛错」。空代码直接通过。
 */
export function dryRunCheck(code: string): DryRunResult {
  const trimmed = code.trim();
  if (!trimmed) return { ok: true }; // 空代码 = 无叠加效果，合法
  let fn: DotEffectFn;
  try {
    const compiled = compileDotEffect(trimmed);
    if (!compiled) return { ok: true };
    fn = compiled;
  } catch (e) {
    return { ok: false, reason: '代码语法有误：' + (e instanceof Error ? e.message : String(e)) };
  }
  // 离屏小 canvas，模拟真实绘制环境（save/restore + 几个虚拟码点）
  try {
    const cv = document.createElement('canvas');
    cv.width = 60;
    cv.height = 60;
    const ctx = cv.getContext('2d')!;
    const s = 10;
    const cases: Array<[number, number, number, number]> = [
      [0, 0, 4, 4],
      [3, 5, 35, 14],
      [10, 2, 24, 46],
    ];
    for (const [r, c, x, y] of cases) {
      ctx.save();
      try {
        fn(ctx, x, y, s, r, c);
      } finally {
        ctx.restore();
      }
    }
  } catch (e) {
    return {
      ok: false,
      reason: '运行时报错：' + (e instanceof Error ? e.message : String(e)),
    };
  }
  return { ok: true };
}

// ─────────────────────────── AI prompt + 解析 ───────────────────────────

/**
 * 组装「用 AI 生成自定义二维码风格」的提示词。
 * 用户把它粘到 ChatGPT/DeepSeek/豆包等普通 AI 对话，AI 按本工具代码约定返回一段
 * 「名称行 + 可选配色行 + 函数体代码」，用户再复制回工具保存即可。
 *
 * @param description 用户对想要的码点效果的自由描述
 */
export function buildAIPrompt(description: string): string {
  const desc = description.trim() || '（用户未填写具体描述，请按一个好看的常见风格自由发挥）';

  return `你是一个前端 Canvas 绘制专家。请帮我为「二维码生成器」工具写一段自定义码点叠加效果的代码。

【我想要的风格】
${desc}

【⚠ 最关键的禁令（违反会让二维码画崩或无法识别）】
1. 不要调用 ctx.clearRect，也不要试图擦除已画的码点。你的代码是在每个码点的【标准形状已经画好之后】被调用的，只能在其上【叠加】绘制。
2. 不要修改全局 transform 后不恢复。代码执行前后工具会自动 ctx.save() / ctx.restore()，但你在内部若做了 translate/scale/rotate，记得配对 save/restore。
3. 不要改画布尺寸、不要操作 canvas 之外的任何 DOM、不要用 fetch/XMLStorage 等异步或存储 API。
4. 叠加效果要【轻量、半透明】，避免把码点完全糊死——二维码必须保持可扫描性。深色码点上叠白色/浅色效果好；浅色背景上叠深色细节效果好。

【本工具的代码约定（务必严格遵守）】
你只需返回一个【函数体】的 JavaScript 代码，不要写 function 包裹，不要写外层括号。
该函数会被这样调用：new Function('ctx','x','y','s','r','c', <你的代码>)(ctx, x, y, s, r, c)
六个参数：
- ctx：CanvasRenderingContext2D，2D 绘图上下文（已 save，你可改 fillStyle/strokeStyle/shadow 等，函数结束自动 restore）。
- x, y：当前码点左上角的像素坐标（number）。
- s：当前码点的像素边长（number），整码由 size×size 个模块组成。
- r, c：当前码点在模块矩阵中的行号、列号（从 0 开始的整数）。可用它做确定性"随机"（如 ((r*7+c*13)%5) 之类），这样每次重绘位置稳定不乱跳。

你的函数体【不需要 return】，只做绘制副作用即可（每个 data 码点都会调用一次）。
注意：定位点（三个角的"眼"）和 Logo 不会触发你的函数，只有 data 区码点会。

【推荐写法示例，按效果参考】

示例 1 —— 顶部白雪覆盖（在码点上方 1/3 叠一层不透明白色）：
\`\`\`js
ctx.fillStyle = 'rgba(255,255,255,0.92)';
ctx.fillRect(x, y, s, Math.max(2, s * 0.3));
\`\`\`

示例 2 —— 右下角高光（像有光源，给每个码点右下加点亮）：
\`\`\`js
ctx.fillStyle = 'rgba(255,255,255,0.25)';
ctx.fillRect(x + s * 0.6, y + s * 0.6, s * 0.4, s * 0.4);
\`\`\`

示例 3 —— 逐点错峰亮点（用 r,c 做确定性散布，部分码点加圆点）：
\`\`\`js
if ((r * 3 + c * 5) % 7 === 0) {
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.arc(x + s / 2, y + s / 2, s * 0.18, 0, Math.PI * 2);
  ctx.fill();
}
\`\`\`

示例 4 —— 内描边（给码点加一圈细描边，强化层次）：
\`\`\`js
ctx.strokeStyle = 'rgba(0,0,0,0.25)';
ctx.lineWidth = Math.max(1, s * 0.06);
ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
\`\`\`

【可选：顺便推荐一套配色】
除了码点效果，你还可以为这个风格推荐一整套配色和形状。在代码块里紧跟名称行，用一行注释给出（全部可选，缺省的工具不覆盖用户当前设置）：
    // 配色: fg=#前景色 bg=#背景色 dot=方块|圆点|圆角 eye=方块|圆角|圆形 logoFit=圆角|直角
其中 dot 对应码点形状，eye 对应定位眼形状，logoFit 对应 Logo 裁剪形状。
若你的效果依赖特定配色（如"落雪"配深蓝底才好看），请务必给出配色行。

【输出格式（务必照此结构，不要加其它说明）】
只输出一个代码块（用 \`\`\`js 包裹）。代码块【第一行】必须是风格名称的注释，格式严格为：
    // 名称：xxx
其后可选地跟一行：
    // 配色: fg=#xxxxxx bg=#xxxxxx dot=圆点 eye=圆形
再其后是函数体。把名称/配色写成代码块内的注释，方便用户整块复制。
示例：
\`\`\`js
// 名称：冬日落雪
// 配色: fg=#1e3a5f bg=#e0f2fe dot=圆角 eye=圆形
ctx.fillStyle = 'rgba(255,255,255,0.92)';
ctx.fillRect(x, y, s, Math.max(2, s * 0.3));
\`\`\`
代码块之外不要写任何文字（包括不要把名称写在代码块外）。不要复述上面的约定。`;
}

/** 用户粘贴内容解析结果 */
export interface ParsedAIOutput {
  /** 风格名称（去除「名称：」前缀后）；解析不到则为空串 */
  name: string;
  /** 逐码点绘制函数体（已 trim，已剥离名称/配色注释行）；解析不到则为空串 */
  code: string;
  /** 从「// 配色: ...」解析出的常规字段；解析不到则为空对象 */
  apply: StyleApply;
}

/** 匹配一行「名称：xxx」（可有 // 前缀，中英文冒号，name 关键字）。捕获组 = 名称文本 */
const NAME_LINE_RE = /^[ \t]*(?:(?:\/\/|#)\s*)?(?:名称|风格名(?:称)?|name)[ \t]*[:：][ \t]*(.+?)[ \t]*$/i;

/**
 * 把配色的中文值翻译成类型化的枚举值；非法返回 undefined。
 * dot/eye/logoFit 各自的合法集合不同，用重载让返回类型与 kind 对应。
 */
function parseShapeValue(raw: string, kind: 'dot'): DotShape | undefined;
function parseShapeValue(raw: string, kind: 'eye'): EyeShape | undefined;
function parseShapeValue(raw: string, kind: 'logoFit'): LogoFit | undefined;
function parseShapeValue(raw: string, kind: 'dot' | 'eye' | 'logoFit'): DotShape | EyeShape | LogoFit | undefined {
  const v = raw.trim();
  if (kind === 'dot') {
    if (v === '方块' || v === 'square') return 'square';
    if (v === '圆点' || v === 'dot') return 'dot';
    if (v === '圆角' || v === 'rounded') return 'rounded';
  } else if (kind === 'eye') {
    if (v === '方块' || v === 'square') return 'square';
    if (v === '圆角' || v === 'rounded') return 'rounded';
    if (v === '圆形' || v === '圆' || v === 'circle') return 'circle';
  } else {
    if (v === '圆角' || v === 'rounded') return 'rounded';
    if (v === '直角' || v === 'square') return 'square';
  }
  return undefined;
}

/**
 * 解析「// 配色: fg=#xxx bg=#xxx dot=圆点 eye=圆形 logoFit=圆角」行，抽出常规字段。
 * 全部字段可选；非法值忽略。返回的 apply 可直接合并进 cfg。
 */
function parsePaletteLine(line: string): StyleApply {
  const apply: StyleApply = {};
  const body = line.replace(/^.*?配色\s*[:：]/i, '').trim();
  // 匹配 key=value 对，key 与值之间允许空格
  const re = /(\w+)\s*=\s*([^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const key = m[1]!.toLowerCase();
    const val = m[2]!;
    if (key === 'fg') {
      const hex = normalizeHex(val);
      if (hex) apply.fgColor = hex;
    } else if (key === 'bg') {
      if (val === 'transparent' || val === '透明' || val === 'none') {
        apply.bgColor = '';
      } else {
        const hex = normalizeHex(val);
        if (hex) apply.bgColor = hex;
      }
    } else if (key === 'dot') {
      const d = parseShapeValue(val, 'dot');
      if (d) apply.dotShape = d;
    } else if (key === 'eye') {
      const e = parseShapeValue(val, 'eye');
      if (e) apply.eyeShape = e;
    } else if (key === 'logofit') {
      const l = parseShapeValue(val, 'logoFit');
      if (l) apply.logoFit = l;
    }
  }
  return apply;
}

/**
 * 把颜色值规范化为 #rrggbb。容错 AI 可能输出的「fef3c7」「#fef3c7」「FEF3C7」等写法。
 * 合法则返回带 # 的小写 hex；非法返回 undefined。
 */
function normalizeHex(raw: string): string | undefined {
  const v = raw.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(v)) return '#' + v;
  return undefined;
}

/**
 * 解析用户从 AI 那里复制回来、粘进「粘贴 AI 代码」框的内容，拆出【名称】+【配色】+【函数体】。
 *
 * 提示词要求 AI 把名称写成代码块内首行 `// 名称：xxx`，配色写在第二行 `// 配色: ...`。
 * 容错策略：
 *   - 代码：优先取 \`\`\`js / \`\`\`javascript / \`\`\` 代码块内容；无围栏则去 ``` 标记行后整段当代码。
 *   - 名称：优先取代码块内首条名称注释；其次代码块外首个名称行；都找不到留空。
 *   - 配色：取代码块内的 `// 配色: ...` 行解析；找不到则 apply 为空对象。
 *   - 取到后从代码体里剥掉名称行和配色行（不污染真正要执行的函数体）。
 */
export function parseAIOutput(raw: string): ParsedAIOutput {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return { name: '', code: '', apply: {} };

  // 1) 代码体：优先围栏块
  let codeBody = '';
  const fence = text.match(/```(?:js|javascript)?\s*\n([\s\S]*?)\n?```/i);
  if (fence) {
    codeBody = fence[1]!.trim();
  } else {
    codeBody = text
      .split('\n')
      .filter((l) => !/^```/.test(l.trim()))
      .join('\n')
      .trim();
  }

  // 2) 名称：优先代码块内首条名称注释；其次代码块外首个名称行
  let name = '';
  const inCodeNameLine = codeBody
    .split('\n')
    .find((l) => NAME_LINE_RE.test(l.trim()) && /^\s*(?:\/\/|#)/.test(l));
  if (inCodeNameLine) {
    name = inCodeNameLine.trim().match(NAME_LINE_RE)![1]!.trim().replace(/^["「『（(]+|["」』）)]+$/g, '').trim();
  } else {
    const outsideNameLine = text.split('\n').find((l) => NAME_LINE_RE.test(l.trim()));
    if (outsideNameLine) {
      name = outsideNameLine.trim().match(NAME_LINE_RE)![1]!.trim().replace(/^["「『（(]+|["」』）)]+$/g, '').trim();
    }
  }

  // 3) 配色：代码块内的 // 配色: ... 行
  let apply: StyleApply = {};
  const paletteLine = codeBody
    .split('\n')
    .find((l) => /^\s*(?:\/\/|#)\s*配色\s*[:：]/i.test(l));
  if (paletteLine) {
    apply = parsePaletteLine(paletteLine);
  }

  // 4) 从代码体剥掉名称行、配色行（含其前缀注释），得到纯净函数体
  const code = codeBody
    .split('\n')
    .filter(
      (l) => !NAME_LINE_RE.test(l.trim()) && !/^\s*(?:\/\/|#)\s*配色\s*[:：]/i.test(l),
    )
    .join('\n')
    .trim();

  return { name, code, apply };
}
