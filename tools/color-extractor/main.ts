import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { createCopyButton } from '@/core/components/CopyButton';
import { copyText } from '@/core/utils/clipboard';
import { extractPalette, type ExtractedColor } from './extractor';
import { loadImage, revokeImage, type LoadedImage } from './image';
import {
  formatPalette,
  FORMAT_OPTIONS,
  formatName,
  type OutputFormat,
} from './palette-format';
import {
  colorName,
  readableForeground,
} from './color-utils';
import {
  loadPrefs,
  savePrefs,
  clampColorCount,
  MIN_COLOR_COUNT,
  MAX_COLOR_COUNT,
  loadColors,
  saveColors,
  type StoredColor,
} from './settings';

initTheme();

/**
 * 配色提取器 —— 上传图片 → 提取主色 → 多格式输出。
 *
 * 布局（自上而下）：
 *   1. 拖拽/选择区（点击选图 + 拖入图片）
 *   2. 控制条（色数滑块 + 输出格式选择）
 *   3. 图片预览 + 提取出的色板（每色：色块 + hex + 占比 + 中文名 + 复制）
 *   4. 多格式输出文本框 + 复制全部
 *
 * 状态：colorCount（色数）、format（输出格式）、image（当前图片）。
 * 色数/格式变化时只重提取与重格式化，不重建色板骨架。
 * 数据全程本地，不上传。
 */
