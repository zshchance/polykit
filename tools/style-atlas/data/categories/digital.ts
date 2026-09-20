import type { StyleEntry } from '../../types';

/**
 * 未来数字 —— 屏幕、代码与网络原生文化催生的风格（1980s 想象 → 2020s 现实）。
 * 共性：以数字技术本身为审美对象——光、像素、代码、故障都是素材。
 */
export const DIGITAL_STYLES: StyleEntry[] = [
  {
    id: 'cyberpunk',
    name: '赛博朋克',
    nameEn: 'Cyberpunk',
    icon: '🌃',
    category: '未来数字',
    era: '1980s',
    moods: ['未来感', '冷酷', '神秘'],
    scenes: ['游戏美术', '音乐视觉', '海报', '社媒配图'],
    traits: ['霓虹光效', '强对比', '立体纵深'],
    techniques: [
      '暗夜底 + 品红 / 青蓝霓虹光源',
      '高楼剪影与密集窗户光点',
      '雨夜湿漉漉的地面反光',
      '全息投影、日文招牌等东方元素',
    ],
    palette: [
      { hex: '#0a0e1a', name: '雨夜黑' },
      { hex: '#ff2a6d', name: '霓虹品红' },
      { hex: '#05d9e8', name: '电光青' },
      { hex: '#f9f002', name: '警示黄' },
      { hex: '#571c8b', name: '暗紫' },
    ],
    desc: '高科技与低生活的碰撞：雨夜都市、霓虹灯牌、全息投影，黑暗里开出的电子之花。',
    background:
      '源自 80 年代科幻小说（《神经漫游者》）与电影（《银翼杀手》）。"High tech, low life"是它的精神内核：越是璀璨霓虹，越衬出阴影里的破败。用色秘诀是黑要够黑（80% 暗部）、光要够毒（品红撞青蓝），游戏、电音、科技议题的万能氛围组。',
    keywords: [
      'cyberpunk style',
      'neon lights',
      'night city',
      'futuristic skyline',
      'rain reflection',
      'magenta cyan neon',
      'Blade Runner aesthetic',
      'hologram',
    ],
    prompt:
      'Cyberpunk city illustration, dark rainy night with glowing neon signs in magenta and cyan, dense skyscraper silhouettes with lit windows, wet street reflections, holographic advertisements, Blade Runner atmosphere',
    promptZh:
      '赛博朋克都市插画，雨夜中品红与青色霓虹灯牌发光，密集高楼剪影与亮窗，湿漉漉的街道倒影，全息广告投影，银翼杀手式氛围',
  },
  {
    id: 'glitch-art',
    name: '故障艺术',
    nameEn: 'Glitch Art',
    icon: '📺',
    category: '未来数字',
    era: '2010s',
    moods: ['前卫', '冷酷', '神秘'],
    scenes: ['音乐视觉', '海报', '社媒配图', '游戏美术'],
    traits: ['错位故障', '霓虹光效', '强对比'],
    techniques: [
      'RGB 通道分离错位（红蓝重影）',
      '水平切片位移与扫描线',
      '色块条纹模拟数据损坏',
      '完整图像 + 局部崩坏制造张力',
    ],
    palette: [
      { hex: '#0d0d0f', name: '信号黑' },
      { hex: '#00e5ff', name: '错位青' },
      { hex: '#ff2975', name: '错位红' },
      { hex: '#f8f8f8', name: '雪花白' },
      { hex: '#7c4dff', name: '失真紫' },
    ],
    desc: '把"出错"变成美：RGB 重影、切片位移、扫描线——数字世界崩坏瞬间的诗意。',
    background:
      '来自数字信号损坏的意外之美（老电视雪花、视频压缩失败）。设计师主动模拟这种失控：复制图层、分离色彩通道、左右错开，再加几道水平切片。它传递的情绪很当代——科技焦虑、虚拟与真实的裂缝，电音封面和电竞视觉的标配。',
    keywords: [
      'glitch art',
      'RGB split effect',
      'datamoshing',
      'scan lines',
      'distorted image',
      'digital error aesthetic',
      'VHS distortion',
      'corrupted data',
    ],
    prompt:
      'Glitch art poster, RGB channel split with red and cyan offset shadows, horizontal slice displacement, scan lines and digital noise, distorted geometric portrait on black background, VHS error aesthetic',
    promptZh:
      '故障艺术海报，RGB 通道分离红蓝重影，水平切片位移，扫描线与数字噪点，黑色背景上扭曲的几何人像，VHS 录像带损坏美学',
  },
  {
    id: 'acid-graphics',
    name: '酸性设计',
    nameEn: 'Acid Graphics',
    icon: '😵‍💫',
    category: '未来数字',
    era: '2020s',
    moods: ['前卫', '叛逆', '活力'],
    scenes: ['音乐视觉', '社媒配图', '海报', '文创周边'],
    traits: ['肌理质感', '霓虹光效', '有机曲线'],
    techniques: [
      '液态金属 / 镀铬质感的不规则滴状',
      '扭曲变形的笑脸与Emoji符号',
      '荧光绿 / 镭射银的"有毒"配色',
      '哥特字体与科幻字体混排',
    ],
    palette: [
      { hex: '#101010', name: '酷黑' },
      { hex: '#c0c0c0', name: '液态银' },
      { hex: '#e2ff2f', name: '荧光酸绿' },
      { hex: '#8b5cf6', name: '镭射紫' },
      { hex: '#f5f5f5', name: '纯白' },
    ],
    desc: 'Z 世代的视觉锐舞：液态金属、扭曲笑脸、荧光酸绿，又酷又"毒"的地下俱乐部美学。',
    background:
      '从 90 年代锐舞（Rave）文化复兴而来，经 Instagram 设计师发扬光大。"酸"既是迷幻剂的代称，也是观感——刺眼、流动、上瘾。标志元素是镀铬液态滴和咧嘴笑脸：一个代表未来科技，一个代表戏谑态度。音乐节、潮牌、滑板文化的当红语言。',
    keywords: [
      'acid graphics',
      'liquid chrome',
      'melting smiley',
      'rave aesthetic',
      'y2k style',
      'metallic blob',
      'neon green',
      'underground club flyer',
    ],
    prompt:
      'Acid graphics design poster, liquid chrome metallic blob, distorted melting smiley face, fluorescent acid green on black background, y2k rave aesthetic, gothic and futuristic mixed typography, underground club flyer',
    promptZh:
      '酸性设计海报，液态镀铬金属滴，扭曲融化的笑脸，黑色背景上的荧光酸绿，Y2K 锐舞美学，哥特与科幻字体混排，地下俱乐部传单',
  },
  {
    id: 'aurora-gradient',
    name: '渐变流体',
    nameEn: 'Aurora Gradient',
    icon: '🌈',
    category: '未来数字',
    era: '2020s',
    moods: ['梦幻', '优雅', '未来感'],
    scenes: ['UI界面', '网页设计', '品牌VI', '社媒配图'],
    traits: ['渐变弥散', '有机曲线', '肌理质感'],
    techniques: [
      '多色径向渐变球相互渗透',
      '高斯模糊制造"弥散光"',
      '叠加细颗粒噪点去塑料感',
      '浅色底 + 柔彩色 / 深色底 + 荧光色',
    ],
    palette: [
      { hex: '#f6f4ff', name: '云雾白' },
      { hex: '#a78bfa', name: '雾紫' },
      { hex: '#f472b6', name: '樱粉' },
      { hex: '#67e8f9', name: '冰青' },
      { hex: '#fde68a', name: '蜜光黄' },
    ],
    desc: '如极光般流动的柔彩渐变：几团模糊的光互相渗透，温柔又有科技感的氛围背景之王。',
    background:
      'Web3 与 SaaS 官网带火的风格（Stripe 是鼻祖）。本质是"数字水彩"：几个径向渐变色球放大、模糊、叠加，边缘自然交融。关键技巧是加噪点——纯渐变太塑料，颗粒感让它高级。做背景、PPT、App 闪屏几乎零失误。',
    keywords: [
      'aurora gradient',
      'mesh gradient',
      'soft blurred gradient',
      'holographic background',
      'pastel glow',
      'fluid colors',
      'dreamy background',
      'grainy gradient',
    ],
    prompt:
      'Abstract aurora gradient background, soft mesh gradient blobs in pastel purple pink and cyan blending into each other, dreamy blurred glow, subtle grain texture, minimal elegant composition',
    promptZh:
      '抽象极光渐变背景，雾紫樱粉冰青的柔彩渐变团相互交融，梦幻模糊光晕，细腻颗粒肌理，极简优雅构图',
  },
  {
    id: 'web-brutalism',
    name: '网页粗野主义',
    nameEn: 'Web Brutalism',
    icon: '🧱',
    category: '未来数字',
    era: '2010s',
    moods: ['叛逆', '前卫'],
    scenes: ['网页设计', '海报', '社媒配图'],
    traits: ['强对比', '网格排版', '大留白'],
    techniques: [
      '裸露的粗黑边框与分割线',
      '默认蓝链接 / 系统字体故意不修饰',
      '超大字号标题顶满版面',
      '打破栅格的错位与重叠',
    ],
    palette: [
      { hex: '#ffffff', name: '裸白' },
      { hex: '#000000', name: '纯黑' },
      { hex: '#0000ee', name: '默认链接蓝' },
      { hex: '#ff0000', name: '警告红' },
      { hex: '#e5e5e5', name: '水泥灰' },
    ],
    desc: '对精致模板说"不"：粗黑边框、默认蓝链接、顶格大字——毛坯房般的网页，反而最有个性。',
    background:
      '借名自混凝土建筑（Brutalist architecture），是对千站一面的 Bootstrap 式网页的反动。它故意暴露"HTML 素颜"：边框、按钮、链接全部最原始的样子。看似随意实则考验功力——字体层级和节奏必须极好。设计师作品集、独立厂牌官网爱用它宣示态度。',
    keywords: [
      'web brutalism',
      'brutalist website',
      'raw HTML aesthetic',
      'thick black borders',
      'default blue links',
      'anti-design',
      'huge typography',
      'concrete aesthetic',
    ],
    prompt:
      'Web brutalism design, raw anti-design layout with thick black borders, default blue hyperlinks, huge bold typography filling the page, stark black and white with red accents, exposed grid structure, concrete aesthetic',
    promptZh:
      '网页粗野主义设计，原始反设计版式，粗黑边框，默认蓝色链接，顶满版面的超大粗体字，黑白为主红色点缀，裸露的网格结构，混凝土美学',
  },
];
