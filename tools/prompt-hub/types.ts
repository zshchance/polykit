/**
 * AI 提示词灵感库 —— 共享类型与类目定义。
 *
 * 核心思想：实用提示词与趣味彩蛋共用同一个 Prompt 模型，
 * 用 category（类目）做主筛选、tags（多标签）做组合筛选、fun 标记区分彩蛋。
 * 这样筛选 / 搜索 / 随机三种检索方式都能在同一套数据上跑。
 *
 * 新增提示词时：在对应 data/categories/*.ts 里加一项即可，data/index.ts 自动聚合。
 */

/** 用户需在详情弹层里填写的变量 */
export interface Variable {
  /** 变量键，对应模板里的 {{key}} */
  key: string;
  /** 输入框标签，如「主题/产品」 */
  label: string;
  /** 输入框占位提示 */
  placeholder?: string;
  /** 是否必填（仅影响 UI 标星；空值时仍会用 default 兜底，保证复制即用） */
  required?: boolean;
  /** 空值时的回退默认（让用户不填也能得到一个完整可用的提示词） */
  default?: string;
  /** 多行文本框（卖点、正文等长输入用） */
  multiline?: boolean;
}

/** 一条提示词（实用与彩蛋统一模型） */
export interface Prompt {
  /** 唯一 id（kebab-case，跨类目不重复） */
  id: string;
  /** 标题 */
  title: string;
  /** emoji 图标 */
  icon: string;
  /** 类目 id（取自 CATEGORIES 的 id） */
  category: string;
  /** 多标签（组合筛选 + 搜索匹配） */
  tags: string[];
  /** 是否趣味彩蛋（显徽章 + 参与随机池） */
  fun: boolean;
  /** 一句话说明（卡片展示 + 搜索匹配） */
  desc: string;
  /** 用户需填的变量；空数组表示纯复制即用 */
  variables: Variable[];
  /** 提示词模板，含 {{变量名}} 占位 */
  template: string;
}

/** 类目定义：主筛选维度 */
export interface CategoryDef {
  id: string;
  name: string;
  icon: string;
}

/**
 * 类目列表（顺序即胶囊展示顺序）。
 * 'all' 是特殊类目表示「全部」，不放进这里（由 main.ts 单独处理）。
 */
export const CATEGORIES: readonly CategoryDef[] = [
  { id: 'writing', name: '写作', icon: '✍️' },
  { id: 'design', name: '绘画设计', icon: '🎨' },
  { id: 'productivity', name: '效率学习', icon: '⚡' },
  { id: 'jargon', name: '黑话翻译', icon: '🎭' },
  { id: 'fun', name: '趣味彩蛋', icon: '✨' },
];

/** 全部合法类目 id（含 'all'），用于 settings 校验 */
export const CATEGORY_IDS: readonly string[] = ['all', ...CATEGORIES.map((c) => c.id)];

/** 类目 id → 中文名（卡片展示与日志用） */
export function categoryName(id: string): string {
  if (id === 'all') return '全部';
  return CATEGORIES.find((c) => c.id === id)?.name ?? id;
}
