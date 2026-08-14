// 上传区面板：① 中心 Logo 上传/移除/持久化恢复；② 上传已有二维码识别美化
// （dropzone + 多码下拉选择 + 识别态恢复）。
// 依赖方向：依赖 image/decode/settings/storage-image；state（cfg + logoBitmap 可写引用）、
// scheduleDraw/redraw/persist/showStatus 由 main 注入，renderLevelRow/logoFitField/textInput
// 来自 controls 面板（经 main 转交），不反向 import。

import { h } from '@/core/components/element';
import { decodeImage, decodeBitmap } from './image';
import { detectAllQr, decodeFailReason, type DetectedCode } from './decode';
import { loadLogoImage, saveLogoImage, loadDetectedImage, saveDetectedImage } from './settings';
import { bitmapToDataUrl, dataUrlToBitmap } from './storage-image';
import type { QrConfig } from './types';

// ────────── Logo 上传区 ──────────

export interface LogoSectionDeps {
  cfg: QrConfig;
  /** Logo 位图缓存的可写引用（主渲染 redraw 读取；上传/移除/恢复时写入） */
  state: { logoBitmap: ImageBitmap | null };
  scheduleDraw(): void;
  persist(): void;
  showStatus(msg: string, isError?: boolean): void;
  /** Logo 上传自动升级纠错后同步选择器高亮（controls 面板提供） */
  renderLevelRow(): void;
  /** 「Logo 形状」字段（controls 面板构建并负责预设套用后的同步重渲） */
  logoFitField: HTMLElement;
}

export interface LogoSection {
  /** 「中心 Logo」区块根元素（嵌入左侧控制面板末尾） */
  root: HTMLElement;
  /** 恢复持久化的 Logo（异步，恢复后重绘） */
  restoreLogo(): Promise<void>;
}

export function createLogoSection(deps: LogoSectionDeps): LogoSection {
  const { cfg, state, scheduleDraw, persist, showStatus, renderLevelRow, logoFitField } = deps;

  const logoToggle = h('input', {
    type: 'checkbox',
    class: 'accent-[var(--accent)] h-4 w-4',
  }) as HTMLInputElement;
  logoToggle.checked = cfg.withLogo;
  logoToggle.addEventListener('change', () => {
    cfg.withLogo = logoToggle.checked;
    if (cfg.withLogo && !state.logoBitmap) {
      // 开了但没图，提示上传
      showStatus('请先上传 Logo 图片', false);
    }
    scheduleDraw();
    persist();
  });
  const logoBtn = h('button', {
    type: 'button',
    class:
      'rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--fg)] hover:border-[var(--accent)] transition-colors',
    textContent: state.logoBitmap ? '更换 Logo' : '上传 Logo',
    onclick: () => logoInput.click(),
  });
  const logoInput = h('input', {
    type: 'file',
    accept: 'image/*',
    class: 'hidden',
  }) as HTMLInputElement;
  logoInput.addEventListener('change', async () => {
    const f = logoInput.files?.[0];
    if (!f) return;
    try {
      state.logoBitmap = await decodeBitmap(f);
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
      const url = await bitmapToDataUrl(state.logoBitmap);
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
    class:
      'rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--fg-muted)] hover:text-[var(--holiday-legal)] transition-colors',
    textContent: '移除',
    onclick: () => {
      state.logoBitmap?.close();
      state.logoBitmap = null;
      cfg.withLogo = false;
      logoToggle.checked = false;
      logoBtn.textContent = '上传 Logo';
      saveLogoImage(''); // 清除持久化的 Logo
      scheduleDraw();
      persist();
    },
  });

  const root = h('div', { class: 'space-y-2' }, [
    h('div', {
      class: 'text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]',
      textContent: '中心 Logo',
    }),
    h('div', { class: 'flex items-center gap-3' }, [
      h('label', { class: 'flex items-center gap-2 text-sm text-[var(--fg)]' }, [
        logoToggle,
        h('span', { textContent: '嵌入 Logo' }),
      ]),
      logoBtn,
      clearLogoBtn,
      logoInput,
    ]),
    logoFitField,
  ]);

  /** 恢复 Logo：若存过 Logo dataURL，还原成 ImageBitmap 并恢复 UI 态 */
  async function restoreLogo(): Promise<void> {
    const saved = loadLogoImage();
    if (!saved) return;
    const bitmap = await dataUrlToBitmap(saved);
    if (!bitmap) return; // dataURL 损坏：忽略，不阻塞
    state.logoBitmap = bitmap;
    logoBtn.textContent = '更换 Logo';
    logoToggle.checked = cfg.withLogo; // withLogo 开关已在 cfg 里恢复
    scheduleDraw(); // 带 Logo 重绘
  }

  return { root, restoreLogo };
}

// ────────── 上传已有二维码解码美化 ──────────

export interface DecodeSectionDeps {
  cfg: QrConfig;
  /** 内容输入框（识别结果回填到这里，controls 面板提供） */
  textInput: HTMLTextAreaElement;
  /** 直接重绘（应用识别内容后立即出码） */
  redraw(): Promise<void>;
  persist(): void;
  showStatus(msg: string, isError?: boolean): void;
}

export interface DecodeSection {
  /** 「美化已有二维码」区块根元素（嵌入右侧预览列底部） */
  root: HTMLElement;
  /** 恢复持久化的识别态（原图 + 多码下拉 + 选中项） */
  restoreDetected(): Promise<void>;
}

export function createDecodeSection(deps: DecodeSectionDeps): DecodeSection {
  const { cfg, textInput, showStatus, redraw, persist } = deps;

  // 多码识别结果：上传的图里可能含多个二维码（海报场景），记下全部供用户在下拉里选择
  let detectedCodes: DetectedCode[] = [];
  let selectedCodeIndex = 0; // 当前选中的第几个码（默认第一个）
  let detectedPreviewUrl: string | null = null; // 上传图预览 URL（用于在多码选择器旁显示）
  let detectedDataUrl: string | null = null; // 识别原图压缩后的 dataURL，持久化与切换选中时复用，避免重编码

  const decodeDrop = h(
    'div',
    {
      role: 'button',
      tabindex: '0',
      'aria-label': '上传二维码图片识别',
      class:
        'flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-5 text-center cursor-pointer transition-colors hover:border-[var(--accent)] focus:outline-none focus-visible:border-[var(--accent)]',
    },
    [
      h('div', { class: 'text-xl', textContent: '📥' }),
      h('div', {
        class: 'text-xs font-medium text-[var(--fg)]',
        textContent: '上传已有二维码 → 识别内容并用当前风格重绘',
      }),
    ],
  );
  const decodeInput = h('input', {
    type: 'file',
    accept: 'image/*',
    class: 'hidden',
  }) as HTMLInputElement;
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
        textContent:
          detectedCodes.length > 1
            ? `识别到 ${detectedCodes.length} 个二维码，选择要美化的`
            : '已识别二维码',
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

  const root = h('div', { class: 'mt-4' }, [
    h('div', {
      class: 'mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]',
      textContent: '美化已有二维码',
    }),
    h('p', {
      class: 'mb-2 text-[11px] leading-snug text-[var(--fg-muted)]',
      textContent: '上传海报/截图，自动识别其中所有二维码（含彩色码），多码时可在下方下拉切换。',
    }),
    decodeDrop,
    decodeInput,
    decodeBar,
  ]);

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

  return { root, restoreDetected };
}
