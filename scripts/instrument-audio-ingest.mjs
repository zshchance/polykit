// @ts-check
/**
 * 乐器百科音频入库器 —— 处理 scripts/instrument-audio-inbox/ 里手动下载的
 * 原始音频文件：跳过开头静音/试音 → 截 12s + 淡出 → 时长闸门（≥10s）→
 * 转成 assets/audio/<乐器id>.mp3，并从 manifest 反查 Commons 署名写入 credits。
 *
 * inbox 文件名即 manifest 里的 Commons 文件名（下载清单.md 生成的原名）。
 * 用法：node scripts/instrument-audio-ingest.mjs
 */
import { readdir, readFile, writeFile, access, rm, mkdir, copyFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const INBOX = resolve(__dirname, 'instrument-audio-inbox');
const AUDIOS_DIR = resolve(ROOT, 'tools/instrument-atlas/assets/audio');
const CREDITS_PATH = resolve(ROOT, 'tools/instrument-atlas/assets/credits.json');
const MANIFEST_PATH = resolve(__dirname, 'instrument-assets.manifest.json');
const AUDIO_SECONDS = 12;

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
const credits = JSON.parse(await readFile(CREDITS_PATH, 'utf8').catch(() => '{}'));

/** Commons 文件名（下划线形式）→ 乐器 id */
const BY_FILE = new Map();
for (const [id, m] of Object.entries(manifest)) {
  if (m.audio) {
    BY_FILE.set(m.audio.replace(/^File:/, '').replace(/ /g, '_'), id);
  }
}

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
    if (startsAtZero && m.length > 0) return Math.min(Number.parseFloat(m[0][1]), 30);
  } catch {}
  return 0;
}

await mkdir(AUDIOS_DIR, { recursive: true });
const files = (await readdir(INBOX)).filter((f) => extname(f) && f !== '下载清单.md' && !f.startsWith('.'));
if (!files.length) {
  console.log('inbox 为空：请先按 下载清单.md 下载文件到 scripts/instrument-audio-inbox/');
  process.exit(0);
}

let ok = 0;
for (const f of files) {
  const key = f.replace(/ /g, '_');
  const id = BY_FILE.get(key);
  const src = resolve(INBOX, f);
  const out = resolve(AUDIOS_DIR, `${id}.mp3`);
  if (!id) {
    console.log(`↷ ${f}：不在 manifest 中，跳过`);
    continue;
  }
  try {
    const lead = await detectLeadSilence(src);
    await run('ffmpeg', [
      '-y', '-v', 'error',
      '-ss', String(lead),
      '-i', src,
      '-t', String(AUDIO_SECONDS),
      '-af', `afade=t=out:st=${AUDIO_SECONDS - 2}:d=2`,
      '-c:a', 'libmp3lame', '-q:a', '5',
      out,
    ]);
    const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]);
    const dur = Number.parseFloat(probe.stdout.trim());
    if (!Number.isFinite(dur) || dur < 10) {
      await rm(out, { force: true });
      throw new Error(`时长仅 ${dur ?? '?'}s`);
    }
    // 署名：从 Commons API 拉一次（API 主机不受限流影响）
    try {
      const api = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent('File:' + key)}&prop=imageinfo&iiprop=url%7Cextmetadata&format=json`;
      const res = await fetch(api, { headers: { 'User-Agent': 'StaticToolkit/1.0' }, signal: AbortSignal.timeout(15000) });
      const data = await res.json();
      const page = Object.values(data.query?.pages || {})[0];
      const ii = page?.imageinfo?.[0];
      if (ii) {
        const em = ii.extmetadata || {};
        const strip = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        credits[id] = credits[id] || {};
        credits[id].audio = {
          title: key,
          artist: strip(em.Artist?.value) || 'Wikimedia Commons',
          license: em.LicenseShortName?.value || '见源页面',
          source: ii.descriptionurl,
        };
      }
    } catch {}
    ok++;
    console.log(`✓ ${id} ← ${f}（跳过开头 ${lead.toFixed(1)}s，${dur.toFixed(0)}s）`);
  } catch (e) {
    console.log(`✗ ${id} ← ${f}: ${e.message}`);
  }
}

await writeFile(CREDITS_PATH, JSON.stringify(credits, null, 2));
const total = (await readdir(AUDIOS_DIR)).filter((f) => f.endsWith('.mp3')).length;
console.log(`\n完成：成功 ${ok}，当前音频 ${total}/50`);
