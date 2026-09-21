/**
 * 乐器百科 —— 数据模型与维度词表。
 *
 * 每个乐器条目（InstrumentEntry）同时承载两类信息：
 *   1. 学习信息：简介 / 音色特点 / 背景与编曲应用 / 常用技巧 / 代表曲目 / 小知识
 *   2. 检索与复用信息：五个筛选维度（大类/音域/情绪/曲风/编曲角色）+ AI 音乐标签与提示词
 *
 * 五个维度的取值全部来自下方词表（FAMILY_ORDER / RANGE_ORDER / MOODS / GENRES / ROLES），
 * 词条只能从词表中挑选，保证筛选胶囊集合可控、不会因自由文本发散。
 * 音色特点与常用技巧是自由短句（逐条复制），模仿 style-atlas 的 traits/techniques 分工。
 */

// ───────────── 维度词表（顺序即 UI 展示顺序）─────────────

/** 大类：乐器的发声原理与文化谱系 */
export const FAMILY_ORDER = [
  '键盘',
  '弓弦',
  '弹拨',
  '木管',
  '铜管',
  '打击',
  '中国民族',
  '世界民族',
  '电子',
] as const;
export type Family = (typeof FAMILY_ORDER)[number];

/** 音域：乐器在编曲频率版图中的位置（编曲配器的第一直觉） */
export const RANGE_ORDER = ['低音', '中低音', '中音', '中高音', '高音', '全音域'] as const;
export type Range = (typeof RANGE_ORDER)[number];

/** 上手难度：从零到能弹出像样东西的时间成本（仅作卡片徽章，不参与筛选） */
export const DIFFICULTY_ORDER = ['易上手', '进阶', '专业'] as const;
export type Difficulty = (typeof DIFFICULTY_ORDER)[number];

/** 情绪：乐器音色最常唤起的心理感受（配乐选乐器的第一维度） */
export const MOODS = [
  '明亮',
  '温暖',
  '忧伤',
  '浪漫',
  '神秘',
  '史诗',
  '庄严',
  '梦幻',
  '空灵',
  '治愈',
  '孤独',
  '欢快',
  '狂野',
  '紧张',
  '怀旧',
  '俏皮',
  '辽阔',
  '暗黑',
  '叛逆',
  '优雅',
  '未来感',
] as const;

/** 曲风：该乐器最常被听到的音乐场景 */
export const GENRES = [
  '古典',
  '流行',
  '摇滚',
  '爵士',
  '布鲁斯',
  '民谣',
  '电子',
  '嘻哈',
  'R&B',
  'Funk',
  '拉丁',
  '国风',
  '影视配乐',
  '游戏配乐',
  '氛围音乐',
  'Lo-fi',
  '金属',
  '世界音乐',
  '新世纪',
] as const;

/** 编曲角色：乐器在一首编配里最常承担的职责 */
export const ROLES = [
  '旋律担当',
  '和声填充',
  '节奏驱动',
  '低音根基',
  '色彩点缀',
  '氛围铺底',
] as const;

// ───────────── 词条 ─────────────

/** 小知识：一眼看完的硬事实（起源 / 定型年代 / 别名 / 调性） */
export interface InstrumentFacts {
  /** 起源地与源流，如「意大利（文艺复兴时期定型）」 */
  origin: string;
  /** 大致定型/出现年代，如「约 1700 年」 */
  era: string;
  /** 常见别名/旧称，如「六弦琴」；无则省略 */
  alias?: string;
  /** 调性/记谱说明，如「降 B 调移调乐器」；非移调乐器省略 */
  tuning?: string;
}

/**
 * 一个乐器条目。图片由 assets/photos/<id>.webp 提供，
 * 试听音频由 assets/audio/<id>.mp3 提供（素材均来自 Wikimedia Commons，
 * 作者与许可信息记录在 assets/credits.json）。
 */
export interface InstrumentEntry {
  /** kebab-case id，同时是图片/音频文件名 */
  id: string;
  /** 中文名 */
  name: string;
  /** 英文/原文名（AI 音乐提示词里常用的写法） */
  nameEn: string;
  /** 卡片小图标（emoji） */
  icon: string;
  family: Family;
  range: Range;
  difficulty: Difficulty;
  /** 情绪词（2-3 个，取自 MOODS） */
  moods: string[];
  /** 常见曲风（2-4 个，取自 GENRES） */
  genres: string[];
  /** 编曲角色（1-3 个，取自 ROLES） */
  roles: string[];
  /** 音色特点（3-4 条自由短句，可逐条复制） */
  timbre: string[];
  /** 常用演奏技巧（4-5 条自由短句，可逐条复制） */
  techniques: string[];
  /** 适合搭配的乐器 id（3-4 个，必须存在于全量词条中，详情页可点击跳转） */
  pairing: string[];
  /** 代表曲目（1-3 条，格式「《曲名》演奏者/出处」，点击复制） */
  exemplars: string[];
  /** 小知识（起源/年代/别名/调性） */
  facts: InstrumentFacts;
  /** 一句话简介（卡片展示，约 40-60 字） */
  desc: string;
  /** 背景与编曲应用（详情弹层展示，约 80-120 字） */
  background: string;
  /** AI 音乐检索/生成常用标签（英文为主，逐枚复制，适配 Suno/Udio 等） */
  keywords: string[];
  /** 英文 AI 音乐提示词（整段复制，突出该乐器的用法） */
  prompt: string;
}

/** 五个筛选维度的定义（key 对应 InstrumentEntry 字段） */
export type FacetKey = 'family' | 'range' | 'moods' | 'genres' | 'roles';

export interface Facet {
  key: FacetKey;
  label: string;
  icon: string;
  values: readonly string[];
}

export const FACETS: Facet[] = [
  { key: 'family', label: '大类', icon: '🗂', values: FAMILY_ORDER },
  { key: 'range', label: '音域', icon: '🎚', values: RANGE_ORDER },
  { key: 'moods', label: '情绪', icon: '💭', values: MOODS },
  { key: 'genres', label: '曲风', icon: '🎧', values: GENRES },
  { key: 'roles', label: '编曲角色', icon: '🎼', values: ROLES },
];
