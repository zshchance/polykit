/**
 * AI 配色提示词 —— 选择态本地持久化（localStorage）。
 *
 * 记住用户最后选中的色系与情绪筛选，下次打开页面时自动还原，免去重复点选。
 *
 * 设计与项目内其它 settings/history 模块一致：带 version 的 JSON blob，
 * 读取经 core/utils/storage 统一容错，损坏/隐私模式时安全回退默认值（首个色系 + 不筛选）。
 *
 * 存储形态（JSON）：
 *   { "version": 1, "selectedId": string, "activeMood": string }
 */

import { readJSON, writeJSON } from '@/core/utils/storage';

import { PALETTES, MOODS } from './data/palettes';

const STORAGE_KEY = 'color-prompt:selection';
const CURRENT_VERSION = 1;

interface SelectionBlob {
  version: number;
  selectedId: string;
  activeMood: string;
}

/** 可被还原的选择态 */
export interface ColorSelection {
  selectedId: string;
  activeMood: string;
}

/** 默认选择：首个色系 + 不筛选 */
export function defaultSelection(): ColorSelection {
  return { selectedId: PALETTES[0]!.id, activeMood: '' };
}

/**
 * 读取选择态；存储损坏/为空/字段非法时回退默认值。
 * 校验 selectedId 必须是存在的色系 id、activeMood 必须是合法情绪或空串。
 */
export function loadSelection(): ColorSelection {
  const def = defaultSelection();
  const parsed = readJSON(STORAGE_KEY) as Partial<SelectionBlob> | null;
  if (!parsed) return def;

  const selectedId =
    typeof parsed.selectedId === 'string' && PALETTES.some((p) => p.id === parsed.selectedId)
      ? parsed.selectedId
      : def.selectedId;

  const activeMood =
    typeof parsed.activeMood === 'string' &&
    (parsed.activeMood === '' || (MOODS as readonly string[]).includes(parsed.activeMood))
      ? parsed.activeMood
      : def.activeMood;

  return { selectedId, activeMood };
}

/** 持久化选择态（隐私模式 / 配额满时静默忽略） */
export function saveSelection(sel: ColorSelection): void {
  const blob: SelectionBlob = { version: CURRENT_VERSION, ...sel };
  writeJSON(STORAGE_KEY, blob);
}
