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
      '即开宝匣',
      '在线工具',
      '在线小工具',
      '小工具合集',
      '本地工具',
      '浏览器工具',
      '即用即走',
      '数据不出本地',
      '自媒体工具',
      '开发者工具',
      '文案工具',
      '名言卡片',
      '密码生成器',
      'AI配色提示词',
      '配色工具',
      '配色提取器',
      '取色',
      '二维码生成器',
      '二维码',
      'QR码',
      '图片压缩',
      '图片格式转换',
      'WebP转换',
      '图片转ICO',
      'AI 提示词',
      '提示词灵感库',
      'AI 玩法',
      '提示词模板',
      '小红书文案',
      'AI 创意',
      '行业黑话',
      '黑话翻译',
      '互联网黑话',
      '术语词典',
      '哲学思辨',
      '苏格拉底',
      '思想实验',
      '万年历',
      '字符画',
      'ASCII art',
      '终端字符画',
      '图片转字符',
      'ASCII banner',
      '终端',
      '复古终端',
      'CRT 终端',
      '半块字符',
    ],
  },
  modules: {
    // password-generator 排到最前（示例工具）
    'password-generator': { order: 1 },
    'color-prompt': { order: 2 },
    'color-extractor': { order: 3 },
    'qr-code': { order: 4 },
    'image-compress': { order: 5 },
    'prompt-hub': { order: 6 },
  },
};
