/**
 * AI 效果配方 —— 用一句话描述，让 AI 产出「载体 + 运动 + 尾迹」的 JSON 组合。
 *
 * 配方是纯数据（零代码执行），逐字段校验；载体支持：
 *   - 内置 id（足球/流星/地球/火箭…）
 *   - asset:<本地素材名>（匹配素材库中的上传素材）
 *   - custom（素材库没有合适主体，附 assetPrompt 让用户先生成贴纸再上传）
 */

import {
  BUILTIN_ACTORS,
  DEFAULT_PROGRESS_EFFECT,
  PROGRESS_MOTIONS,
  PROGRESS_TRAILS,
  type BuiltinActorId,
  type ProgressMotionId,
  type ProgressTint,
  type ProgressTrailId,
} from './options';

export interface ProgressRecipe {
  name: string;
  actor:
    { kind: 'builtin'; id: BuiltinActorId } | { kind: 'asset'; name: string } | { kind: 'custom' };
  motion: ProgressMotionId;
  trail: ProgressTrailId;
  trailLen: number;
  size: number;
  tint: ProgressTint;
  tempoSync: boolean;
  /** 旋转/滚动速度倍数 0-3 */
  spin: number;
  /** 外围光晕强度 0-1 */
  halo: number;
  /** 垂直偏移（相对短边 S，正数下移） */
  offsetY: number;
  /** 素材库没有对应主体时，给用户的文生图贴纸提示词 */
  assetPrompt?: string;
}

const clampNum = (v: unknown, min: number, max: number, fallback: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
};

const enumDoc = <T extends string>(choices: readonly { id: T; label: string }[]): string =>
  choices.map((c) => `"${c.id}"（${c.label}）`).join(' / ');

/**
 * 组装「AI 效果配方」提示词。
 * availableAssets 为当前素材库中的素材名，AI 可引用；没有合适主体时要求返回 custom + assetPrompt。
 */
export function buildProgressEffectPrompt(description: string, availableAssets: string[]): string {
  const desc = description.trim() || '一个有创意的角色进度条效果';
  const assets = availableAssets.filter(Boolean).slice(0, 20);
  const assetLine = assets.length > 0 ? assets.map((n) => `「${n}」`).join('、') : '（素材库为空）';
  return `你是音乐短视频的动效设计专家。请把用户的描述拆解成「角色进度条」效果配方。

【我想要的进度条效果】
${desc}

【可用载体】
- 内置载体：${BUILTIN_ACTORS.map((a) => `"${a.id}"（${a.label}）`).join(' / ')}
- 我的素材库：${assetLine}

【输出格式（必须严格遵守）】
只输出一个 \`\`\`json 围栏代码块，内容为一个 JSON 对象：
{
  "name": "方案名，不超过 12 字",
  "actor": "载体 id",
  "motion": "运动 id",
  "trail": "尾迹 id",
  "trailLen": 0.8,
  "size": 0.12,
  "tint": "original",
  "tempoSync": true,
  "spin": 1,
  "halo": 0.4,
  "offsetY": 0,
  "assetPrompt": "可选：素材生成提示词"
}

字段说明：
- actor：优先使用内置载体 id；如果主体恰好是我的素材库中的一项，写 "asset:素材名"；两者都不合适时写 "custom"，并在 assetPrompt 里给出可直接用于 AI 生图的透明贴纸提示词（扁平插画、单一主体、透明背景、无阴影）。
- motion（运动）：${enumDoc(PROGRESS_MOTIONS)}
- trail（尾迹）：${enumDoc(PROGRESS_TRAILS)}
- trailLen：尾迹长度 0.1-1；size：载体高度占画面短边比例 0.06-0.18。
- tint：original（保留素材原色）或 accent（跟随主题主色）。
- tempoSync：true/false，是否随音乐能量轻微律动。
- spin：旋转/滚动速度倍数 0-3（足球滚动 1，地球自转可 1.5-2.5）。
- halo：外围光晕强度 0-1（地球/星星等发光主体可用 0.3-0.6）。
- offsetY：垂直偏移 -0.2~0.2（正数下移）；中心对齐通常需要 0.05-0.13（视运动与尺寸），设置区有「中心对齐」按钮可自动估算。

【设计要求】
- 运动与主体匹配：足球/唱片用 roll，流星/地球/火箭用 fly，上传的人物动图用 run，星星/爱心用 float。
- 尾迹与氛围匹配：流星/火箭用 fire，地球/光效主体用 glow，星星用 particles，人物动图可 none 或 echo。
- 用户提到“发光/拖尾/火焰/残影”时一定要落到对应 trail。
- name 用中文、短而有意象。
- 如果用户描述的主体明显不在内置列表，不要硬套；用 custom + assetPrompt。

【示例（展示格式，请按我的需求重新设计）】
\`\`\`json
{ "name": "流星火尾", "actor": "meteor", "motion": "fly", "trail": "fire", "trailLen": 0.85, "size": 0.12, "tint": "original", "tempoSync": true, "spin": 0, "halo": 0.3, "offsetY": 0, "assetPrompt": "" }
\`\`\`

围栏之外不要写任何解释文字。`;
}

