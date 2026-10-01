import type { ToolConfig } from '@/core/types';

/**
 * Markdown 手札 —— 模块自描述配置（首页与 SEO 插件自动发现，无需登记）。
 * 字段说明见 README「tool.config.ts 字段」；美化素材放 ./assets/
 * （icon.* / cover.*，文件名固定，未提供时用 icon emoji 兜底）。
 */
export default {
  slug: 'markdown-editor',
  name: 'Markdown 手札',
  description:
    '即开即写的 Markdown 编辑器：拖入 .md 文件或新建手稿，左侧编辑右侧实时渲染，支持 Mermaid 图示、代码高亮与数学公式；内容自动保存在本浏览器，刷新不丢失，可导出独立 HTML / Markdown / PDF。',
  category: '文本',
  icon: '✍️',
  keywords: [
    'Markdown',
    'markdown 编辑器',
    'md 编辑器',
    '实时预览',
    '写作',
    '笔记',
    '手札',
    'Mermaid',
    '代码高亮',
    '数学公式',
    'KaTeX',
    '导出 HTML',
    '导出 PDF',
    '离线编辑器',
  ],
  card: { accent: '#6366f1' },
} satisfies ToolConfig;
