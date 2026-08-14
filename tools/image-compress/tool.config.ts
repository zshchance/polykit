import type { ToolConfig } from '@/core/types';

/**
 * 图片压缩转换 —— 模块自描述配置（首页与 SEO 插件自动发现，无需登记）。
 * 字段说明见 README「tool.config.ts 字段」；美化素材放 ./assets/
 * （icon.* / cover.*，文件名固定，未提供时用 icon emoji 兜底）。
 */
export default {
  slug: 'image-compress',
  name: '图片压缩转换',
  description:
    '本地压缩图片、在 JPEG / WebP / PNG / ICO 之间转换，按用途一键预设参数，并可生成 AI 浏览器接管提示词，左右滑动对比压缩前后效果。图片仅在浏览器处理。',
  category: '图像',
  icon: '🗜️',
  keywords: [
    '图片压缩',
    '图片格式转换',
    'WebP 转换',
    'PNG 转 JPG',
    '图片转 ICO',
    'favicon',
    '压缩图片',
    'image compress',
    'image converter',
    '压缩强度',
    '对比预览',
    '用途预设',
    '小红书压缩',
    '电商图片压缩',
    'AI 浏览器',
    'Tabbit',
    'AI 接管',
    '参数 JSON',
    '快捷输入',
  ],
  card: { accent: '#7c3aed' },
} satisfies ToolConfig;
