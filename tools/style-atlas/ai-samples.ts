/**
 * AI 参考图索引 —— 构建期经 import.meta.glob 就地收集 assets/samples/*.webp。
 *
 * 图片由 minimax-h3-video 技能的 Krea 2 后端按各词条 prompt 离线生成，
 * 与代码解耦：某风格没有参考图时 getAiSampleUrl 返回 undefined，
 * UI 回退到程序化 SVG 样例（永远可用）。
 */
const modules = import.meta.glob<string>('./assets/samples/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

const BY_ID = new Map<string, string>();
for (const [path, url] of Object.entries(modules)) {
  const id = /\/([^/]+)\.webp$/.exec(path)?.[1];
  if (id) BY_ID.set(id, url);
}

/** 取某风格的 AI 参考图 URL（不存在则为 undefined） */
export function getAiSampleUrl(id: string): string | undefined {
  return BY_ID.get(id);
}

/** 当前打包进工具的 AI 参考图数量（用于 UI 提示/测试） */
export const AI_SAMPLE_COUNT = BY_ID.size;
