/** 全站共享的类型定义 */

/**
 * 工具清单条目。
 * 每个工具在 src/home/tools-manifest.ts 中登记一条，首页据此渲染导航卡片。
 * 脚手架 `npm run new` 会自动追加一条占位记录。
 */
export interface ToolMeta {
  /** URL 路径片段，需与 src/tools/<slug>/ 目录名一致，全小写 kebab-case */
  slug: string;
  /** 展示名称（中文标题） */
  name: string;
  /** 一句话描述，显示在卡片上 */
  description: string;
  /** 分类，用于首页分组展示（如 "文本"、"安全"、"图像"） */
  category: string;
  /** 可选：emoji 或简单字符图标，纯前端免引图标库 */
  icon?: string;
}
