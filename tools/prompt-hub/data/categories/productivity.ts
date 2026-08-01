/**
 * 效率学习类提示词 —— 翻译、总结、改写、学习辅导、职场技能等实用工具。
 * 偏"让 AI 帮我干活/学东西"，与趣味彩蛋形成互补。
 */

import type { Prompt } from '../../types';

export const PRODUCTIVITY_PROMPTS: Prompt[] = [
  {
    id: 'summarize-long',
    title: '长文提炼总结',
    icon: '📝',
    category: 'productivity',
    tags: ['总结', '效率', '阅读'],
    fun: false,
    desc: '把长文章/会议记录压成结构化要点，3 秒抓住核心。',
    variables: [
      { key: 'text', label: '原文', placeholder: '粘贴长文/纪要', required: true, multiline: true, default: '（在此粘贴需要总结的长文）' },
      { key: 'focus', label: '关注重点', placeholder: '如：决策项、待办、风险', default: '核心观点和结论' },
    ],
    template: `请帮我总结下面这段内容。

【关注重点】{{focus}}

【原文】
{{text}}

【输出格式】
1. 一句话核心结论。
2. 3-5 个关键要点（每条一句话）。
3. 值得注意的数据/引用。
4. 如有，列出待办事项或决策点。
5. 用通俗语言，避免重复原文啰嗦的表述。

请直接输出。`,
  },
  {
    id: 'translate-polish',
    title: '高质量翻译润色',
    icon: '🌍',
    category: 'productivity',
    tags: ['翻译', '效率'],
    fun: false,
    desc: '不是机翻味，是符合目标语言表达习惯的流畅翻译。',
    variables: [
      { key: 'source', label: '原文', placeholder: '粘贴要翻译的文本', required: true, multiline: true, default: '（在此粘贴原文）' },
      { key: 'target', label: '目标语言', placeholder: '中文/English', default: '中文' },
      { key: 'style', label: '风格', placeholder: '正式/口语/学术', default: '自然流畅' },
    ],
    template: `请把下面这段内容翻译成{{target}}，风格：{{style}}。

【原文】
{{source}}

【要求】
1. 意译为主，符合目标语言的表达习惯，消除机翻味。
2. 专业术语处理准确，保持一致。
3. 长句适当拆分，符合目标语言节奏。
4. 给出译文后，附 2-3 处关键翻译难点的处理说明。

请直接输出译文。`,
  },
  {
    id: 'rewrite-clear',
    title: '啰嗦文字改精炼',
    icon: '✂️',
    category: 'productivity',
    tags: ['改写', '效率', '写作'],
    fun: false,
    desc: '把啰嗦含糊的文字改成简洁有力的表达，逻辑更清晰。',
    variables: [
      { key: 'text', label: '原文', placeholder: '粘贴要改写的文字', required: true, multiline: true, default: '（在此粘贴要改写的文字）' },
    ],
    template: `请帮我把下面这段文字改得更简洁清晰。

【原文】
{{text}}

【要求】
1. 删掉冗余、重复、空洞的表述，保留核心信息。
2. 长句拆短，逻辑层次分明。
3. 用词精准，避免模糊表达（"一些""相关""进行"等能省则省）。
4. 不改变原意和语气。
5. 给出修改后的版本，并用一句话说明主要改了什么。

请直接输出。`,
  },
  {
    id: 'explain-like-five',
    title: '费曼式通俗解释',
    icon: '🧒',
    category: 'productivity',
    tags: ['学习', '解释', '知识'],
    fun: false,
    desc: '把复杂概念讲给小白听懂，用比喻不用术语。',
    variables: [
      { key: 'concept', label: '概念', placeholder: '区块链/复利/量子纠缠', required: true, default: '区块链' },
      { key: 'audience', label: '讲给谁', placeholder: '完全不懂的小白', default: '完全不懂的小白' },
    ],
    template: `请用费曼学习法的方式，把「{{concept}}」讲给{{audience}}听懂。

【要求】
1. 用生活中的比喻解释，避免堆砌专业术语（用到必须解释）。
2. 从"为什么需要它"切入，再讲"它是什么""怎么工作"。
3. 分 3-5 个递进的要点，每点配一个比喻或例子。
4. 最后用一段话总结，并指出一个常见误解。
5. 语言口语化，像聊天。

请直接输出。`,
  },
  {
    id: 'learn-roadmap',
    title: '学习路径规划',
    icon: '🗺️',
    category: 'productivity',
    tags: ['学习', '规划', '知识'],
    fun: false,
    desc: '给任意技能定制分阶段学习路线，含资源和建议。',
    variables: [
      { key: 'skill', label: '想学的', placeholder: '从零学 Python 数据分析', required: true, default: '从零学 Python 数据分析' },
      { key: 'time', label: '可用时间', placeholder: '每天1小时，共3个月', default: '每天1小时，共3个月' },
    ],
    template: `请帮我规划一条学习路径：{{skill}}。

【可用时间】{{time}}

【输出】
1. 总体目标与里程碑（学完后能做什么）。
2. 分阶段计划（每阶段：目标 + 学什么 + 推荐资源类型 + 阶段产出）。
3. 每周大致安排（结合我的可用时间）。
4. 学习中容易卡住的地方及突破方法。
5. 如何检验学习效果（项目/测验建议）。

请直接输出完整规划。`,
  },
  {
    id: 'code-review',
    title: '代码审查与优化',
    icon: '🔍',
    category: 'productivity',
    tags: ['代码', '效率', '开发者'],
    fun: false,
    desc: '让 AI 审查你的代码，找 bug、提优化、讲清原理。',
    variables: [
      { key: 'lang', label: '语言/框架', placeholder: 'TypeScript + React', required: true, default: 'JavaScript' },
      { key: 'code', label: '代码', placeholder: '粘贴代码', required: true, multiline: true, default: '（在此粘贴代码）' },
    ],
    template: `请审查下面这段{{lang}}代码。

【代码】
{{code}}

【输出】
1. 潜在 bug 或逻辑错误（指出具体位置和原因）。
2. 性能/可读性/安全性优化建议（每条说明为什么）。
3. 最佳实践改进（命名、结构、错误处理）。
4. 给出优化后的关键片段（不必全部重写，只改动的部分）。
5. 如果有更优雅的写法，举例说明。

请直接输出。`,
  },
  {
    id: 'code-explain',
    title: '看不懂的代码讲解',
    icon: '📖',
    category: 'productivity',
    tags: ['代码', '学习', '开发者'],
    fun: false,
    desc: '逐行讲清一段代码在干什么，新手友好。',
    variables: [
      { key: 'lang', label: '语言', placeholder: 'Python', required: true, default: 'Python' },
      { key: 'code', label: '代码', placeholder: '粘贴看不懂的代码', required: true, multiline: true, default: '（在此粘贴代码）' },
    ],
    template: `请帮我逐行讲清楚这段{{lang}}代码在做什么。

【代码】
{{code}}

【输出】
1. 整体这段代码实现了什么功能（一句话）。
2. 逐段/逐行解释（关键行说明作用，琐碎的合并讲）。
3. 涉及的核心概念/语法点（顺便科普）。
4. 可能的坑或注意事项。
5. 一个简单的使用示例。

讲解要对新手友好，别假设我已懂很多。请直接输出。`,
  },
  {
    id: 'data-analysis',
    title: '数据分析思路',
    icon: '📊',
    category: 'productivity',
    tags: ['数据', '分析', '效率'],
    fun: false,
    desc: '给一份数据/问题，AI 帮你梳理分析框架和切入点。',
    variables: [
      { key: 'question', label: '分析目的', placeholder: '找出用户流失的原因', required: true, default: '找出用户流失的原因' },
      { key: 'data', label: '现有数据', placeholder: '有用户行为日志、注册信息、订单数据', multiline: true, default: '有用户行为日志和订单数据' },
    ],
    template: `请帮我梳理一个数据分析思路。

【分析目的】{{question}}
【现有数据】{{data}}

【输出】
1. 把问题拆解成 3-5 个可分析的子问题。
2. 每个子问题：用什么指标衡量、需要哪些字段、怎么切分维度。
3. 推荐的分析方法（漏斗/同期群/对比等）和原因。
4. 可能得出哪几类结论，分别对应什么行动。
5. 数据质量的注意事项。

请直接输出。`,
  },
  {
    id: 'excel-formula',
    title: 'Excel 公式助手',
    icon: '🔢',
    category: 'productivity',
    tags: ['Excel', '效率', '办公'],
    fun: false,
    desc: '描述需求，AI 给出对应的 Excel/Sheets 公式并解释。',
    variables: [
      { key: 'need', label: '我想实现', placeholder: 'A列大于60的B列求和', required: true, multiline: true, default: 'A列大于60时，对B列求和' },
    ],
    template: `请帮我写一个 Excel/Google Sheets 公式来实现：{{need}}

【输出】
1. 直接给出公式（标注是 Excel 还是 Sheets 兼容）。
2. 逐部分解释公式每个参数的作用。
3. 给一个具体的数据示例和预期结果。
4. 如果有更优或更简单的替代写法，列出来。
5. 常见报错及排查方法。

请直接输出。`,
  },
  {
    id: 'meeting-prep',
    title: '会议准备清单',
    icon: '🗓️',
    category: 'productivity',
    tags: ['职场', '效率', '会议'],
    fun: false,
    desc: '开会前让 AI 帮你列议程、预判问题、准备材料。',
    variables: [
      { key: 'meeting', label: '会议主题', placeholder: '和设计团队评审新版本方案', required: true, default: '和设计团队评审新版本方案' },
      { key: 'goal', label: '我的目标', placeholder: '拿到设计确认，定下排期', multiline: true, default: '拿到设计确认，定下排期' },
    ],
    template: `请帮我准备这场会议：「{{meeting}}」

【我的目标】{{goal}}

【输出】
1. 建议的会议议程（分时段）。
2. 我需要提前准备的材料/数据。
3. 可能被问到的问题及我的应对要点。
4. 关键决策点和需要各方拍板的事项。
5. 会后该跟进的 action item 模板。

请直接输出。`,
  },
  {
    id: 'negotiation',
    title: '谈判/沟通策略',
    icon: '🤝',
    category: 'productivity',
    tags: ['职场', '沟通', '谈判'],
    fun: false,
    desc: '谈薪资、谈合作、争取资源，AI 帮你制定策略和话术。',
    variables: [
      { key: 'scenario', label: '场景', placeholder: '想跟老板谈加薪', required: true, multiline: true, default: '想跟老板谈加薪' },
    ],
    template: `请帮我制定「{{scenario}}」的沟通/谈判策略。

【输出】
1. 前期准备：要收集哪些信息/筹码。
2. 我的核心诉求与可让步的底线。
3. 对方可能的立场和顾虑。
4. 分步骤的沟通策略（开场 → 陈述 → 应对反对 → 收尾）。
5. 3-5 句关键话术（含如何应对拒绝）。
6. 谈崩时的备选方案（BATNA）。

请直接输出。`,
  },
  {
    id: 'habit-plan',
    title: '习惯养成方案',
    icon: '🔄',
    category: 'productivity',
    tags: ['效率', '自律', '规划'],
    fun: false,
    desc: '想养成一个习惯？AI 给你一套能坚持的落地系统。',
    variables: [
      { key: 'habit', label: '想养成的习惯', placeholder: '每天早起跑步', required: true, default: '每天早起跑步' },
      { key: 'obstacle', label: '过去的障碍', placeholder: '总起不来、容易放弃', multiline: true, default: '总起不来、坚持三五天就放弃' },
    ],
    template: `请帮我设计一套养成「{{habit}}」的可行方案。

【过去的障碍】{{obstacle}}

【输出】
1. 把目标拆成"最小可执行版本"（小到不可能失败）。
2. 21 天分阶段计划（启动期→巩固期→稳定期），每阶段具体做什么。
3. 针对我提到的障碍，给具体破解方法。
4. 环境与提示设计（怎么让习惯容易开始、让坏习惯麻烦）。
5. 奖励与追踪机制（怎么让自己有正反馈）。
6. 中断后如何不崩盘、快速重启。

请直接输出。`,
  },
  {
    id: 'reading-list',
    title: '主题书单定制',
    icon: '📚',
    category: 'productivity',
    tags: ['学习', '读书', '知识'],
    fun: false,
    desc: '给任意主题，AI 推荐由浅入深的书单和阅读顺序。',
    variables: [
      { key: 'topic', label: '主题', placeholder: '理解经济学思维', required: true, default: '理解经济学思维' },
      { key: 'level', label: '我的基础', placeholder: '零基础', default: '零基础' },
    ],
    template: `请为「{{topic}}」定制一份书单，我的基础是：{{level}}。

【输出】
1. 6-8 本书，按由浅入深排序（入门 → 进阶 → 拓展）。
2. 每本：书名、作者、一句话推荐理由、难度星级、预计阅读时长。
3. 推荐阅读顺序及为什么这么排。
4. 标注哪本是"必读"、哪本是"选读"。
5. 配套资源（课程/纪录片/博客）建议。

请直接输出。`,
  },
];
