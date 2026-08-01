import type { ToolConfig } from '@/core/types';

/**
 * AI 提示词灵感库 —— 模块自描述配置。
 * 首页（import.meta.glob）与 SEO 插件会自动读取本文件，无需手动登记。
 *
 * 可选美化素材请放在 ./assets/ 目录下：
 *   - assets/icon.<svg|png>   工具图标
 *   - assets/cover.<svg|png>  卡片首图
 * 文件名固定（icon / cover），扩展名不限。未提供时用下方 icon emoji 兜底。
 */
export default {
  slug: 'prompt-hub',
  name: 'AI 提示词灵感库',
  description: '精选实用与趣味 AI 提示词模板：写作、绘画、效率，还有「AI 还能这么玩」的彩蛋。搜索 / 标签 / 随机发现灵感，一键复制即用。',
  category: 'AI',
  icon: '🧠',
  keywords: [
    'AI 提示词', '提示词', 'prompt', '提示词灵感库', 'AI 玩法',
    '小红书文案', '公众号文案', 'AI 绘画', '提示词模板', 'AI 创意',
    'Midjourney', 'ChatGPT', '提示词工程',
  ],
  card: { accent: '#db2777' },
} satisfies ToolConfig;
