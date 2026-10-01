import type Mermaid from 'mermaid';

export type MermaidTheme = 'default' | 'dark' | 'neutral' | 'forest';

let mermaidInstance: typeof Mermaid | null = null;
let initializePending: Promise<typeof Mermaid> | null = null;
let currentTheme: MermaidTheme = 'default';

/**
 * 惰性加载并初始化 Mermaid（动态 import，不用时零开销）。
 * securityLevel 'strict'：由 Mermaid 自身对标签文本做转义，防注入。
 */
async function getMermaid(): Promise<typeof Mermaid> {
  if (mermaidInstance) return mermaidInstance;
  initializePending ??= (async () => {
    const mod = await import('mermaid');
    const mermaid = mod.default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: currentTheme,
      fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    });
    mermaidInstance = mermaid;
    return mermaid;
  })();
  return initializePending;
}

/**
 * 仅记录期望主题，不触发 Mermaid 加载。
 * 站点启动/切主题时调用；首次真正渲染图示时按该主题初始化。
 */
export function setMermaidThemePref(theme: MermaidTheme): void {
  currentTheme = theme;
}

/** 若 Mermaid 已加载，立即应用当前主题偏好；未加载则无操作（等首渲染生效） */
export async function reapplyMermaidTheme(): Promise<void> {
  if (!mermaidInstance && !initializePending) return;
  const mermaid = await getMermaid();
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: currentTheme });
}

function buildErrorCard(): string {
  return (
    `<div class="md-mermaid-error-title">图示渲染失败</div>` +
    `<pre class="md-mermaid-error-message"></pre>`
  );
}

async function renderBlock(mermaid: typeof Mermaid, block: HTMLElement): Promise<boolean> {
  const code = block.dataset.mdSrc ?? block.textContent ?? '';
  const id = `md-mmd-${Math.random().toString(36).slice(2)}`;
  try {
    const { svg } = await mermaid.render(id, code);
    block.dataset.mdSrc = code; // 源码留档：主题切换/重渲染时使用
    block.innerHTML = svg;
    return true;
  } catch (err) {
    block.classList.add('md-mermaid-error');
    block.innerHTML = buildErrorCard();
    const msgEl = block.querySelector<HTMLElement>('.md-mermaid-error-message');
    if (msgEl) msgEl.textContent = `${err instanceof Error ? err.message : String(err)}\n\n${code}`;
    return false;
  }
}

/**
 * 渲染容器内全部 `.md-mermaid` 占位符（内容为转义图源码）为内联 SVG。
 * - 幂等：已渲染（含 svg）或已是错误卡片的块自动跳过
 * - force：忽略已渲染状态，基于留档源码重渲染（用于主题切换）
 * - 解析失败时显示错误卡片（标题 + 错误信息 + 原始代码），不中断其余渲染
 * @returns 本次成功渲染的图数量
 */
export async function renderMermaidIn(
  container: HTMLElement,
  options: { force?: boolean } = {},
): Promise<number> {
  const blocks = Array.from(container.querySelectorAll<HTMLElement>('.md-mermaid')).filter(
    (block) =>
      options.force ||
      (!block.querySelector('svg') && !block.classList.contains('md-mermaid-error')),
  );
  if (blocks.length === 0) return 0;

  const mermaid = await getMermaid();
  let rendered = 0;
  for (const block of blocks) {
    if (options.force) block.classList.remove('md-mermaid-error');
    if (await renderBlock(mermaid, block)) rendered++;
  }
  return rendered;
}
