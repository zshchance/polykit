import type { StyleEntry } from '../types';
import { CLASSIC_STYLES } from './categories/classic';
import { POP_STYLES } from './categories/pop';
import { DIGITAL_STYLES } from './categories/digital';
import { UI_STYLES } from './categories/ui';
import { CRAFT_STYLES } from './categories/craft';
import { ILLUST_STYLES } from './categories/illust';
import { PHOTO_STYLES } from './categories/photo';
import { EAST_STYLES } from './categories/east';

/**
 * 全量风格条目（顺序 = 默认展示顺序：按大类 + 词表内顺序）。
 * 分类文件各自维护，这里只做汇总与派生查询。
 */
export const ALL_STYLES: StyleEntry[] = [
  ...CLASSIC_STYLES,
  ...POP_STYLES,
  ...DIGITAL_STYLES,
  ...UI_STYLES,
  ...CRAFT_STYLES,
  ...ILLUST_STYLES,
  ...PHOTO_STYLES,
  ...EAST_STYLES,
];

const BY_ID = new Map(ALL_STYLES.map((s) => [s.id, s]));

export function getStyleById(id: string): StyleEntry | undefined {
  return BY_ID.get(id);
}
