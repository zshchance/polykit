import type { ToolConfig } from '@/core/types';

/**
 * 演示翻页视频 —— 模块自描述配置（首页与 SEO 插件自动发现，无需登记）。
 * 字段说明见 README「tool.config.ts 字段」；美化素材放 ./assets/
 * （icon.* / cover.*，文件名固定，未提供时用 icon emoji 兜底）。
 */
export default {
  slug: 'slide-video',
  name: '演示翻页视频',
  description:
    '批量粘贴文稿自动分页，完整视觉主题联动版式、字体与装饰；拟物卷页、翻页音效、倒计时与背景音乐，一键导出演示短视频；支持 AI 自定义主题与动效，纯浏览器本地完成',
  category: '音视频',
  icon: '📽️',
  keywords: [
    '演示翻页视频',
    '翻页视频',
    '文稿转视频',
    '文字轮播视频',
    'PPT视频',
    '演示视频制作',
    '翻页动画',
  ], // SEO 关键词：默认对用户隐藏，但始终写入 meta/JSON-LD 供 AI/搜索引擎读取
  card: { accent: '#10b981' }, // emerald：全局未占用的强调色，与音视频邻居（天蓝/玫红）区分
} satisfies ToolConfig;
