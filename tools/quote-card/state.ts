/**
 * 名言卡片 —— 编辑态共享状态类型。
 *
 * 从 main.ts 拆出：renderQuoteCard() 内的各子模块（模板选择器 / AI 模态 /
 * 历史面板 / 编辑表单 / 导出按钮）都通过同一个 state 对象读写当前编辑态
 * （按引用共享、字段可变），替代拆分前巨型闭包的闭包变量。
 *
 * 依赖方向：仅依赖类型模块（templates/types、aspect、video-export），
 * 被 main.ts 与各子模块引用；本模块不含任何运行时逻辑。
 */

import type { QuoteData } from './templates/types';
import type { AspectId } from './aspect';
import type { VideoResId, VideoFpsId } from './video-export';

/** 名言卡片编辑态（由 main.ts 从草稿恢复后创建，各子模块共享读写） */
export interface QuoteCardState {
  quote: QuoteData;
  templateId: string;
  aspectId: AspectId;
  /** 动画 id：内置（如 'fade'）或自定义（'custom:xxx'）——用 string 容纳运行时 id */
  animId: string;
  videoRes: VideoResId;
  videoFps: VideoFpsId;
}
