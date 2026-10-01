import DOMPurify from 'dompurify';

let hookInstalled = false;

function ensureHook(): void {
  if (hookInstalled) return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')) {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  hookInstalled = true;
}

/**
 * 对渲染产物统一消毒：
 * - 允许 html/svg/mathMl 三类画像（svg 供 Mermaid、mathMl 供 KaTeX 使用）
 * - 移除脚本类标签/属性/危险协议
 * - 外链补 rel="noopener noreferrer"
 */
export function sanitizeHtml(html: string): string {
  ensureHook();
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    // USE_PROFILES 模式下 data-* 默认被剥离，显式放行
    ALLOW_DATA_ATTR: true,
    ADD_ATTR: ['target', 'checked'],
    // SANITIZE_DOM 默认会剥掉与 document/window 属性同名的 id（如 #timeline/#title），
    // 导致「保留字标题」丢失锚点。本管线 html:false，id 仅由自研 slugifier 生成，
    // 无注入面，可安全关闭以保住标题锚点。
    SANITIZE_DOM: false,
  });
}
