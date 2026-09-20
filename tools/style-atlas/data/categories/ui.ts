import type { StyleEntry } from '../../types';

/**
 * 界面材质 —— 随 UI / 3D 工具演进而流行的视觉语言（2010s–2020s）。
 * 共性：围绕"屏幕上的质感"做文章——扁平、玻璃、软浮雕、粘土、2.5D、多边形。
 */
export const UI_STYLES: StyleEntry[] = [
  {
    id: 'flat-design',
    name: '扁平设计',
    nameEn: 'Flat Design',
    icon: '🟦',
    category: '界面材质',
    era: '2010s',
    moods: ['活力', '俏皮'],
    scenes: ['UI界面', '插画', '网页设计', '品牌VI'],
    traits: ['高饱和撞色', '几何构成', '大留白'],
    techniques: [
      '纯色块面，拒绝渐变与阴影',
      '圆角矩形 + 圆形的基础组件',
      '高饱和但明快的"糖果色板"',
      '图标用最少笔画表意',
    ],
    palette: [
      { hex: '#4fb0e5', name: '天空蓝' },
      { hex: '#ffcf3f', name: '太阳黄' },
      { hex: '#2e9e6b', name: '草地绿' },
      { hex: '#f0553b', name: '珊瑚红' },
      { hex: '#f7f7f7', name: '云白' },
    ],
    desc: '数字时代的默认审美：纯色块面、无阴影无渐变，干净直接，信息一眼即达。',
    background:
      '2013 年 iOS 7 抛弃拟物化后统治至今的风格。逻辑很务实：屏幕本身就是平的，何必伪造立体感？去掉一切装饰后，色彩和形状本身必须过硬。画扁平插画时先想"这个物体的剪影能不能被认出"——能，就成了。',
    keywords: [
      'flat design',
      'flat illustration',
      'solid color shapes',
      'minimal icon',
      'candy color palette',
      'vector illustration',
      'simple geometric',
      'modern UI style',
    ],
    prompt:
      'Flat design illustration, solid color geometric shapes, no gradients no shadows, bright candy color palette, simple landscape with circle sun and triangle mountains, clean vector style, modern minimal composition',
    promptZh:
      '扁平设计插画，纯色几何块面，无渐变无阴影，明快糖果色板，圆形太阳与三角山峦的简约风景，干净矢量风格，现代极简构图',
  },
  {
    id: 'glassmorphism',
    name: '玻璃拟态',
    nameEn: 'Glassmorphism',
    icon: '🪟',
    category: '界面材质',
    era: '2020s',
    moods: ['未来感', '优雅', '梦幻'],
    scenes: ['UI界面', '网页设计', '社媒配图'],
    traits: ['通透玻璃', '渐变弥散', '立体纵深'],
    techniques: [
      '背景必须鲜艳（渐变 / 彩色光球）',
      '卡片半透明白 + 背景模糊（backdrop-blur）',
      '1px 半透明白描边模拟玻璃边缘',
      '多层玻璃叠出前后景深',
    ],
    palette: [
      { hex: '#8b5cf6', name: '葡萄紫' },
      { hex: '#ec4899', name: '蔷薇粉' },
      { hex: '#f59e0b', name: '琥珀橙' },
      { hex: '#ffffff', name: '玻璃白' },
      { hex: '#312e81', name: '夜幕紫' },
    ],
    desc: '隔着磨砂玻璃看世界：半透明卡片悬浮在彩色光晕上，边缘一道细亮边，通透而高级。',
    background:
      'macOS Big Sur 与 Windows 11 带火的界面语言。成立的前提只有一个：背景够美——玻璃是"显影液"，背后没有色彩流动就毫无意义。卡片透明度控制在 10-20%，描边用半透明白模拟光线折射。金融、效率类产品的最爱。',
    keywords: [
      'glassmorphism',
      'frosted glass effect',
      'backdrop blur',
      'translucent card',
      'gradient background',
      'modern UI',
      'soft depth',
      'glass panel',
    ],
    prompt:
      'Glassmorphism UI design, frosted glass translucent card floating over vibrant purple pink orange gradient background, subtle white border light refraction, soft shadows and depth, blurred colorful orbs behind glass',
    promptZh:
      '玻璃拟态界面设计，磨砂半透明卡片悬浮于紫粉橙鲜艳渐变背景之上，细白描边模拟光线折射，柔和阴影与景深，玻璃后模糊的彩色光球',
  },
  {
    id: 'neumorphism',
    name: '新拟态',
    nameEn: 'Neumorphism',
    icon: '🕹',
    category: '界面材质',
    era: '2020s',
    moods: ['宁静', '优雅'],
    scenes: ['UI界面', '网页设计'],
    traits: ['肌理质感', '大留白'],
    techniques: [
      '组件与背景同色系，靠光影分形',
      '左上亮投影 + 右下暗投影 = 浮雕感',
      '圆角越大越柔和',
      '只用于开关 / 卡片等少量组件',
    ],
    palette: [
      { hex: '#e0e5ec', name: '浅灰蓝底' },
      { hex: '#ffffff', name: '亮部高光' },
      { hex: '#a3b1c6', name: '暗部阴影' },
      { hex: '#6d7d93', name: '灰蓝文字' },
      { hex: '#c9d4e3', name: '过渡灰' },
    ],
    desc: '从背景里"挤"出来的软浮雕：同色系组件靠一明一暗两道投影立起，安静而克制。',
    background:
      '2019 年 Dribbble 上爆红的概念风格，像用手指按压柔软的记忆棉。它的美在于"一体成型"，但也因此可用性受限（对比度低）——实际项目里只宜点缀：一个音量旋钮、一张天气卡片，作为界面的"触觉彩蛋"刚刚好。',
    keywords: [
      'neumorphism',
      'soft UI',
      'embossed effect',
      'monochrome interface',
      'subtle shadows',
      'tactile design',
      'extruded plastic',
      'minimal 3D',
    ],
    prompt:
      'Neumorphism soft UI design, light gray-blue monochrome interface, extruded rounded buttons and toggle switches, dual light and dark shadows creating soft embossed effect, tactile minimalist components',
    promptZh:
      '新拟态软界面设计，浅灰蓝同色系界面，挤压感圆角按钮与拨动开关，一明一暗双重投影营造柔软浮雕效果，有触觉感的极简组件',
  },
  {
    id: 'claymation',
    name: '粘土质感',
    nameEn: 'Claymation 3D',
    icon: '🧸',
    category: '界面材质',
    era: '2020s',
    moods: ['俏皮', '温暖'],
    scenes: ['UI界面', '插画', '社媒配图', '品牌VI'],
    traits: ['立体纵深', '有机曲线', '肌理质感'],
    techniques: [
      '圆滚滚的哑光 3D 形体',
      '柔和的环境光 + 大面积软阴影',
      '马卡龙 / 莫兰迪色系',
      '形体微微"不完美"更像手捏',
    ],
    palette: [
      { hex: '#f8d7e8', name: '棉花粉' },
      { hex: '#c7e5f5', name: '婴儿蓝' },
      { hex: '#fdf0c9', name: '奶油黄' },
      { hex: '#d9f2dc', name: '薄荷绿' },
      { hex: '#b9a7d9', name: '香芋紫' },
    ],
    desc: '像手捏粘土一样的 3D：圆胖哑光、软阴影、马卡龙色，亲和力满分的"治愈系"立体感。',
    background:
      'Blender 普及后插画师的新宠，介于 3D 渲染与定格动画（《小羊肖恩》）之间。诀窍是"去 CG 感"：不用金属玻璃等硬材质，全部哑光漫反射；边缘故意捏得不规则，保留手工温度。母婴、教育、生活方式品牌用它天然讨喜。',
    keywords: [
      'claymation 3D',
      'clay render',
      'soft 3D shapes',
      'matte texture',
      'pastel colors',
      'cute 3D illustration',
      'blender style',
      'playful render',
    ],
    prompt:
      'Cute claymation 3D render, soft matte clay shapes, rounded chubby forms in pastel pink blue and cream, gentle soft shadows, handmade imperfect edges, playful minimal scene, blender style illustration',
    promptZh:
      '可爱粘土风 3D 渲染，柔软哑光粘土形体，粉蓝奶油色圆胖造型，柔和光影，手工捏制的不完美边缘，俏皮极简场景，Blender 风格插画',
  },
  {
    id: 'isometric',
    name: '等距插画',
    nameEn: 'Isometric',
    icon: '🏗',
    category: '界面材质',
    era: '2010s',
    moods: ['活力', '俏皮'],
    scenes: ['插画', '网页设计', 'UI界面', '游戏美术'],
    traits: ['立体纵深', '几何构成', '网格排版'],
    techniques: [
      '30° 轴测角度，三边等比无透视',
      '所有元素落在同一隐形网格上',
      '一个物体三个面：顶 / 左 / 右',
      '同场景元素多时靠颜色分区',
    ],
    palette: [
      { hex: '#eef2f7', name: '雾蓝底' },
      { hex: '#4f8ef7', name: '科技蓝' },
      { hex: '#f76d6d', name: '西瓜红' },
      { hex: '#ffd166', name: '暖黄' },
      { hex: '#3ec98f', name: '翠绿' },
    ],
    desc: '2.5D 的小世界：30° 轴测视角下万物整齐排列，像一盒精致的立体模型玩具。',
    background:
      '源自工程制图（轴测图），因 Monument Valley 与无数 SaaS 官网插画流行。最大优点是"可组装"：房子、树、小车都是标准件，按网格拼就能搭出一座城——特别适合画流程图、智慧城市、产品生态这类"系统感"题材。',
    keywords: [
      'isometric illustration',
      '2.5D style',
      'axonometric view',
      'isometric city',
      '30 degree angle',
      'technical drawing',
      'miniature world',
      'vector isometric',
    ],
    prompt:
      'Isometric illustration, 2.5D axonometric view of a tiny city with buildings trees and cars on a clean grid, bright blue coral and yellow palette, crisp vector edges, miniature toy world aesthetic',
    promptZh:
      '等距 2.5D 插画，轴测视角的迷你城市，建筑树木小车整齐排列在网格上，蓝红黄明快配色，利落矢量边缘，微缩玩具世界美感',
  },
  {
    id: 'low-poly',
    name: '低多边形',
    nameEn: 'Low Poly',
    icon: '⛰',
    category: '界面材质',
    era: '2010s',
    moods: ['未来感', '宁静'],
    scenes: ['游戏美术', '插画', '海报', '网页设计'],
    traits: ['几何构成', '立体纵深', '渐变弥散'],
    techniques: [
      '三角面片拼出物体轮廓',
      '每个面片单独取色形成"刻面"明暗',
      '背景用同色系大渐变三角',
      '动物 / 山川 / 人像是最经典题材',
    ],
    palette: [
      { hex: '#2f4b7c', name: '深岩蓝' },
      { hex: '#a05195', name: '暮紫' },
      { hex: '#d45087', name: '霞红' },
      { hex: '#f95d6a', name: '珊瑚橙' },
      { hex: '#ffa600', name: '金橙' },
    ],
    desc: '用三角形雕刻世界：一块块刻面拼出山川动物，像数字时代的折纸与水晶。',
    background:
      '早期 3D 游戏的机能限制（面数越少越流畅）逆袭成主动审美。手绘低多边形的关键：三角大小跟着结构走——转折处小三角、平缓处大三角；颜色沿光源方向渐变。它自带"数字雕塑"感，科技、自然题材通吃。',
    keywords: [
      'low poly art',
      'polygonal style',
      'geometric facets',
      'triangulated portrait',
      'crystalline',
      '3D paper craft',
      'faceted animal',
      'polygon landscape',
    ],
    prompt:
      'Low poly art illustration, mountain landscape made of triangular facets, each polygon shaded in gradient from deep blue to warm orange sunset, crystalline geometric aesthetic, faceted sun in polygonal sky',
    promptZh:
      '低多边形艺术插画，三角刻面拼成的山峦风景，多边形颜色由深蓝渐变至金橙落日，水晶般几何美学，多边形天空中的刻面太阳',
  },
];
