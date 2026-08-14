import { h } from './element';

/**
 * 全站共享模态框骨架。
 *
 * 此前 quote-card / ascii-art / qr-code / prompt-hub 四处各自复制同一套骨架：
 * fixed overlay + 点击背景关闭 + Esc 关闭 + body.overflow 锁滚动。
 * 这里收敛为一份；内容面板由调用方自由构造（各工具内容差异大，不做内容模板）。
 *
 * 用法：
 *   const dlg = createDialog({ onClose: ... });
 *   dlg.body.append(自己的内容);
 *   dlg.open();
 *   // 再次打开前可 dlg.body.replaceChildren(...) 换内容
 *
 * 可访问性：role=dialog + aria-modal；Esc 可关。焦点圈（focus trap）
 * 目前未实现，与改造前各处行为一致，后续需要再补。
 */

export interface DialogOptions {
  /** 关闭时回调（Esc / 背景点击 / close() 都会触发） */
  onClose?: () => void;
  /** 点击背景是否关闭，默认 true */
  closeOnBackdrop?: boolean;
  /** 面板宽度（Tailwind max-w 类），默认 'max-w-2xl' */
  panelClass?: string;
  /** 无障碍标签 */
  label?: string;
}

export interface DialogHandle {
  /** 模态根（overlay，已挂到 body） */
  overlay: HTMLElement;
  /** 内容面板（宽度/圆角/阴影在此） */
  panel: HTMLElement;
  /** 可滚动内容区：调用方把内容放这里 */
  body: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export function createDialog(opts: DialogOptions = {}): DialogHandle {
  const { onClose, closeOnBackdrop = true, panelClass = 'max-w-2xl', label = '对话框' } = opts;

  const body = h('div', { class: 'flex-1 overflow-y-auto px-5 py-4' });
  const panel = h(
    'div',
    {
      class: `flex max-h-[88vh] w-full ${panelClass} flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl`,
    },
    [body],
  );

  let open_ = false;
  const overlay = h(
    'div',
    {
      class:
        'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4 backdrop-blur-sm',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': label,
      onclick: (e: Event) => {
        if (closeOnBackdrop && e.target === overlay) close();
      },
    },
    [panel],
  );

  function open(): void {
    if (open_) return;
    open_ = true;
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    document.body.style.overflow = 'hidden'; // 锁背景滚动
  }
  function close(): void {
    if (!open_) return;
    open_ = false;
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
    document.body.style.overflow = '';
    onClose?.();
  }

  document.body.append(overlay);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open_) close();
  });

  return { overlay, panel, body, open, close, isOpen: () => open_ };
}

/**
 * 替代 window.confirm 的统一确认框（Promise 风格）。
 * 仓库约定「不弹原生 alert/confirm」（此前 6 处 confirm 是历史遗留）。
 * resolve true=确认，false=取消（含 Esc / 背景点击）。
 */
export function confirmDialog(
  message: string,
  opts: { title?: string; confirmText?: string; danger?: boolean } = {},
): Promise<boolean> {
  const { title = '确认操作', confirmText = '确定', danger = false } = opts;
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const dlg = createDialog({
      // close() 总在按钮点击之后触发；用 settled 保证只 resolve 一次
      onClose: () => done(false),
      panelClass: 'max-w-sm',
      label: title,
    });

    const confirmBtn = h('button', {
      type: 'button',
      class: danger
        ? 'rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors bg-[var(--holiday-legal)] hover:opacity-90'
        : 'rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors bg-[var(--accent)] hover:opacity-90',
      textContent: confirmText,
      onclick: () => {
        done(true);
        dlg.close();
      },
    });
    const cancelBtn = h('button', {
      type: 'button',
      class:
        'rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--fg-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]',
      textContent: '取消',
      onclick: () => dlg.close(),
    });

    dlg.body.append(
      h('h3', { class: 'text-base font-semibold text-[var(--fg)]', textContent: title }),
      h('p', {
        class: 'mt-2 text-sm leading-relaxed text-[var(--fg-muted)]',
        textContent: message,
      }),
      h('div', { class: 'mt-5 flex justify-end gap-2' }, [cancelBtn, confirmBtn]),
    );
    dlg.open();
  });
}
