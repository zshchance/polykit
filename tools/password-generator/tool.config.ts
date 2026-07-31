import type { ToolConfig } from '@/core/types';

/**
 * 密码生成器 —— 模块自描述配置。
 * 构建期由 registry.ts（import.meta.glob）发现，并由 SEO 插件读取注入 meta/JSON-LD。
 */
export default {
  slug: 'password-generator',
  name: '密码生成器',
  description: '生成可定制长度、字符集的强密码，本地生成不上传。',
  category: '安全',
  icon: '🔐',
  keywords: ['密码生成', '强密码', '随机密码', 'password generator', '安全'],
  card: { accent: '#4f46e5' },
} satisfies ToolConfig;
