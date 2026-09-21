import type { InstrumentEntry } from '../types';
import { KEYBOARD_INSTRUMENTS } from './families/keyboard';
import { BOWED_INSTRUMENTS } from './families/bowed';
import { PLUCKED_INSTRUMENTS } from './families/plucked';
import { WOODWIND_INSTRUMENTS } from './families/woodwind';
import { BRASS_INSTRUMENTS } from './families/brass';
import { PERCUSSION_INSTRUMENTS } from './families/percussion';
import { CHINESE_INSTRUMENTS } from './families/chinese';
import { WORLD_INSTRUMENTS } from './families/world';
import { ELECTRONIC_INSTRUMENTS } from './families/electronic';

/**
 * 全量乐器条目（顺序 = 默认展示顺序：按大类 + 词表内顺序）。
 * 谱系文件各自维护，这里只做汇总与派生查询。
 */
export const ALL_INSTRUMENTS: InstrumentEntry[] = [
  ...KEYBOARD_INSTRUMENTS,
  ...BOWED_INSTRUMENTS,
  ...PLUCKED_INSTRUMENTS,
  ...WOODWIND_INSTRUMENTS,
  ...BRASS_INSTRUMENTS,
  ...PERCUSSION_INSTRUMENTS,
  ...CHINESE_INSTRUMENTS,
  ...WORLD_INSTRUMENTS,
  ...ELECTRONIC_INSTRUMENTS,
];

const BY_ID = new Map(ALL_INSTRUMENTS.map((s) => [s.id, s]));

export function getInstrumentById(id: string): InstrumentEntry | undefined {
  return BY_ID.get(id);
}
