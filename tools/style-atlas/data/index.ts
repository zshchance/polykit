import type { StyleEntry } from '../types';
import { CLASSIC_STYLES } from './categories/classic';
import { POP_STYLES } from './categories/pop';
import { DIGITAL_STYLES } from './categories/digital';
import { UI_STYLES } from './categories/ui';
import { CRAFT_STYLES } from './categories/craft';
import { ILLUST_STYLES } from './categories/illust';
import { PHOTO_STYLES } from './categories/photo';
import { EAST_STYLES } from './categories/east';
import { CG_STYLES } from './categories/cg';
import { PORTRAIT_STYLES } from './categories/portrait';
import { FACEART_STYLES } from './categories/faceart';
import { VLOG_STYLES } from './categories/vlog';
import { ADS_STYLES } from './categories/ads';
import { ANIME_STYLES } from './categories/anime';
import { SCENE_STYLES } from './categories/scene';
import { FASHION_STYLES } from './categories/fashion';
import { TYPO_STYLES } from './categories/typography';
import { PATTERN_STYLES } from './categories/pattern';
import { PRINT_STYLES } from './categories/print';
import { SURREAL_STYLES } from './categories/surreal';
import { ARCH_STYLES } from './categories/architecture';
import { FOOD_STYLES } from './categories/foodphoto';
import { NATURE_STYLES } from './categories/nature';
import { FILMLOOK_STYLES } from './categories/filmlook';

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
  ...CG_STYLES,
  ...PORTRAIT_STYLES,
  ...FACEART_STYLES,
  ...VLOG_STYLES,
  ...ADS_STYLES,
  ...ANIME_STYLES,
  ...SCENE_STYLES,
  ...FASHION_STYLES,
  ...TYPO_STYLES,
  ...PATTERN_STYLES,
  ...PRINT_STYLES,
  ...SURREAL_STYLES,
  ...ARCH_STYLES,
  ...FOOD_STYLES,
  ...NATURE_STYLES,
  ...FILMLOOK_STYLES,
];

const BY_ID = new Map(ALL_STYLES.map((s) => [s.id, s]));

export function getStyleById(id: string): StyleEntry | undefined {
  return BY_ID.get(id);
}
