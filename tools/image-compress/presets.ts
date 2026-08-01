/**
 * 用途预设 —— 按常见发布场景预调好的压缩参数模板。
 *
 * 点一个用途 chip，即把 format / quality / maxLongEdge 一次性设好，
 * 省去用户逐项调参。参数取值参考各平台的常见发布规范与体积/画质权衡。
 *
 * 「通用压缩」= 当前 DEFAULT_CONFIG（平衡画质与体积）。
 * 「自己描述」不是预设，而是切换到自定义输入 + AI 接管提示词，故不在此表。
 */

import type { OutputFormat } from './types';

/** 单个用途预设：参数 + 给用户看的说明。 */
export interface PurposePreset {
  id: string;
  /** chip 显示文案 */
  label: string;
  /** 一句话说明（chip 的 title / 提示） */
  hint: string;
  format: OutputFormat;
  /** 画质 1-100（仅对 JPEG/WebP 有效） */
  quality: number;
  /** 最长边像素上限，0 表示不缩放 */
  maxLongEdge: number;
}

/** 所有内置预设（含通用）。顺序即 chip 展示顺序。 */
export const PRESETS: readonly PurposePreset[] = [
  {
    id: 'general',
    label: '通用压缩',
    hint: '平衡画质与体积，适合大多数场景',
    format: 'webp',
    quality: 80,
    maxLongEdge: 0,
  },
  {
    id: 'xiaohongshu',
    label: '小红书',
    hint: '封面/正文图，清晰为主，最长边 ≤1080',
    format: 'webp',
    quality: 82,
    maxLongEdge: 1080,
  },
  {
    id: 'ecommerce',
    label: '电商商品图',
    hint: '商品细节优先，画质偏高，最长边 ≤1440',
    format: 'jpeg',
    quality: 88,
    maxLongEdge: 1440,
  },
  {
    id: 'social',
    label: '朋友圈/社交',
    hint: '省流量，移动端快速加载，最长边 ≤720',
    format: 'jpeg',
    quality: 75,
    maxLongEdge: 720,
  },
  {
    id: 'web',
    label: '网页/公众号',
    hint: '体积优先，适配屏幕，最长边 ≤1080',
    format: 'webp',
    quality: 78,
    maxLongEdge: 1080,
  },
];

/** 按 id 查预设；不存在返回通用预设（兜底）。 */
export function findPreset(id: string): PurposePreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
}
