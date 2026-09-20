/**
 * 设计风格图鉴 —— 数据模型与维度词表。
 *
 * 每个风格条目（StyleEntry）同时承载两类信息：
 *   1. 学习信息：简介 / 创作思路 / 视觉特点 / 创作手法 / 配色
 *   2. 检索与复用信息：五个筛选维度（大类/年代/情绪/特征/场景）+ AI 标签与提示词
 *
 * 五个维度的取值全部来自下方词表（CATEGORY_ORDER / ERA_ORDER / MOODS / TRAITS / SCENES），
 * 词条只能从词表中挑选，保证筛选胶囊集合可控、不会因自由文本发散。
 */

// ───────────── 维度词表（顺序即 UI 展示顺序）─────────────

/** 大类：风格的文化/技术谱系 */
export const CATEGORY_ORDER = [
  '现代经典',
  '波普复古',
  '未来数字',
  '界面材质',
  '手绘工艺',
  '插画绘本',
  '摄影光影',
  '东方美学',
  'CG游戏美术',
  '写真人像',
  '肖像艺术',
  'Vlog生活',
  '商业广告',
  '二次元动漫',
  '场景概念',
  '时尚潮流',
  '字体图形',
  '图案纹理',
  '复古印刷',
  '超现实艺术',
  '建筑空间',
  '美食摄影',
  '自然动物',
  '电影视觉',
] as const;
export type Category = (typeof CATEGORY_ORDER)[number];

/** 兴起年代：帮助建立"风格 ↔ 时代背景"的直觉（传统技法归为「传世经典」） */
export const ERA_ORDER = [
  '传世经典',
  '1890s',
  '1920s',
  '1930s',
  '1950s',
  '1960s',
  '1970s',
  '1980s',
  '2000s',
  '2010s',
  '2020s',
] as const;
export type Era = (typeof ERA_ORDER)[number];

/** 情绪：作品给人的心理感受 */
export const MOODS = [
  '活力',
  '优雅',
  '前卫',
  '复古',
  '怀旧',
  '未来感',
  '叛逆',
  '俏皮',
  '宁静',
  '奢华',
  '神秘',
  '质朴',
  '温暖',
  '梦幻',
  '冷酷',
  '治愈',
] as const;

/** 视觉特征：画面上一眼可辨的形式语言 */
export const TRAITS = [
  '几何构成',
  '有机曲线',
  '网格排版',
  '大留白',
  '高饱和撞色',
  '复古配色',
  '霓虹光效',
  '渐变弥散',
  '对称构图',
  '斜向动势',
  '重复图案',
  '拼贴合成',
  '肌理质感',
  '立体纵深',
  '颗粒像素',
  '错位故障',
  '通透玻璃',
  '手绘线条',
  '强对比',
  '光影氛围',
  '写实质感',
] as const;

/** 适用场景：该风格最常被用在哪里 */
export const SCENES = [
  '海报',
  '品牌VI',
  'UI界面',
  '包装',
  '社媒配图',
  '游戏美术',
  '音乐视觉',
  '书籍装帧',
  '文创周边',
  '网页设计',
  '插画',
  '字体设计',
  '摄影',
  '视频封面',
] as const;

// ───────────── 词条 ─────────────

export interface PaletteColor {
  hex: string;
  name: string;
}

/**
 * 一个风格条目。参考图由 assets/samples/<id>.webp 提供
 * （按本词条 prompt 用生图模型离线生成），palette 为词条的代表配色。
 */
export interface StyleEntry {
  /** kebab-case id，同时是参考图文件名（assets/samples/<id>.webp） */
  id: string;
  /** 中文名 */
  name: string;
  /** 英文/原文名（AI 提示词里常用的写法） */
  nameEn: string;
  /** 卡片小图标（emoji） */
  icon: string;
  category: Category;
  era: Era;
  /** 情绪词（1-3 个，取自 MOODS） */
  moods: string[];
  /** 适用场景（2-4 个，取自 SCENES） */
  scenes: string[];
  /** 视觉特征（2-4 个，取自 TRAITS）——卡片与筛选用 */
  traits: string[];
  /** 创作手法（4-6 条自由短句，可逐条复制） */
  techniques: string[];
  /** 代表配色（5 色，与样例图一致，点击可复制 hex） */
  palette: PaletteColor[];
  /** 一句话简介（卡片展示，约 50 字） */
  desc: string;
  /** 背景与创作思路（详情弹层展示，约 100 字） */
  background: string;
  /** AI 检索/生成常用标签（英文为主，逐枚复制） */
  keywords: string[];
  /** 英文 AI 提示词（整段复制） */
  prompt: string;
  /** 中文 AI 提示词（整段复制） */
  promptZh: string;
}

/** 五个筛选维度的定义（key 对应 StyleEntry 字段） */
export type FacetKey = 'category' | 'era' | 'moods' | 'traits' | 'scenes';

export interface Facet {
  key: FacetKey;
  label: string;
  icon: string;
  values: readonly string[];
}

export const FACETS: Facet[] = [
  { key: 'category', label: '大类', icon: '🗂', values: CATEGORY_ORDER },
  { key: 'era', label: '年代', icon: '🕰', values: ERA_ORDER },
  { key: 'moods', label: '情绪', icon: '💭', values: MOODS },
  { key: 'traits', label: '特征', icon: '👁', values: TRAITS },
  { key: 'scenes', label: '场景', icon: '🎯', values: SCENES },
];
