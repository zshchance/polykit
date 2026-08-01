import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import {
  DOT_SHAPES,
  EYE_SHAPES,
  ERROR_LEVELS,
  type QrConfig,
  type DotShape,
  type EyeShape,
} from './types';
import { buildModules, drawQr } from './render';
import { decodeQr, decodeFailReason } from './decode';
import { decodeImage, decodeBitmap } from './image';
import { loadConfig, saveConfig } from './settings';
import { downloadCanvasPng, copyCanvasToClipboard, safeFilename } from './export';

initTheme();

/**
 * 二维码生成器 —— 输入内容 → 实时预览 → 美化 → 导出。
 *
 * 布局（左控制 / 右预览，窄屏堆叠）：
 *   左：内容输入、码点形状、定位眼形状、纠错等级、前景/背景色、Logo 上传与开关
 *   右：实时预览 canvas + 上传已有二维码解码美化 + 导出 PNG / 复制
 *
 * 任何配置或内容变化都触发防抖重绘。Logo 上传后缓存 ImageBitmap，
 * 开关切换不重复解码。上传二维码图片 → jsQR 解码 → 回填内容并用当前风格重绘。
 */
function renderQrCode(): void {
  const { content } = renderToolLayout(document.getElementById('app')!, '二维码生成器');

  const cfg: QrConfig = loadConfig();
  let logoBitmap: ImageBitmap | null = null; // Logo 缓存，关闭开关不丢
  let lastCanvas: HTMLCanvasElement | null = null; // 供导出复用

  function persist(): void {
    saveConfig(cfg);
  }

  // ────────── 预览区 ──────────
  const previewWrap = h('div', {
    class: 'flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-6 min-h-[320px]',
  });
  const statusLine = h('div', { class: 'min-h-[1.25rem] text-xs text-[var(--fg-muted)] text-center' });

  /** 防抖重绘 */
  let drawTimer: number | undefined;
  function scheduleDraw(): void {
    clearTimeout(drawTimer);
    drawTimer = window.setTimeout(() => void redraw(), 80);
  }

  async function redraw(): Promise<void> {
    const text = cfg.text.trim();
    if (!text) {
      previewWrap.replaceChildren(
        h('div', { class: 'text-sm text-[var(--fg-muted)]', textContent: '输入内容后这里会显示二维码' }),
      );
      lastCanvas = null;
      return;
    }
    showStatus('生成中…');
    try {
      const modules = await buildModules(text, cfg.errorLevel);
      const { canvas } = drawQr(modules, cfg, logoBitmap, 1024);
      // 预览缩放：CSS 限制最大 320px，保持像素高清
      canvas.style.maxWidth = '320px';
      canvas.style.height = 'auto';
      canvas.style.width = '100%';
      previewWrap.replaceChildren(canvas);
      lastCanvas = canvas;
      showStatus('');
    } catch (err) {
      previewWrap.replaceChildren(
        h('div', { class: 'px-4 text-center text-sm text-[var(--holiday-legal)]', textContent: err instanceof Error ? err.message : '生成失败' }),
      );
      lastCanvas = null;
      showStatus('');
    }
  }

  // ────────── 左：控制面板 ──────────
  // 1. 内容输入
  const textInput = h('textarea', {
    class:
      'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
    rows: 3,
    placeholder: '输入网址或文本，如 https://example.com',
  }) as HTMLTextAreaElement;
  textInput.value = cfg.text;
  textInput.addEventListener('input', () => {
    cfg.text = textInput.value;
    scheduleDraw();
    persist();
  });

  // 2. 码点形状选择
  const dotRow = shapeRow(DOT_SHAPES, cfg.dotShape, (id) => {
    cfg.dotShape = id as DotShape;
    scheduleDraw();
    persist();
  });

  // 3. 定位眼形状
  const eyeRow = shapeRow(EYE_SHAPES, cfg.eyeShape, (id) => {
    cfg.eyeShape = id as EyeShape;
    scheduleDraw();
    persist();
  });

  // 4. 纠错等级 —— 用 levelContainer + renderLevelRow（定义在下方，需在 Logo 自动升级后重渲）
  //    此处先不创建，统一交给下方的 levelContainer。

  // 5. 前景 / 背景色
  const fgInput = colorInput('码点颜色', cfg.fgColor, (v) => {
    cfg.fgColor = v;
    scheduleDraw();
    persist();
  });
  const bgInput = colorInput('背景颜色', cfg.bgColor, (v) => {
    cfg.bgColor = v;
    scheduleDraw();
    persist();
  });

  // 6. Logo 上传与开关
  const logoToggle = h('input', { type: 'checkbox', class: 'accent-[var(--accent)] h-4 w-4' }) as HTMLInputElement;
  logoToggle.checked = cfg.withLogo;
  logoToggle.addEventListener('change', () => {
    cfg.withLogo = logoToggle.checked;
    if (cfg.withLogo && !logoBitmap) {
      // 开了但没图，提示上传
      showStatus('请先上传 Logo 图片', false);
    }
    scheduleDraw();
    persist();
  });
  const logoBtn = h('button', {
    type: 'button',
    class: 'rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--fg)] hover:border-[var(--accent)] transition-colors',
    textContent: logoBitmap ? '更换 Logo' : '上传 Logo',
    onclick: () => logoInput.click(),
  });
  const logoInput = h('input', { type: 'file', accept: 'image/*', class: 'hidden' }) as HTMLInputElement;
  logoInput.addEventListener('change', async () => {
    const f = logoInput.files?.[0];
    if (!f) return;
    try {
      logoBitmap = await decodeBitmap(f);
      cfg.withLogo = true;
      logoToggle.checked = true;
      logoBtn.textContent = '更换 Logo';
      // 嵌 Logo 自动建议升到 Q 级纠错（若当前低于 Q）
      if (cfg.errorLevel === 'L' || cfg.errorLevel === 'M') {
        cfg.errorLevel = 'Q';
        // 同步纠错选择器高亮
        renderLevelRow();
      }
      scheduleDraw();
      persist();
      showStatus('Logo 已加载，纠错已提升至 Q 级', false);
    } catch (err) {
      showStatus(err instanceof Error ? err.message : 'Logo 加载失败', true);
    }
    logoInput.value = '';
  });
  const clearLogoBtn = h('button', {
    type: 'button',
    class: 'rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--holiday-legal)] transition-colors',
    textContent: '移除',
    onclick: () => {
      logoBitmap?.close();
      logoBitmap = null;
      cfg.withLogo = false;
      logoToggle.checked = false;
      logoBtn.textContent = '上传 Logo';
      scheduleDraw();
      persist();
    },
  });

  // 纠错行需要在 Logo 自动升级后重渲高亮：用一个固定容器，重渲时换其内容
  const levelContainer = h('div', { class: 'flex flex-wrap gap-2' });
  function renderLevelRow(): void {
    levelContainer.replaceChildren(
      ...ERROR_LEVELS.map((lv) =>
        h('button', {
          type: 'button',
          'aria-pressed': String(lv.id === cfg.errorLevel),
          class: [
            'rounded-md px-3 py-1.5 text-sm border transition-all duration-150',
            lv.id === cfg.errorLevel
              ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)]'
              : 'bg-[var(--bg-elevated)] text-[var(--fg-muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
          ].join(' '),
          title: lv.desc,
          textContent: lv.name,
          onclick: () => {
            cfg.errorLevel = lv.id;
            renderLevelRow();
            scheduleDraw();
            persist();
          },
        }),
      ),
    );
  }

  // ────────── 上传已有二维码解码美化 ──────────
  const decodeDrop = h('div', {
    role: 'button',
    tabindex: '0',
    'aria-label': '上传二维码图片识别',
    class:
      'flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-5 text-center cursor-pointer transition-colors hover:border-[var(--accent)] focus:outline-none focus-visible:border-[var(--accent)]',
  }, [
    h('div', { class: 'text-xl', textContent: '📥' }),
    h('div', { class: 'text-xs font-medium text-[var(--fg)]', textContent: '上传已有二维码 → 识别内容并用当前风格重绘' }),
  ]);
  const decodeInput = h('input', { type: 'file', accept: 'image/*', class: 'hidden' }) as HTMLInputElement;
  decodeDrop.addEventListener('click', () => decodeInput.click());
  decodeDrop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      decodeInput.click();
    }
  });
  decodeInput.addEventListener('change', async () => {
    const f = decodeInput.files?.[0];
    if (!f) return;
    await handleDecode(f);
    decodeInput.value = '';
  });
  // 支持拖入
  decodeDrop.addEventListener('dragover', (e) => {
    e.preventDefault();
    decodeDrop.classList.add('qr-drop-dragover');
  });
  decodeDrop.addEventListener('dragleave', () => decodeDrop.classList.remove('qr-drop-dragover'));
  decodeDrop.addEventListener('drop', async (e) => {
    e.preventDefault();
    decodeDrop.classList.remove('qr-drop-dragover');
    const f = e.dataTransfer?.files?.[0];
    if (f) await handleDecode(f);
  });

  async function handleDecode(file: File): Promise<void> {
    showStatus('正在识别…');
    try {
      const img = await decodeImage(file);
      URL.revokeObjectURL(img.previewUrl);
      const res = decodeQr(img.data, img.width, img.height);
      img.bitmap.close();
      if (!res.text) {
        showStatus(decodeFailReason(), true);
        return;
      }
      // 回填内容并重绘（用当前风格美化）
      cfg.text = res.text;
      textInput.value = res.text;
      await redraw();
      persist();
      showStatus(`已识别（版本 ${res.version}）并用当前风格重绘`, false);
    } catch (err) {
      showStatus(err instanceof Error ? err.message : '识别失败', true);
    }
  }

  // ────────── 导出 ──────────
  const downloadBtn = h('button', {
    type: 'button',
    class: 'inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
    textContent: '⬇ 下载 PNG',
    onclick: () => {
      if (!lastCanvas) {
        showStatus('请先生成二维码', true);
        return;
      }
      downloadCanvasPng(lastCanvas, safeFilename(cfg.text));
      showStatus('已下载', false);
    },
  });
  const copyBtn = h('button', {
    type: 'button',
    class: 'inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2 text-sm text-[var(--fg)] hover:border-[var(--accent)] transition-colors',
    textContent: '⧉ 复制图片',
    onclick: async () => {
      if (!lastCanvas) {
        showStatus('请先生成二维码', true);
        return;
      }
      const ok = await copyCanvasToClipboard(lastCanvas);
      showStatus(ok ? '已复制到剪贴板' : '当前浏览器不支持复制图片，请用下载', !ok);
    },
  });

  // ────────── 状态提示 ──────────
  let statusTimer: number | undefined;
  function showStatus(msg: string, isError = false): void {
    clearTimeout(statusTimer);
    statusLine.textContent = msg;
    statusLine.style.color = isError ? 'var(--holiday-legal)' : 'var(--fg-muted)';
    if (!isError && msg) {
      statusTimer = window.setTimeout(() => {
        statusLine.textContent = '';
      }, 2500);
    }
  }

  // ────────── 装配 ──────────
  renderLevelRow();

  const controls = h('div', { class: 'space-y-5' }, [
    field('内容', textInput),
    field('码点形状', dotRow),
    field('定位眼形状', eyeRow),
    field('纠错等级', levelContainer),
    h('div', { class: 'grid grid-cols-2 gap-3' }, [field('码点颜色', fgInput), field('背景颜色', bgInput)]),
    h('div', { class: 'space-y-2' }, [
      h('div', { class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '中心 Logo' }),
      h('div', { class: 'flex items-center gap-3' }, [
        h('label', { class: 'flex items-center gap-2 text-sm text-[var(--fg)]' }, [
          logoToggle,
          h('span', { textContent: '嵌入 Logo' }),
        ]),
        logoBtn,
        clearLogoBtn,
        logoInput,
      ]),
    ]),
  ]);

  const previewCol = h('div', { class: 'space-y-4' }, [
    previewWrap,
    statusLine,
    h('div', { class: 'flex flex-wrap justify-center gap-2' }, [downloadBtn, copyBtn]),
    h('div', { class: 'mt-4' }, [
      h('div', { class: 'mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '美化已有二维码' }),
      decodeDrop,
      decodeInput,
    ]),
  ]);

  content.append(
    h('p', {
      class: 'mb-6 text-sm text-[var(--fg-muted)]',
      textContent: '生成可定制风格的二维码：圆点/圆角码点、定位眼形状、自定义配色、中心 Logo。也可上传已有二维码识别后用当前风格美化重绘。全程本地处理。',
    }),
    h('div', { class: 'grid gap-6 lg:grid-cols-2' }, [controls, previewCol]),
  );

  // 初始绘制
  void redraw();
}

/** 形状/等级选择行：一组胶囊按钮，选中高亮 */
function shapeRow(
  items: { id: string; name: string }[],
  selectedId: string,
  onSelect: (id: string) => void,
): HTMLElement {
  const wrap = h('div', { class: 'flex flex-wrap gap-2' });
  function render(): void {
    wrap.replaceChildren(
      ...items.map((it) =>
        h('button', {
          type: 'button',
          'aria-pressed': String(it.id === selectedId),
          class: [
            'rounded-md px-3 py-1.5 text-sm border transition-all duration-150',
            it.id === selectedId
              ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)]'
              : 'bg-[var(--bg-elevated)] text-[var(--fg-muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)]',
          ].join(' '),
          textContent: it.name,
          onclick: () => {
            selectedId = it.id; // 闭包变量更新，下次 render 用新值
            render();
            onSelect(it.id);
          },
        }),
      ),
    );
  }
  render();
  return wrap;
}

