import type { RegistryConfig } from '@/core/types';

/**
 * 中央策展配置 —— 只管"治理"，不存"内容"。
 *
 * 工具的名称/描述/图标/关键词/首图都归各模块自己（tools/<slug>/tool.config.ts），
 * 这里仅负责：排序（order）、启用与否（enabled）、站点级 SEO 开关。
 *
 * 新增工具默认会自动出现在首页（order=100）。仅当需要调整顺序或临时隐藏某工具时，
 * 才在这里加一行：
 *   'fancy-text': { order: 10, enabled: false },
 */
export const registryConfig: RegistryConfig = {
  seo: {
    // 关键词默认不显示在卡片 UI 上，但始终写入 <meta> 与 JSON-LD（爬虫/AI 可读）。
    showKeywordsInline: false,
    siteKeywords: [
      '静态工具箱',
      '在线工具',
      '浏览器工具',
      '软件服务',
      '技术支持',
      '自媒体工具',
      '开发者工具',
      '文案工具',
      '名言卡片',
      '密码生成器',
      '万年历',
    ],
  },
  modules: {
    // password-generator 排到最前（示例工具）
    'password-generator': { order: 1 },
  },
};
