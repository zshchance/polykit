import '@/core/styles/main.css';
import { h } from '@/core/components/element';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import {
  DOT_SHAPES,
  EYE_SHAPES,
  ERROR_LEVELS,
  PRESETS,
  type QrConfig,
  type DotShape,
  type EyeShape,
  type LogoFit,
} from './types';
import { buildModules, drawQr } from './render';
import { detectAllQr, decodeFailReason, type DetectedCode } from './decode';
import { decodeImage, decodeBitmap } from './image';
import {
  loadConfig,
  saveConfig,
  loadLogoImage,
  saveLogoImage,
  loadDetectedImage,
  saveDetectedImage,
} from './settings';
import { bitmapToDataUrl, dataUrlToBitmap } from './storage-image';
import { downloadCanvasPng, copyCanvasToClipboard, safeFilename } from './export';
import { createCopyButton } from '@/core/components/CopyButton';
import {
  loadCustomStyles,
  addCustomStyle,
  removeCustomStyle,
  findCustomStyle,
  isCustomStyleId,
  compileDotEffect,
  dryRunCheck,
  buildAIPrompt,
  parseAIOutput,
  type DotEffectFn,
} from './custom-styles';

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
  // 当前激活的码点叠加钩子（来自 AI 风格的 dotEffectCode）。null=无叠加。
  // 由套用 AI 风格 / 切换内置预设 / 重进恢复 时设置；手动改颜色/形状不清空它。
  let activeDotEffect: DotEffectFn | null = null;

  // 多码识别结果：上传的图里可能含多个二维码（海报场景），记下全部供用户在下拉里选择
  let detectedCodes: DetectedCode[] = [];
  let selectedCodeIndex = 0; // 当前选中的第几个码（默认第一个）
  let detectedPreviewUrl: string | null = null; // 上传图预览 URL（用于在多码选择器旁显示）
  let detectedDataUrl: string | null = null; // 识别原图压缩后的 dataURL，持久化与切换选中时复用，避免重编码

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
      const { canvas } = drawQr(modules, cfg, logoBitmap, 1024, activeDotEffect);
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

  // 2. 码点形状选择（容器可重建，便于预设套用后同步视觉态）
  const dotRow = h('div', { class: 'flex flex-wrap gap-2' });
  function rebuildDotRow(): void {
    dotRow.replaceChildren(
      ...shapeRow(DOT_SHAPES, cfg.dotShape, (id) => {
        cfg.dotShape = id as DotShape;
        activePresetId = null;
        cfg.activeStyleId = null;
        rebuildDotRow();
        renderPresetRow();
        scheduleDraw();
        persist();
      }).childNodes,
    );
  }

  // 3. 定位眼形状
  const eyeRow = h('div', { class: 'flex flex-wrap gap-2' });
  function rebuildEyeRow(): void {
    eyeRow.replaceChildren(
      ...shapeRow(EYE_SHAPES, cfg.eyeShape, (id) => {
        cfg.eyeShape = id as EyeShape;
        activePresetId = null;
        cfg.activeStyleId = null;
        rebuildEyeRow();
        renderPresetRow();
        scheduleDraw();
        persist();
      }).childNodes,
    );
  }

  // 4. 纠错等级 —— 用 levelContainer + renderLevelRow（定义在下方，需在 Logo 自动升级后重渲）
  //    此处先不创建，统一交给下方的 levelContainer。

  // 5. 前景 / 背景色（保留 picker/text 引用，便于预设套用后同步）
  let fgPicker: HTMLInputElement;
  let fgText: HTMLInputElement;
  let bgPicker: HTMLInputElement;
  let bgText: HTMLInputElement;
  const fgInput = colorInput('码点颜色', cfg.fgColor, (v) => {
    cfg.fgColor = v;
    activePresetId = null;
    cfg.activeStyleId = null;
    renderPresetRow();
    scheduleDraw();
    persist();
  }, (p, t) => { fgPicker = p; fgText = t; });
  const bgInput = colorInput('背景颜色', cfg.bgColor, (v) => {
    cfg.bgColor = v;
    activePresetId = null;
    cfg.activeStyleId = null;
    renderPresetRow();
    scheduleDraw();
    persist();
  }, (p, t) => { bgPicker = p; bgText = t; });

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
      // 持久化 Logo 图（压缩成 dataURL），重进可恢复
      const url = await bitmapToDataUrl(logoBitmap);
      if (url) saveLogoImage(url);
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
      saveLogoImage(''); // 清除持久化的 Logo
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
      // detectAllQr 会就地修改像素缓冲（遮蔽已识别码），所以传一份副本，原像素留作预览
      const copy = new Uint8ClampedArray(img.data);
      const codes = detectAllQr(copy, img.width, img.height);
      detectedCodes = codes;
      selectedCodeIndex = 0;

      // 保留上传图预览 URL（之前 revoke 了，这里保留以便多码选择时看到原图）
      if (detectedPreviewUrl) URL.revokeObjectURL(detectedPreviewUrl);
      detectedPreviewUrl = img.previewUrl;

      // 持久化识别原图（压缩成 dataURL）+ 全部识别结果，重进可恢复下拉与选中项。
      // 编码与下方 applyDetected 复用同一份 dataUrl（存到 detectedDataUrl），避免重复编码。
      detectedDataUrl = await bitmapToDataUrl(img.bitmap);
      img.bitmap.close();

      if (codes.length === 0) {
        showStatus(decodeFailReason(), true);
        renderDecodeBar();
        return;
      }

      // 默认选中第一个并应用
      applyDetected(0);
      const more = codes.length > 1 ? `，共识别到 ${codes.length} 个，可在上方切换` : '';
      showStatus(`已识别（版本 ${codes[0]!.version}）${more}`, false);
    } catch (err) {
      showStatus(err instanceof Error ? err.message : '识别失败', true);
    }
  }

  /** 应用第 idx 个识别结果：回填内容 + 重绘 + 记住选中项 */
  async function applyDetected(idx: number): Promise<void> {
    const code = detectedCodes[idx];
    if (!code) return;
    selectedCodeIndex = idx;
    cfg.text = code.text;
    textInput.value = code.text;
    renderDecodeBar(); // 更新下拉选中态
    // 持久化：原图 dataUrl + 全部码 + 当前选中（重进恢复到同一个码）
    if (detectedDataUrl) saveDetectedImage(detectedDataUrl, detectedCodes, idx);
    await redraw();
    persist();
  }

  /**
   * 多码选择条：仅当识别到 ≥1 个码时显示。
   * - 1 个码：显示"识别到 1 个二维码"提示 + 原图缩略图
   * - 多个码：额外渲染一个 <select> 下拉，选项为"#1 内容预览…"，默认选中第一个
   * 切换下拉即切换处理的目标码。
   */
  const decodeBar = h('div', { class: 'space-y-2' });
  function renderDecodeBar(): void {
    decodeBar.replaceChildren();
    if (detectedCodes.length === 0) return;

    const header = h('div', { class: 'flex items-center justify-between gap-2' }, [
      h('span', {
        class: 'text-xs font-medium text-[var(--fg)]',
        textContent: detectedCodes.length > 1 ? `识别到 ${detectedCodes.length} 个二维码，选择要美化的` : '已识别二维码',
      }),
    ]);

    // 多个码：下拉选择
    if (detectedCodes.length > 1) {
      const sel = h('select', {
        class:
          'w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
        'aria-label': '选择要美化的二维码',
      }) as HTMLSelectElement;
      sel.append(
        ...detectedCodes.map((c, i) => {
          const opt = document.createElement('option');
          opt.value = String(i);
          // 选项文本：序号 + 内容预览（截断），方便用户区分多个码
          const preview = c.text.length > 40 ? c.text.slice(0, 40) + '…' : c.text;
          opt.textContent = `#${i + 1}  ${preview}`;
          return opt;
        }),
      );
      sel.value = String(selectedCodeIndex);
      sel.addEventListener('change', () => {
        void applyDetected(Number(sel.value));
      });
      decodeBar.append(header, sel);
    } else {
      decodeBar.append(header);
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

  // 预设模板：点击即套用（覆盖码点/眼/颜色/Logo形状），不动内容与纠错
  // AI 风格（自定义）追加在内置预设之后，带 ⭐ 前缀和删除按钮，额外携带码点叠加钩子。
  const presetRow = h('div', { class: 'flex flex-wrap gap-2' });
  let activePresetId: string | null = cfg.activeStyleId;
  let customStyles = loadCustomStyles();

  /** 套用一个预设（内置或自定义通用）：覆盖常规字段 + 同步控件 + 重绘。
   *  dotEffect 传 null 表示清除码点钩子（内置预设无钩子）；传函数表示挂载（AI 风格）。 */
  function applyStyle(id: string, apply: Partial<QrConfig>, dotEffect: DotEffectFn | null): void {
    activePresetId = id;
    cfg.activeStyleId = id;
    Object.assign(cfg, apply);
    activeDotEffect = dotEffect;
    syncControlsFromCfg();
    renderPresetRow();
    scheduleDraw();
    persist();
  }

  function renderPresetRow(): void {
    // 自定义列表每次重读，确保 AI 新增/删除后实时反映
    customStyles = loadCustomStyles();
    const items: Array<{
      id: string;
      name: string;
      swatch: [string, string];
      isCustom: boolean;
    }> = [
      ...PRESETS.map((p) => ({ id: p.id, name: p.name, swatch: p.swatch, isCustom: false })),
      ...customStyles.map((s) => ({ id: s.id, name: '⭐ ' + s.name, swatch: s.swatch, isCustom: true })),
    ];
    presetRow.replaceChildren(
      ...items.map((it) => {
        const isActive = it.id === activePresetId;
        // 外层用 div 容器（避免 button 嵌套 button 的非法 DOM）：
        // 内含一个套用主体 button + （仅 AI 风格）一个独立删除 button。
        const wrapper = h('div', {
          class: [
            'group flex items-center gap-0.5 rounded-lg border px-2.5 py-1.5 text-xs transition-all duration-150',
            isActive
              ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]/40'
              : 'border-[var(--border)] hover:border-[var(--accent)]',
          ].join(' '),
        });
        const main = h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(isActive),
            title: it.name,
            class: 'flex items-center gap-2 bg-transparent outline-none',
            onclick: () => {
              if (it.isCustom) {
                // AI 风格：套用 apply + 挂载其码点钩子（编译失败则降级为仅配色）
                const style = customStyles.find((s) => s.id === it.id);
                if (!style) return;
                let effect: DotEffectFn | null = null;
                if (style.dotEffectCode) {
                  try {
                    effect = compileDotEffect(style.dotEffectCode);
                  } catch {
                    showStatus('该风格的码点效果代码有误，已仅套用配色', true);
                  }
                }
                applyStyle(style.id, style.apply, effect);
              } else {
                // 内置预设：套用 apply + 清除码点钩子
                const p = PRESETS.find((x) => x.id === it.id);
                if (!p) return;
                applyStyle(p.id, p.apply, null);
              }
            },
          },
          [
            // 色条预览：前→背两小格
            h('span', { class: 'flex overflow-hidden rounded border border-[var(--border)]', style: 'width:22px;height:14px;' }, [
              h('span', { style: `flex:1;background:${it.swatch[0]};` }),
              h('span', { style: `flex:1;background:${it.swatch[1]};` }),
            ]),
            h('span', { class: 'text-[var(--fg)]', textContent: it.name }),
          ],
        );
        wrapper.append(main);
        // AI 风格额外挂一个删除小 ✕（独立 button，点 ✕ 不触发套用）
        if (it.isCustom) {
          const del = h('button', {
            type: 'button',
            'aria-label': `删除风格 ${it.name}`,
            title: '删除该 AI 风格',
            class:
              'ml-0.5 rounded text-[var(--fg-muted)] hover:text-[var(--holiday-legal)] transition-colors text-sm leading-none',
            textContent: '✕',
            onclick: (e: Event) => {
              e.stopPropagation();
              customStyles = removeCustomStyle(it.id);
              // 若删的正是激活项，清掉钩子与高亮
              if (activePresetId === it.id) {
                activePresetId = null;
                cfg.activeStyleId = null;
                activeDotEffect = null;
                persist();
                scheduleDraw();
              }
              renderPresetRow();
            },
          });
          wrapper.append(del);
        }
        return wrapper;
      }),
    );
  }

  // Logo 形状选择：圆角（默认）/ 直角
  const logoFitRow = h('div', { class: 'flex gap-2' });
  function renderLogoFitRow(): void {
    logoFitRow.replaceChildren(
      ...([
        { id: 'rounded' as LogoFit, name: '圆角（推荐）' },
        { id: 'square' as LogoFit, name: '直角' },
      ]).map((it) =>
        h('button', {
          type: 'button',
          'aria-pressed': String(it.id === cfg.logoFit),
          class: [
            'rounded-md px-3 py-1.5 text-xs border transition-all duration-150',
            it.id === cfg.logoFit
              ? 'bg-[var(--accent)] text-[var(--accent-fg)] border-[var(--accent)]'
              : 'bg-[var(--bg-elevated)] text-[var(--fg-muted)] border-[var(--border)] hover:border-[var(--accent)]',
          ].join(' '),
          textContent: it.name,
          onclick: () => {
            cfg.logoFit = it.id;
            renderLogoFitRow();
            scheduleDraw();
            persist();
          },
        }),
      ),
    );
  }

  /** 套用预设后，把各独立选择器（点/眼/颜色）的视觉态同步到 cfg 的新值 */
  function syncControlsFromCfg(): void {
    // 重新构建点/眼行（闭包 selectedId 已是参数，重渲染即可）
    rebuildDotRow();
    rebuildEyeRow();
    // 颜色输入框
    if (fgPicker) fgPicker.value = cfg.fgColor || '#ffffff';
    if (fgText) fgText.value = cfg.fgColor;
    if (bgPicker) bgPicker.value = cfg.bgColor || '#ffffff';
    if (bgText) bgText.value = cfg.bgColor;
    renderLogoFitRow();
  }

  // ────────── AI 风格助手模态（描述 → 生成提示词 → 粘代码保存）──────────
  // 交互同名言卡片的动效 AI：单实例 guard，三步逐步显现。
  let styleDialogEl: HTMLElement | null = null;

  function closeStyleDialog(): void {
    if (!styleDialogEl) return;
    styleDialogEl.remove();
    styleDialogEl = null;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onStyleDialogEsc);
  }
  function onStyleDialogEsc(e: KeyboardEvent): void {
    if (e.key === 'Escape' && styleDialogEl) {
      e.preventDefault();
      closeStyleDialog();
    }
  }
  function mountStyleDialog(card: HTMLElement): HTMLElement {
    const overlay = h('div', {
      class: 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4',
      onclick: (e: Event) => {
        if (e.target === overlay) closeStyleDialog();
      },
    });
    overlay.append(card);
    document.body.append(overlay);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onStyleDialogEsc);
    return overlay;
  }

  function openStyleHelpDialog(): void {
    if (styleDialogEl) closeStyleDialog();

    const statusRow = h('div', { class: 'min-h-[1.25rem] text-xs' });
    function flashError(msg: string): void {
      statusRow.textContent = msg ? '⚠ ' + msg : '';
      statusRow.style.color = 'var(--holiday-legal)';
    }
    function flashOk(msg: string): void {
      statusRow.textContent = '✓ ' + msg;
      statusRow.style.color = '#22c55e';
    }

    // 步骤 1：描述想要的风格
    const descInput = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows: 3,
      'aria-label': '想要的二维码风格描述',
      placeholder:
        '描述你想要的码点效果，例如：落雪效果，每个码点顶部像积了一层白雪；或：深蓝渐变底配金色圆点，像星空；或：每个码点带右下角高光，像有立体感。',
    }) as HTMLTextAreaElement;

    // 步骤 2：生成的提示词（点「生成」后才显示）
    const promptArea = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows: 8,
      readonly: true,
      'aria-label': '生成的 AI 提示词',
    }) as HTMLTextAreaElement;
    const step2 = h('div', { class: 'hidden space-y-2' }, [
      h('p', {
        class: 'text-xs leading-relaxed text-[var(--fg-muted)]',
        textContent:
          '把这段提示词复制到 ChatGPT、豆包、DeepSeek 等 AI 对话，AI 会返回一段「名称 + 配色 + 代码」。把 AI 的整段回复粘到下面框里，点保存即可。',
      }),
      promptArea,
      h('div', { class: 'flex items-center justify-end' }, [
        createCopyButton(() => promptArea.value, '📋 复制提示词', '已复制 ✓'),
      ]),
    ]);

    // 步骤 3：粘贴 AI 返回的代码 + 保存
    const pasteInput = h('textarea', {
      class:
        'w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[var(--fg)] outline-none focus:border-[var(--accent)]',
      rows: 8,
      spellcheck: false,
      'aria-label': '粘贴 AI 返回的代码（含名称注释）',
      placeholder:
        '把 AI 的整段回复粘到这里（代码块首行形如「// 名称：冬日落雪」，其后可选「// 配色: ...」行，再后是 ```js 代码）。工具会自动识别。',
    }) as HTMLTextAreaElement;
    const step3 = h('div', { class: 'hidden space-y-2' }, [
      h('label', { class: 'block text-xs font-medium text-[var(--fg-muted)]', textContent: '③ 粘贴 AI 返回的代码（含名称注释）' }),
      pasteInput,
      h('div', { class: 'flex items-center justify-end gap-2' }, [
        h('button', {
          type: 'button',
          class: 'rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--fg-muted)] hover:border-[var(--accent)] transition-colors',
          textContent: '取消',
          onclick: closeStyleDialog,
        }),
        h('button', {
          type: 'button',
          class: 'rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
          textContent: '保存并应用',
          onclick: saveStyle,
        }),
      ]),
    ]);

    function generate(): void {
      const desc = descInput.value.trim();
      if (!desc) {
        flashError('请先描述你想要的风格。');
        descInput.focus();
        return;
      }
      flashError('');
      promptArea.value = buildAIPrompt(desc);
      step2.classList.remove('hidden');
      step3.classList.remove('hidden');
      promptArea.scrollTop = 0;
    }

    function saveStyle(): void {
      const parsed = parseAIOutput(pasteInput.value);
      if (!parsed.name) {
        flashError('没识别到风格名称——AI 返回的代码块首行应是「// 名称：冬日落雪」这样的注释。');
        pasteInput.focus();
        return;
      }
      if (!parsed.code) {
        flashError('没识别到代码——请把 AI 的整段回复（含 ```js 代码块）粘进来。');
        pasteInput.focus();
        return;
      }
      // 保存前在离屏 canvas 试跑，拦截语法/运行时错误
      const check = dryRunCheck(parsed.code);
      if (!check.ok) {
        flashError(check.reason ?? '代码有问题，无法保存。');
        return;
      }
      // 保存：名称 + 配色 + 码点代码。swatch 由配色推一个色条。
      const list = addCustomStyle({
        name: parsed.name,
        apply: parsed.apply,
        dotEffectCode: parsed.code,
        swatch: [
          parsed.apply.fgColor || cfg.fgColor,
          parsed.apply.bgColor || cfg.bgColor,
        ],
      });
      const saved = list.find((it) => it.name.trim() === parsed.name)!;
      // 立即套用：配色 + 码点钩子
      let effect: DotEffectFn | null = null;
      try {
        effect = compileDotEffect(saved.dotEffectCode);
      } catch {
        // dryRun 已过，理论上不会到这；保险起见降级
      }
      applyStyle(saved.id, saved.apply, effect);
      flashOk(`已保存「${parsed.name}」并应用。`);
      setTimeout(closeStyleDialog, 700);
    }

    const card = h('div', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '用 AI 生成自定义二维码风格',
      class:
        'w-[min(92vw,42rem)] rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 shadow-2xl',
    }, [
      h('div', { class: 'mb-1 flex items-center justify-between gap-2' }, [
        h('span', { class: 'text-sm font-semibold text-[var(--fg)]', textContent: '💡 用 AI 生成自定义码点风格' }),
        h('button', {
          type: 'button',
          'aria-label': '关闭',
          class: 'text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors',
          textContent: '✕',
          onclick: closeStyleDialog,
        }),
      ]),
      // 步骤 1
      h('div', { class: 'mt-2 space-y-2' }, [
        h('label', { class: 'block text-xs font-medium text-[var(--fg-muted)]', textContent: '① 描述你想要的风格' }),
        descInput,
        h('div', { class: 'flex items-center justify-end' }, [
          h('button', {
            type: 'button',
            class: 'rounded-md bg-[var(--accent)] px-4 py-1.5 text-sm text-[var(--accent-fg)] hover:opacity-90 transition-opacity',
            textContent: '生成 AI 提示词',
            onclick: generate,
          }),
        ]),
      ]),
      // 步骤 2
      h('div', { class: 'mt-3' }, [
        h('label', { class: 'mb-1 block text-xs font-medium text-[var(--fg-muted)]', textContent: '② 复制提示词给 AI' }),
        step2,
      ]),
      // 步骤 3
      step3,
      statusRow,
      h('p', {
        class: 'mt-3 text-center text-[11px] text-[var(--fg-muted)]',
        textContent: '数据不出本地 · 代码仅在你自己的浏览器运行',
      }),
    ]);

    styleDialogEl = mountStyleDialog(card);
    requestAnimationFrame(() => descInput.focus());
  }

  // —— AI 风格助手：💡 按钮 + 三步模态（描述 → 生成提示词 → 粘代码保存）——
  const aiHelpBtn = h('button', {
    type: 'button',
    title: '用 AI 生成自定义码点风格：描述想要的效果 → 生成提示词 → 粘贴 AI 返回的代码 → 保存',
    'aria-label': '用 AI 生成自定义风格',
    class: 'text-base leading-none text-[var(--fg-muted)] hover:text-[var(--accent)] transition-colors',
    textContent: '💡',
    onclick: () => openStyleHelpDialog(),
  });
  const styleField = h('div', { class: 'space-y-1.5' }, [
    h('div', { class: 'flex items-center gap-1.5' }, [
      h('div', { class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '一键套用风格' }),
      aiHelpBtn,
    ]),
    presetRow,
  ]);

  const controls = h('div', { class: 'space-y-5' }, [
    field('内容', textInput),
    styleField,
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
      field('Logo 形状', logoFitRow),
    ]),
  ]);

  const previewCol = h('div', { class: 'space-y-4' }, [
    previewWrap,
    statusLine,
    h('div', { class: 'flex flex-wrap justify-center gap-2' }, [downloadBtn, copyBtn]),
    h('div', { class: 'mt-4' }, [
      h('div', { class: 'mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]', textContent: '美化已有二维码' }),
      h('p', { class: 'mb-2 text-[11px] leading-snug text-[var(--fg-muted)]', textContent: '上传海报/截图，自动识别其中所有二维码（含彩色码），多码时可在下方下拉切换。' }),
      decodeDrop,
      decodeInput,
      decodeBar,
    ]),
  ]);

  content.append(
    h('p', {
      class: 'mb-6 text-sm text-[var(--fg-muted)]',
      textContent: '生成可定制风格的二维码：一键套用风格预设，或自选码点/定位眼/配色/Logo。上传已有二维码（含海报里的多个码）识别后用当前风格美化重绘。全程本地处理。',
    }),
    h('div', { class: 'grid gap-6 lg:grid-cols-2' }, [controls, previewCol]),
  );

  // 初始绘制：先填充各选择器，再画二维码
  rebuildDotRow();
  rebuildEyeRow();
  renderPresetRow();
  renderLogoFitRow();
  // 恢复上次激活的 AI 风格的码点钩子（内置预设无钩子，跳过）。
  // 编译失败时降级为仅配色（钩子留空），不阻塞初始绘制。
  if (cfg.activeStyleId && isCustomStyleId(cfg.activeStyleId)) {
    const style = findCustomStyle(cfg.activeStyleId);
    if (style && style.dotEffectCode) {
      try {
        activeDotEffect = compileDotEffect(style.dotEffectCode);
      } catch {
        activeDotEffect = null;
      }
    }
  }
  void redraw();

  // 恢复持久化的图片（Logo / 识别原图），均异步（dataURL→bitmap），恢复后重绘。
  // 这两个恢复互相独立，并行进行。
  void restoreLogo();
  void restoreDetected();

  /** 恢复 Logo：若存过 Logo dataURL，还原成 ImageBitmap 并恢复 UI 态 */
  async function restoreLogo(): Promise<void> {
    const saved = loadLogoImage();
    if (!saved) return;
    const bitmap = await dataUrlToBitmap(saved);
    if (!bitmap) return; // dataURL 损坏：忽略，不阻塞
    logoBitmap = bitmap;
    logoBtn.textContent = '更换 Logo';
    logoToggle.checked = cfg.withLogo; // withLogo 开关已在 cfg 里恢复
    scheduleDraw(); // 带 Logo 重绘
  }

  /** 恢复识别态：原图作预览 + 多码下拉恢复 + 选中上次选中的码 */
  async function restoreDetected(): Promise<void> {
    const saved = loadDetectedImage();
    if (!saved) return;
    detectedCodes = saved.codes;
    selectedCodeIndex = saved.selectedIndex;
    detectedDataUrl = saved.dataUrl;
    detectedPreviewUrl = saved.dataUrl; // dataURL 可直接作 img src，无需 object URL
    renderDecodeBar(); // 恢复多码下拉与选中项
  }
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

/**
 * 颜色输入：色块 + hex 文本框。
 * onReady 回调把内部 picker/text 元素交出，便于预设套用后同步显示值。
 */
function colorInput(
  label: string,
  value: string,
  onChange: (v: string) => void,
  onReady?: (picker: HTMLInputElement, text: HTMLInputElement) => void,
): HTMLElement {
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
  if (onReady) onReady(picker, text);
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
