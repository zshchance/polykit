import type { ToolConfig } from '@/core/types';

/**
 * 名言卡片 —— 模块自描述配置。
 * 首页（import.meta.glob）与 SEO 插件会自动读取本文件，无需手动登记。
 *
 * 可选美化素材请放在 ./assets/ 目录下：
 *   - assets/icon.<svg|png>   工具图标
 *   - assets/cover.<svg|png>  卡片首图
 * 文件名固定（icon / cover），扩展名不限。未提供时用下方 icon emoji 兜底。
 */
export default {
  slug: "quote-card",
  name: "名言卡片",
  description: '搜索或输入名言，一键生成精美卡片，多种模板可切换，直接下载图片做文案。',
  category: '自媒体',
  icon: '💬',
  keywords: ['名言', '金句', '卡片', '语录', '文案', '截图', '社交媒体', 'quote', '名言卡片'],
  card: { accent: '#0ea5e9' },
} satisfies ToolConfig;