/** 颜色输入：色块 + hex 文本框 */
function colorInput(label: string, value: string, onChange: (v: string) => void): HTMLElement {
  const picker = h('input', {
    type: 'color',
    value: value || '#ffffff',
    class: 'h-8 w-10 cursor-pointer rounded border border-[var(--border)] bg-transparent',
  }) as HTMLInputElement;
  const text = h('input', {
    type: 'text',
    value,
    placeholder: '#000000 或留空透明',
    class:
      'w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 font-mono text-xs text-[var(--fg)] outline-none focus:border-[var(--accent)]',
  }) as HTMLInputElement;
  picker.addEventListener('input', () => {
    text.value = picker.value;
    onChange(picker.value);
  });
  text.addEventListener('change', () => {
    const v = text.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v) || v === '') {
      if (v) picker.value = v;
      onChange(v);
    } else {
      text.value = value; // 非法还原
    }
  });
  return h('div', { class: 'space-y-1' }, [
    h('label', { class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: label }),
    h('div', { class: 'flex items-center gap-2' }, [picker, text]),
  ]);
}

/** 带 label 的小字段 */
function field(label: string, control: HTMLElement): HTMLElement {
  return h('div', { class: 'space-y-1.5' }, [
    h('div', { class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: label }),
    control,
  ]);
}

renderQrCode();
