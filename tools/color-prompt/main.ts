import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { createCopyButton } from '@/core/components/CopyButton';
import { PALETTES, MOODS, getPaletteById, type Palette } from './data/palettes';
import { renderWebsitePreview, renderSlidePreview, previewHeader } from './preview';
import { buildPromptZh, buildPromptEn } from './templates';
import { loadSelection, saveSelection } from './settings';

initTheme();

/**
 * AI 配色提示词 —— 选色系 → 看预览 → 复制提示词。
 *
 * 布局（自上而下）：
 *   1. 情绪筛选胶囊（全部 + MOODS）
 *   2. 色系卡片网格（横条色块预览 + 名称 + 情绪标签；点击选中）
 *   3. 双预览（网站首屏 + 幻灯片，随选中实时刷新）
 *   4. 色值清单 + AI 提示词（中 / 英，各带复制按钮）
 *
 * 选中态：色系卡片加 ring 高亮；切换色系仅刷新结果区，不重建网格。
 */
function renderColorPrompt(): void {
  const { content } = renderToolLayout(document.getElementById('app')!, 'AI 配色提示词');

  // —— 状态 ——
  // 启动时恢复上次选中的色系与情绪筛选，无记忆则用默认值
  const restored = loadSelection();
  let selectedId: string = restored.selectedId;
  let activeMood = restored.activeMood;

  /** 落库当前选择态（色系/情绪变化时调用） */
  function persistSelection(): void {
    saveSelection({ selectedId, activeMood });
  }

  /** 选中的色系对象 */
  const selected = (): Palette => getPaletteById(selectedId) ?? PALETTES[0];

  /** 按情绪筛选后的色系列表 */
  function filteredPalettes(): Palette[] {
    if (!activeMood) return PALETTES;
    return PALETTES.filter((p) => p.moods.includes(activeMood));
  }

  // ────────── 1. 情绪筛选 ──────────
  const moodChips = h('div', { class: 'flex flex-wrap gap-2' }, []);

  function renderMoodChips(): void {
    moodChips.replaceChildren(
      moodChip('全部', '', activeMood === ''),
      ...MOODS.map((m) => moodChip(m, m, activeMood === m)),
    );
  }

  function moodChip(label: string, value: string, isActive: boolean): HTMLButtonElement {
    return h('button', {
      type: 'button',
      class: [
        'rounded-full px-3.5 py-1.5 text-sm font-medium transition-all duration-200 border',
        isActive
          ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)]'
          : 'bg-[var(--bg-elevated)] text-[var(--fg-muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
      ].join(' '),
      textContent: label,
      onclick: () => {
        activeMood = value;
        renderMoodChips();
        renderPaletteGrid();
        // 若当前选中色系被筛选掉，回退到第一个可见色系
        if (!filteredPalettes().some((p) => p.id === selectedId)) {
          const first = filteredPalettes()[0];
          if (first) select(first.id);
        }
        persistSelection();
      },
    });
  }

  // ────────── 2. 色系卡片网格 ──────────
  const paletteGrid = h('div', {
    class: 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3',
  });

  function renderPaletteGrid(): void {
    paletteGrid.replaceChildren(
      ...filteredPalettes().map((p) => paletteCard(p, p.id === selectedId)),
    );
  }

  function paletteCard(p: Palette, isSelected: boolean): HTMLElement {
    // 横条色块预览：6 色等宽
    const swatch = h('div', { class: 'flex h-8 overflow-hidden rounded-md' },
      p.colors.map((c) =>
        h('div', { style: `flex:1;background:${c.hex};`, title: `${c.name} ${c.hex}` }),
      ),
    );

    return h('button', {
      type: 'button',
      class: [
        'text-left rounded-xl border bg-[var(--bg-elevated)] p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        isSelected
          ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/40'
          : 'border-[var(--border)] hover:border-[var(--accent)]',
      ].join(' '),
      'aria-pressed': String(isSelected),
      onclick: () => select(p.id),
    }, [
      swatch,
      h('div', { class: 'mt-2 flex items-center justify-between gap-2' }, [
        h('span', { class: 'font-medium text-[var(--fg)]', textContent: p.name }),
        h('div', { class: 'flex flex-wrap justify-end gap-1' },
          p.moods.slice(0, 2).map((m) =>
            h('span', {
              class: 'rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--fg-muted)]',
              textContent: m,
            }),
          ),
        ),
      ]),
      h('p', { class: 'mt-1 text-xs leading-snug text-[var(--fg-muted)] line-clamp-2', textContent: p.desc }),
    ]);
  }

  // ────────── 3 & 4. 预览 + 色值 + 提示词（随选中刷新） ──────────
  const resultArea = h('div', { class: 'space-y-6' });

  function renderResult(): void {
    const p = selected();

    // 预览区：网站首屏 + 幻灯片
    const previewBlock = h('div', { class: 'space-y-3' }, [
      previewHeader('配色预览 · 网站首屏 / 幻灯片'),
      h('div', { class: 'grid gap-4 lg:grid-cols-2' }, [
        h('div', { class: 'overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3' }, [
          h('div', { class: 'mb-2 text-xs font-medium text-[var(--fg-muted)]', textContent: '网站首屏' }),
          renderWebsitePreview(p),
        ]),
        h('div', { class: 'overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3' }, [
          h('div', { class: 'mb-2 text-xs font-medium text-[var(--fg-muted)]', textContent: '幻灯片' }),
          renderSlidePreview(p),
        ]),
      ]),
    ]);

    // 色值清单（便于用户直接取用 hex）
    const colorList = h('div', { class: 'space-y-3' }, [
      previewHeader('色值清单'),
      h('div', { class: 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6' },
        p.colors.map((c) =>
          h('div', { class: 'flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-2' }, [
            h('span', { class: 'h-5 w-5 shrink-0 rounded border border-[var(--border)]', style: `background:${c.hex};` }),
            h('div', { class: 'min-w-0' }, [
              h('div', { class: 'truncate text-xs font-medium text-[var(--fg)]', textContent: c.name }),
              h('div', { class: 'truncate text-[11px] text-[var(--fg-muted)]', textContent: c.hex.toUpperCase() }),
            ]),
          ]),
        ),
      ),
    ]);

    // 提示词区（中 / 英，各带复制按钮）
    const promptZh = buildPromptZh(p);
    const promptEn = buildPromptEn(p);
    const promptBlock = h('div', { class: 'space-y-3' }, [
      previewHeader('AI 提示词 · 中文 / English'),
      promptCard('中文提示词', promptZh, () => promptZh),
      promptCard('English Prompt', promptEn, () => promptEn),
    ]);

    resultArea.replaceChildren(previewBlock, colorList, promptBlock);
  }

  /** 单段提示词卡片：标题 + 复制按钮 + 只读文本框 */
  function promptCard(title: string, text: string, getter: () => string): HTMLElement {
    const ta = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows: 10,
      readonly: true,
    }) as HTMLTextAreaElement;
    ta.value = text;
    return h('div', { class: 'rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4' }, [
      h('div', { class: 'mb-2 flex items-center justify-between gap-2' }, [
        h('span', { class: 'text-sm font-medium text-[var(--fg)]', textContent: title }),
        createCopyButton(getter, '复制', '已复制 ✓'),
      ]),
      ta,
    ]);
  }

  /** 选中某色系：更新状态 + 刷新网格选中态 + 刷新结果区 + 落库 */
  function select(id: string): void {
    selectedId = id;
    renderPaletteGrid(); // 更新选中态高亮
    renderResult();
    persistSelection();
    // 结果区滚入视野（避免长网格下选了看不到）
    resultArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ────────── 装配 ──────────
  content.append(
    h('p', {
      class: 'mb-5 text-sm text-[var(--fg-muted)]',
      textContent: '选择色系，实时预览网站与幻灯片配色效果，一键复制中英文 AI 提示词。',
    }),
    h('div', { class: 'mb-3 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '按情绪筛选' }),
    moodChips,
    h('div', { class: 'mb-3 mt-5 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '选择色系' }),
    paletteGrid,
    h('div', { class: 'mt-8' }, [resultArea]),
  );

  renderMoodChips();
  renderPaletteGrid();
  renderResult();
}

renderColorPrompt();
