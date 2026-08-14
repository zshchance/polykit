import type { ToolConfig } from '@/core/types';

/**
 * AI 配色提示词 —— 模块自描述配置（首页与 SEO 插件自动发现，无需登记）。
 * 字段说明见 README「tool.config.ts 字段」；美化素材放 ./assets/
 * （icon.* / cover.*，文件名固定，未提供时用 icon emoji 兜底）。
 */
export default {
  slug: 'color-prompt',
  name: 'AI配色提示词',
  description:
    '精选高级色系与情绪筛选，实时预览配色效果，一键生成中英文 AI 配色提示词，可直接用于幻灯片、网站与界面设计，数据不出本地。',
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
