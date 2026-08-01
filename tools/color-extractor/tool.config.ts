import type { ToolConfig } from '@/core/types';

/**
 * 配色提取器 —— 模块自描述配置。
 * 首页（import.meta.glob）与 SEO 插件会自动读取本文件，无需手动登记。
 *
 * 可选美化素材请放在 ./assets/ 目录下：
 *   - assets/icon.<svg|png>   工具图标
 *   - assets/cover.<svg|png>  卡片首图
 * 文件名固定（icon / cover），扩展名不限。未提供时用下方 icon emoji 兜底。
 */
export default {
  slug: 'color-extractor',
  name: '配色提取器',
  description: '上传图片自动提取主色，生成 CSS 变量 / Tailwind / SCSS / JSON 等多格式配色，并一键生成颜色迁移、风格统一等 AI 玩法提示词，数据不出本地。',
  category: '图像',
  icon: '🎯',
  keywords: [
    '配色', '取色', '主色提取', '颜色提取', '色板', '图像配色',
    'CSS 变量', 'Tailwind', '设计', 'color', 'palette', 'extract',
    'AI 提示词', '颜色迁移', '风格统一', '配色重造',
  ],
  card: { accent: '#0d9488' },
} satisfies ToolConfig;
