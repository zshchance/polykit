import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { createCopyButton } from '@/core/components/CopyButton';
import { downloadBlob } from '@/core/utils/clipboard';
import { loadImage, revokeImage, type LoadedImage } from './image';
import { convertToBlob, scaledSize } from './encode';
import { encodeIco } from './ico';
import { createCompareViewer } from './compare-viewer';
import { loadConfig, saveConfig } from './settings';
import { PRESETS } from './presets';
import { buildTakeoverPrompt, displayFormatName, type CurrentParams } from './ai-takeover';
import {
  FORMAT_OPTIONS,
  ICO_SIZE_OPTIONS,
  LONG_EDGE_OPTIONS,
  MIN_QUALITY,
  MAX_QUALITY,
  type CompressConfig,
  type CompareMode,
  type OutputFormat,
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
          'aria-label': `输出格式：${fo.name}`,
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
    'aria-label': '压缩强度',
    'aria-valuemin': String(MIN_QUALITY),
    'aria-valuemax': String(MAX_QUALITY),
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
    'aria-label': '最长边缩放上限',
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
          'aria-label': `ICO 尺寸：${size}px`,
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

  /**
   * 统一的"设置参数"入口：一次设好 format/quality/maxLongEdge（可选 icoSizes），
   * 同步刷新所有控件 UI（格式行、画质滑块、最长边下拉、ICO 行显隐）并触发重编码。
   *
   * 用途预设 chip 与全局 API (window.__IMG_COMPRESS__.applyPreset) 都走这里，
   * 保证行为一致——单一改动路径，避免散落在各 onclick 里。
   */
  function applyParams(
    format: OutputFormat,
    quality: number,
    maxLongEdge: number,
    icoSizes?: number[],
  ): void {
    cfg.format = format;
    cfg.quality = clampQ(quality);
    cfg.maxLongEdge = clampL(maxLongEdge);
    if (icoSizes && icoSizes.length > 0) cfg.icoSizes = icoSizes;

    // 同步控件显示值
    qualitySlider.value = String(cfg.quality);
    qualityValue.textContent = String(cfg.quality);
    longEdgeSelect.value = String(cfg.maxLongEdge);

    // 刷新派生 UI
    renderFormatRow();
    syncLossySensitiveControls();
    renderIcoSizes();
    syncFormatSensitiveWraps();

    scheduleEncode();
    persist();
  }

  // 局部钳制器（避免从 types 导入运行期函数造成循环）
  function clampQ(n: number): number {
    return Math.max(MIN_QUALITY, Math.min(MAX_QUALITY, Number.isFinite(n) ? Math.round(n) : 80));
  }
  function clampL(n: number): number {
    if (!Number.isFinite(n)) return 0;
    const v = Math.round(n);
    return v === 0 || (v >= 16 && v <= 8000) ? v : 0;
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

  // ────────── 用途预设行 ──────────
  // 参数区最前方：通用压缩 + 4 个预设 + 自己描述。
  // 点预设 → applyParams 一步设好参数；点自己描述 → 展开输入框 + 生成 AI 接管提示词。
  const purposeContainer = h('div', { class: 'flex flex-wrap gap-2' });
  let activePurposeId = 'general';

  // 自定义描述区（默认隐藏，点"自己描述"展开）
  const customWrap = h('div', { class: 'mt-3 space-y-2', style: 'display:none;' });
  const descInput = h('textarea', {
    class:
      'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
    rows: 3,
    placeholder: '描述你的用途，例如：给淘宝主图用，要清晰、保留商品细节；或：做微信文章里的配图，体积尽量小…',
    'aria-label': '用途描述',
  }) as HTMLTextAreaElement;

  function renderPurposeRow(): void {
    purposeContainer.replaceChildren(
      ...PRESETS.map((p) =>
        h('button', {
          type: 'button',
          'aria-pressed': String(activePurposeId === p.id),
          'aria-label': `用途：${p.label}`,
          title: p.hint,
          class: [
            'rounded-full px-3 py-1.5 text-xs font-medium border transition-all duration-150',
            activePurposeId === p.id
              ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)]'
              : 'bg-[var(--bg-elevated)] text-[var(--fg-muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
          ].join(' '),
          textContent: p.label,
          onclick: () => {
            activePurposeId = p.id;
            applyParams(p.format, p.quality, p.maxLongEdge);
            renderPurposeRow();
            customWrap.style.display = 'none'; // 选预设时收起自定义区
          },
        }),
      ),
      // 自己描述（非预设，单独样式提示其特殊性）
      h('button', {
        type: 'button',
        'aria-pressed': String(activePurposeId === 'custom'),
        'aria-label': '用途：自己描述（展开输入框，生成 AI 接管提示词）',
        title: '展开输入框，描述用途后生成可粘贴给 AI 浏览器的提示词',
        class: [
          'rounded-full px-3 py-1.5 text-xs font-medium border transition-all duration-150',
          activePurposeId === 'custom'
            ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)]'
            : 'bg-[var(--bg-elevated)] text-[var(--fg-muted)] border-dashed border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
        ].join(' '),
        textContent: '✍ 自己描述',
        onclick: () => {
          activePurposeId = 'custom';
          renderPurposeRow();
          customWrap.style.display = '';
          descInput.focus();
        },
      }),
    );
  }
  renderPurposeRow();

  // 接管提示词预览区（生成后才显示）
  const takeoverArea = h('div', { class: 'space-y-2' });

  function generateTakeover(): void {
    const text = buildTakeoverPrompt(descInput.value, snapshotParams(), location.href);
    const preview = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows: 12,
      readonly: true,
      'aria-label': 'AI 浏览器接管提示词',
    }) as HTMLTextAreaElement;
    preview.value = text;
    takeoverArea.replaceChildren(
      h('div', { class: 'rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4' }, [
        h('div', { class: 'flex items-center justify-between gap-2 mb-2' }, [
          h('span', { class: 'text-sm font-medium text-[var(--fg)]', textContent: '🤖 AI 浏览器接管提示词' }),
          createCopyButton(() => preview.value, '复制提示词', '已复制 ✓'),
        ]),
        preview,
        h('p', {
          class: 'mt-2 text-[11px] text-[var(--fg-muted)]',
          textContent: '复制后粘贴给 Tabbit 等 AI 浏览器，它会按提示词自动设置好上面的压缩参数（全程本地，图片不会上传）。',
        }),
      ]),
    );
  }

  const generateBtn = h('button', {
    type: 'button',
    class:
      'inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
    textContent: '🤖 生成 AI 接管提示词',
    onclick: generateTakeover,
  });

  customWrap.append(
    descInput,
    h('div', { class: 'flex items-center gap-2' }, [generateBtn]),
    takeoverArea,
  );

  // 当前参数快照（注入提示词）
  function snapshotParams(): CurrentParams {
    return {
      format: cfg.format,
      quality: cfg.quality,
      maxLongEdge: cfg.maxLongEdge,
      icoSizes: [...cfg.icoSizes],
    };
  }

  // ────────── JSON 快捷参数框（Alt+J 唤出，对 AI 浏览器友好）──────────
  // 设计动机：AI 浏览器（Tabbit 类）不支持控制台执行命令，可视化精确操作又慢。
  // 用快捷键唤出一个 JSON 输入框，AI 只需"填文本 + 按回车"即可精确设参，
  // 绕开它不擅长的可视化点击/拖拽。
  let jsonDialogEl: HTMLElement | null = null;

  function openJsonDialog(): void {
    if (jsonDialogEl) return; // 已打开则不重复唤出

    const presetText = JSON.stringify(snapshotParams(), null, 2);
    const ta = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-sm leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows: 8,
      spellcheck: false,
      'aria-label': '参数 JSON',
    }) as HTMLTextAreaElement;
    ta.value = presetText;

    const statusRow = h('div', { class: 'min-h-[1.25rem] text-xs' });

    function flashError(msg: string): void {
      statusRow.textContent = '⚠ ' + msg;
      statusRow.style.color = 'var(--holiday-legal)';
    }

    function submitJson(): void {
      let parsed: unknown;
      try {
        parsed = JSON.parse(ta.value);
      } catch {
        flashError('JSON 格式有误，请检查括号/引号/逗号。');
        return;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        flashError('需要是一个 JSON 对象，如 {"format":"webp","quality":80,"maxLongEdge":1080}');
        return;
      }
      const obj = parsed as Record<string, unknown>;
      // 字段校验 + 兜底（缺失/类型错用当前值）
      const fmt = typeof obj.format === 'string' && (obj.format === 'webp' || obj.format === 'jpeg' || obj.format === 'png' || obj.format === 'ico')
        ? (obj.format as OutputFormat)
        : cfg.format;
      const q = typeof obj.quality === 'number' && Number.isFinite(obj.quality) ? obj.quality : cfg.quality;
      const le = typeof obj.maxLongEdge === 'number' && Number.isFinite(obj.maxLongEdge) ? obj.maxLongEdge : cfg.maxLongEdge;
      let ico: number[] | undefined;
      if (Array.isArray(obj.icoSizes) && obj.icoSizes.every((v) => typeof v === 'number')) {
        ico = (obj.icoSizes as number[]).filter((v) => ICO_SIZE_OPTIONS.includes(v));
        if (ico.length === 0) ico = undefined;
      }

      applyParams(fmt, q, le, ico);
      closeJsonDialog();
      showStatus(`已按 JSON 设参：${displayFormatName(fmt)} / 画质 ${Math.round(q)} / 最长边 ${le === 0 ? '不缩放' : '≤' + le + 'px'}`);
    }

    // Enter 提交 / Shift+Enter 换行 / Esc 关闭
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitJson();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeJsonDialog();
      }
    });

    const card = h('div', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '参数 JSON 快捷输入',
      class:
        'w-[min(92vw,34rem)] rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-2xl',
    }, [
      h('div', { class: 'mb-1 flex items-center justify-between gap-2' }, [
        h('span', { class: 'text-sm font-semibold text-[var(--fg)]', textContent: '⌨ 参数 JSON 快捷输入' }),
        h('span', { class: 'text-[11px] text-[var(--fg-muted)]', textContent: '回车提交 · Shift+回车换行 · Esc 关闭' }),
      ]),
      h('p', {
        class: 'mb-2 text-xs text-[var(--fg-muted)]',
        textContent: '合法字段：format(webp/jpeg/png/ico) · quality(1-100) · maxLongEdge(0=不缩放) · icoSizes(可选)。缺失字段沿用当前值。',
      }),
      ta,
      statusRow,
      h('div', { class: 'mt-3 flex items-center justify-end gap-2' }, [
        h('button', {
          type: 'button',
          class: 'rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--fg-muted)] hover:border-[var(--accent)] transition-colors',
          textContent: '取消',
          onclick: () => closeJsonDialog(),
        }),
        h('button', {
          type: 'button',
          class: 'rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
          textContent: '应用参数',
          onclick: submitJson,
        }),
      ]),
    ]);

    // 遮罩：点击空白关闭
    const overlay = h('div', {
      class: 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4',
      onclick: (e: Event) => {
        if (e.target === overlay) closeJsonDialog();
      },
    });
    overlay.append(card);

    document.body.append(overlay);
    jsonDialogEl = overlay;
    // 自动聚焦输入框并全选，方便直接覆盖粘贴
    requestAnimationFrame(() => {
      ta.focus();
      ta.select();
    });
  }

  function closeJsonDialog(): void {
    if (!jsonDialogEl) return;
    jsonDialogEl.remove();
    jsonDialogEl = null;
  }

  // 全局快捷键：Alt+J（macOS Option+J）唤出 JSON 框
  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'j' || e.key === 'J')) {
      e.preventDefault();
      openJsonDialog();
    }
  });


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
      // 用途预设行（参数区最前方）
      h('div', { class: 'space-y-1.5' }, [
        h('div', { class: 'flex items-center justify-between gap-2' }, [
          h('span', { class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '用途（一键预设参数）' }),
          h('button', {
            type: 'button',
            title: '弹出参数 JSON 输入框（快捷键 Alt+J），粘贴 JSON 回车即可精确设参',
            'aria-label': '快捷输入参数 JSON（Alt+J）',
            class: 'inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
            textContent: '⌨ 快捷输入',
            onclick: openJsonDialog,
          }),
        ]),
        purposeContainer,
        customWrap,
      ]),
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

  // ────────── 全局脚本 API（供 AI 浏览器确定性操作）──────────
  // 挂到 window.__IMG_COMPRESS__，让 Tabbit 等 AI 浏览器可一步设好参数，
  // 配合页面 aria-label 形成双通道（脚本优先，ARIA 备选）。仅本工具页面存在。
  (window as unknown as { __IMG_COMPRESS__: unknown }).__IMG_COMPRESS__ = {
    /** 一步设好 format/quality/maxLongEdge（可选 icoSizes）并触发重编码 */
    applyPreset: (format: OutputFormat, quality: number, maxLongEdge: number, icoSizes?: number[]) =>
      applyParams(format, quality, maxLongEdge, icoSizes),
    /** 读取当前参数快照（供 AI 校验设置是否生效） */
    getParams: () => snapshotParams(),
  };
}

renderImageCompress();
