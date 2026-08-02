/**
 * 生成「复制 HTML」用的完整独立 HTML 页面源码。
 *
 * 用户期望：点「复制 HTML」后，粘贴到 .html 文件或富文本编辑器，
 * 能直接看到一个带终端外框、配色、CRT 效果、字符画的完整页面。
 *
 * 做法：克隆预览区的终端外框 DOM（.ascii-frame，所有样式都是内联 style，
 * 不依赖外部 CSS 规则），连同字符画 span 一起，包进一个自包含的 HTML 页面：
 *   - <head> 内联 @font-face（JetBrains Mono，引用 Google Fonts CDN 作为兜底）
 *     + body 居中 + 背景填充
 *   - <body> 放克隆的终端外框节点（保留全部内联样式）
 *
 * 导出路径：复制按钮用 navigator.clipboard.write 写 text/html + text/plain。
 */

/**
 * 由预览区的终端外框元素生成完整独立 HTML 页面源码。
 * @param frameEl 预览区里的 .ascii-frame 元素（buildTerminalFrame 的返回值）
 * @returns 完整 HTML 页面字符串（<!doctype>...</html>）
 */
export function buildStandaloneHtml(frameEl: HTMLElement): string {
  // 克隆节点（深拷贝，保留字符画 span）
  const clone = frameEl.cloneNode(true) as HTMLElement;
  // 导出态：复位 CRT 弧度的 transform（截图/粘贴方未必支持 perspective）
  // 但保留 border-radius 等静态效果。给克隆加 exporting 类去掉 transform。
  // 这里直接遍历移除 .ascii-screen 上的 transform（更可靠，不依赖外部 class）。
  clone.querySelectorAll<HTMLElement>('.ascii-screen').forEach((el) => {
    const s = el.style;
    if (s.transform) s.removeProperty('transform');
  });

  const frameHtml = clone.outerHTML;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>终端字符画</title>
<style>
  /* 字体：优先用本机 JetBrains Mono，没有则走 Google Fonts CDN 兜底 */
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono&display=swap');
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 24px;
    min-height: 100vh;
    background: #0f172a;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  /* 字符画必须等宽 + 严格行高，保证对齐 */
  pre {
    margin: 0;
    font-family: "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;
    line-height: 1;
    white-space: pre;
    overflow: hidden;
  }
</style>
</head>
<body>
${frameHtml}
</body>
</html>`;
}
