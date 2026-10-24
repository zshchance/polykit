/** 演示文稿格式帮助与可复制 AI 整理提示词。 */
import { h } from '@/core/components/element';
import { createDialog } from '@/core/components/Dialog';
import { createCopyButton } from '@/core/components/CopyButton';

export function buildContentPrompt(content = ''): string {
  return `你是一位擅长信息提炼和演示设计的编辑。请把下面的原始文稿整理成适合“演示翻页视频”的文本。

【整理要求】
1. 保留原意和关键事实，不虚构数据，不增加原文没有的观点；语言自然、简洁，适合直接朗读和观看。
2. 每页只表达一个核心观点。用“# 加空格”书写页标题，例如“# 为什么需要复盘”；标题尽量不超过 16 个字。
3. 标题下写 2～4 行短正文，每页正文尽量控制在 80 字以内；长内容按逻辑拆成连续多页，不要塞满一页。
4. 每页之间空一行。需要明确换页时，可单独使用一行“---”。不要使用项目符号、加粗符号、链接或图片语法。
5. 第一页作为封面，保留一个简短有力的标题和一句导语；后续页面按“背景—要点—结论/行动”组织，但无需机械添加标签。
6. 只输出整理后的演示文稿本身，不要解释、摘要或 Markdown 代码围栏，方便我直接粘贴使用。

【原始文稿】
${content.trim() || '（请把需要整理的原始文稿粘贴在这里）'}`;
}

export function openContentHelp(getContent: () => string): void {
  const dialog = createDialog({ label: '演示文稿格式与 AI 整理帮助', panelClass: 'max-w-xl' });
  const prompt = h('textarea', {
    class:
      'w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 font-mono text-xs leading-relaxed text-[var(--fg-muted)] outline-none',
    rows: 12,
    readonly: true,
    'aria-label': 'AI 文稿整理提示词',
  }) as HTMLTextAreaElement;
  prompt.value = buildContentPrompt();
  const copyPrompt = createCopyButton(() => buildContentPrompt(), '复制提示词');
  const copyWithContent = createCopyButton(
    () => buildContentPrompt(getContent()),
    '复制提示词＋当前文稿',
  );
  const secondary =
    'rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] hover:border-[var(--accent)] hover:text-[var(--accent)]';
  copyWithContent.className = `inline-flex items-center rounded-md px-3 py-1.5 text-sm transition-colors ${secondary}`;
  dialog.body.append(
    h('div', { class: 'space-y-4' }, [
      h('div', {}, [
        h('h3', {
          class: 'text-base font-semibold text-[var(--fg)]',
          textContent: '让 AI 帮你整理演示文稿',
        }),
        h('p', {
          class: 'mt-1.5 text-sm leading-relaxed text-[var(--fg-muted)]',
          textContent:
            '复制下面的提示词到任意 AI 工具。只有当你主动粘贴时，文稿才会发送给该工具；这里不会自动上传。',
        }),
      ]),
      h(
        'div',
        {
          class:
            'rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 font-mono text-xs leading-relaxed text-[var(--fg-muted)]',
        },
        [
          h('div', { textContent: '# 第一页标题' }),
          h('div', { textContent: '一句简短的导语或核心观点。' }),
          h('div', { class: 'h-2' }),
          h('div', { textContent: '# 第二页标题' }),
          h('div', { textContent: '每页只讲一件事，长文拆成多页。' }),
          h('div', { class: 'h-2' }),
          h('div', { textContent: '---' }),
          h('div', { textContent: '这一行也可以强制分页。' }),
        ],
      ),
      h('div', { class: 'space-y-2' }, [
        h('p', { class: 'text-sm font-medium text-[var(--fg)]', textContent: 'AI 整理提示词' }),
        prompt,
      ]),
      h('div', { class: 'flex flex-wrap justify-end gap-2' }, [copyPrompt, copyWithContent]),
    ]),
  );
  dialog.open();
}
