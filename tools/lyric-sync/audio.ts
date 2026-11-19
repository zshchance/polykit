/** 本地音频解码与共享 AudioContext。音频只进入内存，不上传或持久化。 */

let sharedCtx: AudioContext | null = null;

export interface LoadedAudio {
  buffer: AudioBuffer;
  duration: number;
  name: string;
  fileName: string;
}

export function getSharedAudioContext(): AudioContext {
  if (!sharedCtx) {
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedCtx = new Ctor();
  }
  return sharedCtx;
}

export async function resumeAudioContext(): Promise<void> {
  const ctx = getSharedAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
}

function decodeWith(ctx: BaseAudioContext, raw: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    try {
      ctx.decodeAudioData(
        raw,
        (buffer) => resolve(buffer),
        () => reject(new Error('decode failed')),
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error('decodeAudioData unavailable'));
    }
  });
}

function makeOfflineContext(): BaseAudioContext | null {
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

export function stripExt(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index > 0 ? fileName.slice(0, index) : fileName;
}

/** 浏览器支持什么编码由 decodeAudioData 决定；失败时再用 OfflineAudioContext 兼容 Safari。 */
export async function loadAudioFile(file: File): Promise<LoadedAudio> {
  let raw: ArrayBuffer;
  try {
    raw = await file.arrayBuffer();
  } catch {
    throw new Error('读取音频失败，请重新选择文件');
  }

  for (const ctx of [getSharedAudioContext(), makeOfflineContext()]) {
    if (!ctx) continue;
    try {
      const buffer = await decodeWith(ctx, raw.slice(0));
      if (buffer.length > 0 && Number.isFinite(buffer.duration)) {
        return {
          buffer,
          duration: buffer.duration,
          name: stripExt(file.name),
          fileName: file.name,
        };
      }
    } catch {
      // 尝试下一种解码通道；最终失败时给出统一、可操作的提示。
    }
  }
  throw new Error(`无法解码「${file.name}」，请使用有效的 MP3、WAV、M4A 或 OGG 音频`);
}
