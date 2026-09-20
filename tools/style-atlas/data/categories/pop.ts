import type { StyleEntry } from '../../types';

/**
 * 波普复古 —— 大众文化与青年亚文化催生的风格（1960s–2010s）。
 * 共性：从广告、漫画、街头、电子游戏等"俗文化"取材，
 * 态度鲜明、色彩大胆、复制与拼贴是常用手法。
 */
export const POP_STYLES: StyleEntry[] = [
  {
    id: 'pop-art',
    name: '波普艺术',
    nameEn: 'Pop Art',
    icon: '💥',
    category: '波普复古',
    era: '1960s',
    moods: ['活力', '俏皮', '复古'],
    scenes: ['海报', '社媒配图', '包装', '插画'],
    traits: ['高饱和撞色', '重复图案', '肌理质感'],
    techniques: [
      '本戴点（Ben-Day dots）半调网点',
      '同一图像网格化重复 + 换色',
      '漫画对话框与拟声词（POW!）',
      '红黄蓝高饱和丝网印刷色',
    ],
    palette: [
      { hex: '#e63329', name: '波普红' },
      { hex: '#f7d708', name: '柠檬黄' },
      { hex: '#1f7ac2', name: '卡通蓝' },
      { hex: '#f5f0e6', name: '漫画纸' },
      { hex: '#111111', name: '网点黑' },
    ],
    desc: '安迪·沃霍尔的罐头与梦露：网点、重复、高饱和撞色，把大众消费品变成艺术。',
    background:
      '60 年代对"高雅艺术"的反叛——把广告、漫画、超市货架搬上画布。标志性技法是丝网印刷的本戴点与图像复制：同一头像印四遍、每遍换一套撞色，平凡事物因此获得图腾感。做促销海报、年轻化品牌时极其好用。',
    keywords: [
      'Pop Art',
      'Andy Warhol style',
      'Ben-Day dots',
      'halftone pattern',
      'comic style',
      'bold primary colors',
      'silkscreen print',
      'retro pop poster',
    ],
    prompt:
      'Pop Art poster, halftone Ben-Day dots pattern, bold red yellow blue color blocks, comic book explosion starburst, silkscreen print texture, 1960s Andy Warhol Roy Lichtenstein style',
    promptZh:
      '波普艺术海报，本戴点半调网点图案，红黄蓝高饱和色块，漫画爆炸形对话框，丝网印刷肌理，1960 年代沃霍尔与利希滕斯坦风格',
  },
  {
    id: 'psychedelic',
    name: '迷幻海报',
    nameEn: 'Psychedelic',
    icon: '🌀',
    category: '波普复古',
    era: '1960s',
    moods: ['梦幻', '叛逆', '活力'],
    scenes: ['音乐视觉', '海报', '插画'],
    traits: ['有机曲线', '高饱和撞色', '重复图案'],
    techniques: [
      '旋涡与涟漪状的扭曲构成',
      '"融化"的字体——字面快要流下来',
      '彩虹渐变与互补色高频碰撞',
      '密集纹样填满每一寸画面',
    ],
    palette: [
      { hex: '#ff5da2', name: '迷幻粉' },
      { hex: '#ff8c1a', name: '橘光' },
      { hex: '#ffe94a', name: '荧光黄' },
      { hex: '#7b2ff7', name: '电紫' },
      { hex: '#2ec4b6', name: '松石绿' },
    ],
    desc: '60 年代摇滚现场的视觉回声：旋涡、融化的字体、高饱和彩虹色，眩晕而自由。',
    background:
      '嬉皮文化与摇滚乐催生的海报风格（旧金山 Fillmore 剧院海报是代表）。字体故意画得难以辨认——读懂它需要凑近，于是观众和海报产生了互动。今天的音乐节、Livehouse、潮牌仍在用这套语言传递"迷醉与释放"。',
    keywords: [
      'psychedelic poster',
      '1960s rock poster',
      'melting typography',
      'swirl pattern',
      'trippy rainbow colors',
      'groovy style',
      'Fillmore poster',
      'warped letters',
    ],
    prompt:
      '1960s psychedelic rock poster, swirling warped patterns, melting groovy typography, vibrant pink orange purple rainbow palette, dense ornamental details, trippy optical illusion, vintage concert flyer',
    promptZh:
      '1960 年代迷幻摇滚海报，旋涡扭曲纹样，融化流动的字体，粉橙紫高饱和彩虹配色，密集装饰细节，眩晕视错觉，复古演出传单',
  },
  {
    id: 'punk-collage',
    name: '朋克拼贴',
    nameEn: 'Punk Collage',
    icon: '✂️',
    category: '波普复古',
    era: '1970s',
    moods: ['叛逆', '活力'],
    scenes: ['音乐视觉', '海报', '社媒配图'],
    traits: ['拼贴合成', '肌理质感', '强对比'],
    techniques: [
      '报纸 / 杂志剪裁错位拼贴',
      '勒索信式单字拼贴字体',
      '胶带、订书钉、撕边痕迹',
      '黑白影印 + 一两处刺眼荧光色',
    ],
    palette: [
      { hex: '#d9c9a3', name: '牛皮纸' },
      { hex: '#111111', name: '影印黑' },
      { hex: '#e8e3d8', name: '新闻纸' },
      { hex: '#c22f2f', name: '记号红' },
      { hex: '#f2ede0', name: '胶带米' },
    ],
    desc: '剪刀加胶水的美学：报纸剪裁、勒索信字体、胶带撕痕，粗糙就是对精致的反抗。',
    background:
      '70 年代朋克乐队没钱做设计，干脆自己剪报纸拼传单——"粗制滥造"反而成了最锋利的态度：撕碎的边缘、影印的噪点、东倒西歪的字母都在喊"DIY 与反主流"。乐队封面、潮牌、脱口秀海报常用它制造生猛感。',
    keywords: [
      'punk collage',
      'ransom note letters',
      'cut and paste',
      'zine aesthetic',
      'torn paper texture',
      'DIY punk flyer',
      'xerox texture',
      'anarchist poster',
    ],
    prompt:
      'Punk rock collage flyer, ransom note cut-out letters, torn newspaper clippings, duct tape and staples texture, black and white xerox aesthetic with red accents, chaotic DIY zine layout, 1970s punk poster',
    promptZh:
      '朋克拼贴传单，勒索信式剪贴字母，撕裂的报纸碎片，胶带与订书钉痕迹，黑白影印质感配红色点缀，混乱的 DIY 独立杂志版式，1970 年代朋克海报',
  },
  {
    id: 'memphis',
    name: '孟菲斯',
    nameEn: 'Memphis',
    icon: '〰',
    category: '波普复古',
    era: '1980s',
    moods: ['俏皮', '活力', '复古'],
    scenes: ['社媒配图', '文创周边', '包装', '海报'],
    traits: ['几何构成', '高饱和撞色', '重复图案'],
    techniques: [
      '波浪线、圆点、三角的随机散布',
      '粗黑描边 + 糖果撞色',
      '故意打破对齐的"乱中有序"',
      '水磨石 / 网格 / 斑点小纹样填充',
    ],
    palette: [
      { hex: '#ffffff', name: '纯白底' },
      { hex: '#ff5c8a', name: '泡泡粉' },
      { hex: '#ffd23f', name: '明黄' },
      { hex: '#3fd2c7', name: '蒂芙尼青' },
      { hex: '#222222', name: '描边黑' },
    ],
    desc: '80 年代的设计顽童：波浪线、圆点、三角撒满画面，糖果撞色加粗黑描边，快乐得没有道理。',
    background:
      '1981 年米兰 Memphis Group 掀起的"反设计"运动，故意违背现代主义的克制——为什么波浪线不能和三角做朋友？它的随机感其实有章法：元素种类控制在 3-4 种、颜色控制在 3-4 个、密度均匀。今天的电商大促、儿童品牌满屏都是它。',
    keywords: [
      'Memphis design',
      '1980s pattern',
      'squiggle lines',
      'geometric confetti',
      'playful shapes',
      'bold pastel colors',
      'retro abstract',
      'pop pattern background',
    ],
    prompt:
      'Memphis design pattern, playful squiggle lines, circles, triangles and confetti shapes scattered on white background, bold pink yellow teal colors with thick black outlines, 1980s retro abstract composition',
    promptZh:
      '孟菲斯风格图案，俏皮的波浪线、圆形、三角与纸屑形散布在白底上，粉黄青糖果色配粗黑描边，1980 年代复古抽象构成',
  },
  {
    id: 'pixel-art',
    name: '像素艺术',
    nameEn: 'Pixel Art',
    icon: '👾',
    category: '波普复古',
    era: '1980s',
    moods: ['复古', '俏皮', '怀旧'],
    scenes: ['游戏美术', '社媒配图', '文创周边'],
    traits: ['颗粒像素', '高饱和撞色', '重复图案'],
    techniques: [
      '一切图形对齐到可见像素格',
      '有限色盘（通常 8-16 色）',
      '抖动（dithering）表现明暗过渡',
      '等距或横向卷轴式场景构图',
    ],
    palette: [
      { hex: '#1a1c2c', name: '夜空蓝黑' },
      { hex: '#f4f4f4', name: '纯白' },
      { hex: '#ff004d', name: '街机红' },
      { hex: '#29adff', name: '电子蓝' },
      { hex: '#ffec27', name: '星星黄' },
    ],
    desc: '红白机时代的美学：一颗颗可见的像素方块堆出角色与世界，限制造就了独特魅力。',
    background:
      '早期游戏机的机能限制（低分辨率、少颜色）逼出的艺术形式。今天的像素画是主动选择：每一格像素都是手工放置的，因此有种数字刺绣般的温度。独立游戏（《星露谷物语》）、表情包、NFT 头像让这套语言长青。',
    keywords: [
      'pixel art',
      '8-bit style',
      'retro video game',
      '16-bit sprite',
      'dithering',
      'arcade aesthetic',
      'voxel style',
      'chiptune cover',
    ],
    prompt:
      'Pixel art illustration, retro 8-bit video game style, visible pixel grid, limited color palette, space invader alien sprite with stars on dark night sky, crisp square pixels, nostalgic arcade aesthetic',
    promptZh:
      '像素艺术插画，复古 8-bit 游戏风格，可见像素网格，有限色盘，深色夜空中的太空侵略者角色与星星，锐利方形像素，怀旧街机美学',
  },
  {
    id: 'vaporwave',
    name: '蒸汽波',
    nameEn: 'Vaporwave',
    icon: '🌴',
    category: '波普复古',
    era: '2010s',
    moods: ['梦幻', '怀旧', '神秘'],
    scenes: ['音乐视觉', '社媒配图', '海报'],
    traits: ['渐变弥散', '网格排版', '复古配色'],
    techniques: [
      '粉蓝紫的日落渐变色',
      '透视网格地板延伸到天边',
      '石膏像 / 棕榈树 / 老电脑符号',
      '故障错位 + 日文片假名点缀',
    ],
    palette: [
      { hex: '#2a1a4a', name: '暮紫夜空' },
      { hex: '#ff71ce', name: '蒸汽粉' },
      { hex: '#01cdfe', name: '电子青' },
      { hex: '#b967ff', name: '霓虹紫' },
      { hex: '#fffb96', name: '落日黄' },
    ],
    desc: '互联网原生的一场怀旧梦：粉蓝渐变、网格地平线、石膏像与棕榈树，赛博式的乡愁。',
    background:
      '2010 年前后从网络音乐场景长出的美学，拼贴 80-90 年代的消费符号（老 Windows 界面、商场广告、希腊雕塑），再罩上一层粉蓝滤镜。它怀的是一种从未真正存在过的旧时光——做梦幻、松弛、复古未来主题时氛围感拉满。',
    keywords: [
      'vaporwave aesthetic',
      'retro futurism',
      'pink cyan gradient',
      'perspective grid',
      'greek statue',
      'palm tree sunset',
      '80s nostalgia',
      'synthwave poster',
    ],
    prompt:
      'Vaporwave aesthetic poster, pink and cyan gradient sunset sky, wireframe perspective grid floor, greek statue bust and palm tree silhouettes, chrome striped sun, glitch effects, 80s retro futurism nostalgia',
    promptZh:
      '蒸汽波美学海报，粉青渐变落日夜空，线框透视网格地面，希腊石膏像与棕榈树剪影，铬金条纹落日，故障效果，80 年代复古未来主义怀旧',
  },
];
