import type { ToolConfig } from '@/core/types';

/**
 * AI 配色提示词 —— 模块自描述配置（首页与 SEO 插件自动发现，无需登记）。
 * 字段说明见 README「tool.config.ts 字段」；美化素材放 ./assets/
 * （icon.* / cover.*，文件名固定，未提供时用 icon emoji 兜底）。
 */
export default {
  slug: 'color-prompt',
  name: 'AI配色提示词',
  description: '精选色系 + 配色预览，一键生成中英文 AI 配色提示词，美化幻灯片与网站。',
  category: '自媒体',
  icon: '🎨',
  keywords: [
    '配色',
    '色彩',
    '提示词',
    'AI',
    '幻灯片',
    'PPT',
    '网站',
    '设计',
    'color',
    'palette',
    'prompt',
    'design',
  ],
  card: { accent: '#a855f7' },
} satisfies ToolConfig;
