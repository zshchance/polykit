import type { ToolConfig } from '@/core/types';

/**
 * 配色提取器 —— 模块自描述配置（首页与 SEO 插件自动发现，无需登记）。
 * 字段说明见 README「tool.config.ts 字段」；美化素材放 ./assets/
 * （icon.* / cover.*，文件名固定，未提供时用 icon emoji 兜底）。
 */
export default {
  slug: 'color-extractor',
  name: '配色提取器',
  description:
    '上传图片自动提取主色，生成 CSS 变量 / Tailwind / SCSS / JSON 等多格式配色，并一键生成颜色迁移、风格统一等 AI 玩法提示词，数据不出本地。',
  category: '图像',
  icon: '🎯',
  keywords: [
    '配色',
    '取色',
    '主色提取',
    '颜色提取',
    '色板',
    '图像配色',
    'CSS 变量',
    'Tailwind',
    '设计',
    'color',
    'palette',
    'extract',
    'AI 提示词',
    '颜色迁移',
    '风格统一',
    '配色重造',
  ],
  card: { accent: '#0d9488' },
} satisfies ToolConfig;
