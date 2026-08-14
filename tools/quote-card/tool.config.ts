import type { ToolConfig } from '@/core/types';

/**
 * 名言卡片 —— 模块自描述配置（首页与 SEO 插件自动发现，无需登记）。
 * 字段说明见 README「tool.config.ts 字段」；美化素材放 ./assets/
 * （icon.* / cover.*，文件名固定，未提供时用 icon emoji 兜底）。
 */
export default {
  slug: 'quote-card',
  name: '名言卡片',
  description:
    '搜索或输入名言，一键生成精美卡片，多种模板与入场动画可切换，支持用 AI 自定义模板（可内嵌 SVG 图形）与动画效果代码并生成提示词，直接下载图片或视频做文案。',
  category: '自媒体',
  icon: '💬',
  keywords: [
    '名言',
    '金句',
    '卡片',
    '语录',
    '文案',
    '截图',
    '社交媒体',
    'quote',
    '语录卡片',
    '金句卡片',
    '自定义动画',
    '自定义模板',
    'AI 提示词',
    '动画效果',
    '文字动画',
    'Web Animations API',
    'SVG 卡片',
    'AI 设计模板',
    '模板设计',
  ],
  card: { accent: '#0ea5e9' },
} satisfies ToolConfig;
