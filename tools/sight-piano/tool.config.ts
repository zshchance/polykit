import type { ToolConfig } from '@/core/types';

/**
 * 识谱琴房 —— 模块自描述配置（首页与 SEO 插件自动发现，无需登记）。
 * 字段说明见 README「tool.config.ts 字段」；美化素材放 ./assets/
 * （icon.* / cover.*，文件名固定，未提供时用 icon emoji 兜底）。
 */
export default {
  slug: 'sight-piano',
  name: '识谱琴房',
  description:
    '拟物钢琴上的五线谱识谱与弹琴练习：单手到双手大谱表，识谱 / 和弦走向 / 琶音三阶各 150+ 首分级练习，内置节拍器与节奏伴奏，支持鼠标 / 电脑键盘 / 88 键 MIDI，可导入简谱、ABC 与 MIDI 曲谱',
  category: '音乐',
  icon: '🎼',
  keywords: [
    '五线谱识谱',
    '视奏练习',
    '虚拟钢琴',
    '钢琴教学',
    '识谱练习',
    '双手钢琴',
    '大谱表',
    '和弦走向',
    '琶音练习',
    '节拍器',
    'MIDI键盘',
    '数字简谱导入',
    'ABC记谱',
    '音乐学习',
  ], // SEO 关键词：默认对用户隐藏，但始终写入 meta/JSON-LD 供 AI/搜索引擎读取
  card: { accent: '#b45309' }, // 可选：卡片强调色（无首图时用于渐变头）
} satisfies ToolConfig;
