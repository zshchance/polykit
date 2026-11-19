import type { ToolConfig } from '@/core/types';

/** 歌词校准 —— 由工具注册与 SEO 插件自动发现。 */
export default {
  slug: 'lyric-sync',
  name: '歌词校准',
  description:
    '载入歌曲与 LRC/SRT 歌词，在全曲及局部频谱上拖动选区，逐句校准开始与结束时间；自动保存编辑进度并可重新导出。',
  category: '音视频',
  icon: '🎚️',
  keywords: [
    '歌词校准',
    '歌词打轴',
    'LRC编辑器',
    'SRT编辑器',
    '歌词时间轴',
    '音频对齐',
    '频谱图',
    'lyric sync',
    'LRC sync',
  ],
  card: { accent: '#8b5cf6' },
} satisfies ToolConfig;
