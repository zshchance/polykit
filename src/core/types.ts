/** 全站共享的类型定义 */

/**
 * 工具自描述配置（每个工具目录下 tool.config.ts 的 default export 类型）。
 *
 * 设计：把"内容身份"（slug/名称/描述/图标/关键词/配色）留在模块自身目录，
 * 中央 registry 只负责策展治理（排序/启用）。新增工具零改注册表即可被发现。
 */
export interface ToolConfig {
  /** URL 路径片段，需与 tools/<slug>/ 目录名一致，全小写 kebab-case */
  slug: string;
  /** 展示名称（中文标题） */
  name: string;
  /** 一句话描述，显示在卡片上 */
  description: string;
  /** 分类，用于首页分组展示（如 "文本"、"安全"、"图像"） */
  category: string;
  /** 可选：emoji 或简单字符图标，作为无图标资源时的兜底 */
  icon?: string;
  /**
   * 可选：SEO 关键词。
   * 默认情况下不渲染到用户可见 UI，但始终注入 <meta keywords> 和 JSON-LD，
   * 因此爬虫/AI 始终可读取（详见 registry-config.seo.showKeywordsInline）。
   */
  keywords?: string[];
  /** 可选：卡片视觉定制（强调色等） */
  card?: {
    /** 卡片强调色（hex），用于无首图时的渐变头与 hover 描边 */
    accent?: string;
  };
}

/**
 * 运行时注册后的工具（registry 合并 glob 发现的资源 URL 后的形态）。
 * 图标/首图 URL 在构建期由 Vite 解析（assets 目录就地存放）。
 */
export interface RegisteredTool extends ToolConfig {
  /** 模块 assets/icon.* 的最终 URL（无则用 icon emoji 兜底） */
  iconUrl?: string;
  /** 模块 assets/cover.* 的最终 URL（无则用 card.accent 渐变兜底） */
  coverUrl?: string;
  /** 策展排序权重，越小越靠前；默认 100 */
  order: number;
}

/**
 * 中央策展配置（src/home/registry-config.ts）。
 * 仅记录跨模块治理信息，不重复工具自身元数据。
 */
export interface RegistryConfig {
  /** 站点级 SEO 开关 */
  seo: SeoConfig;
  /** 按 slug 覆盖：排序权重、启用与否 */
  modules: Record<string, { order?: number; enabled?: boolean }>;
}

export interface SeoConfig {
  /**
   * 是否在卡片 UI 上直接展示关键词胶囊。
   * false（默认）：关键词仅写入 <meta> / JSON-LD，用户不可见，但 AI/搜索引擎始终可读。
   * true：额外渲染为可见标签。
   */
  showKeywordsInline: boolean;
  /** 站点默认关键词（首页 meta） */
  siteKeywords?: string[];
}

// ─────────────────────────── 万年历 / 节假日 ───────────────────────────

/**
 * 单日信息：节日类型 + 名称。
 * legal    法定假日放假（红色，标记为"休"）
 * workday  法定调休上班（周末但补班，橙色，标记为"班"）
 * festival 传统节日 / 二十四节气（当天非公休但值得展示）
 */
export interface DayInfo {
  type: 'legal' | 'workday' | 'festival';
  /** 显示名（如 "春节"、"国庆节"、"清明"、"立春"） */
  name: string;
}

/**
 * 节假日策展数据结构（holidays.json）。
 * 数据来源：国务院办公厅年度部分节假日安排通知（权威公告），每年初更新一次。
 */
export interface HolidaysData {
  /** 数据版本，年份标识（如 "2026"） */
  version: string;
  /** 数据来源说明（便于溯源） */
  source: string;
  /** 最后核对日期 ISO */
  updatedAt: string;
  /** 按年组织：年份 → 日期(YYYY-MM-DD) → 当日信息 */
  years: Record<string, Record<string, DayInfo>>;
}
