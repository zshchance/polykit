import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { downloadBlob } from '@/core/utils/clipboard';
import { loadImage, revokeImage, type LoadedImage } from './image';
import { convertToBlob, scaledSize } from './encode';
import { encodeIco } from './ico';
import { createCompareViewer } from './compare-viewer';
import { loadConfig, saveConfig } from './settings';
import {
  FORMAT_OPTIONS,
  ICO_SIZE_OPTIONS,
  LONG_EDGE_OPTIONS,
  MIN_QUALITY,
  MAX_QUALITY,
  type CompressConfig,
  type CompareMode,
} from './types';

initTheme();

/**
 * 图片压缩转换 —— 上传图 → 选格式/画质/尺寸 → 实时编码 → 对比预览 → 下载。
 *
 * 布局（自上而下）：
 *   1. 拖拽/选择区
 *   2. 控件区：输出格式（segmented）、画质滑块（仅 lossy）、最长边（select）、ICO 尺寸（toggle）
 *   3. 对比预览器（模式 segmented：原图/对比/输出，默认对比；鼠标滑动分割线）
 *   4. 统计：原图大小 → 输出大小 / 节省 % / 尺寸
 *   5. 下载按钮
 *
 * 状态：cfg（参数，持久化）+ image（原图，不持久化）。
 * 任一参数变更 → 防抖重新编码 → 刷新预览输出层 + 统计 + 下载按钮。
 * 数据全程本地，不上传。
 */
