/**
 * ICO 编码 —— 零依赖手写 ICO 容器。
 *
 * 为什么需要手写：canvas 只能输出 PNG/JPEG/WebP，无法输出 ICO。
 * 但 ICO 格式允许「内嵌 PNG」——目录项声明 bpp=32，数据段直接放一张 PNG 字节。
 * 这是现代浏览器（含所有主流 favicon 渲染）都支持的合法写法，无需做 BMP 位图编码。
 *
 * 容器结构（小端）：
 *   ICONDIR  (6B)：reserved(2B)=0 / type(2B)=1(图标) / count(2B)=图像数
 *   ICONDIRENTRY[] (每项 16B)：
 *     width(1B)、height(1B)   —— 0 表示 256，本工具 ≤64 直接写实值
 *     colorCount(1B)=0(真彩) / reserved(1B)=0
 *     planes(2B)=1 / bitCount(2B)=32
 *     bytesInRes(4B)=该 PNG 字节数 / imageOffset(4B)=相对文件头偏移
 *   数据段：各尺寸的 PNG 字节，依次拼接
 *
 * 每个尺寸做方形 contain-fit（等比缩放居中，透明底），保证非正方形原图也能安全落格。
 */

/** 把位图按指定正方形尺寸 contain-fit 渲染为 PNG Blob（透明底） */
async function renderPngSize(bitmap: ImageBitmap, size: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('当前环境不支持 2D 画布');
  // 透明底（不填色），contain-fit 等比缩放居中
  const scale = Math.min(size / bitmap.width, size / bitmap.height);
  const dw = Math.max(1, Math.round(bitmap.width * scale));
  const dh = Math.max(1, Math.round(bitmap.height * scale));
  const dx = Math.round((size - dw) / 2);
  const dy = Math.round((size - dh) / 2);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, dx, dy, dw, dh);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('PNG 编码失败'))),
      'image/png',
    );
  });
}

/**
 * 把位图编码为多尺寸 ICO Blob。
 * @param bitmap 源位图
 * @param sizes 目标尺寸集合（像素，正方形边长）；已排序去重更稳
 * @returns image/x-icon Blob
 */
export async function encodeIco(bitmap: ImageBitmap, sizes: number[]): Promise<Blob> {
  const sorted = [...new Set(sizes)]
    .filter((s) => Number.isFinite(s) && s > 0 && s <= 256)
    .sort((a, b) => a - b);
  const list = sorted.length > 0 ? sorted : [16, 32, 48];

  // 先把每个尺寸的 PNG 字节算出来
  const pngs: Blob[] = [];
  for (const s of list) {
    pngs.push(await renderPngSize(bitmap, s));
  }

  // 偏移：ICONDIR(6) + N×ICONDIRENTRY(16)
  const count = pngs.length;
  const headerSize = 6 + count * 16;

  // 用 ArrayBuffer + DataView 精确写入小端整数
  const total = headerSize + pngs.reduce((acc, b) => acc + b.size, 0);
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // ICONDIR
  dv.setUint16(0, 0, true); // reserved
  dv.setUint16(2, 1, true); // type = 1 (icon)
  dv.setUint16(4, count, true);

  // ICONDIRENTRY[] + 数据段
  let dataOffset = headerSize;
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    const px = list[i]!;
    const png = pngs[i]!;
    // 256 在 ICO 里用 0 表示
    dv.setUint8(entry + 0, px >= 256 ? 0 : px); // width
    dv.setUint8(entry + 1, px >= 256 ? 0 : px); // height
    dv.setUint8(entry + 2, 0); // colorCount（0=真彩）
    dv.setUint8(entry + 3, 0); // reserved
    dv.setUint16(entry + 4, 1, true); // planes
    dv.setUint16(entry + 6, 32, true); // bitCount
    dv.setUint32(entry + 8, png.size, true); // bytesInRes
    dv.setUint32(entry + 12, dataOffset, true); // imageOffset

    // 数据段：拷贝 PNG 字节
    u8.set(new Uint8Array(await png.arrayBuffer()), dataOffset);
    dataOffset += png.size;
  }

  return new Blob([buf], { type: 'image/x-icon' });
}
