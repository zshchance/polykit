import type { ToolConfig } from '@/core/types';

/**
 * AI 配色提示词 —— 模块自描述配置。
 * 首页（import.meta.glob）与 SEO 插件会自动读取本文件，无需手动登记。
 *
 * 可选美化素材请放在 ./assets/ 目录下：
 *   - assets/icon.<svg|png>   工具图标
 *   - assets/cover.<svg|png>  卡片首图
 * 文件名固定（icon / cover），扩展名不限。未提供时用下方 icon emoji 兜底。
 */
export default {
  slug: 'color-prompt',
  name: 'AI配色提示词',
  description: '精选色系 + 配色预览，一键生成中英文 AI 配色提示词，美化幻灯片与网站。',
  category: '自媒体',
  icon: '🎨',
  keywords: [
    '配色', '色彩', '提示词', 'AI', '幻灯片', 'PPT', '网站', '设计',
    'color', 'palette', 'prompt', 'design',
  ],
  card: { accent: '#a855f7' },
} satisfies ToolConfig;
