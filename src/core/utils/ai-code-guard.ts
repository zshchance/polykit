/**
 * AI 回填代码的危险模式静态扫描（共享安全层）。
 *
 * 背景：quote-card 自定义模板/动画、qr-code 自定义码点都允许用户粘贴 AI 生成的
 * 函数体代码，经 new Function 在本地执行（威胁模型：用户自己粘贴自用，数据不出
 * 本地）。此前三处各写各的黑名单、强度不一：模板侧有扫描，动画/码点侧完全没扫。
 * 这里收敛为一份共享名单，保存时（dryRun）与每次渲染执行前都用它复检。
 *
 * 注意：这是黑名单不是沙箱——字符串拼接、别名等手法理论上仍可绕过；真正的隔离
 * 需要 iframe sandbox 或 Worker。当前深度与「本地自用工具」的威胁模型匹配。
 */

interface DangerPattern {
  re: RegExp;
  /** 命中时向用户展示的说明 */
  label: string;
}

const DANGER_PATTERNS: readonly DangerPattern[] = [
  // 页面全局结构（点访问 + 方括号访问两种写法都要挡）
  {
    re: /document\s*\.\s*(?:body|documentElement|head|cookie|write|open|location)\b/,
    label: 'document.body/head/cookie 等全局结构',
  },
  {
    re: /document\s*\[\s*['"`](?:body|documentElement|head|cookie|write|open|location)['"`]\s*\]/,
    label: 'document[...] 方括号访问全局结构',
  },
  // 页面跳转：window.location / 裸 location / top|parent.location
  { re: /\blocation\s*[.=([]/, label: 'location 页面跳转' },
  {
    re: /(?:window|top|parent|globalThis|self)\s*\[\s*['"`]location['"`]\s*\]/,
    label: 'location 页面跳转（方括号访问）',
  },
  // 网络外发
  { re: /\bfetch\s*\(/, label: 'fetch 网络请求' },
  { re: /['"`]\s*fetch\s*['"`]\s*\]\s*\(/, label: 'fetch 网络请求（方括号访问）' },
  { re: /\bXMLHttpRequest\b/, label: 'XMLHttpRequest' },
  { re: /\bWebSocket\b/, label: 'WebSocket' },
  { re: /\bEventSource\b/, label: 'EventSource' },
  { re: /\bnew\s+(?:Worker|SharedWorker)\b/, label: 'Worker' },
  { re: /navigator\s*\.\s*sendBeacon\b/, label: 'navigator.sendBeacon' },
  { re: /navigator\s*\[\s*['"`]sendBeacon['"`]\s*\]/, label: 'navigator.sendBeacon（方括号访问）' },
  { re: /navigator\s*\.\s*serviceWorker\b/, label: 'navigator.serviceWorker' },
  // 二次 eval / 动态 import
  { re: /\beval\s*\(/, label: 'eval' },
  { re: /\bnew\s+Function\b/, label: 'new Function' },
  { re: /\bimport\s*\(/, label: '动态 import' },
  // 本地持久化（防篡改工具自身的存储数据）
  { re: /\b(?:localStorage|sessionStorage|indexedDB)\b/, label: 'localStorage 等本地存储' },
];

/** 返回首个命中的危险模式说明；干净代码返回 null */
export function findDangerousPattern(code: string): string | null {
  for (const p of DANGER_PATTERNS) {
    if (p.re.test(code)) return p.label;
  }
  return null;
}

/** 代码是否含危险模式（供只需要布尔判断的调用方） */
export function hasDangerousCode(code: string): boolean {
  return findDangerousPattern(code) !== null;
}

/** 命中危险模式时给用户的统一拒绝文案 */
export function dangerousCodeReason(label: string): string {
  return `代码含越界操作（${label}）。这段代码只能操作工具传入的参数（如 el / content / ctx），不能触碰页面其它部分、发网络请求或读写本地存储。`;
}
