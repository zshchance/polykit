/**
 * 乐器媒体索引 —— 构建期经 import.meta.glob 就地收集 assets/photos/*.webp 与
 * assets/audio/*.mp3。素材由 scripts/instrument-assets-fetch.mjs 从
 * Wikimedia Commons 抓取转换（作者与许可信息在 assets/credits.json），
 * 与代码解耦：某乐器缺素材时对应函数返回 undefined，UI 回退到图标占位。
 */
import creditsJson from './assets/credits.json';

const photoModules = import.meta.glob<string>('./assets/photos/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

const audioModules = import.meta.glob<string>('./assets/audio/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
});

const PHOTOS = new Map<string, string>();
for (const [path, url] of Object.entries(photoModules)) {
  const id = /\/([^/]+)\.webp$/.exec(path)?.[1];
  if (id) PHOTOS.set(id, url);
}

const AUDIOS = new Map<string, string>();
for (const [path, url] of Object.entries(audioModules)) {
  const id = /\/([^/]+)\.mp3$/.exec(path)?.[1];
  if (id) AUDIOS.set(id, url);
}

export interface MediaCredit {
  title: string;
  artist: string;
  license: string;
  /** 源文件页面链接；个别早期抓取条目可能缺失，UI 降级为纯文本展示 */
  source?: string;
}

export interface InstrumentCredit {
  photo?: MediaCredit;
  audio?: MediaCredit;
}

const CREDITS = creditsJson as Record<string, InstrumentCredit>;

/** 取某乐器的照片 URL（不存在则为 undefined） */
export function getPhotoUrl(id: string): string | undefined {
  return PHOTOS.get(id);
}

/** 取某乐器的试听音频 URL（不存在则为 undefined） */
export function getAudioUrl(id: string): string | undefined {
  return AUDIOS.get(id);
}

/** 取某乐器的素材署名信息（图片/音频分别可能缺失） */
export function getCredits(id: string): InstrumentCredit | undefined {
  return CREDITS[id];
}

/** 当前打包进工具的照片/音频数量（用于 UI 提示/测试） */
export const PHOTO_COUNT = PHOTOS.size;
export const AUDIO_COUNT = AUDIOS.size;
