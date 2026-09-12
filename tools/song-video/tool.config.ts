import type { ToolConfig } from '@/core/types';

/**
 * 歌曲生成视频 —— 模块自描述配置。
 * 构建期由 registry.ts（import.meta.glob）发现，并由 SEO 插件读取注入 meta/JSON-LD。
 */
export default {
  slug: 'song-video',
  name: '歌曲生成视频',
  description:
    '上传 MP3/WAV 音乐，可选配歌词字幕（LRC/SRT）、背景与专辑封面，一键在浏览器里渲染出带音频可视化、滚动歌词、进度条与片尾字幕的音乐播放视频，本地完成、绝不上传。',
  category: '音视频',
  icon: '🎵',
  keywords: [
    '歌曲生成视频',
    '音乐视频',
    '音频可视化',
    '歌词视频',
    'MP3转视频',
    'LRC歌词',
    'SRT字幕',
    '音乐播放器录屏',
    'song video',
    'music visualizer',
  ],
  card: { accent: '#0ea5e9' },
} satisfies ToolConfig;
