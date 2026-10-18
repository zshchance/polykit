/**
 * AI 直连结果 → 候选口令列表（纯函数）。
 *
 * 提示词约定 AI 把口令放在 ```text 围栏里、每行一个；但直连路径要对各种
 * 「不完全守约」的输出有兜底：无围栏时按非空行取，行首编号/列表符剥掉，
 * 空行、围栏标记、纯编号行过滤，去重、限量。
 */

/** 行首编号 / 列表符剥离：`1. ` `1、` `2) ` `- ` `* ` */
function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:\d+[.、)]\s*|[-*]\s+)/, '').trim();
}

/**
 * 从 AI 返回文本中提取候选口令。
 * 优先取第一个 ```text（或裸 ```）围栏内的内容；没有围栏时按整段非空行处理。
 */
export function extractCandidates(raw: string, max = 10): string[] {
  const fenced = /```(?:text)?\s*\n([\s\S]*?)```/i.exec(raw);
  const body = fenced ? fenced[1]! : raw;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const candidate = stripListMarker(line).replace(/^`+|`+$/g, '').trim();
    if (!candidate || candidate === '```') continue;
    if (/^\d+[.、)]?$/.test(candidate)) continue; // 纯编号行
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
    if (out.length >= max) break;
  }
  return out;
}
