import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
} from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';

export interface CursorPos {
  line: number;
  col: number;
}

export interface CodeMirrorHandle {
  /** 获取当前文档全文 */
  getDoc(): string;
  /** 整体替换文档内容（保留撤销历史） */
  setDoc(text: string): void;
  /** 光标位置（行列，从 1 计） */
  cursorPosition(): CursorPos;
  /** 编辑器滚动容器（用于滚动同步） */
  scrollElement(): HTMLElement;
  /** 订阅光标移动 */
  onCursor(fn: (pos: CursorPos) => void): void;
  /** 订阅文档变更 */
  onDocChanged(fn: (doc: string) => void): void;
  /** 焦点到编辑器 */
  focus(): void;
  /** 重新测量布局（外壳被重新挂载到 DOM 后调用） */
  measure(): void;
  /** 滚动到 1 基行号所在行（不移动光标），供大纲跳转 */
  revealLine(line: number): void;
  /** 文档总行数 */
  lineCount(): number;
  /**
   * 滚动区顶部首个可见源码行（1 基，带小数部分=行内滚动进度）。
   * 软换行下行高不均，只依赖视口内的实测坐标（coordsAtPos），不受虚拟化影响。
   */
  firstVisibleLine(): number;
  /** 滚动同步：把 0 基行号（可带小数）的行顶对齐到滚动区顶，分栏同步专用 */
  syncScrollToLine(line: number): void;
}

/**
 * 创建 Markdown 编辑器（CodeMirror 6）：
 * 行号、历史、活动行高亮、Markdown 语法高亮（含围栏内嵌语言）、搜索、软换行。
 */
export function createCodeMirror(parent: HTMLElement, initialDoc: string): CodeMirrorHandle {
  const docListeners: Array<(doc: string) => void> = [];
  const cursorListeners: Array<(pos: CursorPos) => void> = [];

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: initialDoc,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSelectionMatches(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(defaultHighlightStyle),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) docListeners.forEach((fn) => fn(update.state.doc.toString()));
          if (update.selectionSet) {
            const pos = update.state.selection.main.head;
            const line = update.state.doc.lineAt(pos);
            cursorListeners.forEach((fn) => fn({ line: line.number, col: pos - line.from + 1 }));
          }
        }),
      ],
    }),
  });

  return {
    getDoc: () => view.state.doc.toString(),
    setDoc(text: string) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    cursorPosition() {
      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      return { line: line.number, col: pos - line.from + 1 };
    },
    scrollElement: () => view.scrollDOM,
    onCursor: (fn) => cursorListeners.push(fn),
    onDocChanged: (fn) => docListeners.push(fn),
    focus: () => view.focus(),
    measure: () => view.requestMeasure(),
    revealLine(line: number) {
      const n = Math.min(Math.max(1, line), view.state.doc.lines);
      const pos = view.state.doc.line(n).from;
      view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 12 }) });
    },
    lineCount: () => view.state.doc.lines,
    firstVisibleLine() {
      const scrollerTop = view.scrollDOM.getBoundingClientRect().top;
      const content = view.contentDOM.getBoundingClientRect();
      const pos =
        view.posAtCoords({
          x: Math.min(content.left + 24, content.right - 4),
          y: scrollerTop + 2,
        }) ?? 0;
      const line = view.state.doc.lineAt(pos);
      // 行内进度：行顶已滚出视口顶的距离 ÷ 该逻辑行的完整视觉高度
      // （软换行下行 = 多个视觉行，用下一行行顶实测距离做分母）
      const frac = (() => {
        const top = view.coordsAtPos(line.from)?.top;
        if (top == null || top >= scrollerTop) return 0; // 行顶未越过视口顶（含内边距带）
        if (line.number >= view.state.doc.lines) return 0;
        const nextTop = view.coordsAtPos(view.state.doc.line(line.number + 1).from)?.top;
        if (nextTop == null || nextTop <= top) return 0;
        return Math.min((scrollerTop - top) / (nextTop - top), 1);
      })();
      return line.number + frac;
    },
    syncScrollToLine(line: number) {
      const base = Math.min(Math.max(Math.floor(line), 0), view.state.doc.lines - 1);
      const frac = line - Math.floor(line);
      view.dispatch({
        effects: EditorView.scrollIntoView(view.state.doc.line(base + 1).from, {
          y: 'start',
          yMargin: 0,
        }),
      });
      if (frac > 0 && base + 1 < view.state.doc.lines) {
        // 对齐后再按该行真实视觉高度折算行内偏移（软换行下 defaultLineHeight 会偏小）
        const top = view.coordsAtPos(view.state.doc.line(base + 1).from)?.top;
        const nextTop = view.coordsAtPos(view.state.doc.line(base + 2).from)?.top;
        if (top != null && nextTop != null && nextTop > top) {
          view.scrollDOM.scrollTop += frac * (nextTop - top);
        }
      }
    },
  };
}
