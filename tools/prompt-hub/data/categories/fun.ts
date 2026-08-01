/**
 * 趣味彩蛋提示词 —— "AI 还能这么玩？" 的灵感集合。
 * 全部 fun=true，参与随机池。覆盖：内容变身 / 趣味生成 / 实用趣味。
 * 目标：让用户打开后发出"原来还能这样"的惊叹。
 */

import type { Prompt } from '../../types';

export const FUN_PROMPTS: Prompt[] = [
  {
    id: 'resume-wuxia',
    title: '简历改武侠风',
    icon: '⚔️',
    category: 'fun',
    tags: ['变身', '彩蛋', '职场', '武侠'],
    fun: true,
    desc: '把干巴巴的简历改写成江湖侠客传记，HR 看了眼前一亮。',
    variables: [
      { key: 'content', label: '简历内容', placeholder: '5年产品经理，做过电商和增长', required: true, multiline: true, default: '5年产品经理，做过电商和增长' },
    ],
    template: `请把下面的简历改写成武侠人物传记风格，但要保留核心经历信息。

【原简历】{{content}}

【要求】
1. 用武侠小说笔法：姓名→师承（公司）→绝学（技能）→战绩（项目）→所求（求职意向）。
2. 称号要中二又贴切（如"增长阁首席操盘手"）。
3. 项目经历包装成行侠仗义/闯荡江湖的故事，但成果数据要真实可辨。
4. 读起来热血又不失专业，让人会心一笑又不觉得不靠谱。

请直接输出武侠版简历。`,
  },
  {
    id: 'recipe-cooking-show',
    title: '菜谱变美食节目',
    icon: '🍳',
    category: 'fun',
    tags: ['变身', '彩蛋', '美食'],
    fun: true,
    desc: '把普通菜谱改写成美食节目脚本，下饭感十足。',
    variables: [
      { key: 'dish', label: '菜品', placeholder: '番茄炒蛋', required: true, default: '番茄炒蛋' },
    ],
    template: `请把「{{dish}}」的做法，改写成一档美食节目的脚本。

【风格】参考《舌尖上的中国》/《风味人间》的解说腔：诗意的旁白 + 食材特写 + 人文故事。

【脚本格式】[画面] + [旁白解说] + [字幕]

【要求】
1. 开头用风景/人文引入，把这道菜放进一个故事里。
2. 制作过程包装成"时间的艺术"，每个步骤都要有仪式感和哲理。
3. 旁白用词考究、节奏舒缓，多用通感和拟人。
4. 结尾升华到生活与人情。

请直接输出完整脚本（约 400 字）。`,
  },
  {
    id: 'text-classical',
    title: '现代文转文言文',
    icon: '📜',
    category: 'fun',
    tags: ['变身', '彩蛋', '古风'],
    fun: true,
    desc: '把大白话翻译成文绉绉的文言文，装腔利器。',
    variables: [
      { key: 'text', label: '原文', placeholder: '今天好累不想上班', required: true, multiline: true, default: '今天好累不想上班' },
    ],
    template: `请把下面这段现代白话文翻译成文言文。

【原文】{{text}}

【要求】
1. 文言文要地道，句式简练，用词典雅。
2. 给 2 个版本：一个平实典雅版，一个华丽骈文版。
3. 附上白话译文回译，方便对照理解。
4. 适合发朋友圈装文化人。

请直接输出。`,
  },
  {
    id: 'boardgame-onesentence',
    title: '一句话生成桌游',
    icon: '🎲',
    category: 'fun',
    tags: ['生成', '彩蛋', '创意'],
    fun: true,
    desc: '给个主题，AI 设计一整套桌游规则，脑洞大开。',
    variables: [
      { key: 'theme', label: '主题', placeholder: '在便利店打工的猫咪', required: true, default: '在便利店打工的猫咪' },
    ],
    template: `请以「{{theme}}」为主题，设计一款桌面游戏。

【输出】
1. 游戏名（要有记忆点）。
2. 玩家人数与时长。
3. 核心玩法（一句话讲清怎么玩）。
4. 详细规则：胜利条件、回合流程、关键机制、资源/卡牌设计（举 3-5 个例子）。
5. 一个让游戏有趣的"反转机制"或"惊喜元素"。
6. 适合什么人群。

规则要具体可玩，别空泛。请直接输出。`,
  },
  {
    id: 'worry-lyrics',
    title: '把烦恼写成歌词',
    icon: '🎵',
    category: 'fun',
    tags: ['生成', '彩蛋', '音乐'],
    fun: true,
    desc: '倾诉你的烦恼，AI 把它写成一首有情绪的歌。',
    variables: [
      { key: 'worry', label: '你的烦恼', placeholder: '每天加班还存不下钱', required: true, multiline: true, default: '每天加班还存不下钱' },
      { key: 'genre', label: '曲风', placeholder: '民谣/摇滚/R&B/说唱', default: '民谣' },
    ],
    template: `请把我的烦恼写成一首{{genre}}风格的歌词。

【我的烦恼】{{worry}}

【要求】
1. 结构：主歌(叙事) → 副歌(情绪爆发/金句) → 桥段(转折) → 副歌。
2. 意象具体、有画面感，避免直白说教；情绪要有起伏。
3. 副歌要有一句能循环洗脑的记忆点。
4. 风格匹配曲风（民谣朴素、摇滚热血、说唱押韵密集）。

请直接输出完整歌词（标注段落）。`,
  },
  {
    id: 'emoji-riddle',
    title: '专属 emoji 谜题',
    icon: '🧩',
    category: 'fun',
    tags: ['生成', '彩蛋', '整蛊'],
    fun: true,
    desc: '把一句话变成 emoji 谜语，发给朋友猜着玩。',
    variables: [
      { key: 'phrase', label: '要猜的话', placeholder: '今晚吃火锅', required: true, default: '今晚吃火锅' },
    ],
    template: `请把「{{phrase}}」做成一个 emoji 谜题。

【输出】
1. 用纯 emoji 重新表达这句话（不许出现文字）。
2. 给 2 个难度版本：直白版 + 高难度谐音/联想版。
3. 附上解题思路（每个 emoji 代表什么）。
4. 再给 3 句类似的、适合做谜题的短语建议。

请直接输出。`,
  },
  {
    id: 'pet-memoir',
    title: '给宠物写回忆录',
    icon: '🐾',
    category: 'fun',
    tags: ['生成', '彩蛋', '温情'],
    fun: true,
    desc: '以宠物的口吻写一本迷你回忆录，催泪又可爱。',
    variables: [
      { key: 'pet', label: '宠物', placeholder: '一只叫馒头的橘猫，3岁', required: true, default: '一只叫馒头的橘猫，3岁' },
    ],
    template: `请以宠物的第一人称口吻，写一本迷你回忆录。

【主角】{{pet}}

【要求】
1. 章节式：初见主人 → 第一天到家 → 最爱的事 → 最怕的事 → 对主人的小吐槽 → 想对主人说的话。
2. 语气天真、傲娇又深情，符合宠物视角（不理解人类世界但努力观察）。
3. 有具体的小细节和画面，避免空泛。
4. 结尾要温暖治愈，最好催泪。

请直接输出完整回忆录（约 600 字）。`,
  },
  {
    id: 'birthday-blessing',
    title: '创意生日祝福',
    icon: '🎂',
    category: 'fun',
    tags: ['祝福', '彩蛋', '整蛊'],
    fun: true,
    desc: '别再发"生日快乐"，AI 帮你写走心又特别的祝福。',
    variables: [
      { key: 'relation', label: '对方是谁', placeholder: '认识10年的闺蜜', required: true, default: '认识10年的闺蜜' },
      { key: 'trait', label: 'TA的特点/回忆', placeholder: '爱喝奶茶、总迟到但很讲义气', multiline: true, default: '爱喝奶茶、总迟到但很讲义气' },
      { key: 'style', label: '风格', placeholder: '走心/搞笑/文艺/毒舌', default: '走心' },
    ],
    template: `请帮我写一段给「{{relation}}」的生日祝福。

【TA的特点/我们的回忆】{{trait}}
【风格】{{style}}

【要求】
1. 别用"生日快乐"开头的套话。
2. 紧扣对方特点和具体回忆，让人一看就是写给 TA 的，不是群发。
3. 给 3 个不同风格的版本（走心版/幽默版/短句金句版），每段 50-100 字。
4. 适合发朋友圈或私聊。

请直接输出。`,
  },
  {
    id: 'roast-outfit',
    title: '毒舌点评穿搭',
    icon: '👗',
    category: 'fun',
    tags: ['彩蛋', '整蛊', '毒舌'],
    fun: true,
    desc: '描述你的穿搭，AI 用时尚毒舌评委的口吻犀利点评。',
    variables: [
      { key: 'outfit', label: '你的穿搭', placeholder: '格子衬衫+运动裤+洞洞鞋', required: true, multiline: true, default: '格子衬衫+运动裤+洞洞鞋' },
    ],
    template: `请扮演一位嘴毒但专业的时尚评委，犀利点评我的穿搭。

【我的穿搭】{{outfit}}

【要求】
1. 语气毒舌、金句频出（参考时尚选秀节目的评委），但点评要有专业依据。
2. 先狠狠吐槽问题，再给 3 条具体可执行的改造建议。
3. 给这套穿搭打个分（/10）并解释。
4. 结尾来一句"恭喜你，离时尚还有…公里"之类的总结。

请直接输出点评。`,
  },
  {
    id: 'meeting-standup',
    title: '会议纪要变脱口秀',
    icon: '🎤',
    category: 'fun',
    tags: ['变身', '彩蛋', '职场'],
    fun: true,
    desc: '把无聊的会议纪要改写成脱口秀段子，苦中作乐。',
    variables: [
      { key: 'minutes', label: '会议纪要', placeholder: '讨论Q3 OKR，确认三个目标…', required: true, multiline: true, default: '讨论Q3 OKR，确认三个目标，安排下周复盘' },
    ],
    template: `请把下面这段会议纪要，改写成一段脱口秀段子。

【会议纪要】{{minutes}}

【要求】
1. 用脱口秀演员的口吻（自嘲、观察、反转），把职场黑话和会议日常解构成笑点。
2. 抓住"领导说话艺术""无效会议""OKR 画饼"等共鸣点猛戳。
3. 有铺垫有 punchline，节奏感强。
4. 约 300 字，读出来能让人笑。

请直接输出段子。`,
  },
  {
    id: 'mock-interview',
    title: 'AI 模拟面试官',
    icon: '💼',
    category: 'fun',
    tags: ['彩蛋', '职场', '面试'],
    fun: true,
    desc: '让 AI 当面试官，针对你的岗位连环追问，练手神器。',
    variables: [
      { key: 'role', label: '岗位', placeholder: '初级产品经理', required: true, default: '初级产品经理' },
    ],
    template: `请你扮演一位资深、专业、会连环追问的{{role}}面试官，对我进行模拟面试。

【规则】
1. 你一次只问一个问题，等我回答后，根据我的回答追问或换下一题（不要一次列出一堆问题）。
2. 问题由浅入深：自我介绍 → 项目经历深挖（用 STAR 追问）→ 专业题 → 反问环节。
3. 适当施压（"为什么这么做？""如果重来你会怎么改？"），模拟真实压力。
4. 面试结束后，给我一份详细反馈：回答亮点、薄弱点、改进建议、整体评分。

请先开场，问我第一个问题。`,
  },
  {
    id: 'movie-in-five',
    title: '电影一句话神总结',
    icon: '🎬',
    category: 'fun',
    tags: ['生成', '彩蛋', '影视'],
    fun: true,
    desc: '把电影剧情浓缩成一句神吐槽，看完不剧透也想笑。',
    variables: [
      { key: 'movie', label: '电影', placeholder: '泰坦尼克号', required: true, default: '泰坦尼克号' },
    ],
    template: `请把电影「{{movie}}」的剧情，用一句神吐槽总结（不剧透核心悬念，但抓住精髓）。

【输出】
1. 一句话神总结（要幽默、有梗、抓精髓）。
2. 3 个不同风格的一句话版本（毒舌版/文艺版/网感版）。
3. 一段不超过 50 字的"无剧透安利语"，让人想去看。
4. 用 emoji 给这部电影打个"标签"。

请直接输出。`,
  },
  {
    id: 'excuse-generator',
    title: '高情商请假/婉拒话术',
    icon: '🙈',
    category: 'fun',
    tags: ['彩蛋', '职场', '整蛊'],
    fun: true,
    desc: '体面地请假、推掉饭局、拒绝邀约，话术得体又不伤和气。',
    variables: [
      { key: 'situation', label: '场景', placeholder: '想拒绝同事的周末聚餐邀请', required: true, multiline: true, default: '想拒绝同事的周末聚餐邀请' },
    ],
    template: `请帮我写一段高情商的话术，应对这个场景：「{{situation}}」

【要求】
1. 给 3 个版本：真诚得体版 / 幽默化解版 / 委婉含蓄版。
2. 既表达清楚拒绝/请求，又不让对方难堪，留有余地。
3. 措辞自然、像真人说的，别用书面腔。
4. 标注每个版本适合的关系亲疏（熟人/普通同事/领导）。

请直接输出。`,
  },
  {
    id: 'child-story',
    title: '定制睡前故事',
    icon: '🌙',
    category: 'fun',
    tags: ['生成', '彩蛋', '童话'],
    fun: true,
    desc: '把孩子/朋友的名字和喜好编进专属童话，哄睡神器。',
    variables: [
      { key: 'name', label: '主角名字', placeholder: '朵朵', required: true, default: '朵朵' },
      { key: 'likes', label: '喜欢的东西', placeholder: '恐龙、星星、草莓', multiline: true, default: '恐龙、星星、草莓' },
    ],
    template: `请讲一个定制的睡前故事，主角叫「{{name}}」，喜欢：{{likes}}。

【要求】
1. 把主角的名字和喜欢的东西自然编织进故事。
2. 情节温暖、有惊无险、节奏舒缓（适合睡前），结尾要平和安宁，引导入睡。
3. 语言简单生动，适合 3-8 岁孩子，可有一些重复的韵律句。
4. 800 字左右，分几段。

请直接讲故事。`,
  },
  {
    id: 'philosophy-everyday',
    title: '日常小事变哲学思辨',
    icon: '🤔',
    category: 'fun',
    tags: ['变身', '彩蛋', '脑洞'],
    fun: true,
    desc: '把一件小事升华成哲学命题，朋友圈装深度专用。',
    variables: [
      { key: 'thing', label: '一件小事', placeholder: '今天外卖迟到了半小时', required: true, multiline: true, default: '今天外卖迟到了半小时' },
    ],
    template: `请把下面这件日常小事，升华成一段哲学思辨。

【小事】{{thing}}

【要求】
1. 借用一两位哲学家/思想流派的观点（如存在主义、斯多葛、禅），但要说人话。
2. 从这件小事引出对生活、时间、欲望或意义的洞察。
3. 语气克制有深度，不要爹味说教，带一点自嘲或幽默。
4. 结尾留一个让人回味的金句。
5. 适合发朋友圈，约 200 字。

请直接输出。`,
  },
];
