/**
 * 绘画设计类提示词 —— AI 绘画（Midjourney/SD/DALL·E）、Logo、海报、插画等。
 * 其中带 fun=true 的是"内容变身"彩蛋（照片变画风等），体现"AI 还能这么玩"。
 */

import type { Prompt } from '../../types';

export const DESIGN_PROMPTS: Prompt[] = [
  {
    id: 'ghibli-transform',
    title: '照片变吉卜力风',
    icon: '🍃',
    category: 'design',
    tags: ['变身', '彩蛋', '宫崎骏', '绘画'],
    fun: true,
    desc: '把任意场景描述成吉卜力动画画面，治愈感拉满。',
    variables: [
      { key: 'scene', label: '场景描述', placeholder: '一个女孩在雨天的公交站等车，旁边有只猫', required: true, multiline: true, default: '一个女孩在雨天的公交站等车，旁边有只猫' },
    ],
    template: `请基于以下描述，生成一张吉卜力工作室（宫崎骏）风格的插画。

【场景】{{scene}}

【风格要求】
- 宫崎骏吉卜力动画画风：柔和的手绘水彩质感、饱满的云朵与天空、温暖的色调。
- 人物线条柔和、表情生动；背景细节丰富（植物、光影、生活气息）。
- 光线是清晨或黄昏的柔和暖光，带一点怀旧与治愈氛围。
- 构图开阔，留有呼吸感。

【参数】--ar 16:9 --niji 6 --style raw

请输出适合 Midjourney/Niji 的英文提示词，以及一段中文画面说明。`,
  },
  {
    id: 'cyberpunk-transform',
    title: '场景变赛博朋克',
    icon: '🌃',
    category: 'design',
    tags: ['变身', '彩蛋', '赛博朋克', '绘画'],
    fun: true,
    desc: '把普通场景改造成霓虹未来感的赛博朋克画面。',
    variables: [
      { key: 'scene', label: '场景描述', placeholder: '一条老式街道', required: true, multiline: true, default: '一条老式街道' },
    ],
    template: `请把以下场景改造成赛博朋克风格的画面描述，用于 AI 绘画。

【原场景】{{scene}}

【风格要求】
- 霓虹紫青撞色、雨夜湿漉漉的街道反光、全息广告牌、高耸的拥挤建筑。
- 未来科技感与市井衰败感并存，氛围压抑又炫酷。
- 透视夸张，镜头戏剧化。

【参数】--ar 16:9 --v 6

请输出英文 Midjourney 提示词 + 中文画面描述。`,
  },
  {
    id: 'ink-wash-transform',
    title: '照片变水墨画',
    icon: '🖌️',
    category: 'design',
    tags: ['变身', '彩蛋', '水墨', '国风'],
    fun: true,
    desc: '把风景描述成中国传统水墨写意画，意境悠远。',
    variables: [
      { key: 'scene', label: '场景描述', placeholder: '远山、孤舟、江面薄雾', required: true, multiline: true, default: '远山、孤舟、江面薄雾' },
    ],
    template: `请把以下场景画成中国传统水墨写意画，用于 AI 绘画。

【场景】{{scene}}

【风格要求】
- 留白意境、浓淡墨色层次、皴擦点染的笔触感。
- 远近虚实分明，构图遵循散点透视；可点缀朱砂印章感。
- 整体淡雅克制，有"气韵生动"的东方美学。
- 不要鲜艳色彩，以墨分五色为主。

请输出英文绘画提示词 + 中文意境描述。`,
  },
  {
    id: 'logo-design',
    title: 'Logo 设计提示词',
    icon: '🔷',
    category: 'design',
    tags: ['Logo', '品牌', '设计'],
    fun: false,
    desc: '生成专业 Logo 设计需求，含风格、配色、参考方向。',
    variables: [
      { key: 'brand', label: '品牌名/行业', placeholder: '一家精品咖啡品牌「山野」', required: true, default: '一家精品咖啡品牌「山野」' },
      { key: 'style', label: '风格偏好', placeholder: '极简/手绘/几何/复古', default: '极简自然' },
    ],
    template: `请为「{{brand}}」设计一个 Logo，给我设计方案和 AI 绘画提示词。

【风格偏好】{{style}}

【输出内容】
1. 3 个不同方向的创意概念（每个：设计理念 + 视觉元素 + 寓意）。
2. 推荐配色方案（主色+辅助色 hex + 理由）。
3. 适合 Midjourney/DALL·E 的英文提示词（含风格、构图、留白、矢量感等关键词）。
4. 字体建议（中英文各一种）。

请直接输出。`,
  },
  {
    id: 'poster-design',
    title: '海报设计提示词',
    icon: '🖼️',
    category: 'design',
    tags: ['海报', '设计', '营销'],
    fun: false,
    desc: '活动/产品海报的视觉方案与 AI 绘画提示词。',
    variables: [
      { key: 'purpose', label: '海报用途', placeholder: '一场 indie 音乐节', required: true, default: '一场 indie 音乐节' },
      { key: 'mood', label: '氛围', placeholder: '热血/迷幻/复古', default: '迷幻复古' },
    ],
    template: `请为「{{purpose}}」设计一张海报，给我视觉方案和 AI 绘画提示词。

【氛围】{{mood}}

【输出】
1. 整体视觉概念（主视觉、构图、关键意象）。
2. 配色方案（3-5 色 hex + 比例）。
3. 排版建议（主标题位置、信息层级、字体风格）。
4. Midjourney 英文提示词（含构图、光照、风格、--ar 比例）。
5. 文案建议（主标题 + 副标题）。

请直接输出。`,
  },
  {
    id: 'illustration-style',
    title: '插画风格定调',
    icon: '🎨',
    category: 'design',
    tags: ['插画', '绘画', '设计'],
    fun: false,
    desc: '为一组插画确定统一的画风规范，保证系列感。',
    variables: [
      { key: 'project', label: '项目', placeholder: '儿童绘本「小熊的冒险」', required: true, default: '儿童绘本「小熊的冒险」' },
      { key: 'ref', label: '参考风格', placeholder: '暖色、圆润、童趣', default: '暖色、圆润、童趣' },
    ],
    template: `请为「{{project}}」确定一套统一的插画风格规范。

【参考方向】{{ref}}

【输出】
1. 画风定义（线条、上色、质感、笔触）。
2. 配色板（主色/辅助色/点缀色 hex，说明用途）。
3. 人物/元素设计规范（比例、表情、材质）。
4. 构图与场景规范（视角、留白、光影）。
5. 一段可直接用于 AI 绘画的英文 style 提示词，保证多张图风格一致。

请直接输出完整规范。`,
  },
  {
    id: 'ui-mockup',
    title: 'UI 界面设计稿',
    icon: '📱',
    category: 'design',
    tags: ['UI', '设计', '界面'],
    fun: false,
    desc: '生成 App/网页界面的设计方案与布局说明。',
    variables: [
      { key: 'product', label: '产品', placeholder: '一个冥想 App 的首页', required: true, default: '一个冥想 App 的首页' },
      { key: 'style', label: '风格', placeholder: '极简/温暖/治愈系', default: '温暖治愈系' },
    ],
    template: `请为「{{product}}」设计界面，输出布局方案。

【风格】{{style}}

【输出】
1. 整体设计语言（配色 hex、字体、圆角、间距规范）。
2. 首屏布局（区块划分 + 每块内容 + 交互元素）。
3. 关键交互说明（按钮、动效、状态反馈）。
4. 信息层级与视觉动线。
5. 可直接给设计工具或 AI 的描述。

请直接输出。`,
  },
  {
    id: 'avatar-design',
    title: '专属头像生成',
    icon: '🙂',
    category: 'design',
    tags: ['头像', '绘画', '设计'],
    fun: false,
    desc: '根据描述生成个性化头像的 AI 绘画提示词。',
    variables: [
      { key: 'desc', label: '想要的样子', placeholder: '戴眼镜的橘猫，穿宇航服', required: true, multiline: true, default: '戴眼镜的橘猫，穿宇航服' },
      { key: 'style', label: '风格', placeholder: '扁平/3D/像素/油画', default: '扁平矢量' },
    ],
    template: `请为以下描述生成头像的 AI 绘画提示词。

【描述】{{desc}}
【风格】{{style}}

【输出】
1. 一段详细的英文 Midjourney 提示词（含主体、风格、背景、光照、构图、--ar 1:1）。
2. 3 个微调变体（换背景/换表情/换配色）。
3. 中文画面说明。

请直接输出。`,
  },
  {
    id: 'pixel-art',
    title: '像素风绘画',
    icon: '👾',
    category: 'design',
    tags: ['像素', '绘画', '彩蛋'],
    fun: true,
    desc: '把任何东西变成复古像素游戏画风，情怀拉满。',
    variables: [
      { key: 'subject', label: '主体', placeholder: '一只柴犬在吃拉面', required: true, default: '一只柴犬在吃拉面' },
    ],
    template: `请把以下主体画成复古像素游戏画风，用于 AI 绘画。

【主体】{{subject}}

【风格要求】
- 16-bit / 32-bit 复古像素游戏风（参考 SNES/GBA 时代）。
- 有限的调色板、清晰的像素颗粒、鲜明的轮廓。
- 可带一点扫描线或 CRT 质感的复古氛围。
- 构图像游戏场景或精灵图。

请输出英文 Midjourney 提示词 + 中文说明。`,
  },
  {
    id: 'photo-enhance',
    title: '摄影构图建议',
    icon: '📷',
    category: 'design',
    tags: ['摄影', '构图', '设计'],
    fun: false,
    desc: '针对拍摄主题给出构图、光线、参数建议。',
    variables: [
      { key: 'subject', label: '拍摄主题', placeholder: '咖啡馆里的人像', required: true, default: '咖啡馆里的人像' },
      { key: 'device', label: '设备', placeholder: '手机/微单', default: '手机' },
    ],
    template: `请为拍摄「{{subject}}」（设备：{{device}}）给出专业建议。

【输出】
1. 3 种构图方案（每种：机位、构图法则、为什么这样拍）。
2. 光线建议（方向、色温、人造/自然光）。
3. 推荐参数（光圈、快门、ISO 大致范围，或手机模式）。
4. 后期调色方向（色调、对比、氛围）。
5. 容易踩的坑与规避方法。

请直接输出。`,
  },
  {
    id: 'sticker-set',
    title: '表情包/贴纸套图',
    icon: '😊',
    category: 'design',
    tags: ['贴纸', '表情包', '绘画', '彩蛋'],
    fun: true,
    desc: '设计一套统一风格的表情包，可直接拿去画。',
    variables: [
      { key: 'character', label: '主角', placeholder: '一只总是困困的水豚', required: true, default: '一只总是困困的水豚' },
    ],
    template: `请为「{{character}}」设计一套表情包/贴纸。

【输出】
1. 角色设定（外形、性格、标志性特征，保证整套辨识度统一）。
2. 8 个表情的设计（每个：情绪 + 动作 + 配文，如「打工人/下班了/在吗/勿扰」）。
3. 统一的画风规范（线条、配色、尺寸、留白）。
4. 一段可复用的 AI 绘画英文 style 提示词，保证 8 张风格一致。

请直接输出。`,
  },
];
