/**
 * 文稿分页 —— 把批量粘贴的文本切分成演示页（纯函数，无 DOM）。
 *
 * 分页规则（UI 提示语与此一致）：
 *   - 空行分页：连续空行视作一个分隔，前后各成一页；
 *   - `---`（三个及以上连字符）单独成行：强制分页；
 *   - `# 标题`：段落首行的 # 前缀行作为该页标题（单独成段也行 = 纯标题页）；
 *   - 超长段落：按句读（。！？!?；;…）拆句后贪心装页，单句仍超预算按字符硬切。
 *
 * 每页字符预算按画布比例给参考值（16:9→160 / 9:16→110 / 其它→130），
 * 仅影响切分位置的美观；真正的溢出保障由渲染端「自动缩字号」兜底。
 */

/** 一页演示内容：标题可选（# 行），正文必填（可为空 = 纯标题页） */
export interface Page {
  title?: string;
  body: string;
}

/** 分页结果 */
export interface PaginateResult {
  pages: Page[];
  /** 超出页数上限被丢弃（true 时 UI 提示） */
  truncated: boolean;
}

/** 页数上限：保护渲染性能与页导航可用性 */
export const MAX_PAGES = 60;
/** 标题长度上限 */
const TITLE_MAX = 40;

/** 强制分页分隔线：--- / ---- / === 等 */
const BREAK_RE = /^(?:-{3,}|={3,}|\*{3,})$/;
/** 标题行：# 前缀（允许全半角空格） */
const TITLE_RE = /^#{1,2}\s+(.*)$/;

/** 各比例的每页字符预算（切分参考值） */
export function pageBudget(aspectId: string): number {
  if (aspectId === '16:9') return 160;
  if (aspectId === '9:16') return 110;
  return 130;
}

/** 空内容时预填的示例文稿（首屏即有效果，可编辑） */
export const SAMPLE_TEXT = `# 即开宝匣 · 演示翻页视频

把文稿整段粘贴进来，空一行就是下一页。适合知识口播稿、清单体、金句合集——几分钟做出一支配乐演示短视频。

# 三步成片

第一，粘贴文稿自动分页；第二，挑一套主题与翻页动画；第三，选好背景音乐一键导出。

# 个性化交给 AI

完整主题、翻页动画与倒计时都能用 AI 生成，搭配纸张音效，让每一页都有自己的气质。`;

/**
 * 主入口：文本 → 页列表。
 * 永不抛错：任何输入都返回合法结果（空文本返回空列表）。
 */
export function paginate(text: string, budget: number): PaginateResult {
  // 下限 8 仅防病态预算（真实调用为 110-160），避免 0/负预算导致硬切死循环
  const cap = Math.max(8, Math.floor(budget));
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  // —— 第一遍：切成「块」（段落），`---` 强制分块，空行是天然块界 ——
  const blocks: Array<{ title?: string; bodyLines: string[] }> = [];
  let current: { title?: string; bodyLines: string[] } | null = null;

  const flush = (): void => {
    if (current && (current.title !== undefined || current.bodyLines.some((l) => l.trim()))) {
      blocks.push(current);
    }
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (BREAK_RE.test(line.trim())) {
      flush(); // 强制分页（挂起中的标题块也一并封存 = 纯标题页）
      continue;
    }
    if (!line.trim()) {
      // 空行分页：只封「有正文」的块；挂起中的标题块保持打开，
      // 吸收下一段正文（容忍「# 标题 ↵ 空行 ↵ 正文」的自然写法）
      if (current && current.bodyLines.length > 0) flush();
      continue;
    }
    const titleMatch = TITLE_RE.exec(line.trim());
    if (titleMatch) {
      // 新标题行：当前块已有标题或正文 → 先封块（标题即隐式分页 + 新页标题）
      if (current && (current.title !== undefined || current.bodyLines.length > 0)) flush();
      current = { title: titleMatch[1]!.trim().slice(0, TITLE_MAX), bodyLines: [] };
      continue;
    }
    if (!current) current = { bodyLines: [] };
    current.bodyLines.push(line);
  }
  flush();

  // —— 第二遍：超预算的块拆句装页 ——
  const pages: Page[] = [];
  let truncated = false;

  /** 尝试追加一页；超过上限则置 truncated 并停止收集 */
  const push = (p: Page): boolean => {
    if (pages.length >= MAX_PAGES) {
      truncated = true;
      return false;
    }
    pages.push(p);
    return true;
  };

  for (const b of blocks) {
    const titleLen = b.title?.length ?? 0;
    const bodyBudget = Math.max(8, cap - titleLen);
    const body = b.bodyLines.join('\n').trim();
    if (body.length + titleLen <= cap) {
      if (!push({ ...(b.title !== undefined ? { title: b.title } : {}), body })) break;
    } else {
      // 按句读拆分（保留句读符），贪心装页；显式换行处也允许断页
      const sentences = splitSentences(body);
      let buf = '';
      for (const s of sentences) {
        if (s.length > bodyBudget) {
          // 单句超预算：先封存已有内容，再按硬粒度切
          if (buf.trim()) {
            if (!push({ ...(b.title !== undefined ? { title: b.title } : {}), body: buf.trim() })) {
              buf = '';
              break;
            }
            buf = '';
          }
          for (let i = 0; i < s.length; i += bodyBudget) {
            if (
              !push({
                ...(b.title !== undefined ? { title: b.title } : {}),
                body: s.slice(i, i + bodyBudget),
              })
            ) {
              break;
            }
          }
          if (pages.length >= MAX_PAGES) break;
          continue;
        }
        if ((buf + s).length > bodyBudget && buf.trim()) {
          if (!push({ ...(b.title !== undefined ? { title: b.title } : {}), body: buf.trim() })) {
            buf = '';
            break;
          }
          buf = '';
        }
        buf += s;
      }
      if (buf.trim()) {
        push({ ...(b.title !== undefined ? { title: b.title } : {}), body: buf.trim() });
      }
    }
    if (truncated) break;
  }

  return { pages, truncated };
}

/**
 * 按句读拆句（保留句读符与换行）。CJK 句读与英文标点都认；
 * 换行并入前一句结尾，贪心装页时自然允许在换行处断页。
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const parts = text.split('\n');
  for (let pi = 0; pi < parts.length; pi++) {
    const para = parts[pi]!;
    let buf = '';
    for (const ch of para) {
      buf += ch;
      if ('。！？!?；;…'.includes(ch)) {
        out.push(buf);
        buf = '';
      }
    }
    if (buf) out.push(buf);
    if (pi < parts.length - 1 && out.length > 0) out[out.length - 1] += '\n';
  }
  return out.filter((s) => s.length > 0);
}
