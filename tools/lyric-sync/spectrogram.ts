/** 时间 × 频率的静态 STFT 频谱。分析与绘制分离，绘制底图按视图缓存。 */

export interface SpectrogramData {
  columns: number;
  rows: number;
  duration: number;
  times: Float32Array;
  /** column-major：一列内的 rows 个频率强度按 0–255 存储 */
  magnitudes: Uint8Array;
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface PaintSpectrumOptions {
  viewStart: number;
  viewEnd: number;
  selection: TimeRange | null;
  playhead: number | null;
  detailWindow?: TimeRange | null;
}

export const SPECTROGRAM_FFT_SIZE = 1024;
const SPECTROGRAM_ROWS = 88;
const MAX_COLUMNS = 18_000;
const CANCELLED = '歌词校准：频谱计算已取消';

export function normalizeView(start: number, end: number, duration: number): TimeRange {
  if (!Number.isFinite(duration) || duration <= 0) return { start: 0, end: 0 };
  const min = Math.min(Math.max(0, Number.isFinite(start) ? start : 0), duration);
  const max = Math.min(Math.max(min, Number.isFinite(end) ? end : duration), duration);
  return { start: min, end: Math.max(min + 0.000001, max) };
}

function cancelledError(): Error {
  return new Error(CANCELLED);
}

function yieldToUI(): Promise<void> {
  // MessageChannel 不受后台页 setTimeout 钳制，且每次仍让浏览器处理输入/绘制任务。
  if (typeof MessageChannel !== 'undefined') {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(0);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 就地 radix-2 FFT，复用工作区避免每个时间列分配大量数组。 */
function fft(real: Float64Array, imaginary: Float64Array): void {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const wReal = Math.cos(angle);
    const wImaginary = Math.sin(angle);
    for (let offset = 0; offset < n; offset += length) {
      let currentReal = 1;
      let currentImaginary = 0;
      for (let j = 0; j < length / 2; j++) {
        const even = offset + j;
        const odd = even + length / 2;
        const oddReal = real[odd] * currentReal - imaginary[odd] * currentImaginary;
        const oddImaginary = real[odd] * currentImaginary + imaginary[odd] * currentReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = currentReal * wReal - currentImaginary * wImaginary;
        currentImaginary = currentReal * wImaginary + currentImaginary * wReal;
        currentReal = nextReal;
      }
    }
  }
}

/** 对数频率带兼顾低频人声辨识度与高频打击乐轮廓。 */
function frequencyBands(sampleRate: number): Uint32Array {
  const bins = SPECTROGRAM_FFT_SIZE / 2;
  const nyquist = sampleRate / 2;
  const low = Math.min(55, nyquist / 2);
  const high = Math.max(low + 1, Math.min(16_000, nyquist));
  const ratio = high / low;
  const bands = new Uint32Array(SPECTROGRAM_ROWS * 2);
  for (let row = 0; row < SPECTROGRAM_ROWS; row++) {
    const fromFrequency = low * ratio ** (row / SPECTROGRAM_ROWS);
    const toFrequency = low * ratio ** ((row + 1) / SPECTROGRAM_ROWS);
    const from = Math.max(1, Math.floor((fromFrequency / nyquist) * bins));
    const to = Math.min(bins - 1, Math.max(from, Math.ceil((toFrequency / nyquist) * bins)));
    bands[row * 2] = from;
    bands[row * 2 + 1] = to;
  }
  return bands;
}

export async function analyzeSamples(
  samples: Float32Array,
  sampleRate: number,
  duration: number,
  onProgress?: (value: number) => void,
  shouldCancel?: () => boolean,
): Promise<SpectrogramData> {
  if (!(samples.length > 0) || !(sampleRate > 0) || !(duration > 0)) {
    throw new Error('音频没有可用于生成频谱的采样数据');
  }
  const estimatedColumns = Math.ceil((duration * sampleRate) / 512);
  const columns = Math.max(1, Math.min(MAX_COLUMNS, estimatedColumns));
  const hop = Math.max(256, Math.ceil(samples.length / columns));
  const actualColumns = Math.max(1, Math.ceil(samples.length / hop));
  const magnitudes = new Uint8Array(actualColumns * SPECTROGRAM_ROWS);
  const times = new Float32Array(actualColumns);
  const window = new Float64Array(SPECTROGRAM_FFT_SIZE);
  for (let i = 0; i < window.length; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (window.length - 1));
  }
  const real = new Float64Array(SPECTROGRAM_FFT_SIZE);
  const imaginary = new Float64Array(SPECTROGRAM_FFT_SIZE);
  const bands = frequencyBands(sampleRate);

  for (let column = 0; column < actualColumns; column++) {
    if (shouldCancel?.()) throw cancelledError();
    const offset = column * hop;
    real.fill(0);
    imaginary.fill(0);
    const count = Math.min(SPECTROGRAM_FFT_SIZE, samples.length - offset);
    for (let i = 0; i < count; i++) real[i] = samples[offset + i] * window[i];
    fft(real, imaginary);

    for (let row = 0; row < SPECTROGRAM_ROWS; row++) {
      const from = bands[row * 2];
      const to = bands[row * 2 + 1];
      let energy = 0;
      for (let bin = from; bin <= to; bin++) {
        energy += real[bin] * real[bin] + imaginary[bin] * imaginary[bin];
      }
      const magnitude = Math.sqrt(energy / (to - from + 1)) / (SPECTROGRAM_FFT_SIZE / 2);
      const decibels = 20 * Math.log10(magnitude + 1e-8);
      const normalized = Math.min(1, Math.max(0, (decibels + 72) / 66));
      magnitudes[column * SPECTROGRAM_ROWS + row] = Math.round(normalized * 255);
    }
    times[column] = Math.min(
      duration,
      (offset + Math.min(count, SPECTROGRAM_FFT_SIZE) / 2) / sampleRate,
    );
    if (column % 24 === 0 || column === actualColumns - 1) {
      onProgress?.((column + 1) / actualColumns);
      await yieldToUI();
    }
  }
  return { columns: actualColumns, rows: SPECTROGRAM_ROWS, duration, times, magnitudes };
}

/** 只混前两声道；单声道不复制，避免长歌曲不必要的 PCM 内存翻倍。 */
export async function computeSpectrogram(
  buffer: AudioBuffer,
  onProgress?: (value: number) => void,
  shouldCancel?: () => boolean,
): Promise<SpectrogramData> {
  if (buffer.numberOfChannels === 1) {
    return analyzeSamples(
      buffer.getChannelData(0),
      buffer.sampleRate,
      buffer.duration,
      onProgress,
      shouldCancel,
    );
  }
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const mono = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) mono[i] = (left[i] + right[i]) * 0.5;
  return analyzeSamples(mono, buffer.sampleRate, buffer.duration, onProgress, shouldCancel);
}

