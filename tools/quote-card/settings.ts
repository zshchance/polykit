/**
 * 名言卡片草稿 —— 本地持久化（localStorage）。
 *
 * 记住用户最后输入的名言内容/落款/出处、所选模板、宽高比与动画效果，
 * 下次打开页面时自动还原，免去重复输入与点选。
 * 仅存「当前编辑中的草稿」，不与 history.ts（用户主动保存的名言）混用。
 *
 * 设计与 history.ts 一致：带 version 的 JSON blob，损坏/隐私模式时安全回退默认值。
 *
 * 存储形态（JSON）：
 *   { "version": 4, "draft": { text, author, source?, templateId, aspectId?, animId?, videoRes?, videoFps? } }
 *   （v2 新增 aspectId/animId，v3 新增 videoRes，v4 新增 videoFps；旧草稿缺字段时用默认值，向前兼容）
 */

import { isValidAspectId, type AspectId } from './aspect';
import { isValidAnimId } from './animations';
import { isValidVideoResId, type VideoResId, isValidVideoFpsId, type VideoFpsId } from './video-export';
import { isValidTemplateId, defaultTemplate } from './templates';

const STORAGE_KEY = 'quote-card:draft';
const CURRENT_VERSION = 4;

/** 草稿（可被还原的编辑态） */
export interface QuoteDraft {
  text: string;
  author: string;
  source?: string;
  templateId: string;
  /** 宽高比（v2，可选，缺省默认 1:1） */
  aspectId?: AspectId;
  /**
   * 动画效果（v2，可选，缺省默认淡入）。
   * 用 string 而非 AnimId 联合类型：自定义效果的 id 是运行时生成的 'custom:xxx'，
   * 不在静态联合里。合法性由 isValidAnimId（含自定义）统一校验。
   */
  animId?: string;
  /** 视频分辨率（v3，可选，缺省默认 1080p） */
  videoRes?: VideoResId;
  /** 视频帧率（v4，可选，缺省默认 60 丝滑） */
  videoFps?: VideoFpsId;
}

interface DraftBlob {
  version: number;
  draft: QuoteDraft;
}

/** 读取草稿；存储损坏/为空/字段非法时返回 null（调用方用默认值） */
export function loadDraft(): QuoteDraft | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DraftBlob>;
    if (!parsed || typeof parsed !== 'object') return null;
    const d = parsed.draft;
    if (!d || typeof d !== 'object') return null;
    // 逐字段校验：text/author/templateId 必须是非空字符串，source 可选字符串
    if (typeof d.text !== 'string' || typeof d.author !== 'string' || typeof d.templateId !== 'string') return null;
    if (d.text.length === 0 && d.author.length === 0) return null; // 全空视为无草稿
    const source = typeof d.source === 'string' ? d.source : undefined;
    // templateId 校验合法性（内置 + 自定义合并列表里存在）；非法（如删除的自定义模板）
    // 回退默认模板。与 animId 的 isValidAnimId 行为一致。
    const templateId = isValidTemplateId(d.templateId) ? d.templateId : defaultTemplate.id;
    // aspectId / animId / videoRes / videoFps 仅在合法时保留，否则留空（调用方用默认）
    const aspectId = isValidAspectId(d.aspectId) ? d.aspectId : undefined;
    const animId = isValidAnimId(d.animId) ? d.animId : undefined;
    const videoRes = isValidVideoResId(d.videoRes) ? d.videoRes : undefined;
    const videoFps = isValidVideoFpsId(d.videoFps) ? d.videoFps : undefined;
    return { text: d.text, author: d.author, source, templateId, aspectId, animId, videoRes, videoFps };
  } catch {
    return null;
  }
}

/** 持久化草稿（隐私模式 / 配额满时静默忽略） */
export function saveDraft(draft: QuoteDraft): void {
  try {
    const blob: DraftBlob = { version: CURRENT_VERSION, draft };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    // 容量满 / 隐私模式禁用 localStorage：静默忽略，不影响功能
  }
}

/** 清除草稿（恢复默认） */
export function clearDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 静默忽略
  }
}
