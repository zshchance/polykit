/** 快闪文案格式帮助与可复制 AI 整理提示词。 */
import { h } from '@/core/components/element';
import { createDialog } from '@/core/components/Dialog';
import { createCopyButton } from '@/core/components/CopyButton';
import { getAspect } from './options';
import { cardBudget } from './script';

/**
 * 生成「让 AI 改写成本工具格式」的提示词。
 *
 * 规则与 script.ts 的切卡实现一一对应，避免 AI 写出工具拆不动的文案：
 *   - 一行 = 一张卡，句读会自动二次拆分 → 要求一行一句
 *   - 每卡字符预算随画面比例变化（9:16 最窄）→ 提示词里带上真实预算
 *   - `#`/`##` 行 = 标题卡，`**…**`/`【…】` 整句 = 强调卡
 *   - 空行与 `---` 只是分隔，不进画面
 *
 * @param content 用户当前文案（空字符串时提示词留占位符，便于先复制模板）
 * @param aspect 当前画面比例 id（决定每卡字符上限）
 */
export function buildContentPrompt(content = '', aspect = '9:16'): string {
  const a = getAspect(aspect);
  const budget = cardBudget(a.id);
  return `你是一位擅长短视频文案与节奏设计的编导。请把下面的原始内容，改写成适合「文字快闪视频」的文案。

【格式要求：严格遵守，否则会切卡错乱】
1. 一行就是一张卡，一行只说一件事。每行尽量不超过 ${budget} 个字（当前画幅 ${a.label}，这是舒适阅读上限）；宁可多分几行，也不要把长句塞进一行。
2. 不要在一行里写多句话。句号、问号、感叹号、分号、省略号都会触发自动拆卡，需要停顿就直接换行。
3. 以「# 标题」开头的一行，会成为分段标题卡（最多用 1～2 个 #）。标题不超过 16 个字，整条视频用 0～4 个即可，用来切换话题；不要用 3 个及以上的 #，也不要加粗标题。
4. 把最想让人记住的那一句（钩子、金句、关键数字或结论）整句用 **双星号** 或 【方括号】 包起来，它会渲染成强调卡。一张卡只包一整句，强调卡占全片 10%～20% 最为合适。
5. 空行、以及单独一行的 --- ，都只是视觉分隔，不会出现在画面上。用它把文案按段落分组，方便你自查结构；其他分隔符（***、===、___）不要使用。
6. 不要使用项目符号、编号列表、链接、图片语法、表情符号。
7. 语言要口语、短句、有节奏：多用具体动词和数字，删掉「的、了、吧」这类可有可无的虚词和书面连接词。
8. 第一张卡要能独立成立（当封面用），最后一张卡收束成结论或行动号召。全片建议 20～80 张卡，最多 200 张。
9. 只输出改写后的文案本身：不要解释、不要前言后语、不要 Markdown 代码围栏，方便我直接粘贴使用。

【原始内容】
${content.trim() || '（请把需要改写的原始文案粘贴在这里）'}`;
}

/** 常见误用 → 正确写法的对照示例（均已按 script.ts 的真实解析行为核对） */
const MISTAKES: { wrong: string; right: string; why: string }[] = [
  {
    wrong: '这条视频的核心是让你意识到坚持不下去不是意志力问题',
    right: '坚持不下去\n不是意志力问题',
    why: '超过每行字数上限会被按字符硬切，容易把最后一个字甩到下一张卡',
  },
  {
    wrong: '你总是坚持不下去。因为一开始目标就定得太大。',
    right: '你总是坚持不下去\n因为一开始目标就定得太大',
    why: '句号会触发自动拆卡，断点由标点决定而不是你',
  },
  {
    wrong: '- 打开文档',
    right: '打开文档',
    why: '项目符号不会自动清理，会原样出现在画面上',
  },
  {
    wrong: '### 小标题',
    right: '# 小标题',
    why: '只有 1～2 个 # 会被识别成标题卡',
  },
];

