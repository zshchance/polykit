/**
 * 控制面板 / 操作按钮与渲染管线之间的共享上下文。
 *
 * 职责：收拢原本 main.ts render() 巨型闭包里的可变状态与回调
 * （state / loadedImage / currentCells / htmlCopyBtn 前向引用等），
 * 使拆出的 controls.ts / actions.ts / find-word-panel.ts 通过显式对象访问，
 * 不用模块级可变全局变量模拟闭包。
 *
 * 依赖方向：仅依赖 types / settings / image 的类型，被 controls.ts、
 * actions.ts、find-word-panel.ts 与 main.ts 引用，是依赖汇聚点（无运行时逻辑）。
 */

import type { PersistedState } from './settings';
import type { LoadedImage } from './image';
import type { Rendered } from './types';

export interface ControlsContext {
  state: PersistedState;
  /** 图片模式当前加载的图片：controls 的 handleFile 写入（先 revoke 旧的），actions 的 PNG 导出读文件名。 */
  loadedImage: LoadedImage | null;
  /** 图片/logo 模式最新渲染 Cell 网格：渲染管线写入，复制纯文本 / PNG Canvas 导出读取。 */
  currentCells: Rendered;
  /** logo 模式最新网格宽度（供字号自适应 + 导出 W 用）。0=非网格模式。渲染管线写入，actions 读取。 */
  currentGridWidth: number;
  /**
   * 操作按钮里的「复制彩色 HTML」按钮引用：buildActions 创建并回写，
   * 但 buildControls（updateModeVisibility 做显隐）先于 buildActions 运行 ——
   * 此时为 undefined，读取方需守卫（与原 main.ts 的 TDZ 前向声明语义一致）。
   */
  htmlCopyBtn?: HTMLElement;
  /**
   * 纯文本错位提示 span（非点阵找字 + 含全角字时显示）：buildActions 创建并回写，
   * updatePlainTextHint 读取 —— 赋值前为 undefined，守卫跳过。
   */
  plainTextHint?: HTMLElement;
  persist(): void;
  rerenderPreview(): void;
  updatePlainTextHint(): void;
}
