/**
 * 内置色系库 —— 纯前端、离线可用，呼应全站「数据不出本地」。
 *
 * 每个色系（Palette）包含 6 个语义化角色色：
 *   bg      页面大面积背景
 *   surface 卡片/面板表面（比 bg 略亮或略暗）
 *   text    主文字色（需与 bg 形成足够对比）
 *   muted   次要文字/辅助信息
 *   primary 主色：关键按钮、链接、强调
 *   accent  点缀色：次要按钮、标签、装饰
 *
 * moods（情绪/场景标签）用于筛选，取自下方 MOODS 集合。
 * 配色经过手工挑选以保证可读性与美感；颜色数值不作随机生成。
 */

/** 色彩角色 */
export type ColorRole = 'bg' | 'surface' | 'text' | 'muted' | 'primary' | 'accent';

/** 单个语义色 */
export interface PaletteColor {
  role: ColorRole;
  /** hex，如 "#0f172a" */
  hex: string;
  /** 角色中文名，如「主文字」「主色」 */
  name: string;
}

/** 一个完整色系 */
export interface Palette {
  id: string;
  /** 色系名（中文） */
  name: string;
  /** 情绪/场景标签（用于筛选） */
  moods: string[];
  /** 一句话风格描述 */
  desc: string;
  colors: PaletteColor[];
}

/** 情绪/场景集合（筛选胶囊顺序即此数组顺序） */
export const MOODS = ['专业', '活泼', '温暖', '冷峻', '优雅', '自然', '科技', '柔和'] as const;

/** 构造色块的工具：保持 colors 顺序固定（bg→surface→text→muted→primary→accent） */
function pal(
  id: string,
  name: string,
  moods: string[],
  desc: string,
  hex: {
    bg: string;
    surface: string;
    text: string;
    muted: string;
    primary: string;
    accent: string;
  },
): Palette {
  return {
    id,
    name,
    moods,
    desc,
    colors: [
      { role: 'bg', hex: hex.bg, name: '背景' },
      { role: 'surface', hex: hex.surface, name: '表面' },
      { role: 'text', hex: hex.text, name: '主文字' },
      { role: 'muted', hex: hex.muted, name: '次要文字' },
      { role: 'primary', hex: hex.primary, name: '主色' },
      { role: 'accent', hex: hex.accent, name: '点缀色' },
    ],
  };
}

