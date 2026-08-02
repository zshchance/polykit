import type { ToolConfig } from '@/core/types';

/**
 * 文字夹私货 —— 模块自描述配置。
 * 首页（import.meta.glob）与 SEO 插件会自动读取本文件，无需手动登记。
 *
 * 可选美化素材请放在 ./assets/ 目录下：
 *   - assets/icon.<svg|png>   工具图标
 *   - assets/cover.<svg|png>  卡片首图
 * 文件名固定（icon / cover），扩展名不限。未提供时用下方 icon emoji 兜底。
 */
export default {
  slug: 'contact-obfuscator',
  name: '文字夹私货',
  description:
    '把手机号/微信/QQ/邮箱等联系方式经多层随机字符变换（大小写打乱、数字转中文、穿插符号表情、可见分隔符，可选零宽字符/同形字），让机器正则识别失效、对人仍可读。可见变换为主能扛平台规范化，不可见字符默认关闭。输入与设置本地记忆，一次生成多条候选，数据不出浏览器。',
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
    'obfuscate',
  ],
  card: { accent: '#0f766e' },
} satisfies ToolConfig;
