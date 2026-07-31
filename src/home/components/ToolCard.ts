import { h } from '@/core/components/element';
import type { RegisteredTool } from '@/core/types';

/** 关键词是否在卡片 UI 上可见（编译期注入；不影响 meta/JSON-LD 始终可读） */
declare const __SEO_SHOW_KEYWORDS__: boolean;

/**
 * 工具卡片。
 *
 * 视觉层次：
 *   - 头部：有 cover 首图则展示首图带；否则按 card.accent 渐变带 + 大图标
 *   - 主体：图标（无首图时）/ 名称 / 描述
 *   - 可选：关键词胶囊（仅 __SEO_SHOW_KEYWORDS__ 为 true 时渲染，默认隐藏）
 *
 * 交互：hover 时抬升 + 阴影 + 强调描边 + 头部图标微缩放。
 * 入场动画由 stagger.ts 统一加 .stagger-item 控制，本组件不重复实现。
 */
export function createToolCard(tool: RegisteredTool, index: number): HTMLAnchorElement {
  const base = import.meta.env.BASE_URL;
  const href = `${base}tools/${tool.slug}/`;
  const accent = tool.card?.accent ?? 'var(--accent)';

  // —— 头部 ——
  const header = h('div', { class: 'tool-card-header relative h-24 overflow-hidden' });
  if (tool.coverUrl) {
    header.append(
      h('img', {
        src: tool.coverUrl,
        alt: '',
        class: 'h-full w-full object-cover transition-transform duration-500 group-hover:scale-105',
        loading: 'lazy',
      }),
    );
  } else {
    // 无首图：accent 渐变 + 装饰圆 + emoji 图标居中
    header.style.cssText = `background:linear-gradient(135deg, ${accent}, ${accent}cc);`;
    header.append(
      h('div', {
        class: 'absolute -right-6 -top-6 h-20 w-20 rounded-full bg-white/10',
      }),
      h('div', {
        class:
          'absolute inset-0 flex items-center justify-center text-4xl transition-transform duration-500 group-hover:scale-110',
        textContent: tool.icon ?? '🧰',
      }),
    );
  }

  // —— 主体 ——
  const body = h('div', { class: 'p-4' }, [
    h('div', { class: 'flex items-center gap-2' }, [
      // 有首图时主体左侧再放一个小图标；无首图时头部已展示，主体不重复
      ...(tool.coverUrl && tool.icon
        ? [h('span', { class: 'text-lg', textContent: tool.icon })]
        : []),
      h('h3', {
        class:
          'font-semibold text-[var(--fg)] group-hover:text-[var(--accent)] transition-colors',
        textContent: tool.name,
      }),
    ]),
    h('p', {
      class: 'mt-1.5 text-sm text-[var(--fg-muted)] line-clamp-2',
      textContent: tool.description,
    }),
  ]);

  // —— 可选关键词胶囊 ——
  const showKeywords = typeof __SEO_SHOW_KEYWORDS__ !== 'undefined' && __SEO_SHOW_KEYWORDS__;
  if (showKeywords && tool.keywords?.length) {
    body.append(
      h(
        'div',
        { class: 'mt-3 flex flex-wrap gap-1.5' },
        tool.keywords.slice(0, 4).map((k) =>
          h('span', {
            class:
              'rounded-full bg-[var(--bg)] border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--fg-muted)]',
            textContent: k,
          }),
        ),
      ),
    );
  }

  return h(
    'a',
    {
      href,
      class: 'tool-card group stagger-item block overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:border-[var(--accent)]',
      // stagger 入场延迟（索引越大越晚），最多 600ms 封顶
      style: `--stagger-index:${index}`,
    },
    [header, body],
  );
}
