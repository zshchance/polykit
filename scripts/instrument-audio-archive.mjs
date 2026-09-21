// @ts-check
/**
 * 乐器百科音频补齐器（备用源）—— 从 Internet Archive 搜索并下载缺失乐器的
 * 声音样本，作为 Wikimedia Commons 持续限流时的备用素材渠道。
 *
 * 用法：node scripts/instrument-audio-archive.mjs [--only id1,id2] [--force]
 * 流程：advancedsearch 检索 → metadata 挑 ≥13s 的音频文件 → 直链下载 →
 *       ffmpeg 截 12s + 淡出 → ffprobe 时长闸门（≥10s）→ credits.json 记录来源。
 * 许可：优先带 licenseurl 的条目（CC/Public Domain），如实写入 credits。
 */
import { readFile, writeFile, access, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { setDefaultResultOrder } from 'node:dns';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

setDefaultResultOrder('ipv4first');
const run = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const AUDIOS_DIR = resolve(ROOT, 'tools/instrument-atlas/assets/audio');
const CREDITS_PATH = resolve(ROOT, 'tools/instrument-atlas/assets/credits.json');

const UA = 'StaticToolkitInstrumentAtlas/1.0 (educational static site; contact via github)';
const PROXY = process.env.IA_PROXY || '';
const SPAWN_ENV = PROXY
  ? { ...process.env, http_proxy: PROXY, https_proxy: PROXY, HTTP_PROXY: PROXY, HTTPS_PROXY: PROXY }
  : undefined;
const AUDIO_SECONDS = 12;

/** 每件乐器的 archive.org 检索词（挑贴切的独奏/主导录音） */
const QUERIES = {
  bassoon: 'bassoon',
  cajon: 'cajon',
  celesta: 'celesta',
  'electric-guitar': 'electric guitar',
  'electric-piano': 'electric piano',
  erhu: 'erhu',
  glockenspiel: 'glockenspiel',
  guqin: 'guqin',
  handpan: 'handpan',
  pipa: 'pipa',
  saxophone: 'saxophone',
  shamisen: 'shamisen',
  suona: 'suona',
  theremin: 'theremin',
  timpani: 'timpani',
  tuba: 'tuba',
  vocoder: 'vocoder',
  xylophone: 'xylophone',
};

const onlyArg = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 && process.argv[i + 1] ? new Set(process.argv[i + 1].split(',')) : null;
})();
const FORCE = process.argv.includes('--force');
const targets = Object.keys(QUERIES).filter((id) => !onlyArg || onlyArg.has(id));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true).catch(() => false);

async function getJSON(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (attempt < 3) {
      await sleep(1500 * attempt);
      return getJSON(url, attempt + 1);
    }
    throw e;
  }
}

async function download(url, dest) {
  await run('curl', [
    '-sS', '-L',
    ...(PROXY ? ['-x', PROXY] : []),
    '--connect-timeout', '10',
    '--max-time', '180',
    '--speed-limit', '1024', '--speed-time', '25',
    '-A', UA,
    '-o', dest,
    url,
  ]);
}

/** 低质来源黑名单：radio aporee 街头环境录音、78rpm/蜡筒老转录（底噪大） */
const BAD_SOURCE = /aporee|^78|[-_]78\b|cylinder|78rpm|gramophone/i;

/** 质量评分：录音室 CC 发行（jamendo/musopen 镜像）> 带 licenseurl 的正式条目 > 其他 */
function qualityScore(doc) {
  let s = 0;
  if (/^jamendo-/.test(doc.identifier)) s += 4; // Jamendo 全站 CC，现代发行
  if (/musopen/i.test(doc.identifier)) s += 4; // Musopen 专业古典录音镜像
  if (doc.licenseurl) s += 2;
  if (BAD_SOURCE.test(doc.identifier) || BAD_SOURCE.test(String(doc.title))) s -= 20;
  return s;
}

/** 搜索：按质量评分排序，过滤负分条目 */
async function searchItems(q, rows = 20) {
  const url =
    `https://archive.org/advancedsearch.php?q=title%3A%28${encodeURIComponent(q)}%29+AND+mediatype%3A%28audio%29` +
    `&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=licenseurl&fl%5B%5D=creator&rows=${rows}&output=json`;
  const data = await getJSON(url);
  const docs = (data.response?.docs || []).filter(
    (d) => qualityScore(d) > -10 && !BAD_SOURCE.test(d.identifier),
  );
  return docs.sort((a, b) => qualityScore(b) - qualityScore(a));
}

/** 元数据：返回 { files: [{name, format, length}], licenseurl, creator, title } */
async function itemMeta(id) {
  const m = await getJSON(`https://archive.org/metadata/${encodeURIComponent(id)}`);
  return {
    files: (m.files || []).filter((f) =>
      /mp3|ogg|oga|flac|wav|m4a/i.test(f.format || '') || /\.(mp3|ogg|oga|flac|wav|m4a)$/i.test(f.name || ''),
    ),
    licenseurl: m.metadata?.licenseurl || '',
    creator: m.metadata?.creator || m.metadata?.artist || 'Internet Archive 上传者',
    title: m.metadata?.title || id,
  };
}

