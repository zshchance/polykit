import type { ToolConfig } from '@/core/types';

/**
 * 文字夹私货 —— 模块自描述配置（首页与 SEO 插件自动发现，无需登记）。
 * 字段说明见 README「tool.config.ts 字段」；美化素材放 ./assets/
 * （icon.* / cover.*，文件名固定，未提供时用 icon emoji 兜底）。
 */
export default {
  slug: 'contact-obfuscator',
  name: '文字夹私货',
  description:
    '手机号/微信/邮箱等联系方式防机器识别：大小写打乱、数字转中文、穿插符号表情等多层随机变换，可选零宽字符与同形字激进层，机器识别失效、对人可读，变态档附 AI 可解密变换。设置本地记忆，数据不出浏览器。',
  category: '文本',
  icon: '🥷',
  keywords: [
    '联系方式防检测',
    '防屏蔽',
    '微信防屏蔽',
    '手机号防识别',
    '字符变换',
    '零宽字符',
    '同形字',
    '数字转中文',
    '文本混淆',
    '反爬虫',
    '防采集',
    '联系方式加密',
    'AI 还原',
    'AI 解密',
    '豆包还原',
    '变态加密',
    'leet',
    'Base64 联系方式',
    '罗马数字',
    'obfuscate',
  ],
  card: { accent: '#0f766e' },
} satisfies ToolConfig;
