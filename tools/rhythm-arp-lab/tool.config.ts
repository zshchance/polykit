import type { ToolConfig } from '@/core/types';

/**
 * 节奏琶音工坊 —— 模块自描述配置（首页与 SEO 插件自动发现，无需登记）。
 * 字段说明见 README「tool.config.ts 字段」；美化素材放 ./assets/
 * （icon.* / cover.*，文件名固定，未提供时用 icon emoji 兜底）。
 */
export default {
  slug: 'rhythm-arp-lab',
  name: '节奏琶音工坊',
  description: '鼓组律动 × 琶音模式参考库：混合试听、和弦垫实时试奏、一键复制组合提示词',
  category: '音乐',
  icon: '🥁',
  keywords: [
    '节奏型',
    '鼓点律动',
    '琶音模式',
    'AI音乐提示词',
    'Suno提示词',
    '音乐创作辅助',
    '节拍设计',
    '和弦进行',
  ], // SEO 关键词：默认对用户隐藏，但始终写入 meta/JSON-LD 供 AI/搜索引擎读取
  card: { accent: '#e11d48' }, // 可选：卡片强调色（无首图时用于渐变头）
} satisfies ToolConfig;
