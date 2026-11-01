/**
 * 背景音乐加载 —— 文件解码为 AudioBuffer 与共享 AudioContext 管理。
 *
 * 预览与录制共用同一个 AudioContext（浏览器限制数量，且复用可避免重复创建开销）：
 *   预览：BufferSource → Gain → ctx.destination（外放）
 *   录制：BufferSource → Gain → MediaStreamDestination（进视频音轨，不外放）
 *
 * 时间锚点：无论有无 BGM，预览与录制的时钟都统一使用本 context 的
 * currentTime——绝不引入 performance.now 第二时钟，保证两路逐帧一致。
 *
 * 自 slide-video/audio.ts 适配（工具自包含，不跨目录 import）。
 */

let sharedCtx: AudioContext | null = null;

/** 取共享 AudioContext（首次调用时创建；需在用户手势后 resume） */
export function getSharedAudioContext(): AudioContext {
  if (!sharedCtx) {
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedCtx = new Ctor();
  }
  return sharedCtx;
}

/** 恢复被浏览器自动播放策略挂起的 context（在用户点击「播放/生成」时调用） */
export async function resumeAudioContext(): Promise<void> {
  const ctx = getSharedAudioContext();
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      // 个别浏览器在无手势时 resume 被拒：由调用方的错误提示兜底
    }
  }
}

export interface LoadedAudio {
  /** 解码后的完整音频（预览播放 / 录制音源 / 节拍检测共用） */
  buffer: AudioBuffer;
  /** 时长（秒） */
  duration: number;
  /** 展示名：文件名去扩展名 */
  name: string;
}

/** 加载并解码一个音频文件（mp3 / wav），失败时抛错（调用方展示原因） */
export async function loadAudioFile(file: File): Promise<LoadedAudio> {
  let raw: ArrayBuffer;
  try {
    raw = await file.arrayBuffer();
  } catch {
    throw new Error('读取音频文件失败，请重试');
  }

  // 通道 1：共享 AudioContext 解码（选文件属用户手势，context 可被恢复）。
  // 通道 2：OfflineAudioContext 兜底（个别浏览器 suspended 状态下拒绝在前者解码）。
  // 两通道都用 callback 形式调 decodeAudioData —— promise 形式在旧 Safari 上不存在。
  for (const ctx of [getSharedAudioContext(), makeOfflineCtx()]) {
    if (!ctx) continue;
    if (ctx === sharedCtx) void resumeAudioContext();
    try {
      // 副本解码：个别浏览器 decode 后会 detach 原始 buffer，留原件供下一通道重试
      const buffer = await decodeWith(ctx, raw.slice(0));
      if (buffer && buffer.length > 0) {
        return { buffer, duration: buffer.duration, name: stripExt(file.name) };
      }
    } catch {
      // 走下一通道重试；全部失败时用文件名信息抛面向用户的错误
    }
  }

  throw new Error(
    `无法解码「${file.name}」${file.type ? `（类型 ${file.type}）` : ''}，` +
      '请确认是 MP3 或 WAV 格式且文件未损坏',
  );
}

/** callback 形式的 decodeAudioData 包装（兼容仅支持回调式解码的旧浏览器） */
function decodeWith(ctx: BaseAudioContext, raw: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    try {
      ctx.decodeAudioData(
        raw,
        (buf) => resolve(buf),
        (e) => reject(e instanceof Error ? e : new Error('decode failed')),
      );
    } catch (e) {
      // 个别浏览器（如旧 Safari 的 OfflineAudioContext）没有该方法：同步抛 TypeError
      reject(e instanceof Error ? e : new Error('decodeAudioData unavailable'));
    }
  });
}

/** 1 秒的离线 context（仅用于解码兜底；解码不依赖其时长，length 取非零即可） */
function makeOfflineCtx(): BaseAudioContext | null {
  try {
    const Ctor =
      window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
        .webkitOfflineAudioContext;
    return Ctor ? new Ctor(1, 44100, 44100) : null;
  } catch {
    return null;
  }
}

/** 文件名去扩展名（展示名默认值）；无扩展名时原样返回 */
export function stripExt(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i > 0 ? filename.slice(0, i) : filename;
}

/**
 * 把音频混缩成单声道样本，供节拍检测使用。
 * 多声道取平均；超长音频按 22050Hz 目标做简单抽样降采样（检测只关心能量包络，
 * 降采样不改变鼓点位置，同时把几百兆的样本量压到可用范围）。
 */
export function mixToMono(buffer: AudioBuffer, targetRate = 22050): { samples: Float32Array; rate: number } {
  const channels = Math.min(2, buffer.numberOfChannels);
  const tracks: Float32Array[] = [];
  for (let c = 0; c < channels; c++) tracks.push(buffer.getChannelData(c));
  const source = tracks[0]!;
  const length = source.length;
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const track of tracks) sum += track[i] ?? 0;
    samples[i] = sum / Math.max(1, channels);
  }
  const srcRate = buffer.sampleRate;
  if (srcRate <= targetRate) return { samples, rate: srcRate };

  // 简单抽取：每 step 个样本取一个（能量包络足够用）
  const step = Math.max(1, Math.round(srcRate / targetRate));
  const out = new Float32Array(Math.floor(length / step));
  for (let i = 0; i < out.length; i++) out[i] = samples[i * step] ?? 0;
  return { samples: out, rate: srcRate / step };
}