interface SpectrumCache {
  key: string;
  image: HTMLCanvasElement;
}
const caches = new WeakMap<HTMLCanvasElement, SpectrumCache>();

function heatColor(value: number): [number, number, number] {
  // 深色静默 → 蓝紫低声压 → 青色主体 → 暖白峰值。
  if (value < 0.35) {
    const t = value / 0.35;
    return [8 + 44 * t, 13 + 28 * t, 25 + 92 * t];
  }
  if (value < 0.72) {
    const t = (value - 0.35) / 0.37;
    return [52 + 30 * t, 41 + 145 * t, 117 + 102 * t];
  }
  const t = (value - 0.72) / 0.28;
  return [82 + 165 * t, 186 + 60 * t, 219 + 24 * t];
}

const palette = Array.from({ length: 256 }, (_, value) => heatColor(value / 255));

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatRulerTime(value: number): string {
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function paintBase(
  data: SpectrogramData,
  width: number,
  height: number,
  dpr: number,
  start: number,
  end: number,
): HTMLCanvasElement {
  const image = document.createElement('canvas');
  image.width = Math.round(width * dpr);
  image.height = Math.round(height * dpr);
  const ctx = image.getContext('2d');
  if (!ctx) return image;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#080d19';
  ctx.fillRect(0, 0, width, height);
  const plotHeight = height - 27;
  const pixels = ctx.createImageData(image.width, Math.max(1, Math.floor(plotHeight * dpr)));
  const outputWidth = pixels.width;
  const outputHeight = pixels.height;
  for (let y = 0; y < outputHeight; y++) {
    const row = Math.min(
      data.rows - 1,
      Math.floor(((outputHeight - 1 - y) / outputHeight) * data.rows),
    );
    for (let x = 0; x < outputWidth; x++) {
      const time = start + ((x + 0.5) / outputWidth) * (end - start);
      let low = 0;
      let high = data.columns - 1;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (data.times[mid] < time) low = mid + 1;
        else high = mid;
      }
      const column = low;
      const magnitude = data.magnitudes[column * data.rows + row];
      const [r, g, b] = palette[magnitude];
      const offset = (y * outputWidth + x) * 4;
      pixels.data[offset] = r;
      pixels.data[offset + 1] = g;
      pixels.data[offset + 2] = b;
      pixels.data[offset + 3] = 255;
    }
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(pixels, 0, 0);
  ctx.restore();

  const duration = end - start;
  const roughStep = duration / Math.max(2, Math.floor(width / 95));
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const step = steps.find((item) => item >= roughStep) ?? Math.ceil(roughStep / 300) * 300;
  ctx.strokeStyle = 'rgba(148,163,184,0.09)';
  ctx.fillStyle = '#7d8ca8';
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'middle';
  for (let tick = Math.ceil(start / step) * step; tick <= end; tick += step) {
    const x = ((tick - start) / duration) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, plotHeight);
    ctx.stroke();
    const label = step < 1 ? tick.toFixed(step < 0.1 ? 2 : 1) : formatRulerTime(tick);
    ctx.fillText(
      label,
      Math.min(width - ctx.measureText(label).width - 4, Math.max(4, x + 4)),
      height - 13,
    );
  }
  return image;
}