function renderColorExtractor(): void {
  const { content } = renderToolLayout(document.getElementById('app')!, '配色提取器');

  const restored = loadPrefs();
  let colorCount = restored.colorCount;
  let format: OutputFormat = restored.format;
  let image: LoadedImage | null = null;
  let currentColors: ExtractedColor[] = [];

  function persist(): void {
    savePrefs({ colorCount, format });
  }

  // ────────── 1. 拖拽/选择区 ──────────
  const dropzone = h('div', {
    role: 'button',
    tabindex: '0',
    'aria-label': '选择或拖入图片',
    class:
      'flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--bg-elevated)] px-6 py-12 text-center cursor-pointer transition-colors hover:border-[var(--accent)] focus:outline-none focus-visible:border-[var(--accent)]',
  }, [
    h('div', { class: 'text-3xl', textContent: '🖼️' }),
    h('div', { class: 'text-sm font-medium text-[var(--fg)]', textContent: '点击选择图片，或拖拽到此处' }),
    h('div', { class: 'text-xs text-[var(--fg-muted)]', textContent: '支持 PNG / JPG / WebP / GIF，图片仅在本地处理，不会上传' }),
  ]);

  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*',
    class: 'hidden',
  }) as HTMLInputElement;

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const f = e.dataTransfer?.files?.[0];
    if (f) void handleFile(f);
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void handleFile(f);
    fileInput.value = ''; // 允许重复选同一张
  });

  async function handleFile(file: File): Promise<void> {
    setLoading(true);
    try {
      const next = await loadImage(file);
      if (image) revokeImage(image);
      image = next;
      reextract();
      renderPreview();
      renderColors();
      renderOutput();
      // 持久化本次提取结果（仅色值数据，不存图片），重进可恢复色板
      saveColors(currentColors.map(toStored));
    } catch (err) {
      showError(err instanceof Error ? err.message : '图片加载失败');
    } finally {
      setLoading(false);
    }
  }

  /** ExtractedColor → 可序列化的 StoredColor（去掉运行期 rgb 对象） */
  function toStored(c: ExtractedColor): StoredColor {
    return { hex: c.hex, ratio: c.ratio, count: c.count };
  }
  /** StoredColor → ExtractedColor（rgb 由 hex 反解，仅供色板展示/格式化用，不再参与提取） */
  function fromStored(c: StoredColor): ExtractedColor {
    const hex6 = c.hex.slice(1);
    return {
      hex: c.hex,
      ratio: c.ratio,
      count: c.count,
      rgb: {
        r: parseInt(hex6.slice(0, 2), 16),
        g: parseInt(hex6.slice(2, 4), 16),
        b: parseInt(hex6.slice(4, 6), 16),
      },
    };
  }

  // ────────── 2. 控制条 ──────────
  const countLabel = h('span', { class: 'text-sm font-medium text-[var(--fg)]', textContent: `${colorCount} 色` });
  const countSlider = h('input', {
    type: 'range',
    min: String(MIN_COLOR_COUNT),
    max: String(MAX_COLOR_COUNT),
    step: '1',
    value: String(colorCount),
    class: 'color-extractor-range w-full',
    'aria-label': '提取色数',
  }) as HTMLInputElement;
  countSlider.addEventListener('input', () => {
    colorCount = clampColorCount(Number(countSlider.value));
    countLabel.textContent = `${colorCount} 色`;
    reextract();
    renderColors();
    renderOutput();
    persist();
  });

  const formatSelect = h('select', {
    class:
      'rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
    'aria-label': '输出格式',
  }) as HTMLSelectElement;
  formatSelect.append(
    ...FORMAT_OPTIONS.map((f) => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.name;
      return opt;
    }),
  );
  formatSelect.value = format;
  formatSelect.addEventListener('change', () => {
    format = formatSelect.value as OutputFormat;
    renderOutput();
    persist();
  });

  const controls = h('div', { class: 'flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6' }, [
    h('div', { class: 'flex-1' }, [
      h('div', { class: 'mb-1 flex items-center justify-between' }, [
        h('span', { class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '提取色数' }),
        countLabel,
      ]),
      countSlider,
    ]),
    h('div', { class: 'flex items-center gap-2' }, [
      h('span', { class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '输出格式' }),
      formatSelect,
    ]),
  ]);

  // ────────── 3. 预览 + 色板 ──────────
  const previewWrap = h('div');
  const colorsGrid = h('div', {
    class: 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4',
  });
  const emptyHint = h('div', {
    class: 'rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-10 text-center text-sm text-[var(--fg-muted)]',
    textContent: '上传图片后，这里会显示提取出的主色与多格式配色。',
  });

  /** 无图时隐藏色板网格，显示空提示；有图则相反 */
  function updateEmptyHint(): void {
    emptyHint.style.display = image ? 'none' : '';
    colorsGrid.style.display = image ? '' : 'none';
  }

  /** 重新提取（图片或色数变化时调用） */
  function reextract(): void {
    if (!image) {
      currentColors = [];
      return;
    }
    const step = sampleStep(image.width, image.height);
    currentColors = extractPalette(image.pixels, colorCount, step);
  }

  /** 根据图尺寸选采样步长：大图稀疏采样，保证速度 */
  function sampleStep(w: number, h: number): number {
    const n = w * h;
    if (n > 1_500_000) return 4;
    if (n > 400_000) return 2;
    return 1;
  }

  function renderPreview(): void {
    if (!image) {
      previewWrap.replaceChildren();
      return;
    }
    previewWrap.replaceChildren(
      h('div', { class: 'overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)]' }, [
        h('img', {
          src: image.previewUrl,
          alt: '原图预览',
          class: 'mx-auto max-h-72 w-auto',
        }),
      ]),
    );
  }

  function renderColors(): void {
    if (currentColors.length === 0) {
      colorsGrid.replaceChildren();
    } else {
      colorsGrid.replaceChildren(...currentColors.map((c) => colorCard(c)));
    }
    updateEmptyHint();
  }

  /**
   * 单色卡片：大色块（显示 hex，黑/白字自适应）+ 中文名 + 占比。
   * 整卡可点击复制对应 hex 色值，点击后色块短暂显示"已复制"反馈。
   */
  function colorCard(c: ExtractedColor): HTMLElement {
    const fgDark = readableForeground(c.rgb); // true→黑字
    const pct = `${(c.ratio * 100).toFixed(1)}%`;
    // 色块：点击复制 hex，复制成功后短暂切文案
    const swatch = h('button', {
      type: 'button',
      title: `点击复制 ${c.hex}`,
      class:
        'flex h-16 w-full cursor-pointer items-center justify-center text-xs font-mono font-semibold transition-opacity hover:opacity-90',
      style: `background:${c.hex};color:${fgDark ? '#0f172a' : '#ffffff'};`,
      textContent: c.hex,
      onclick: async () => {
        const ok = await copyText(c.hex);
        const original = c.hex;
        swatch.textContent = ok ? '已复制 ✓' : '复制失败';
        swatch.disabled = true;
        setTimeout(() => {
          swatch.textContent = original;
          swatch.disabled = false;
        }, 1200);
      },
    });
    return h('div', {
      class: 'overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]',
    }, [
      swatch,
      h('div', { class: 'flex items-center justify-between gap-1 px-2.5 py-1.5' }, [
        h('span', { class: 'text-xs font-medium text-[var(--fg)]', textContent: colorName(c.rgb) }),
        h('span', { class: 'text-[11px] text-[var(--fg-muted)]', textContent: pct }),
      ]),
    ]);
  }

  // ────────── 4. 多格式输出 ──────────
  const outputArea = h('div', { class: 'space-y-3' });
  function renderOutput(): void {
    if (currentColors.length === 0) {
      outputArea.replaceChildren();
      return;
    }
    const text = formatPalette(currentColors, format);
    const ta = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-sm leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows: 9,
      readonly: true,
    }) as HTMLTextAreaElement;
    ta.value = text;
    outputArea.replaceChildren(
      h('div', { class: 'rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4' }, [
        h('div', { class: 'mb-2 flex items-center justify-between gap-2' }, [
          h('span', { class: 'text-sm font-medium text-[var(--fg)]', textContent: formatName(format) }),
          createCopyButton(() => formatPalette(currentColors, format), '复制全部', '已复制 ✓'),
        ]),
        ta,
      ]),
    );
  }

  // ────────── 反馈：加载态 / 错误提示 ──────────
  const statusLine = h('div', { class: 'min-h-[1.25rem] text-xs text-[var(--fg-muted)]' });
  let statusTimer: number | undefined;
  function showStatus(msg: string, isError = false): void {
    clearTimeout(statusTimer);
    statusLine.textContent = msg;
    statusLine.style.color = isError ? 'var(--holiday-legal)' : 'var(--fg-muted)';
  }
  function showError(msg: string): void {
    showStatus('⚠ ' + msg, true);
  }
  function setLoading(loading: boolean): void {
    if (loading) {
      showStatus('正在处理…');
      dropzone.style.opacity = '0.6';
      dropzone.style.pointerEvents = 'none';
    } else {
      statusLine.textContent = '';
      dropzone.style.opacity = '';
      dropzone.style.pointerEvents = '';
    }
  }

  // ────────── 装配 ──────────
  content.append(
    h('p', {
      class: 'mb-5 text-sm text-[var(--fg-muted)]',
      textContent: '上传一张图片，自动提取主色，并生成可直接粘贴到工程的 CSS 变量 / Tailwind / SCSS / JSON 配色。图片仅在浏览器本地处理。',
    }),
    dropzone,
    fileInput,
    statusLine,
    h('div', { class: 'mt-6' }, [
      h('div', { class: 'mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '原图预览' }),
      previewWrap,
    ]),
    h('div', { class: 'mt-6' }, [controls]),
    h('div', { class: 'mt-8' }, [
      h('div', { class: 'mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '提取色板' }),
      colorsGrid,
      emptyHint,
    ]),
    h('div', { class: 'mt-8' }, [
      h('div', { class: 'mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '多格式输出' }),
      outputArea,
    ]),
  );

  // 恢复上次的提取结果（仅色值，不含图片）：色板与多格式输出直接用历史颜色渲染，
  // 用户重进即可看到上次的配色，无需重新上传图。新上传图后自然覆盖。
  const storedColors = loadColors();
  if (storedColors) {
    currentColors = storedColors.map(fromStored);
    // 提示来源：数据来自上次会话，原图未恢复（不可序列化）
    showStatus('已恢复上次的提取结果（原图需重新上传）');
    renderColors();
    renderOutput();
  }
}

renderColorExtractor();
