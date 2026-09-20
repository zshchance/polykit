import type { StyleEntry } from '../../types';

/**
 * 手绘工艺 —— 源自手工技法的风格（传统技法 + 当代复兴）。
 * 共性：保留"手的痕迹"——刀痕、水痕、剪刀边、蜡笔线，
 * 在数字时代反而成了最稀缺的温度。
 */
export const CRAFT_STYLES: StyleEntry[] = [
  {
    id: 'paper-cut',
    name: '剪纸风',
    nameEn: 'Paper Cut',
    icon: '📄',
    category: '手绘工艺',
    era: '2010s',
    moods: ['温暖', '梦幻', '宁静'],
    scenes: ['插画', '海报', '书籍装帧', '文创周边'],
    traits: ['立体纵深', '有机曲线', '肌理质感'],
    techniques: [
      '色纸分层堆叠，层与层投下细影',
      '由远及近：后层浅、前层深（或反之）',
      '波浪 / 山峦 / 云朵的连续曲线裁边',
      '纸纹肌理 + 柔和顶光',
    ],
    palette: [
      { hex: '#0b3d60', name: '深海蓝' },
      { hex: '#14618c', name: '靛蓝' },
      { hex: '#2f86b8', name: '湖蓝' },
      { hex: '#7fbcda', name: '浅波蓝' },
      { hex: '#f5efdf', name: '纸米白' },
    ],
    desc: '把画面裁成一层层色纸：前后叠压投下细影，二维的纸裁出三维的纵深与梦境。',
    background:
      '从传统剪纸演化出的数字插画手法。它用"图层思维"理解世界：月亮压远山、远山压近海、近海压沙滩，每层之间一道薄薄的投影，纵深立刻出现。配色上同色系渐层最保险，撞色系分层最出挑，儿童绘本与节日海报常客。',
    keywords: [
      'paper cut style',
      'layered paper art',
      'papercraft',
      'depth layers',
      'cut paper waves',
      '3D paper illustration',
      'shadow layers',
      'craft aesthetic',
    ],
    prompt:
      'Paper cut style illustration, layered cut paper waves in gradient blue tones, full moon over mountains and sea, subtle shadows between paper layers, craft texture, dreamy depth composition',
    promptZh:
      '剪纸风插画，蓝色渐层剪纸波浪，月亮悬于山海之上，纸层之间细腻投影，纸艺肌理，梦幻纵深构图',
  },
  {
    id: 'woodcut',
    name: '木刻版画',
    nameEn: 'Woodcut',
    icon: '🪵',
    category: '手绘工艺',
    era: '1930s',
    moods: ['质朴', '叛逆', '神秘'],
    scenes: ['书籍装帧', '海报', '插画', '包装'],
    traits: ['强对比', '肌理质感', '手绘线条'],
    techniques: [
      '黑白两色对撞，拒绝中间灰',
      '排线 / 点刻表现明暗过渡',
      '刀锋的顿挫感保留为"金石味"',
      '主形象极简剪影化',
    ],
    palette: [
      { hex: '#11100e', name: '油墨黑' },
      { hex: '#f2e9d8', name: '宣纸米' },
      { hex: '#c8452c', name: '印章红' },
      { hex: '#8a8172', name: '旧墨灰' },
      { hex: '#2e2b26', name: '炭褐' },
    ],
    desc: '刀与木的较量：黑白对撞、刀痕毕露，最朴素的材料刻出最有筋骨的画面。',
    background:
      '鲁迅倡导的新兴木刻运动让它成为中国的"呐喊美学"；西方则有德国表现主义木刻。数字仿木刻的要诀：宁硬勿软——线条要有刀入木的顿挫，黑白分布"计白当黑"，加一枚红色印章立刻东方。酒类、茶叶包装用它自带手工匠心。',
    keywords: [
      'woodcut print',
      'linocut style',
      'black and white carving',
      'block print',
      'expressionist woodcut',
      'hand carved texture',
      'printmaking',
      'high contrast illustration',
    ],
    prompt:
      'Woodcut print illustration, bold black ink carving on cream paper, radiating carved lines around a stark sun, waves with hand-carved hatch texture, expressionist printmaking style, red seal stamp accent',
    promptZh:
      '木刻版画插画，米白纸上浓烈黑墨刀刻，太阳四周放射状刻线，海浪手工排线肌理，表现主义版画风格，点缀红色印章',
  },
  {
    id: 'watercolor',
    name: '水彩手绘',
    nameEn: 'Watercolor',
    icon: '💧',
    category: '手绘工艺',
    era: '传世经典',
    moods: ['宁静', '梦幻', '优雅'],
    scenes: ['插画', '书籍装帧', '文创周边', '包装'],
    traits: ['有机曲线', '肌理质感', '渐变弥散'],
    techniques: [
      '湿画法：颜色自然晕染交融',
      '留白当光——最亮处是纸本身',
      '水痕与沉淀边成为装饰',
      '先浅后深，叠色不超过三层',
    ],
    palette: [
      { hex: '#fdfbf5', name: '水彩纸' },
      { hex: '#7fb3d5', name: '湖蓝' },
      { hex: '#a9c9a4', name: '苔绿' },
      { hex: '#e8a2b4', name: '蔷薇粉' },
      { hex: '#f2c879', name: '藤黄' },
    ],
    desc: '水与色的偶然游戏：晕染、水痕、飞白，画到七分剩下三分交给水，灵动而温柔。',
    background:
      '最古老也最有人味的绘画媒介之一。水彩的精髓是"控制意外"：水分多少决定晕染边界，水痕（cobble）本是败笔却成了风格签名。数字水彩要保留三样东西——颜料沉淀边、纸纹、不完美的笔触感，否则就"干净"得没有灵魂。',
    keywords: [
      'watercolor illustration',
      'hand painted',
      'wet on wet',
      'soft washes',
      'paper texture',
      'botanical watercolor',
      'loose brushstrokes',
      'delicate painting',
    ],
    prompt:
      'Delicate watercolor illustration, soft wet-on-wet washes of blue pink and yellow bleeding into each other, visible paper texture and water bloom edges, loose flower and leaf shapes, airy hand-painted feel',
    promptZh:
      '细腻水彩插画，蓝粉黄湿画法颜料相互晕染渗透，可见纸纹与水痕边缘，松散的花叶形态，轻盈手绘感',
  },
  {
    id: 'doodle',
    name: '涂鸦手绘',
    nameEn: 'Doodle',
    icon: '✏️',
    category: '手绘工艺',
    era: '2010s',
    moods: ['俏皮', '活力', '温暖'],
    scenes: ['社媒配图', '插画', '文创周边', 'UI界面'],
    traits: ['手绘线条', '重复图案', '大留白'],
    techniques: [
      '刻意抖动的"不完美"线条',
      '星星 / 箭头 / 对话框等小符号填空',
      '黑白线稿 + 一两个跳色点缀',
      '元素疏密节奏比画功更重要',
    ],
    palette: [
      { hex: '#fffef8', name: '速写本白' },
      { hex: '#1c1c1c', name: '马克笔黑' },
      { hex: '#ff5a5f', name: '记号红' },
      { hex: '#3d8bfd', name: '圆珠蓝' },
      { hex: '#ffc531', name: '荧光黄' },
    ],
    desc: '笔记本边角的快乐：歪歪扭扭的星星、箭头和笑脸，像开会时走神画下的涂鸦。',
    background:
      '从课堂笔记本走向主流视觉（Google Doodle 推波助澜）。它的亲和力来自"我也能画"的心理暗示，因此画时要克制技巧——线条宁拙勿巧，小元素成群出现（三个星星比一个有气氛）。PPT 配图、白板动画、App 空状态页的救场王。',
    keywords: [
      'doodle art',
      'hand drawn sketch',
      'playful line art',
      'marker drawing',
      'scribble style',
      'cute doodles',
      'notebook sketch',
      'whimsical illustration',
    ],
    prompt:
      'Playful doodle illustration, hand drawn wobbly black marker lines, stars arrows speech bubbles and smiley faces scattered on white paper, small red and yellow accents, cute notebook sketch style',
    promptZh:
      '俏皮涂鸦插画，手绘抖动的黑色马克笔线条，星星箭头对话框与笑脸散布在白纸速写本上，少量红黄点缀，可爱笔记本涂鸦风',
  },
  {
    id: 'guochao',
    name: '国潮插画',
    nameEn: 'Guochao',
    icon: '🏮',
    category: '手绘工艺',
    era: '2020s',
    moods: ['活力', '优雅', '复古'],
    scenes: ['包装', '海报', '文创周边', '品牌VI'],
    traits: ['重复图案', '高饱和撞色', '对称构图'],
    techniques: [
      '祥云 / 海浪 / 仙鹤等传统纹样现代化',
      '朱红 + 鎏金 + 石青的经典国色',
      '金线勾边 + 平涂填色的"新工笔"',
      '圆形取景与对称构图',
    ],
    palette: [
      { hex: '#9e1b1b', name: '朱砂红' },
      { hex: '#d4a017', name: '鎏金黄' },
      { hex: '#f5e6cc', name: '绢米白' },
      { hex: '#1f3a5f', name: '石青蓝' },
      { hex: '#2e6e63', name: '松烟绿' },
    ],
    desc: '传统纹样的年轻化表达：祥云仙鹤、朱红鎏金，故宫口红式的"东方美学复兴"。',
    background:
      '2018 年后随国货崛起爆发的风格，把年画、敦煌壁画、青花瓷的视觉语汇用现代插画语法重述。要点是"纹样密度"与"金线"——传统纹样细密排布出华丽感，金色勾线提气。春节营销、茶饮、博物馆文创的当家风格。',
    keywords: [
      'Guochao style',
      'Chinese trend illustration',
      'oriental aesthetic',
      'auspicious clouds pattern',
      'crane and waves',
      'vermilion and gold',
      'modern Chinese style',
      'traditional pattern',
    ],
    prompt:
      'Guochao style illustration, modern Chinese aesthetic, golden auspicious clouds and flying crane on vermilion red background, stylized waves pattern, ornate gold line work, circular composition, oriental decorative art',
    promptZh:
      '国潮风插画，现代东方美学，朱砂红底上金色祥云与飞鹤，风格化海浪纹样，华丽金线勾勒，圆形构图，东方装饰艺术',
  },
  {
    id: 'wabi-sabi',
    name: '侘寂美学',
    nameEn: 'Wabi-Sabi',
    icon: '🍵',
    category: '手绘工艺',
    era: '传世经典',
    moods: ['宁静', '质朴', '优雅'],
    scenes: ['品牌VI', '包装', '书籍装帧', '海报'],
    traits: ['大留白', '肌理质感', '有机曲线'],
    techniques: [
      '不完整之美：缺口的圆、枯瘦的枝',
      '大地色系：米 / 灰 / 褐 / 墨',
      '粗粝材质（陶、麻、旧纸）入画',
      '留白占画面七成以上',
    ],
    palette: [
      { hex: '#e8e0d0', name: '枯米' },
      { hex: '#b5a98f', name: '灰茶' },
      { hex: '#7a7263', name: '苔灰' },
      { hex: '#4a443a', name: '墨褐' },
      { hex: '#f7f3ea', name: '素白' },
    ],
    desc: '接受残缺与无常：缺口的手绘圆、枯枝、旧纸——在朴素与寂静里看见时间。',
    background:
      '源自日本茶道的审美哲学，近年随"慢生活"回流设计界。核心是与"完美"和解：圆不必闭合、色不必均匀、构图不必居中——一切刻意的不经意。茶、香、手作器物品牌用它，传递的是"我们不赶时间"的态度。',
    keywords: [
      'wabi-sabi aesthetic',
      'japanese zen',
      'imperfect beauty',
      'enso circle',
      'earthy tones',
      'rustic texture',
      'minimal japanese',
      'quiet design',
    ],
    prompt:
      'Wabi-sabi aesthetic poster, imperfect hand-drawn enso circle with a gap, single dry branch on aged beige paper, earthy muted tones, generous empty space, quiet zen japanese minimalism',
    promptZh:
      '侘寂美学海报，带缺口的手绘圆相，枯枝横斜于做旧米色纸上，大地哑色调，大面积留白，安静的日式禅意极简',
  },
];
