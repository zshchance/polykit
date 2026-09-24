import type { ToolConfig } from '@/core/types';

/**
 * 调式罗盘 —— 模块自描述配置（首页与 SEO 插件自动发现，无需登记）。
 * 字段说明见 README「tool.config.ts 字段」；美化素材放 ./assets/
 * （icon.* / cover.*，文件名固定，未提供时用 icon emoji 兜底）。
 */
export default {
  slug: 'mode-wheel',
  name: '调式罗盘',
  description:
    '可调式的和弦转盘：五度圈上点亮 10 种调式的自然和弦，点扇区即弹、招牌进行自动巡航，用共同音染色看懂和弦的远近与色彩',
  category: '音乐',
  icon: '🧭',
  keywords: [
    '调式',
    '五度圈',
    '和弦进行',
    'Mixolydian',
    '和弦转盘',
    '乐理入门',
    '音乐创作',
    '调式音阶',
    '罗马数字级数',
  ], // SEO 关键词：默认对用户隐藏，但始终写入 meta/JSON-LD 供 AI/搜索引擎读取
  card: { accent: '#7c3aed' }, // 可选：卡片强调色（无首图时用于渐变头）
} satisfies ToolConfig;
