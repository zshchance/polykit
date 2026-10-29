/**
 * 角色进度条素材层 —— 内置 SVG 精灵、本地上传处理、IndexedDB 素材库与主题染色。
 *
 * 设计要点：
 *   - 内置精灵走 Vite import.meta.glob 就地收集（?url），部署 base 自动适配，
 *     不产生跨域图片，canvas 永远不会被污染（MediaRecorder 导出安全）。
 *   - 上传素材统一处理成「去透明边 + 最长边 ≤384px 的 PNG」后存 IndexedDB，
 *     localStorage 只保存 sva: 素材 id（避免 5MB 配额被图片挤爆）。
 *   - 主题染色用离屏 canvas + source-in：把任意素材的 alpha 当蒙版刷成主色，
 *     单色 iconfont 图标可直接跟随主题。
 *   - 只接受 PNG/JPG/WebP/SVG 静态图；GIF 解码在 P1 单独实现（避免误当首帧）。
 */

import type { BuiltinActorId } from './options';
import type { ImageAsset } from './renderer';

// ─────────────────────────── 内置精灵 ───────────────────────────

const spriteModules = import.meta.glob<string>('./assets/sprites/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});

const SPRITE_URLS = new Map<string, string>();
for (const [path, url] of Object.entries(spriteModules)) {
  const id = /\/([^/]+)\.svg$/.exec(path)?.[1];
  if (id) SPRITE_URLS.set(id, url);
}

/** 内置载体 SVG 的 URL（UI 缩略图用；缺失返回 undefined） */
export function builtinActorSpriteUrl(id: BuiltinActorId): string | undefined {
  return SPRITE_URLS.get(id);
}

// ─────────────────────────── 图片加载与缓存 ───────────────────────────

const IMAGE_CACHE = new Map<string, Promise<ImageAsset | null>>();

/** 把 URL 解码为 ImageAsset；失败返回 null（渲染层会回退发光圆点） */
function decodeImage(url: string): Promise<ImageAsset | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      resolve({
        img,
        w: img.naturalWidth || img.width || 64,
        h: img.naturalHeight || img.height || 64,
      });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** 裁掉素材四周的透明留白，让载体真正填满设定的尺寸（失败时原样返回） */
function trimImageAsset(asset: ImageAsset): ImageAsset {
  try {
    const { cv, ctx } = makeCanvas(asset.w, asset.h);
    ctx.drawImage(asset.img, 0, 0, cv.width, cv.height);
    const trimmed = trimTransparent(cv);
    if (trimmed.width === cv.width && trimmed.height === cv.height) return asset;
    return { img: trimmed, w: trimmed.width, h: trimmed.height };
  } catch {
    return asset;
  }
}

/** 载入内置载体（按 id 缓存，重复调用不会重复解码） */
export function loadBuiltinActor(id: BuiltinActorId): Promise<ImageAsset | null> {
  const key = `builtin:${id}`;
  const cached = IMAGE_CACHE.get(key);
  if (cached) return cached;
  const url = SPRITE_URLS.get(id);
  if (!url) return Promise.resolve(null);
  const p = decodeImage(url).then((asset) => (asset ? trimImageAsset(asset) : null));
  IMAGE_CACHE.set(key, p);
  return p;
}

/** 载入本地上传素材（IndexedDB → Blob URL → Image；缺失返回 null） */
export async function loadUploadedActor(id: string): Promise<ImageAsset | null> {
  const key = `asset:${id}`;
  const cached = IMAGE_CACHE.get(key);
  if (cached) return cached;
  const rec = await getProgressAsset(id);
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  const p = decodeImage(url).finally(() => URL.revokeObjectURL(url));
  IMAGE_CACHE.set(key, p);
  return p;
}

/** 素材删除/覆盖后失效缓存（含该素材的染色缓存） */
export function invalidateActorAssetCache(id: string): void {
  IMAGE_CACHE.delete(`asset:${id}`);
  const prefix = `asset:${id}|`;
  for (const key of Array.from(TINT_CACHE.keys())) {
    if (key.startsWith(prefix)) TINT_CACHE.delete(key);
  }
}

// ─────────────────────────── 主题染色 ───────────────────────────

const TINT_CACHE = new Map<string, ImageAsset>();

/**
 * 用 mono 蒙版把素材刷成指定颜色（结果缓存）。
 * cacheKey 形如 builtin:football / asset:sva:xxx，颜色变化会形成新缓存项。
 */
export function tintActorAsset(cacheKey: string, asset: ImageAsset, color: string): ImageAsset {
  const key = `${cacheKey}|${color}`;
  const cached = TINT_CACHE.get(key);
  if (cached) return cached;

  const w = Math.max(1, Math.round(asset.w));
  const h = Math.max(1, Math.round(asset.h));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return asset;
  ctx.drawImage(asset.img, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);

  const tinted: ImageAsset = { img: canvas, w, h };
  TINT_CACHE.set(key, tinted);
  return tinted;
}

// ─────────────────────────── IndexedDB 素材库 ───────────────────────────

const DB_NAME = 'song-video-assets';
const DB_VERSION = 1;
const STORE = 'assets';
const ID_PATTERN = /^sva:[a-z0-9]{4,32}$/;

export interface ProgressAssetRecord {
  id: string;
  name: string;
  blob: Blob;
  width: number;
  height: number;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function validRecord(it: unknown): it is ProgressAssetRecord {
  if (!it || typeof it !== 'object') return false;
  const o = it as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    ID_PATTERN.test(o.id) &&
    typeof o.name === 'string' &&
    o.blob instanceof Blob &&
    typeof o.width === 'number' &&
    typeof o.height === 'number' &&
    typeof o.createdAt === 'number'
  );
}

function newAssetId(): string {
  return 'sva:' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** 保存一条素材；IndexedDB 不可用时返回 null（调用方提示） */
export async function saveProgressAsset(input: {
  name: string;
  blob: Blob;
  width: number;
  height: number;
}): Promise<ProgressAssetRecord | null> {
  const db = await openDb();
  if (!db) return null;
  const record: ProgressAssetRecord = {
    id: newAssetId(),
    name: input.name,
    blob: input.blob,
    width: input.width,
    height: input.height,
    createdAt: Date.now(),
  };
  const ok = await new Promise<boolean>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
  return ok ? record : null;
}

/** 列出全部素材（新导入的在前） */
export async function listProgressAssets(): Promise<ProgressAssetRecord[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const items = Array.isArray(req.result) ? req.result : [];
        resolve(items.filter(validRecord).sort((a, b) => b.createdAt - a.createdAt));
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** 读取单条素材 */
export async function getProgressAsset(id: string): Promise<ProgressAssetRecord | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(validRecord(req.result) ? req.result : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** 删除素材 */
export async function deleteProgressAsset(id: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

// ─────────────────────────── 上传图处理 ───────────────────────────

/** 静态素材目标尺寸：384px 足够 1080p（载体高度约 0.06-0.18×短边） */
const MAX_IMAGE_SIDE = 384;
/** SVG 先光栅化到 512px，再裁边缩到目标尺寸，保证细线不糊 */
const SVG_RASTER_SIDE = 512;
/** alpha 低于该值视为透明（去边/空白判定） */
const TRIM_ALPHA = 8;

export interface ProcessedActorAsset {
  blob: Blob;
  width: number;
  height: number;
}

/** 文件名 → 展示名（去扩展名、截断 12 字） */
export function cleanAssetName(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '').trim();
  return (base || '我的素材').slice(0, 12);
}

function makeCanvas(
  w: number,
  h: number,
): {
  cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w));
  cv.height = Math.max(1, Math.round(h));
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('当前浏览器无法创建画布，素材处理失败。');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { cv, ctx };
}

/** 把任意来源按最长边 maxSide 等比画进画布（先缩小再裁边，避免扫描超大画布） */
function drawSourceToCanvas(
  img: CanvasImageSource,
  w: number,
  h: number,
  maxSide: number,
): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(1, w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const { cv, ctx } = makeCanvas(cw, ch);
  ctx.drawImage(img, 0, 0, cw, ch);
  return cv;
}

/** 裁掉全透明边（保留 1% 安全边），返回更紧凑的画布 */
function trimTransparent(cv: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return cv;
  const { width, height } = cv;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! > TRIM_ALPHA) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    throw new Error('素材是全透明的，没有可见内容，请换一张。');
  }
  const pad = Math.max(1, Math.round(Math.max(width, height) * 0.01));
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(width - 1, maxX + pad);
  const y1 = Math.min(height - 1, maxY + pad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  if (cw >= width && ch >= height) return cv;
  const { cv: out, ctx: octx } = makeCanvas(cw, ch);
  octx.drawImage(cv, x0, y0, cw, ch, 0, 0, cw, ch);
  return out;
}

/** 限制最长边（等比缩小） */
function limitCanvas(cv: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  if (Math.max(cv.width, cv.height) <= maxSide) return cv;
  const scale = maxSide / Math.max(cv.width, cv.height);
  const { cv: out, ctx } = makeCanvas(cv.width * scale, cv.height * scale);
  ctx.drawImage(cv, 0, 0, out.width, out.height);
  return out;
}

function canvasToPng(cv: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    cv.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('素材编码失败，请换一张图片。'));
    }, 'image/png');
  });
}

