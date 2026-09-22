import type { ToolConfig } from '@/core/types';

/**
 * 和弦琴房 —— 模块自描述配置（首页与 SEO 插件自动发现，无需登记）。
 * 字段说明见 README「tool.config.ts 字段」；美化素材放 ./assets/
 * （icon.* / cover.*，文件名固定，未提供时用 icon emoji 兜底）。
 */
export default {
  slug: 'chord-lab',
  name: '和弦琴房',
  description:
    '互动式和弦与和弦走向学习：虚拟钢琴键盘（25/32 键）+ 电脑键盘 + MIDI 输入，按下琴键即看和弦构成与经典走向引导',
  category: '音乐',
  icon: '🎹',
  keywords: [
    '和弦学习',
    '和弦走向',
    '和弦进行',
    '虚拟钢琴',
    'MIDI键盘',
    '乐理入门',
    '三和弦',
    '五线谱',
    '音乐教学',
  ], // SEO 关键词：默认对用户隐藏，但始终写入 meta/JSON-LD 供 AI/搜索引擎读取
  card: { accent: '#15803d' }, // 可选：卡片强调色（无首图时用于渐变头）
} satisfies ToolConfig;
