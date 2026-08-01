import { h } from '@/core/components/element';
import type { RegisteredTool } from '@/core/types';

/** 关键词是否在卡片 UI 上可见（编译期注入；不影响 meta/JSON-LD 始终可读） */
declare const __SEO_SHOW_KEYWORDS__: boolean;

/** 卡片渲染所需的用户偏好与回调 */
export interface ToolCardOptions {
  /** stagger 入场索引 */
  index: number;
  /** 是否已置顶 */
  pinned: boolean;
  /** 是否已星标 */
  starred: boolean;
  /** 切换置顶（回调由 main 注入，负责落库 + 重渲染） */
  onTogglePin: () => void;
  /** 切换星标 */
  onToggleStar: () => void;
}

/**
 * 工具卡片。
 *
 * 视觉层次：
 *   - 头部：有 cover 首图则展示首图带；否则按 card.accent 渐变带 + 大图标
 *   - 主体：图标（无首图时）/ 名称 / 描述
 *   - 可选：关键词胶囊（仅 __SEO_SHOW_KEYWORDS__ 为 true 时渲染，默认隐藏）
 *
 * 用户偏好交互（头部右上角绝对定位按钮）：
 *   - 📌 置顶：激活态填充，置顶卡片额外加 .tool-card--pinned 绿色细边框
 *   - ⭐ 星标：激活态金色
 *   按钮位于 <a> 之外不可行（卡片根是 <a>，不能嵌套交互按钮），
 *   故以绝对定位浮层覆盖，事件内 stopPropagation + preventDefault 避免触发卡片跳转。
 *
 * 交互：hover 时抬升 + 阴影 + 强调描边 + 头部图标微缩放。
 * 入场动画由 stagger.ts 统一加 .stagger-item 控制，本组件不重复实现。
 */
export function createToolCard(
  tool: RegisteredTool,
  opts: ToolCardOptions,
): HTMLAnchorElement {
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
    // 无首图：accent 渐变 + 装饰圆 + 图标居中。
    // 有矢量图标素材（iconUrl）时优先用 <img>，比 emoji 更精致、跨系统风格统一；
    // 否则回退 tool.config.ts 的 emoji 图标。
    header.style.cssText = `background:linear-gradient(135deg, ${accent}, ${accent}cc);`;
    const centerIcon = tool.iconUrl
      ? h('img', {
          src: tool.iconUrl,
          alt: '',
          // 与 text-4xl emoji 视觉重量相当；矢量圆角图标用 h-12 w-12 撑满
          class: 'h-12 w-12 object-contain drop-shadow-sm',
          loading: 'lazy',
          draggable: false,
        })
      : h('span', { class: 'text-4xl', textContent: tool.icon ?? '🧰' });
    header.append(
      h('div', {
        class: 'absolute -right-6 -top-6 h-20 w-20 rounded-full bg-white/10',
      }),
      h('div', {
        class:
          'absolute inset-0 flex items-center justify-center transition-transform duration-500 group-hover:scale-110',
      }, [centerIcon]),
    );
  }

  // —— 置顶 / 星标 按钮（头部右上角浮层）——
  // 不能放进 <a> 内（交互按钮不可嵌套于锚点），故绝对定位、事件拦截跳转。
  const pinBtn = h('button', {
    type: 'button',
    class: `tool-card-act tool-card-pin-btn${opts.pinned ? ' is-active' : ''}`,
    title: opts.pinned ? '取消置顶' : '置顶',
    'aria-label': opts.pinned ? '取消置顶' : '置顶',
    'aria-pressed': String(opts.pinned),
    textContent: '📌',
    onclick: (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      opts.onTogglePin();
    },
  });
  const starBtn = h('button', {
    type: 'button',
    class: `tool-card-act tool-card-star-btn${opts.starred ? ' is-active' : ''}`,
    title: opts.starred ? '取消星标' : '加星标',
    'aria-label': opts.starred ? '取消星标' : '加星标',
    'aria-pressed': String(opts.starred),
    textContent: '⭐',
    onclick: (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      opts.onToggleStar();
    },
  });
  header.append(pinBtn, starBtn);

  // —— 主体 ——
  const titleRow = h('div', { class: 'flex items-center gap-2' }, [
    // 星标激活时标题左侧加金色星（视觉冗余提示，与头部按钮呼应）
    ...(opts.starred
      ? [
          h('span', {
            class: 'tool-card-star-title text-base leading-none',
            'aria-hidden': 'true',
            textContent: '⭐',
          }),
        ]
      : []),
    // 有首图时主体左侧再放一个小图标；无首图时头部已展示，主体不重复
    ...(tool.coverUrl && tool.icon
      ? [h('span', { class: 'text-lg', textContent: tool.icon })]
      : []),
    h('h3', {
      class:
        'font-semibold text-[var(--fg)] group-hover:text-[var(--accent)] transition-colors',
      textContent: tool.name,
    }),
  ]);
  const body = h('div', { class: 'flex flex-1 flex-col p-4' }, [
    titleRow,
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
      // tool-card--pinned：置顶绿边框修饰类；relative 让头部按钮浮层定位锚定到卡片。
      // h-full + flex flex-col：撑满网格行高，body flex-1 占据剩余空间，
      // 使同一行卡片（描述行数不同）高度对齐。
      class: `tool-card group stagger-item flex h-full flex-col overflow-hidden rounded-2xl border bg-[var(--bg-elevated)] transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:border-[var(--accent)]${opts.pinned ? ' relative tool-card--pinned' : ' border-[var(--border)]'}`,
      // stagger 入场延迟（索引越大越晚），最多 600ms 封顶
      style: `--stagger-index:${opts.index}`,
      draggable: false, // 卡片整体不作为拖拽源；拖拽由外层 wrapper 手柄驱动
    },
    [header, body],
  );
}