function renderImageCompress(): void {
  const { content } = renderToolLayout(document.getElementById('app')!, '图片压缩转换');

  const restored = loadConfig();
  const cfg: CompressConfig = { ...restored };
  let image: LoadedImage | null = null;
  // 当前输出（编码结果）；null 表示尚未编码 / 编码中 / 失败
  let outBlob: Blob | null = null;
  let outUrl: string | null = null;
  let outWidth = 0;
  let outHeight = 0;
  let encodeToken = 0; // 防止旧编码覆盖新结果

  function persist(): void {
    saveConfig({ ...cfg });
  }

  // ────────── 工具函数 ──────────
  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }
  function currentFormatOpt() {
    return FORMAT_OPTIONS.find((f) => f.id === cfg.format) ?? FORMAT_OPTIONS[0]!;
  }
  function isLossy(): boolean {
    return currentFormatOpt().lossy;
  }

  // ────────── 1. 拖拽/选择区 ──────────
  const dropzone = h('div', {
    role: 'button',
    tabindex: '0',
    'aria-label': '选择或拖入图片',
    class:
      'flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--bg-elevated)] px-6 py-12 text-center cursor-pointer transition-colors hover:border-[var(--accent)] focus:outline-none focus-visible:border-[var(--accent)]',
  }, [
    h('div', { class: 'text-3xl', textContent: '🗜️' }),
    h('div', { class: 'text-sm font-medium text-[var(--fg)]', textContent: '点击选择图片，或拖拽到此处' }),
    h('div', { class: 'text-xs text-[var(--fg-muted)]', textContent: '支持 PNG / JPG / WebP / GIF，可输出 ICO。图片仅在本地处理，不会上传' }),
  ]);
  const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'hidden' }) as HTMLInputElement;
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

  // ────────── 状态行 ──────────
  const statusLine = h('div', { class: 'min-h-[1.25rem] text-xs text-[var(--fg-muted)]' });
  function showStatus(msg: string, isError = false): void {
    statusLine.textContent = msg;
    statusLine.style.color = isError ? 'var(--holiday-legal)' : 'var(--fg-muted)';
  }
  function showError(msg: string): void {
    showStatus('⚠ ' + msg, true);
  }

  // ────────── 2. 控件区 ──────────

  // 2a. 输出格式 segmented
  const formatContainer = h('div', { class: 'flex flex-wrap gap-2' });
  function renderFormatRow(): void {
    formatContainer.replaceChildren(
      ...FORMAT_OPTIONS.map((fo) => {
        const active = fo.id === cfg.format;
        return h('button', {
          type: 'button',
          'aria-pressed': String(active),
          title: fo.hint,
          class: [
            'rounded-md px-3 py-1.5 text-sm border transition-all duration-150',
            active
              ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)]'
              : 'bg-[var(--bg-elevated)] text-[var(--fg-muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
          ].join(' '),
          textContent: fo.name,
          onclick: () => {
            cfg.format = fo.id;
            renderFormatRow();
            syncLossySensitiveControls();
            scheduleEncode();
            persist();
          },
        });
      }),
    );
  }

  // 2b. 画质滑块（仅 lossy 可调；PNG/ICO 无损，禁用并提示）
  const qualityValue = h('span', { class: 'text-sm font-medium text-[var(--fg)]', textContent: `${cfg.quality}` });
  const qualitySlider = h('input', {
    type: 'range',
    min: String(MIN_QUALITY),
    max: String(MAX_QUALITY),
    step: '1',
    value: String(cfg.quality),
    class: 'image-compress-range w-full',
  }) as HTMLInputElement;
  qualitySlider.addEventListener('input', () => {
    cfg.quality = Number(qualitySlider.value);
    qualityValue.textContent = String(cfg.quality);
    scheduleEncode();
    persist();
  });
  const qualityHint = h('div', { class: 'text-xs text-[var(--fg-muted)]' });
  const qualityWrap = h('div', { class: 'space-y-1.5' }, [
    h('div', { class: 'mb-1 flex items-center justify-between' }, [
      h('span', { class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '压缩强度' }),
      qualityValue,
    ]),
    qualitySlider,
    qualityHint,
  ]);

  function syncLossySensitiveControls(): void {
    const lossy = isLossy();
    qualitySlider.disabled = !lossy;
    qualitySlider.style.opacity = lossy ? '' : '0.5';
    qualitySlider.style.cursor = lossy ? 'pointer' : 'not-allowed';
    qualityHint.textContent = lossy
      ? `数值越低体积越小（画质越低）。${currentFormatOpt().hint}`
      : `${currentFormatOpt().name} 为无损格式，压缩强度不可调。${currentFormatOpt().hint}`;
  }

  // 2c. 最长边 select
  const longEdgeSelect = h('select', {
    class:
      'rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
  }) as HTMLSelectElement;
  longEdgeSelect.append(
    ...LONG_EDGE_OPTIONS.map((v) => {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = v === 0 ? '原始尺寸（不缩放）' : `≤ ${v}px`;
      return o;
    }),
  );
  longEdgeSelect.value = String(cfg.maxLongEdge);
  longEdgeSelect.addEventListener('change', () => {
    cfg.maxLongEdge = Number(longEdgeSelect.value);
    scheduleEncode();
    persist();
  });

  // 2d. ICO 尺寸 toggle（仅 ICO 显示）
  const icoSizesContainer = h('div', { class: 'flex flex-wrap gap-2' });
  function renderIcoSizes(): void {
    icoSizesContainer.replaceChildren(
      ...ICO_SIZE_OPTIONS.map((size) => {
        const active = cfg.icoSizes.includes(size);
        return h('button', {
          type: 'button',
          'aria-pressed': String(active),
          class: [
            'rounded-md px-2.5 py-1 text-xs border transition-all duration-150',
            active
              ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)]'
              : 'bg-[var(--bg-elevated)] text-[var(--fg-muted)] border-[var(--border)] hover:border-[var(--accent)]',
          ].join(' '),
          textContent: `${size}`,
          title: `${size}×${size}`,
          onclick: () => {
            if (active) {
              if (cfg.icoSizes.length <= 1) return; // 至少保留一个
              cfg.icoSizes = cfg.icoSizes.filter((s) => s !== size);
            } else {
              cfg.icoSizes = [...cfg.icoSizes, size].sort((a, b) => a - b);
            }
            renderIcoSizes();
            scheduleEncode();
            persist();
          },
        });
      }),
    );
  }
  const icoSizesWrap = h('div', { class: 'space-y-1.5' }, [
    h('span', { class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: 'ICO 尺寸（可多选）' }),
    icoSizesContainer,
  ]);

  // 2e. 预览模式 segmented
  const modeContainer = h('div', { class: 'flex flex-wrap gap-2' });
  const MODE_OPTIONS: { id: CompareMode; name: string }[] = [
    { id: 'original', name: '原图' },
    { id: 'compare', name: '对比' },
    { id: 'output', name: '输出' },
  ];
  function renderModeRow(): void {
    modeContainer.replaceChildren(
      ...MODE_OPTIONS.map((m) => {
        const active = m.id === cfg.mode;
        return h('button', {
          type: 'button',
          'aria-pressed': String(active),
          class: [
            'rounded-md px-3 py-1.5 text-sm border transition-all duration-150',
            active
              ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)]'
              : 'bg-[var(--bg-elevated)] text-[var(--fg-muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
          ].join(' '),
          textContent: m.name,
          onclick: () => {
            cfg.mode = m.id;
            viewer.setMode(m.id);
            renderModeRow();
            persist();
          },
        });
      }),
    );
  }

  // ────────── 3. 对比预览器 ──────────
  const viewer = createCompareViewer();

  // ────────── 4. 统计 + 下载 ──────────
  const statsLine = h('div', { class: 'min-h-[1.25rem] text-xs text-[var(--fg-muted)]' });
  const downloadBtn = h('button', {
    type: 'button',
    disabled: true,
    class:
      'inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed',
    textContent: '⬇ 下载输出',
    onclick: () => {
      if (!outBlob || !image) return;
      const ext = currentFormatOpt().ext;
      const base = image.name.replace(/\.[^.]+$/, '') || 'image';
      downloadBlob(outBlob, `${base}.${ext}`);
      showStatus(`已下载 ${base}.${ext}`);
    },
  });

  function updateStats(): void {
    if (!image) {
      statsLine.textContent = '';
      return;
    }
    if (!outBlob) {
      statsLine.textContent = `原图：${formatBytes(image.bytes)} · ${image.width}×${image.height}`;
      return;
    }
    const saved = image.bytes - outBlob.size;
    const pct = image.bytes > 0 ? (saved / image.bytes) * 100 : 0;
    const savedTxt =
      outBlob.size < image.bytes
        ? `↓ ${pct.toFixed(1)}%（省 ${formatBytes(Math.max(0, saved))}）`
        : `↑ ${Math.abs(pct).toFixed(1)}%（输出比原图大 ${formatBytes(-saved)}）`;
    statsLine.textContent =
      `${formatBytes(image.bytes)} → ${formatBytes(outBlob.size)} · ${savedTxt} · 输出 ${outWidth}×${outHeight}`;
  }

  // ────────── 核心流程 ──────────
  async function handleFile(file: File): Promise<void> {
    showStatus('正在解码…');
    try {
      // 释放上一张
      if (image) revokeImage(image);
      if (outUrl) URL.revokeObjectURL(outUrl);
      image = await loadImage(file);
      outBlob = null;
      outUrl = null;
      viewer.setImages(image.url, null);
      viewer.setMode(cfg.mode);
      syncPreviewVisibility(); // 有图了：显示预览区
      updateStats();
      showStatus(`已加载 ${image.name}（${image.width}×${image.height}）`);
      void encode(); // 立即编码一次
    } catch (err) {
      image = null;
      viewer.setImages(null, null);
      syncPreviewVisibility(); // 无图：隐藏预览区
      showError(err instanceof Error ? err.message : '加载失败');
    }
  }

  // 防抖重编码：参数频繁变动时只跑最后一次
  let encodeTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleEncode(): void {
    if (!image) return;
    if (encodeTimer) clearTimeout(encodeTimer);
    encodeTimer = setTimeout(() => {
      void encode();
    }, 150);
  }

  async function encode(): Promise<void> {
    if (!image) return;
    const token = ++encodeToken;
    showStatus('正在编码…');
    try {
      const result =
        cfg.format === 'ico'
          ? { blob: await encodeIco(image.bitmap, cfg.icoSizes), width: 0, height: 0 }
          : await convertToBlob(image.bitmap, {
              format: cfg.format,
              quality: cfg.quality,
              maxLongEdge: cfg.maxLongEdge,
            });

      // 旧编码结果丢弃（参数可能已再变）
      if (token !== encodeToken) return;

      if (outUrl) URL.revokeObjectURL(outUrl);
      outBlob = result.blob;
      outUrl = URL.createObjectURL(result.blob);
      if (cfg.format === 'ico') {
        outWidth = cfg.icoSizes[0] ?? 0;
        outHeight = outWidth;
      } else {
        const s = scaledSize(image.width, image.height, cfg.maxLongEdge);
        outWidth = s.w;
        outHeight = s.h;
      }
      viewer.setImages(image.url, outUrl);
      downloadBtn.disabled = false;
      updateStats();
      showStatus(`已生成 ${currentFormatOpt().name}${cfg.format === 'ico' ? `（${cfg.icoSizes.join('/')}px）` : ''}`);
    } catch (err) {
      if (token !== encodeToken) return;
      outBlob = null;
      downloadBtn.disabled = true;
      updateStats();
      showError(err instanceof Error ? err.message : '编码失败');
    }
  }

  // ────────── 装配 ──────────
  renderFormatRow();
  syncLossySensitiveControls();
  renderIcoSizes();
  renderModeRow();
  viewer.setMode(cfg.mode);

  // ICO 尺寸行只在选 ICO 时显示
  function syncFormatSensitiveWraps(): void {
    icoSizesWrap.style.display = cfg.format === 'ico' ? '' : 'none';
  }
  syncFormatSensitiveWraps();
  // 包装 formatRow 的 onclick 以便切格式时也刷新 ICO 行显隐
  formatContainer.addEventListener('click', syncFormatSensitiveWraps);

  // 预览区显隐：未上传图时整块隐藏（预览标签 / 模式切换 / 画板 / 统计 / 下载 都无意义）。
  // 上传后显示，清空后再次隐藏。viewer 内部也会同步隐藏 stage（双重保险）。
  let previewWrap: HTMLElement | null = null;
  function syncPreviewVisibility(): void {
    if (previewWrap) previewWrap.style.display = image ? '' : 'none';
  }

  content.append(
    h('p', {
      class: 'mb-5 text-sm text-[var(--fg-muted)]',
      textContent: '上传图片，自定义压缩强度与输出格式（支持转 ICO 图标）。左右滑动鼠标对比压缩前后效果，全部在浏览器本地完成。',
    }),
    dropzone,
    fileInput,
    statusLine,
    // 控件区
    h('div', { class: 'mt-6 space-y-5' }, [
      h('div', { class: 'space-y-1.5' }, [
        h('span', { class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '输出格式' }),
        formatContainer,
      ]),
      qualityWrap,
      h('div', { class: 'space-y-1.5' }, [
        h('span', { class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '最长边（缩放上限）' }),
        longEdgeSelect,
      ]),
      icoSizesWrap,
    ]),
    // 预览器 + 模式切换（未上传图时整块隐藏）
    (previewWrap = h('div', { class: 'mt-8 space-y-3' }, [
      h('div', { class: 'flex items-center justify-between gap-3 flex-wrap' }, [
        h('span', { class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '预览' }),
        modeContainer,
      ]),
      viewer.el,
      statsLine,
      downloadBtn,
    ])),
  );

  // 初次挂载时无图：隐藏预览区（上传后才显示）
  syncPreviewVisibility();
}

renderImageCompress();
