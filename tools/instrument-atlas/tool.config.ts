import type { ToolConfig } from '@/core/types';

/**
 * 乐器百科 —— 模块自描述配置（首页与 SEO 插件自动发现，无需登记）。
 * 字段说明见 README「tool.config.ts 字段」；美化素材放 ./assets/
 * （icon.* / cover.*，文件名固定，未提供时用 icon emoji 兜底）。
 */
export default {
  slug: 'instrument-atlas',
  name: '乐器百科',
  description:
    '50+ 件乐器 × 9 大谱系的多维百科：实物照片 + 声音样本试听 + 音色特点与技巧解析 + 编曲角色/搭配推荐，AI 音乐标签与提示词一键复制，为音乐创作者而策展。',
  category: '音视频',
  icon: '🎻',
  keywords: [
    '乐器百科',
    '乐器大全',
    '乐器介绍',
    '乐器试听',
    '乐器声音',
    '编曲教程',
    '配器法',
    '乐器搭配',
    '音乐制作',
    '音乐创作',
    'AI音乐提示词',
    'Suno提示词',
    '音色库',
    '乐器图鉴',
    '管弦乐器',
    '民族乐器',
    '中国民族乐器',
    '电子乐器',
    '钢琴',
    '小提琴',
    '吉他',
    '萨克斯',
    '二胡',
    '古筝',
    '唢呐',
    '合成器',
    '架子鼓',
    '影视配乐乐器',
    '世界音乐',
  ],
  card: { accent: '#b45309' },
} satisfies ToolConfig;
