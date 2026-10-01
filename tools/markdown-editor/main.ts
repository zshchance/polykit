import '@/core/styles/main.css';
import { renderToolLayout } from '@/core/components/ToolLayout';
import { initTheme } from '@/core/components/ThemeToggle';
import { createRenderer } from './renderer';
import { createCodeHighlighter } from './renderer/highlight';
import { EditorApp } from './app';
import { loadSession } from './session';
import welcomeDoc from './assets/welcome.md?raw';
import './preview.css';
import './styles.css';

initTheme();

// 会话自己记忆滚动位置：关掉浏览器原生滚动恢复，避免还原到「加载中的矮页面」
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

async function boot(): Promise<void> {
  // Shiki 高亮器就绪后再进现场，避免首屏出现无高亮 → 高亮的跳变
  const highlighter = await createCodeHighlighter();
  const renderer = createRenderer({ highlighter });
  const { content } = renderToolLayout(document.getElementById('app')!, 'Markdown 手札');

  const app = new EditorApp(content, renderer, welcomeDoc);

  // 会话记忆：上次写到一半的手稿直接恢复现场（含浏览位置）；否则进欢迎页（支持拖文件进来）
  const session = loadSession();
  if (session) {
    app.enterEditor(session.doc, session.name, {
      mode: session.mode,
      outline: session.outline,
      scroll: session.scroll,
    });
  } else {
    app.showLanding();
  }
}

void boot();
