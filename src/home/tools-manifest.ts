import type { ToolMeta } from '@/core/types';

/**
 * ★ 工具清单 —— 单一数据源。
 * 首页据此渲染卡片；新增工具时脚手架 `npm run new` 会自动在此追加一条。
 *
 * 手动新增格式：
 *   { slug: 'quote-card', name: '金句卡片', description: '...', category: '文本', icon: '💬' }
 * slug 必须与 tools/<slug>/ 目录名一致，且全小写 kebab-case。
 */
export const toolsManifest: ToolMeta[] = [
  {
    slug: 'password-generator',
    name: '密码生成器',
    description: '生成可定制长度、字符集的强密码，本地生成不上传。',
    category: '安全',
    icon: '🔐',
  },
];