function parseLength(s) {
  if (!s) return -1;
  if (s.includes(':')) {
    return s.split(':').reduce((acc, x) => acc * 60 + Number.parseFloat(x), 0);
  }
  return Number.parseFloat(s) || -1;
}

/** 检测开头静音/试音段长度：silencedetect 找首个声音起点（最多跳 30s）。
 *  archive.org 录音常带报幕、调音、长静音前缀，直接从 0 截取会全是噪音。 */
async function detectLeadSilence(file) {
  try {
    const r = await run('ffmpeg', [
      '-i', file, '-t', '45',
      '-af', 'silencedetect=noise=-35dB:d=0.8',
      '-f', 'null', '-',
    ]);
    const err = r.stderr || '';
    const startsAtZero = /silence_(start|end): -?0[\d.]/.test(err) || err.includes('silence_start: 0');
    const m = [...err.matchAll(/silence_end: ([\d.]+)/g)];
    if (startsAtZero && m.length > 0) {
      return Math.min(Number.parseFloat(m[0][1]), 30);
    }
  } catch (e) {
    // silencedetect 失败（如整段静音）则回退 0 起点，由时长闸门兜底
  }
  return 0;
}

async function main() {
  const credits = JSON.parse(await readFile(CREDITS_PATH, 'utf8').catch(() => '{}'));
  let ok = 0;
  const fail = [];

  for (const id of targets) {
    const out = resolve(AUDIOS_DIR, `${id}.mp3`);
    if (!FORCE && (await exists(out))) {
      console.log(`↷ ${id} 已存在，跳过`);
      continue;
    }
    let done = false;
    try {
      const items = await searchItems(QUERIES[id]);
      await sleep(900);
      // 每个乐器最多试 6 个条目，取第一个能产出 ≥10s 剪辑的
      outer: for (const it of items.slice(0, 6)) {
        let meta;
        try {
          meta = await itemMeta(it.identifier);
        } catch {
          continue;
        }
        await sleep(900);
        // 挑时长 ≥13s 的音频文件（优先 mp3/ogg）
        const cand = meta.files
          .map((f) => ({ ...f, sec: parseLength(f.length) }))
          .filter((f) => f.sec >= 13)
          .sort((a, b) => Number(/\.mp3$/i.test(b.name)) - Number(/\.mp3$/i.test(a.name)) || a.sec - b.sec);
        for (const f of cand.slice(0, 3)) {
          const tmp = resolve('/tmp', `ia-arch-${id}-${createHash('md5').update(f.name).digest('hex').slice(0, 6)}.${(f.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'bin').toLowerCase()}`);
          const url = `https://archive.org/download/${encodeURIComponent(it.identifier)}/${encodeURIComponent(f.name)}`;
          try {
            await download(url, tmp);
            // 跳过开头静音/试音，从首个声音处截取
            const lead = await detectLeadSilence(tmp);
            await run('ffmpeg', [
              '-y', '-v', 'error',
              '-ss', String(lead),
              '-i', tmp,
              '-t', String(AUDIO_SECONDS),
              '-af', `afade=t=out:st=${AUDIO_SECONDS - 2}:d=2`,
              '-c:a', 'libmp3lame', '-q:a', '5',
              out,
            ]);
            const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]);
            const dur = Number.parseFloat(probe.stdout.trim());
            if (!Number.isFinite(dur) || dur < 10) {
              await rm(out, { force: true });
              continue;
            }
            credits[id] = credits[id] || {};
            credits[id].audio = {
              title: `${meta.title}（${f.name}）`,
              artist: meta.creator,
              license: it.licenseurl ? `Internet Archive · ${it.licenseurl.includes('creativecommons') ? 'CC（见来源）' : '见来源'}` : 'Internet Archive · 许可见来源页',
              source: `https://archive.org/details/${it.identifier}`,
            };
            ok++;
            done = true;
            console.log(`✓ ${id} ← archive.org/${it.identifier}（${dur.toFixed(0)}s）`);
            await writeFile(CREDITS_PATH, JSON.stringify(credits, null, 2));
            break outer;
          } catch (e) {
            // 该文件失败（下载/转换/闸门），试下一个
          }
        }
      }
    } catch (e) {
      // 搜索层面失败
    }
    if (!done) {
      fail.push(id);
      console.log(`✗ ${id}：archive.org 无合适素材`);
    }
    await sleep(1200);
  }

  console.log(`\n完成：成功 ${ok}，失败 ${fail.length}${fail.length ? '：' + fail.join(', ') : ''}`);
}

await main();
