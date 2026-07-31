/// <reference types="vite/client" />

/**
 * 编译期注入的全局常量（由 vite.config.ts 的 define 注入）。
 * 控制关键词是否在卡片 UI 上可见；不影响 meta/JSON-LD（始终注入）。
 */
declare const __SEO_SHOW_KEYWORDS__: boolean;
