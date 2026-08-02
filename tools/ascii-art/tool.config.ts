import type { ToolConfig } from '@/core/types';

/**
 * 终端字符画 —— 模块自描述配置。
 * 首页（import.meta.glob）与 SEO 插件会自动读取本文件，无需手动登记。
 *
 * 可选美化素材请放在 ./assets/ 目录下：
 *   - assets/icon.<svg|png>   工具图标
 *   - assets/cover.<svg|png>  卡片首图
 * 文件名固定（icon / cover），扩展名不限。未提供时用下方 icon emoji 兜底。
 */
export default {
  slug: 'ascii-art',
  name: '终端字符画',
  description: '把图片或文字渲染成复古终端风格的字符画：图片转 ASCII（半块高细节真彩模式）、文字流排版进终端外框、Logo 字符大字 banner，6 套风格预设（复古绿屏 / 琥珀 / 白纸 / 赛博朋克 / 蓝屏 / 极简）+ AI 自定义风格，CRT 扫描线辉光，一键复制纯文本或彩色 HTML、下载 PNG。数据全程本地处理。',
  category: '自媒体',
  icon: '🖥️',
  keywords: [
    '字符画', 'ASCII art', 'ASCII', '终端', '终端字符画', '图片转字符',
    '图片转 ASCII', '文字转字符画', '半块字符', '复古终端', 'CRT',
    '绿屏', '琥珀屏', '赛博朋克', '终端截图', 'ASCII banner',
    'terminal art', 'text to ascii', 'image to ascii', '字符艺术',
    '自定义风格', 'AI 风格', '终端主题', 'AI 设计风格', 'Logo 字符',
  ],
  card: { accent: '#33ff66' },
} satisfies ToolConfig;
