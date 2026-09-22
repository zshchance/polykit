/**
 * 识谱琴房 —— 节奏型伴奏样式表（策展数据）。
 *
 * 每种风格定义在 16 分步网格上的鼓点/节拍器/贝斯触发点。
 * 3/4 拍风格 stepsPerBar=12；调度器只负责按步回调，触什么发什么由这里决定。
 */

export interface RhythmStyle {
  id: string;
  name: string;
  /** 一句话说明（选择器 title） */
  desc: string;
  /** 每小节 16 分步数：4/4 = 16，3/4 = 12 */
  stepsPerBar: number;
  kick?: readonly number[];
  snare?: readonly number[];
  hat?: readonly number[];
  /** 节拍器嗒声（重拍 = 每小节第 0 步音高更高） */
  click?: readonly number[];
  swing?: number;
  /** 贝斯触发步 + 音型：root = 只弹根音，rootfive = 根五交替，walk = 四分行走 */
  bassSteps?: readonly number[];
  bassKind?: 'root' | 'rootfive' | 'walk';
}

export const RHYTHM_STYLES: readonly RhythmStyle[] = [
  {
    id: 'off',
    name: '关闭',
    desc: '只留自己的琴声',
    stepsPerBar: 16,
  },
  {
    id: 'metro',
    name: '纯节拍器',
    desc: '每拍一嗒，小节头重拍；识谱练习的默认伙伴',
    stepsPerBar: 16,
    click: [0, 4, 8, 12],
  },
  {
    id: 'pop',
    name: '流行八拍',
    desc: '动次打次：底鼓 1/3 拍、军鼓 2/4 拍、八分踩镲，贝斯根五交替',
    stepsPerBar: 16,
    kick: [0, 8],
    snare: [4, 12],
    hat: [0, 2, 4, 6, 8, 10, 12, 14],
    bassSteps: [0, 4, 8, 12],
    bassKind: 'rootfive',
  },
  {
    id: 'folk',
    name: '民谣叙事',
    desc: '稀疏的底鼓与踩镲，留出叙事空间，贝斯只压小节头',
    stepsPerBar: 16,
    kick: [0],
    snare: [8],
    hat: [0, 4, 8, 12],
    bassSteps: [0, 8],
    bassKind: 'root',
  },
  {
    id: 'waltz',
    name: '圆舞曲',
    desc: '3/4 拍：嘭-恰-恰，贝斯在第一拍落地',
    stepsPerBar: 12,
    kick: [0],
    hat: [4, 8],
    click: [0, 4, 8],
    bassSteps: [0],
    bassKind: 'root',
  },
  {
    id: 'swing',
    name: '摇摆爵士',
    desc: '带 swing 的骑镲节奏与四分行走贝斯，适合和弦走向阶段',
    stepsPerBar: 16,
    swing: 0.18,
    kick: [0, 8],
    snare: [4, 12],
    hat: [0, 4, 6, 8, 12, 14],
    bassSteps: [0, 4, 8, 12],
    bassKind: 'walk',
  },
];

export const RHYTHM_MAP: ReadonlyMap<string, RhythmStyle> = new Map(
  RHYTHM_STYLES.map((r) => [r.id, r]),
);