export function openContentHelp(
  getContent: () => string,
  getAspect: () => string = () => '9:16',
): void {
  const dialog = createDialog({ label: '快闪文案格式与 AI 整理帮助', panelClass: 'max-w-xl' });
  const prompt = h('textarea', {
    class:
      'w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 font-mono text-xs leading-relaxed text-[var(--fg-muted)] outline-none',
    rows: 16,
    readonly: true,
    'aria-label': 'AI 文案改写提示词',
  }) as HTMLTextAreaElement;
  prompt.value = buildContentPrompt('', getAspect());

  const copyPrompt = createCopyButton(() => buildContentPrompt('', getAspect()), '复制提示词');
  const copyWithContent = createCopyButton(
    () => buildContentPrompt(getContent(), getAspect()),
    '复制提示词＋当前文案',
  );
  const secondary =
    'rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] hover:border-[var(--accent)] hover:text-[var(--accent)]';
  copyWithContent.className = `inline-flex items-center rounded-md px-3 py-1.5 text-sm transition-colors ${secondary}`;

  const mono =
    'rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 font-mono text-xs leading-relaxed text-[var(--fg-muted)]';

  dialog.body.append(
    h('div', { class: 'space-y-4' }, [
      h('div', {}, [
        h('h3', {
          class: 'text-base font-semibold text-[var(--fg)]',
          textContent: '让 AI 帮你把文案改成快闪格式',
        }),
        h('p', {
          class: 'mt-1.5 text-sm leading-relaxed text-[var(--fg-muted)]',
          textContent:
            '复制下面的提示词到任意 AI 工具，把口播稿、文章或笔记丢给它，它就会按本工具的切卡规则返回可直接粘贴的文案。只有当你主动粘贴时，内容才会发送给该工具；这里不会自动上传。',
        }),
      ]),
      h(
        'div',
        {
          class:
            'rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-xs leading-relaxed text-[var(--fg-muted)]',
        },
        [
          h('div', { class: 'mb-1.5 font-medium text-[var(--fg)]', textContent: '格式速查' }),
          h('div', { textContent: '一行 = 一张卡（句读会自动再拆，所以一行只写一句）' }),
          h('div', { textContent: '# 开头的行 = 标题卡，0～4 个足够' }),
          h('div', { textContent: '**整句** 或 【整句】 = 强调卡（金句、数字、结论）' }),
          h('div', { textContent: '空行与 --- = 仅作分隔，不出现在画面里' }),
        ],
      ),
      h('div', { class: 'space-y-2' }, [
        h('p', { class: 'text-sm font-medium text-[var(--fg)]', textContent: '正确写法长这样' }),
        h('div', { class: mono }, [
          h('div', { textContent: '# 你不需要准备好' }),
          h('div', { textContent: '先做三分钟' }),
          h('div', { textContent: '**开始了才会清晰**' }),
          h('div', { class: 'h-2' }),
          h('div', { textContent: '---' }),
          h('div', { class: 'h-2' }),
          h('div', { textContent: '# 三个动作' }),
          h('div', { textContent: '打开文档' }),
          h('div', { textContent: '写一句废话' }),
          h('div', { textContent: '删掉它，接着写' }),
        ]),
      ]),
      h('div', { class: 'space-y-2' }, [
        h('p', { class: 'text-sm font-medium text-[var(--fg)]', textContent: '常见误用' }),
        h(
          'div',
          { class: 'space-y-2' },
          MISTAKES.map((m) =>
            h(
              'div',
              {
                class:
                  'rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5 text-xs leading-relaxed',
              },
              [
                h('div', { class: 'text-[var(--fg-muted)]', textContent: `✕ ${m.wrong}` }),
                h('div', {
                  class: 'text-[var(--fg)]',
                  textContent: `✓ ${m.right.replace(/\n/g, ' ⏎ ')}`,
                }),
                h('div', {
                  class: 'mt-0.5 text-[11px] text-[var(--fg-muted)]',
                  textContent: m.why,
                }),
              ],
            ),
          ),
        ),
      ]),
      h('div', { class: 'space-y-2' }, [
        h('p', { class: 'text-sm font-medium text-[var(--fg)]', textContent: 'AI 改写提示词' }),
        prompt,
        h('p', {
          class: 'text-[11px] leading-relaxed text-[var(--fg-muted)]',
          textContent:
            '提示词里的每行字数上限会跟随当前画面比例自动调整，切换比例后重新打开本帮助即可复制新版。',
        }),
      ]),
      h('div', { class: 'flex flex-wrap justify-end gap-2' }, [copyPrompt, copyWithContent]),
    ]),
  );
  dialog.open();
  // 只读提示词框按内容展开：避免内滚动把后半段提示词藏起来（用户会以为提示词被截断）
  prompt.style.height = 'auto';
  prompt.style.height = `${prompt.scrollHeight + 2}px`;
}
