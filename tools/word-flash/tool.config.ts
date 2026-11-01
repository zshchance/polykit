import type { ToolConfig } from '@/core/types';

/**
 * 文字快闪视频 —— 模块自描述配置（首页与 SEO 插件自动发现，无需登记）。
 * 字段说明见 README「tool.config.ts 字段」；美化素材放 ./assets/
 * （icon.* / cover.*，文件名固定，未提供时用 icon emoji 兜底）。
 */
export default {
  slug: 'word-flash',
  name: '文字快闪视频',
  description:
    '粘贴一段文案，按句读自动切成快闪卡片；大字排版、入场动效、节拍对齐与进度条，配乐一键导出竖屏短视频；支持 AI 自定义主题与动效，纯浏览器本地完成',
  category: '音视频',
  icon: '⚡',
  keywords: [
    '文字快闪视频',
    '快闪视频',
    '文字卡点视频',
    '卡点视频制作',
    '文案转视频',
    '大字视频',
    '动态文字视频',
    'Kinetic Typography',
  ], // SEO 关键词：默认对用户隐藏，但始终写入 meta/JSON-LD 供 AI/搜索引擎读取
  card: { accent: '#f43f5e' }, // rose：与音视频邻居（天蓝/翠绿）区分
} satisfies ToolConfig;
