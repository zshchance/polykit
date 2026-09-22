import type { RhythmPattern } from '../../types';
import { ELECTRONIC_RHYTHMS } from './electronic';
import { HIPHOP_RHYTHMS } from './hiphop';
import { ROCK_RHYTHMS } from './rock';
import { FUNK_RHYTHMS } from './funk';
import { POP_RHYTHMS } from './pop';
import { WORLD_RHYTHMS } from './world';

/** 全部鼓组律动（按 DRUM_GENRES 词表顺序聚合） */
export const ALL_RHYTHMS: RhythmPattern[] = [
  ...ELECTRONIC_RHYTHMS,
  ...HIPHOP_RHYTHMS,
  ...ROCK_RHYTHMS,
  ...FUNK_RHYTHMS,
  ...POP_RHYTHMS,
  ...WORLD_RHYTHMS,
];
