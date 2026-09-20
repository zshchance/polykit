import type { ToolConfig } from '@/core/types';

/**
 * 设计风格图鉴 —— 模块自描述配置（首页与 SEO 插件自动发现，无需登记）。
 * 字段说明见 README「tool.config.ts 字段」；美化素材放 ./assets/
 * （icon.* / cover.*，文件名固定，未提供时用 icon emoji 兜底）。
 */
export default {
  slug: 'style-atlas',
  name: '设计风格图鉴',
  description:
    '48 种视觉风格 × 8 大谱系的多维图鉴：AI 生成参考图 + 特点手法 + 情绪场景 + 代表配色，AI 标签与提示词一键复制，边逛边学。',
  category: '图像',
  icon: '🎨',
  keywords: [
    '设计风格',
    '平面设计',
    '图像风格',
    '风格图鉴',
    '设计灵感',
    '视觉设计',
    '设计学习',
    'AI绘画提示词',
    'AI绘画风格',
    'Midjourney风格',
    '设计风格标签',
    '包豪斯',
    '波普艺术',
    '赛博朋克',
    '蒸汽波',
    '孟菲斯',
    '玻璃拟态',
    '酸性设计',
    '国潮',
    '极简主义',
    '浮世绘',
    '中国水墨',
    '新中式',
    '敦煌壁画',
    '日系胶片',
    '电影感',
    '扁平插画',
  ],
  card: { accent: '#7c3aed' },
} satisfies ToolConfig;
