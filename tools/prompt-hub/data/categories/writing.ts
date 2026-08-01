/**
 * 写作类提示词 —— 自媒体、营销、职场文案等实用场景。
 * 纯数据，无副作用。新增条目直接 push 即可，data/index.ts 会聚合。
 */

import type { Prompt } from '../../types';

export const WRITING_PROMPTS: Prompt[] = [
  {
    id: 'xhs-zhongcao',
    title: '小红书种草文案',
    icon: '📕',
    category: 'writing',
    tags: ['小红书', '种草', '电商', '营销'],
    fun: false,
    desc: '闺蜜语气种草，自带黄金 3 秒钩子和 emoji，爆款结构。',
    variables: [
      { key: 'topic', label: '产品/主题', placeholder: '便携咖啡机', required: true, default: '便携咖啡机' },
      { key: 'points', label: '核心卖点', placeholder: '60秒萃取、可充电、颜值高', multiline: true, default: '60秒萃取、可充电、颜值高' },
    ],
    template: `请用小红书种草博主的口吻，帮我写一篇关于「{{topic}}」的种草文案。

【写作要求】
1. 语气：第一人称、亲切闺蜜感，多用「姐妹」「真的会谢」等口语和语气词。
2. 结构按此顺序：黄金3秒钩子标题 → 痛点共鸣 → 产品方案 → 真实使用体验 → 行动号召。
3. 标题要吸睛，可用数字、反差或悬念（如「后悔没早点入手！」）。
4. 适量 emoji，每段配 1-2 个相关 emoji，但别堆砌。
5. 篇幅 300-500 字，分 3-4 段，多用换行制造呼吸感。
6. 围绕这些卖点展开：{{points}}

【禁忌】
- 避免硬广感和绝对化用语（最、第一）。
- 别写成说明书，要有真实使用场景和感受。

请直接输出完整文案，可给 2-3 个标题备选。`,
  },
  {
    id: 'xhs-tadian',
    title: '小红书探店文案',
    icon: '🍜',
    category: 'writing',
    tags: ['小红书', '探店', '美食'],
    fun: false,
    desc: '沉浸式探店，环境+菜品+性价比，氛围感拉满。',
    variables: [
      { key: 'shop', label: '店铺/品类', placeholder: '巷子里的日式拉面店', required: true, default: '巷子里的日式拉面店' },
      { key: 'highlight', label: '亮点', placeholder: '汤头浓郁、老板是日本人、人均40', multiline: true, default: '汤头浓郁、老板是日本人、人均40' },
    ],
    template: `请用小红书探店博主的风格，写一篇「{{shop}}」的探店文案。

【要求】
1. 第一人称沉浸式叙述，像带朋友去吃一样。
2. 涵盖：门头/环境氛围（拍照点位）→ 招牌菜品口感 → 人均性价比 → 适不适合拍照打卡。
3. 围绕亮点：{{highlight}}
4. 标题带地点或反差（如「XX路藏着一家…」「人均40吃哭我」）。
5. 300-450 字，emoji 点缀，结尾给个总评（值不值/推荐指数）。

请直接输出文案 + 3 个备选标题。`,
  },
  {
    id: 'gzh-deep',
    title: '公众号深度文',
    icon: '📰',
    category: 'writing',
    tags: ['公众号', '深度', '知识'],
    fun: false,
    desc: '有观点有论据的深度长文，结构清晰引人入胜。',
    variables: [
      { key: 'topic', label: '主题', placeholder: '为什么年轻人开始迷上逛菜市场', required: true, default: '为什么年轻人开始迷上逛菜市场' },
      { key: 'angle', label: '观点/角度', placeholder: '治愈感、掌控感、对抗原子化', multiline: true, default: '治愈感、掌控感、对抗原子化' },
    ],
    template: `请写一篇公众号深度文章，主题是「{{topic}}」。

【要求】
1. 风格：理性克制但有人文温度，像「人物」「GQ报道」的调性。
2. 结构：引人入胜的开头场景 → 提出问题 → 多角度分析 → 案例/数据支撑 → 升华结论。
3. 核心观点方向：{{angle}}
4. 1500-2500 字，分小标题，段落不宜过长。
5. 多用具象细节和故事，少用空泛道理；避免说教。

请直接输出完整文章。`,
  },
  {
    id: 'gzh-list',
    title: '公众号干货清单',
    icon: '📋',
    category: 'writing',
    tags: ['公众号', '干货', '清单'],
    fun: false,
    desc: '结构化干货清单体，信息密度高，易收藏易传播。',
    variables: [
      { key: 'topic', label: '主题', placeholder: '打工人必备的10个免费AI工具', required: true, default: '打工人必备的10个免费AI工具' },
      { key: 'count', label: '数量', placeholder: '10' },
    ],
    template: `请写一篇「{{topic}}」的干货清单文。

【要求】
1. 清单体结构：开头点出痛点价值 → 逐条展开（每条：名称/一句话说明/为什么有用/怎么用）→ 结尾总结收藏建议。
2. 每条独立成段，可用序号或小标题，便于扫读。
3. 信息要具体可执行，别只说「很有用」，要说清「怎么用、省什么」。
4. {{count}} 条左右，每条 50-100 字。

请直接输出完整文章。`,
  },
  {
    id: 'zhihu-answer',
    title: '知乎专业回答',
    icon: '💡',
    category: 'writing',
    tags: ['知乎', '知识', '专业'],
    fun: false,
    desc: '专业又有温度的高赞回答，先抛结论再展开论证。',
    variables: [
      { key: 'question', label: '问题', placeholder: '普通人如何建立被动收入？', required: true, default: '普通人如何建立被动收入？' },
      { key: 'stance', label: '你的立场', placeholder: '不靠理财暴富，靠技能资产化', multiline: true, default: '不靠理财暴富，靠技能资产化' },
    ],
    template: `请以知乎高赞回答的风格，回答这个问题：「{{question}}」

【要求】
1. 开头先给一句有冲击力的结论（"先说答案：…"），再展开论证。
2. 论证结合：个人经验 / 案例 / 数据 / 反例，逻辑清晰。
3. 立场方向：{{stance}}
4. 语气专业但不端着，像和懂行的朋友聊天；适当自嘲或讲故事拉近距离。
5. 800-1500 字，分点论述，结尾可升华或给行动建议。
6. 避免爹味说教和空话套话。

请直接输出回答。`,
  },
  {
    id: 'ecom-detail',
    title: '电商详情页文案',
    icon: '🛒',
    category: 'writing',
    tags: ['电商', '营销', '详情页'],
    fun: false,
    desc: '高转化详情页，痛点→方案→信任→促单一条龙。',
    variables: [
      { key: 'product', label: '产品', placeholder: '人体工学腰靠', required: true, default: '人体工学腰靠' },
      { key: 'points', label: '卖点', placeholder: '记忆棉、贴合曲线、久坐不累', multiline: true, default: '记忆棉、贴合曲线、久坐不累' },
    ],
    template: `请为「{{product}}」写电商详情页文案。

【要求】
1. 结构：吸睛主图标题 → 痛点场景（久坐腰酸…）→ 产品解决方案 → 卖点逐一展开 → 信任背书（材质/认证/好评）→ 限时促单。
2. 围绕卖点：{{points}}
3. 标题用利益点而非功能点（"告别腰酸" 而非 "采用记忆棉"）。
4. 每个卖点配一句场景化文案 + 一句参数说明。
5. 促单段制造紧迫感（限时/限量/赠品）。

请输出完整详情页文案（分模块）。`,
  },
  {
    id: 'douyin-script',
    title: '抖音口播脚本',
    icon: '🎬',
    category: 'writing',
    tags: ['短视频', '抖音', '口播'],
    fun: false,
    desc: '15-60秒口播脚本，前3秒留人，结构紧凑有钩子。',
    variables: [
      { key: 'topic', label: '主题', placeholder: '3个让你变有钱的小习惯', required: true, default: '3个让你变有钱的小习惯' },
      { key: 'duration', label: '时长', placeholder: '45秒', default: '45秒' },
    ],
    template: `请写一个抖音口播短视频脚本，主题「{{topic}}」，时长约{{duration}}。

【脚本格式】每段标注：[画面/动作] + [口播台词] + [字幕/花字]

【要求】
1. 前3秒必须有强钩子（反常识/痛点/悬念/冲突），决定完播率。
2. 结构：钩子 → 内容主体（分点，每点一个小高潮）→ 互动引导（评论/点赞）。
3. 台词口语化、短句、有节奏感，避免书面语。
4. 适当埋梗或反转，提升互动和转发。
5. 结尾抛问题或留钩子引导评论。

请直接输出完整脚本（含分镜提示）。`,
  },
  {
    id: 'resume-polish',
    title: '简历润色优化',
    icon: '📄',
    category: 'writing',
    tags: ['简历', '职场', '求职'],
    fun: false,
    desc: '把流水账简历改成 STAR 结构，突出成果与数据。',
    variables: [
      { key: 'role', label: '目标岗位', placeholder: '产品经理', required: true, default: '产品经理' },
      { key: 'content', label: '原经历', placeholder: '负责XX功能，做了XX，提升了XX', multiline: true, default: '负责用户增长功能，做了签到活动，DAU有提升' },
    ],
    template: `请帮我把下面的工作经历，改写成适合「{{role}}」岗位的优秀简历条目。

【原始经历】
{{content}}

【改写要求】
1. 用 STAR 结构：情境(S)→任务(T)→行动(A)→结果(R)，重点突出行动和结果。
2. 结果尽量量化（提升X%、增长X万、节省X小时）；若原内容无数据，请基于常理推测合理范围并标注「[需核实]」。
3. 动词开头（主导/优化/搭建/推动…），每条 1-2 行。
4. 去掉"负责""参与"等弱动词和主观形容词。
5. 给 3-5 条精炼的简历要点。

请直接输出改写后的简历条目。`,
  },
  {
    id: 'email-business',
    title: '商务邮件起草',
    icon: '📧',
    category: 'writing',
    tags: ['邮件', '职场', '商务'],
    fun: false,
    desc: '得体专业的商务邮件，开场到落款一步到位。',
    variables: [
      { key: 'purpose', label: '邮件目的', placeholder: '邀请对方合作/催款/约会议', required: true, default: '邀请对方进行商务合作' },
      { key: 'detail', label: '关键信息', placeholder: '合作内容、时间、对方收益', multiline: true, default: '我们想邀请贵司联合举办一场线下活动，时间下月初，可带来品牌曝光' },
    ],
    template: `请帮我写一封商务邮件。

【目的】{{purpose}}
【关键信息】{{detail}}

【要求】
1. 称谓得体，开场简短寒暄后直入主题。
2. 主体清晰分段：背景/来意 → 具体内容/方案 → 对方收益/行动项 → 期待回复。
3. 语气专业、礼貌但不卑微；诉求明确，附截止时间或下一步。
4. 结尾规范的商务落款。
5. 控制在 200-300 字，别啰嗦。

请直接输出邮件正文（含主题行）。`,
  },
  {
    id: 'slogan',
    title: '广告 Slogan 生成',
    icon: '🎯',
    category: 'writing',
    tags: ['营销', 'slogan', '品牌'],
    fun: false,
    desc: '一句入魂的品牌 slogan，多风格多备选。',
    variables: [
      { key: 'brand', label: '品牌/产品', placeholder: '一款主打轻量的登山包', required: true, default: '一款主打轻量的登山包' },
      { key: 'style', label: '风格', placeholder: '热血/文艺/极简/幽默', default: '热血' },
    ],
    template: `请为「{{brand}}」创作广告 slogan。

【风格】{{style}}

【要求】
1. 给 10 条不同角度的 slogan，每条不超过 12 字。
2. 角度覆盖：功能利益、情感共鸣、场景代入、反差冲突、价值观主张。
3. 要有记忆点和节奏感，能口口相传。
4. 每条后用括号注明切入角度。

请直接输出 10 条，编号排列。`,
  },
  {
    id: 'press-release',
    title: '新闻通稿',
    icon: '📡',
    category: 'writing',
    tags: ['公关', '新闻', '品牌'],
    fun: false,
    desc: '规范的新闻通稿，倒金字塔结构，客观专业。',
    variables: [
      { key: 'event', label: '事件', placeholder: '公司完成B轮融资5000万', required: true, default: '公司完成B轮融资5000万' },
      { key: 'detail', label: '详情', placeholder: '投资方、用途、意义', multiline: true, default: '领投方为XX资本，资金用于产品研发和市场扩张' },
    ],
    template: `请写一篇新闻通稿。

【事件】{{event}}
【详情】{{detail}}

【要求】
1. 倒金字塔结构：导语（5W1H 核心事实）→ 主体（背景/细节/引言）→ 结尾（展望/联系方式）。
2. 第三人称客观叙述，避免营销腔；可引用负责人发言增强可信度。
3. 标题突出事件本身的价值，不夸张。
4. 500-800 字，段落规范。

请直接输出通稿（含标题）。`,
  },
  {
    id: 'speech',
    title: '演讲稿撰写',
    icon: '🎤',
    category: 'writing',
    tags: ['演讲', '职场', '公关'],
    fun: false,
    desc: '有感染力的演讲稿，开场抓人、金句收尾。',
    variables: [
      { key: 'topic', label: '主题', placeholder: '如何在不确定中找到确定性', required: true, default: '如何在不确定中找到确定性' },
      { key: 'audience', label: '听众', placeholder: '公司全员/行业大会/毕业生', default: '公司全员' },
      { key: 'minutes', label: '时长(分钟)', placeholder: '8', default: '8' },
    ],
    template: `请帮我写一篇约{{minutes}}分钟的演讲稿，主题「{{topic}}」，听众是{{audience}}。

【要求】
1. 开场用故事/提问/反差抓住注意力，别用"今天很高兴…"。
2. 主体 2-3 个核心观点，每个配案例或故事，逻辑递进。
3. 语言口语化、有节奏，适合现场表达；多用短句和排比。
4. 结尾要有金句或行动号召，留下余韵。
5. 标注[停顿][互动]等现场提示。

请直接输出完整演讲稿。`,
  },
  {
    id: 'copy-translate-localize',
    title: '文案本地化翻译',
    icon: '🌐',
    category: 'writing',
    tags: ['翻译', '本地化', '营销'],
    fun: false,
    desc: '不是直译，是符合目标语言文化语境的本地化改写。',
    variables: [
      { key: 'source', label: '原文', placeholder: 'Just do it', required: true, multiline: true, default: 'Think different' },
      { key: 'target', label: '目标语言', placeholder: '中文', default: '中文' },
    ],
    template: `请把下面这句文案本地化为{{target}}，不是直译，要符合目标语言的文化语境和传播习惯。

【原文】{{source}}

【要求】
1. 给 5 个不同风格的本地化版本（直白/文艺/幽默/网感/经典）。
2. 保留原意和精神，但表达要地道、有传播力。
3. 每条说明改写思路（为什么这么翻）。
4. 注意文化禁忌，避免生硬直译造成的尴尬。

请直接输出 5 个版本 + 说明。`,
  },
  {
    id: 'book-review',
    title: '读书笔记/书评',
    icon: '📚',
    category: 'writing',
    tags: ['书评', '知识', '读书'],
    fun: false,
    desc: '结构化读书笔记，提炼金句+洞察+行动启发。',
    variables: [
      { key: 'book', label: '书名', placeholder: '《纳瓦尔宝典》', required: true, default: '《纳瓦尔宝典》' },
      { key: 'focus', label: '关注点', placeholder: '财富、幸福、决策', multiline: true, default: '财富与幸福的法则' },
    ],
    template: `请为「{{book}}」写一篇结构化的读书笔记/书评。

【关注点】{{focus}}

【结构】
1. 一句话总结这本书的核心思想。
2. 3-5 个最有启发的核心观点（每个：观点 + 书中论据 + 我的解读）。
3. 摘录 3 句金句并简评。
4. 这本书对我的行动启发（具体可执行的 2-3 点）。
5. 适合谁读 / 不适合谁读。

请直接输出完整笔记。`,
  },
];