export function parseProgressEffectAIOutput(
  raw: string,
): { ok: true; recipe: ProgressRecipe } | { ok: false; reason: string } {
  const fence = /```(?:json)?\s*\n([\s\S]*?)\n?```/i.exec(raw);
  const text = (fence ? fence[1] : raw).trim();
  let obj: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'AI 返回的不是 JSON 对象——请把 ```json 代码块完整粘进来。' };
    }
    obj = parsed as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      reason: 'JSON 解析失败——请把 AI 返回的 ```json 代码块原样粘进来（不要增删字符）。',
    };
  }

  const name = typeof obj.name === 'string' ? obj.name.trim().slice(0, 12) : '';
  if (!name) return { ok: false, reason: 'JSON 里缺少有效 name（方案名，≤12 字）。' };

  let actor: ProgressRecipe['actor'];
  const rawActor = typeof obj.actor === 'string' ? obj.actor.trim() : '';
  if (rawActor.startsWith('asset:')) {
    const assetName = rawActor.slice(6).trim().slice(0, 20);
    actor = assetName ? { kind: 'asset', name: assetName } : { kind: 'custom' };
  } else if (BUILTIN_ACTORS.some((a) => a.id === rawActor)) {
    actor = { kind: 'builtin', id: rawActor as BuiltinActorId };
  } else {
    actor = { kind: 'custom' };
  }

  const assetPrompt =
    typeof obj.assetPrompt === 'string' && obj.assetPrompt.trim()
      ? obj.assetPrompt.trim().slice(0, 600)
      : undefined;

  const motion = PROGRESS_MOTIONS.some((m) => m.id === obj.motion)
    ? (obj.motion as ProgressMotionId)
    : DEFAULT_PROGRESS_EFFECT.motion;

  return {
    ok: true,
    recipe: {
      name,
      actor,
      motion,
      trail: PROGRESS_TRAILS.some((t) => t.id === obj.trail)
        ? (obj.trail as ProgressTrailId)
        : DEFAULT_PROGRESS_EFFECT.trail,
      trailLen: clampNum(obj.trailLen, 0.1, 1, DEFAULT_PROGRESS_EFFECT.trailLen),
      size: clampNum(obj.size, 0.06, 0.18, DEFAULT_PROGRESS_EFFECT.size),
      tint: obj.tint === 'accent' ? 'accent' : 'original',
      tempoSync: typeof obj.tempoSync === 'boolean' ? obj.tempoSync : false,
      spin: clampNum(obj.spin, 0, 3, motion === 'roll' ? 1 : 0),
      halo: clampNum(obj.halo, 0, 1, DEFAULT_PROGRESS_EFFECT.halo),
      offsetY: clampNum(obj.offsetY, -0.2, 0.2, DEFAULT_PROGRESS_EFFECT.offsetY),
      ...(assetPrompt ? { assetPrompt } : {}),
    },
  };
}
