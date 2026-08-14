import type { ToolConfig } from '@/core/types';

/**
 * 二维码生成器 —— 模块自描述配置（首页与 SEO 插件自动发现，无需登记）。
 * 字段说明见 README「tool.config.ts 字段」；美化素材放 ./assets/
 * （icon.* / cover.*，文件名固定，未提供时用 icon emoji 兜底）。
 */
export default {
  slug: 'qr-code',
  name: '二维码生成器',
  description:
    '生成可定制风格的二维码（圆点/圆角码点、定位眼形状、配色、中心 Logo），支持用 AI 生成自定义码点风格（如落雪、高光、描边等逐码点效果），上传已有二维码识别后美化重绘。',
  category: '图像',
  icon: '🔳',
  keywords: [
    '二维码',
    'QR码',
    '二维码生成',
    '美化二维码',
    '带Logo二维码',
    '圆点二维码',
    '扫码',
    'qrcode',
    'QR',
    'generator',
    'AI 风格',
    '自定义码点',
    '落雪二维码',
    '码点效果',
    'AI 提示词',
  ],
  card: { accent: '#0891b2' },
} satisfies ToolConfig;