/** 内置色系库（16 个） */
export const PALETTES: Palette[] = [
  pal('calm-blue', '沉静蓝', ['专业', '冷峻', '科技'],
    '冷调蓝灰，克制理性，适合科技与商业产品。',
    { bg: '#f8fafc', surface: '#ffffff', text: '#0f172a', muted: '#64748b', primary: '#2563eb', accent: '#06b6d4' }),

  pal('dawn-warm', '晨曦暖橙', ['温暖', '活泼', '柔和'],
    '日出般的暖橙调，明亮而亲和，适合生活方式与活动页。',
    { bg: '#fffaf5', surface: '#ffffff', text: '#45290f', muted: '#9a6b3f', primary: '#ea580c', accent: '#f59e0b' }),

  pal('morandi', '莫兰迪', ['优雅', '柔和'],
    '低饱和灰调，含蓄高级，适合文艺与品牌叙事。',
    { bg: '#f3f1ee', surface: '#ece8e1', text: '#3d3a36', muted: '#8a8378', primary: '#9c8a7a', accent: '#b8a98f' }),

  pal('cyberpunk', '赛博朋克', ['科技', '活泼'],
    '霓虹紫青撞色，未来感强烈，适合潮流与游戏。',
    { bg: '#0a0118', surface: '#1a0b2e', text: '#f0e6ff', muted: '#a78bfa', primary: '#d946ef', accent: '#22d3ee' }),

  pal('forest-green', '森林绿', ['自然', '冷峻', '优雅'],
    '深绿与米白，沉稳自然，适合环保与可持续主题。',
    { bg: '#f5f7f2', surface: '#ffffff', text: '#1a2e1a', muted: '#5a7a5a', primary: '#16a34a', accent: '#ca8a04' }),

  pal('minimal-gray', '极简灰', ['专业', '优雅', '冷峻'],
    '黑白灰极简，专注内容，适合编辑型与文档站。',
    { bg: '#fafafa', surface: '#ffffff', text: '#18181b', muted: '#71717a', primary: '#18181b', accent: '#6366f1' }),

  pal('sunset-purple', '日落紫', ['优雅', '温暖', '柔和'],
    '黄昏紫粉渐变情绪，浪漫柔和，适合美妆与文创。',
    { bg: '#fdf4ff', surface: '#ffffff', text: '#3b0764', muted: '#8672a3', primary: '#9333ea', accent: '#ec4899' }),

  pal('ocean-teal', '海洋青', ['自然', '冷峻', '科技'],
    '深海青绿，清爽通透，适合医疗与数据可视化。',
    { bg: '#f0fdfa', surface: '#ffffff', text: '#042f2e', muted: '#5b8a86', primary: '#0d9488', accent: '#0ea5e9' }),

  pal('terracotta', '陶土红', ['温暖', '自然', '优雅'],
    '陶土与米沙，质朴温润，适合餐饮与手作。',
    { bg: '#fdf6f0', surface: '#ffffff', text: '#451a03', muted: '#9a6342', primary: '#c2410c', accent: '#d97706' }),

  pal('midnight', '午夜深蓝', ['专业', '冷峻', '科技'],
    '深邃藏蓝配亮青，适合开发者工具与仪表盘。',
    { bg: '#0b1120', surface: '#1e293b', text: '#e2e8f0', muted: '#94a3b8', primary: '#3b82f6', accent: '#2dd4bf' }),

  pal('sakura-pink', '樱花粉', ['柔和', '温暖', '活泼'],
    '樱花淡粉，甜美轻盈，适合女性向与节庆主题。',
    { bg: '#fff5f7', surface: '#ffffff', text: '#4a1d2e', muted: '#a8708a', primary: '#ec4899', accent: '#f472b6' }),

  pal('industrial', '工业黄黑', ['专业', '冷峻'],
    '警示黄与炭黑，硬朗醒目，适合工业与安全主题。',
    { bg: '#1c1917', surface: '#292524', text: '#fafaf9', muted: '#a8a29e', primary: '#facc15', accent: '#f97316' }),

  pal('lavender-mist', '薰衣草雾', ['优雅', '柔和'],
    '淡紫雾感，宁静梦幻，适合文创与心理疗愈。',
    { bg: '#f6f5fb', surface: '#ffffff', text: '#2e2a4a', muted: '#8379a8', primary: '#7c3aed', accent: '#a78bfa' }),

  pal('citrus-fresh', '柑橘清新', ['活泼', '温暖', '自然'],
    '柑橘黄绿，清新有活力，适合食品与教育。',
    { bg: '#fdfef0', surface: '#ffffff', text: '#1a2e05', muted: '#6b7a3f', primary: '#65a30d', accent: '#eab308' }),

  pal('royal-wine', '皇家酒红', ['优雅', '温暖', '专业'],
    '酒红配金，沉稳华贵，适合高端品牌与奢品。',
    { bg: '#1a0a0f', surface: '#2a1119', text: '#f5e6e8', muted: '#b08090', primary: '#9f1239', accent: '#d4af37' }),

  pal('arctic-ice', '北极冰', ['冷峻', '专业', '科技'],
    '冰蓝纯白，洁净理性，适合科研与极简产品。',
    { bg: '#f0f7ff', surface: '#ffffff', text: '#0c1e33', muted: '#5a7a9a', primary: '#0284c7', accent: '#7dd3fc' }),
];

/** 按 id 取色系 */
export function getPaletteById(id: string): Palette | undefined {
  return PALETTES.find((p) => p.id === id);
}

/** 取某角色色的 hex；缺失时回退到主色 */
export function colorOf(p: Palette, role: ColorRole): string {
  return p.colors.find((c) => c.role === role)?.hex ?? p.colors[4].hex;
}