export function drawSpectrogram(
  canvas: HTMLCanvasElement,
  data: SpectrogramData,
  options: PaintSpectrumOptions,
): void {
  const rect = canvas.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (width <= 0 || height <= 0) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const view = normalizeView(options.viewStart, options.viewEnd, data.duration);
  const key = `${width}:${height}:${dpr}:${view.start}:${view.end}`;
  let cache = caches.get(canvas);
  if (!cache || cache.key !== key) {
    cache = { key, image: paintBase(data, width, height, dpr, view.start, view.end) };
    caches.set(canvas, cache);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(cache.image, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const plotHeight = height - 27;
  const xAt = (time: number): number => ((time - view.start) / (view.end - view.start)) * width;

  if (options.detailWindow) {
    const left = xAt(options.detailWindow.start);
    const right = xAt(options.detailWindow.end);
    if (right >= 0 && left <= width) {
      ctx.fillStyle = 'rgba(165,180,252,0.07)';
      ctx.fillRect(
        clamp(left, 0, width),
        0,
        clamp(right, 0, width) - clamp(left, 0, width),
        plotHeight,
      );
      ctx.strokeStyle = 'rgba(165,180,252,0.75)';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(
        clamp(left, 0, width) + 0.5,
        0.5,
        Math.max(0, clamp(right, 0, width) - clamp(left, 0, width) - 1),
        plotHeight - 1,
      );
      ctx.setLineDash([]);
    }
  }

  if (options.selection) {
    const left = xAt(options.selection.start);
    const right = xAt(options.selection.end);
    ctx.fillStyle = 'rgba(2,6,23,0.5)';
    ctx.fillRect(0, 0, clamp(left, 0, width), plotHeight);
    ctx.fillRect(
      clamp(right, 0, width),
      0,
      Math.max(0, width - clamp(right, 0, width)),
      plotHeight,
    );
    ctx.fillStyle = 'rgba(129,140,248,0.09)';
    ctx.fillRect(left, 0, right - left, plotHeight);
    ctx.strokeStyle = '#a5b4fc';
    ctx.lineWidth = 1.5;
    for (const x of [left, right]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, plotHeight);
      ctx.stroke();
    }
  }

  if (options.playhead !== null) {
    const x = xAt(options.playhead);
    if (x >= 0 && x <= width) {
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, plotHeight);
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.moveTo(x - 4, 0);
      ctx.lineTo(x + 4, 0);
      ctx.lineTo(x, 5);
      ctx.closePath();
      ctx.fill();
    }
  }
}