async function decodeFile(file: File): Promise<{
  img: CanvasImageSource;
  w: number;
  h: number;
  close?: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { img: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch {
      // 个别格式 createImageBitmap 不支持：回退 Image 解码
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const asset = await decodeImage(url);
    if (!asset) throw new Error('图片解码失败，请换一张试试。');
    return { img: asset.img, w: asset.w, h: asset.h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** PNG / JPG / WebP → 去透明边 + 最长边 ≤384 的 PNG */
export async function prepareImageAsset(file: File): Promise<ProcessedActorAsset> {
  const decoded = await decodeFile(file);
  try {
    const base = drawSourceToCanvas(decoded.img, decoded.w, decoded.h, 1024);
    const trimmed = trimTransparent(base);
    const finalCv = limitCanvas(trimmed, MAX_IMAGE_SIDE);
    return { blob: await canvasToPng(finalCv), width: finalCv.width, height: finalCv.height };
  } finally {
    decoded.close?.();
  }
}

/**
 * SVG 源码清洗：只保留绘图标签，剥掉脚本/事件/外链/样式表，
 * 防止粘贴来的 iconfont SVG 携带脚本或远程引用。
 * 返回 null 表示不是有效的 SVG。
 */
export function sanitizeSvgText(raw: string): string | null {
  const text = raw.trim();
  if (!text || !/<svg[\s>]/i.test(text)) return null;
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return null;
  const svg = doc.documentElement;
  if (!svg || svg.tagName.toLowerCase() !== 'svg') return null;

  doc.querySelectorAll('script, foreignObject, image, style').forEach((el) => el.remove());
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
      } else if (name === 'href' || name === 'xlink:href') {
        // 允许内部片段引用（渐变/use），其余（外链）一律移除
        if (!attr.value.trim().startsWith('#')) el.removeAttribute(attr.name);
      } else if (name === 'style' && /url\s*\(/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }
  if (!doc.querySelector('path, circle, rect, ellipse, polygon, polyline, line')) return null;

  const vb = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!svg.getAttribute('width')) {
    svg.setAttribute('width', String(vb.length === 4 && Number.isFinite(vb[2]) ? vb[2] : 64));
  }
  if (!svg.getAttribute('height')) {
    svg.setAttribute('height', String(vb.length === 4 && Number.isFinite(vb[3]) ? vb[3] : 64));
  }
  return new XMLSerializer().serializeToString(svg);
}

/** SVG 源码（上传文件或 iconfont 粘贴）→ 光栅化 PNG */
export async function prepareSvgAsset(text: string): Promise<ProcessedActorAsset> {
  const cleaned = sanitizeSvgText(text);
  if (!cleaned) {
    throw new Error('没识别到有效的 SVG 图形——请粘贴完整的 <svg>…</svg> 代码。');
  }
  const blob = new Blob([cleaned], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const asset = await decodeImage(url);
    if (!asset) throw new Error('SVG 渲染失败，请确认文件完整。');
    // 小尺寸 SVG（如 iconfont width=200）先放大到 512 再裁边，避免细线糊掉
    const upscale = Math.max(1, SVG_RASTER_SIDE / Math.max(1, asset.w, asset.h));
    const base = drawSourceToCanvas(
      asset.img,
      asset.w * upscale,
      asset.h * upscale,
      SVG_RASTER_SIDE,
    );
    const trimmed = trimTransparent(base);
    const finalCv = limitCanvas(trimmed, MAX_IMAGE_SIDE);
    return { blob: await canvasToPng(finalCv), width: finalCv.width, height: finalCv.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
