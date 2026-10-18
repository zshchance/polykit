import type { ToolConfig } from '@/core/types';

/**
 * AI 接入设置 —— 模块自描述配置（首页与 SEO 插件自动发现，无需登记）。
 * 这是全站 BYOK 大模型配置的唯一入口页，详见 docs/ai-framework.md。
 */
export default {
  slug: 'ai-settings',
  name: 'AI 接入设置',
  description:
    '全局配置大模型供应商（OpenAI 兼容 / Anthropic）：API 密钥、地址、多模态模型与调用优先级，支持连通性测试与模型列表拉取，各工具的 AI 能力自动引用；密钥仅存本地，配置可导出跨域名迁移。',
  category: 'AI',
  icon: '🧩',
  keywords: [
    'AI 设置',
    '大模型配置',
    'API 密钥',
    'BYOK',
    'OpenAI 兼容',
    'Anthropic',
    'DeepSeek',
    'Kimi',
    'GLM',
    'Ollama',
    '多模态模型',
    '视觉模型',
    '模型优先级',
    '本地密钥管理',
    'AI 接入',
  ],
  card: { accent: '#6366f1' },
} satisfies ToolConfig;
