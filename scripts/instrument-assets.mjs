// @ts-check
/**
 * 乐器百科素材抓取器 —— 为每件乐器收集"照片 + 声音样本"。
 *
 * 素材策略：
 *   图片 → 优先取英文维基百科词条首图（编辑精选，质量最稳），Commons 全文检索兜底
 *   音频 → Wikimedia Commons 全文检索（filetype:audio），按名称匹配度评分挑选
 *
 * 三阶段工作流：
 *   1) node scripts/instrument-assets.mjs search   → 候选写 scripts/instrument-assets.candidates.json（增量保存，可断点续跑）
 *   2) node scripts/instrument-assets.mjs pick     → 启发式+MANUAL_PICKS 写 scripts/instrument-assets.manifest.json
 *   3) node scripts/instrument-assets.mjs fetch [--force] → 下载转换进 tools/instrument-atlas/assets/，署名写 credits.json
 *
 * 通用参数：--only a,b 只处理指定乐器；search 阶段可用 --force 重搜。
 */
import { mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDefaultResultOrder } from 'node:dns';
import { createHash } from 'node:crypto';

// 沙箱/部分网络无 IPv6 路由，Node fetch 会卡在 IPv6 连接超时——强制 IPv4 优先
setDefaultResultOrder('ipv4first');

const run = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TOOL = resolve(ROOT, 'tools/instrument-atlas');
const CANDIDATES_PATH = resolve(__dirname, 'instrument-assets.candidates.json');
const MANIFEST_PATH = resolve(__dirname, 'instrument-assets.manifest.json');
const CREDITS_PATH = resolve(TOOL, 'assets/credits.json');
const PHOTOS_DIR = resolve(TOOL, 'assets/photos');
const AUDIOS_DIR = resolve(TOOL, 'assets/audio');

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const UA = 'StaticToolkitInstrumentAtlas/1.0 (educational static site; contact via github)';
/** 可选代理（如 IA_PROXY=http://127.0.0.1:7890）：curl 加 -x，ffmpeg 注入环境变量 */
const PROXY = process.env.IA_PROXY || '';
const SPAWN_ENV = PROXY
  ? { ...process.env, http_proxy: PROXY, https_proxy: PROXY, HTTP_PROXY: PROXY, HTTPS_PROXY: PROXY }
  : undefined;

const AUDIO_SECONDS = 12;

/** 人工指定（pick 阶段优先于启发式）：{ id: { photo?: 'File:...', audio?: 'File:...' } } */
const MANUAL_PICKS = {
  // —— 键盘 ——
  piano: { audio: 'File:Satie Gymnopedie No. 3 for piano solo 01.wav' },
  'electric-piano': { audio: 'File:Wurlitzer EP200.mp3' },
  organ: { audio: 'File:Mendelssohn organ sonata B-flat major op. 65 no. 4 Wolfram Syré.mp3' },
  harpsichord: {
    audio: 'File:Handel - Suites for Harpsichord - No.5 in E major - The Harmonious Blacksmith.ogg',
  },
  celesta: { audio: 'File:Cascading arpeggios on celesta from Sugar Plum Fairy.wav' },
  accordion: {
    audio: "File:Schubert's Ave Maria, D.839 (accordion orchestra) - Paul De Bra.ogg",
  },
  // —— 弓弦 ——
  violin: {
    audio: 'File:J. S. Bach – Violin Sonata No.1 in G minor, BWV 1001, I. Adagio.ogg',
  },
  viola: { audio: 'File:Telemann - Viola Concerto Gmaj - 2. Allegro.ogg' },
  cello: {
    photo: 'File:Cello front side.png',
    audio: 'File:JOHN MICHEL CELLO-J S BACH CELLO SUITE 1 in G Prelude.ogg',
  },
  'double-bass': {
    photo: 'File:Double Bass MET DP217153.jpg',
    audio: 'File:Jazz walking bass on double bass.oga',
  },
  // —— 弹拨 ——
  'acoustic-guitar': {
    photo: 'File:00 Walden Acoustic Guitar D310e 01.jpg',
    audio: 'File:Jason Shaw - SOLO ACOUSTIC GUITAR.ogg',
  },
  'electric-guitar': {
    photo: 'File:Guitarra eléctrica.JPG',
    audio: 'File:Guitar Solo in a minor.ogg',
  },
  'bass-guitar': { audio: 'File:Funky Slap Bass line.ogg' },
  ukulele: {
    photo: 'File:17 inch pocket ukulele branded "ultnice".jpg',
    audio: 'File:Ukulele playing.ogg',
  },
  harp: {
    photo: 'File:Salvi harp Diana.jpg',
    audio: 'File:Evening Fall (Harp) (ISRC USUAN1100236).mp3',
  },
  banjo: {
    photo: 'File:Bluegrass banjo.png',
    audio:
      'File:Carnival of Venice, composed by Julius Benedict, arranged for banjo and played by Alfred A. Farland.flac',
  },
  mandolin: { audio: 'File:Antonio Vivaldi, Mandolin Concerto in C major, RV 425.ogg' },
  // —— 木管 ——
  flute: { audio: 'File:Bach - Partita For Solo Flute - Modern Flute - 3. Sarabande.ogg' },
  // piccolo：Commons 无合格音频（搜到的均为发音示范），显式跳过，详情页自动隐藏播放器
  piccolo: { audio: 'NONE' },
  clarinet: { audio: 'File:Wolfgang Amadeus Mozart - Clarinet Concerto - 2. Adagio.ogg' },
  oboe: { audio: 'File:Mourning Song (ISRC USUAN1100431).mp3' },
  bassoon: { audio: 'File:Bassoon beethoven.ogg' },
  saxophone: {
    photo: 'File:Yamaha YAS-25 Alto Saxophone 20080502.jpg',
    audio:
      'File:Georg Philipp Telemann - Fantasia No 11 - Soprano saxophone - David Hernando Vitores.ogg',
  },
  // —— 铜管 ——
  trumpet: { audio: 'File:Harry Gozzard trumpet solo in Donahue band.ogg' },
  'french-horn': { audio: 'File:Hunting horn tone.ogg' },
  trombone: { audio: 'File:RakeoianAnthem (trombone solo).wav' },
  tuba: { audio: 'File:Sousaphone.ogg' }, // Tuba-range 系列仅 ~7s 音域演示，换大号家族实录
  flugelhorn: {
    photo: 'File:Yamaha Flugelhorn YFH-8310Z.jpg',
    audio: 'File:Short flugelhorn excerpt.ogg',
  },
  // —— 打击 ——
  'drum-kit': {
    photo: 'File:A drum kit made by Mapex Drums - Cacon Photos- Copyleft - Creative Commons 11.jpg',
    audio: 'File:Drum beat.ogg',
  },
  timpani: {
    photo: 'File:Standard timpani setup.jpg',
    audio: 'File:Paukenwirbel auf einer Wiener Pauke mit acht verschiedenen Schlegeln.ogg',
  },
  marimba: { audio: 'File:Exemple marimba.ogg' },
  xylophone: {
    photo: 'File:Xylophone Metallophone IMG 9447.jpg',
    audio: 'File:Bali xylophone.ogg',
  },
  glockenspiel: {
    photo: 'File:Glockenspiel-malletech.jpg',
    audio: 'File:Glockenspiel 1. Mai Alle meine Entchen.ogg',
  },
  cajon: { audio: 'File:Cajon Peruano Parche.ogg' },
  // —— 中国民族 ——
  erhu: { photo: 'File:Erhu.png', audio: 'File:二泉映月.ogg' },
  guzheng: { audio: 'File:Guzheng Morning (Antti Luode).mp3' },
  pipa: { photo: 'File:Pipa MET DP216711.jpg', audio: 'File:Pipa - sound.ogg' },
  dizi: { photo: 'File:Dizi MET mi65.149.R.jpg', audio: 'File:DiZi Chinese Flute Sample.ogg' },
  // xiao：Commons 无合格音频（搜到的均为发音示范），显式跳过；照片勿选「肖战」
  xiao: { photo: 'File:Xiao MET DP216557.jpg', audio: 'NONE' },
  suona: { photo: 'File:Suona xinesa.jpg', audio: 'File:Suona.ogg' },
  guqin: { audio: 'File:Guqin-Yangguan Sandie.ogg' },
  // —— 世界民族 ——
  shamisen: { audio: 'File:Shamisenwithvocals 2006.ogg' },
  sitar: { audio: 'File:Raga Bag Bhim, Ranjit Makkuni.ogg' },
  kalimba: {
    photo: 'File:Kalimba hata.jpg',
    audio: 'File:Kalimba de coco (notas sueltas) 01.wav',
  },
  handpan: { photo: 'File:Handpan 2014.jpg', audio: 'File:Hang 2007 vertical.ogg' },
  panflute: { audio: 'File:Daniel Alomía Robles - El Cóndor Pasa.ogg' }, // 首选持续 429，备选见 candidates
  bagpipe: {
    photo: 'File:Bagpipe, Musical Instrument Museum, Brussels.jpg',
    audio: 'File:Duet Musette (ISRC USUAN1100250).mp3',
  },
  // —— 电子 ——
  synthesizer: { photo: 'File:Moog Prodigy.png', audio: 'File:JP-4 Bass Arpeggio.ogg' },
  theremin: { audio: 'File:Theremin walking bass.ogg' },
  'drum-machine': {
    photo: 'File:TR-808 - MIM, Phoenix (2019-08-30 14.59.26 by Bryan Pocius) (cropped).jpg',
    audio: 'File:808vstsample.ogg',
  },
  sampler: { photo: 'File:Akai MPC2000XL.jpg', audio: 'File:Beat Hip hop.wav' },
  vocoder: {
    photo: 'File:Korg VC-10 Vocoder.jpg',
    audio: 'File:Vocoder demo.ogg',
  },
};

/**
 * 每件乐器：en.wiki 词条名（取首图）+ Commons 音频检索词
 */
const QUERIES = {
  piano: { wiki: 'Piano', audio: 'piano solo' },
  'electric-piano': { wiki: 'Rhodes piano', audio: 'Rhodes piano' },
  organ: { wiki: 'Pipe organ', audio: 'pipe organ' },
  harpsichord: { wiki: 'Harpsichord', audio: 'harpsichord' },
  celesta: { wiki: 'Celesta', audio: 'celesta' },
  accordion: { wiki: 'Accordion', audio: 'accordion music' },
  violin: { wiki: 'Violin', audio: 'violin solo' },
  viola: { wiki: 'Viola', audio: 'viola music' },
  cello: { wiki: 'Cello', audio: 'cello suite' },
  'double-bass': { wiki: 'Double bass', audio: 'double bass' },
  'acoustic-guitar': { wiki: 'Acoustic guitar', audio: 'acoustic guitar' },
  'electric-guitar': { wiki: 'Electric guitar', audio: 'electric guitar' },
  'bass-guitar': { wiki: 'Bass guitar', audio: 'bass guitar' },
  ukulele: { wiki: 'Ukulele', audio: 'ukulele' },
  harp: { wiki: 'Pedal harp', audio: 'harp music' },
  banjo: { wiki: 'Banjo', audio: 'banjo' },
  mandolin: { wiki: 'Mandolin', audio: 'mandolin' },
  flute: { wiki: 'Western concert flute', audio: 'flute solo' },
  piccolo: { wiki: 'Piccolo', audio: 'piccolo' },
  clarinet: { wiki: 'Clarinet', audio: 'clarinet concerto' },
  oboe: { wiki: 'Oboe', audio: 'oboe solo' },
  bassoon: { wiki: 'Bassoon', audio: 'bassoon' },
  saxophone: { wiki: 'Saxophone', audio: 'saxophone solo' },
  trumpet: { wiki: 'Trumpet', audio: 'trumpet call' },
  'french-horn': { wiki: 'French horn', audio: 'french horn' },
  trombone: { wiki: 'Trombone', audio: 'trombone' },
  tuba: { wiki: 'Tuba', audio: 'tuba' },
  flugelhorn: { wiki: 'Flugelhorn', audio: 'flugelhorn' },
  'drum-kit': { wiki: 'Drum kit', audio: 'drum kit beat' },
  timpani: { wiki: 'Timpani', audio: 'timpani' },
  marimba: { wiki: 'Marimba', audio: 'marimba' },
  xylophone: { wiki: 'Xylophone', audio: 'xylophone' },
  glockenspiel: { wiki: 'Glockenspiel', audio: 'glockenspiel' },
  cajon: { wiki: 'Cajón', audio: 'cajon' },
  erhu: { wiki: 'Erhu', audio: 'erhu' },
  guzheng: { wiki: 'Guzheng', audio: 'guzheng' },
  pipa: { wiki: 'Pipa', audio: 'pipa' },
  dizi: { wiki: 'Dizi (instrument)', audio: 'dizi flute' },
  xiao: { wiki: 'Xiao (flute)', audio: 'xiao flute' },
  suona: { wiki: 'Suona', audio: 'suona' },
  guqin: { wiki: 'Guqin', audio: 'guqin' },
  shamisen: { wiki: 'Shamisen', audio: 'shamisen' },
  sitar: { wiki: 'Sitar', audio: 'sitar raga' },
  kalimba: { wiki: 'Kalimba', audio: 'kalimba' },
  handpan: { wiki: 'Handpan', audio: 'handpan' },
  panflute: { wiki: 'Pan flute', audio: 'pan flute' },
  bagpipe: { wiki: 'Great Highland bagpipe', audio: 'bagpipes' },
  synthesizer: { wiki: 'Minimoog', audio: 'analog synthesizer' },
  theremin: { wiki: 'Theremin', audio: 'theremin' },
  'drum-machine': { wiki: 'Roland TR-808', audio: 'TR-808' },
  sampler: { wiki: 'Sampler (musical instrument)', audio: 'MPC 3000' },
  vocoder: { wiki: 'Vocoder', audio: 'vocoder' },
};

const IDS = Object.keys(QUERIES);

// ─────────── 参数 ───────────

const onlyArg = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 && process.argv[i + 1] ? new Set(process.argv[i + 1].split(',')) : null;
})();
const FORCE = process.argv.includes('--force');
const targets = IDS.filter((id) => !onlyArg || onlyArg.has(id));

// ─────────── 工具 ───────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) =>
  access(p)
    .then(() => true)
    .catch(() => false);

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function apiJson(base, params, attempt = 1) {
  const url = `${base}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (attempt < 3) {
      await sleep(1500 * attempt);
      return apiJson(base, params, attempt + 1);
    }
    throw e;
  }
}

/** en.wiki 词条首图 → Commons 文件标题（File:...） */
async function wikiLeadImage(article) {
  const data = await apiJson(WIKI_API, {
    action: 'query',
    titles: article,
    prop: 'pageimages',
    piprop: 'name|original',
    redirects: '1',
  });
  const page = Object.values(data.query?.pages || {})[0];
  const name = page?.pageimage;
  return name ? `File:${name}` : null;
}

async function commonsSearch(query, kind, limit = 8) {
  const filetype = kind === 'audio' ? 'filetype:audio' : 'filetype:bitmap';
  const data = await apiJson(COMMONS_API, {
    action: 'query',
    list: 'search',
    srsearch: `${query} ${filetype}`,
    srnamespace: '6',
    srlimit: String(limit),
  });
  return (data.query?.search || []).map((r) => r.title);
}

/**
 * 下载：走 curl 子进程——本网络对 upload.wikimedia.org 存在间歇性连接黑洞
 * （SYN 被丢弃，Node fetch 的总超时 90s 会在死窗口里白等）。
 * curl 的 --connect-timeout 能在 6s 内识别死窗口快速失败，--speed-time
 * 兜底卡死传输；失败由调用方按"窗口节奏"重试。
 * 设置 IA_PROXY=http://127.0.0.1:7890 时 curl 走代理（绕开黑洞）。
 */
async function download(url, dest) {
  await run('curl', [
    '-sS', '-L',
    ...(PROXY ? ['-x', PROXY] : []),
    '--connect-timeout', '8',
    '--max-time', '120',
    '--speed-limit', '1024', '--speed-time', '20', // <1KB/s 持续 20s 视为卡死
    // 不用 --retry：429 属 transient 错误会被 curl 重试并刷新源站惩罚计时器，
    // 快速失败交给调用方按窗口节奏统一处理
    '-A', UA,
    '-o', dest,
    url,
  ]);
}

// ─────────── 阶段一：search（增量保存） ───────────

async function doSearch() {
  let out = {};
  if (!FORCE) out = JSON.parse(await readFile(CANDIDATES_PATH, 'utf8').catch(() => '{}'));
  let wikiUp = true; // en.wiki 不可达时自动降级为纯 Commons 检索

  for (const id of targets) {
    if (!FORCE && out[id]?.wikiLead && out[id]?.photos?.length && out[id]?.audios?.length) {
      console.log(`↷ ${id}（已有候选，跳过；--force 重搜）`);
      continue;
    }
    const q = QUERIES[id];
    const prev = out[id] || { photos: [], audios: [], wikiLead: null };
    const entry = { ...prev };
    if (wikiUp) {
      try {
        entry.wikiLead = (await wikiLeadImage(q.wiki)) || prev.wikiLead;
      } catch (e) {
        console.log(`  ⚠ ${id} 维基首图失败: ${e.message}`);
        if (/failed|timeout|abort/i.test(String(e?.message))) wikiUp = false; // 连续失败则后续跳过
      }
      await sleep(1200);
    }
    try {
      const photos = await commonsSearch(id.replace(/-/g, ' '), 'photo');
      if (photos.length) entry.photos = photos;
    } catch (e) {
      console.log(`  ⚠ ${id} 图片检索失败: ${e.message}`);
    }
    await sleep(1200);
    try {
      const audios = await commonsSearch(q.audio, 'audio');
      if (audios.length) entry.audios = audios;
    } catch (e) {
      console.log(`  ⚠ ${id} 音频检索失败: ${e.message}`);
    }
    out[id] = entry;
    await writeFile(CANDIDATES_PATH, JSON.stringify(out, null, 2)); // 增量保存
    console.log(
      `✓ ${id}: 维基首图 ${entry.wikiLead ? '✓' : '—'} / 图候选 ${entry.photos.length} / 音候选 ${entry.audios.length}`,
    );
    await sleep(1200);
  }
  console.log(`\n候选已写入 ${CANDIDATES_PATH}`);
}

// ─────────── 阶段二：pick ───────────

const PHOTO_BAD =
  /map|diagram|drawing|sketch|poster|logo|notation|sheet music|chart|fingering|range.svg|festival|statue|museum|sign|shop|player|playing|concert|musician|orchestra|band|portrait|album|cover|rock |rock\.|church|cathedral|temple|building/i;
const AUDIO_BAD = /pronunciation|spoken|speech|narration|pronounce|wiki|En-.*?-article/i;

function scoreByName(title, tokens) {
  const t = title.toLowerCase();
  let s = 0;
  for (const tok of tokens) if (tok && t.includes(tok)) s += 2;
  if (AUDIO_BAD.test(title)) s -= 10;
  if (/\.(ogg|oga)$/i.test(title)) s += 1;
  if (/solo|scale|sound|demo|sample|theme|lick|phrase/i.test(title)) s += 1;
  return s;
}

async function doPick() {
  const candidates = JSON.parse(await readFile(CANDIDATES_PATH, 'utf8'));
  const manifest = {};
  const badPhoto = (t) => PHOTO_BAD.test(t) || /\.svg$/i.test(t);
  for (const id of IDS) {
    const c = candidates[id] || {};
    const manual = MANUAL_PICKS[id] || {};
    // 'NONE' 哨兵 = 显式跳过该素材（Commons 无合格内容时避免误选发音示范等垃圾）
    const pick = (v) => (v === 'NONE' ? null : v);
    // 图片：维基首图优先（排除 SVG/图表类），其次无黑名单词的 Commons 候选
    let photo = pick(manual.photo) || (c.wikiLead && !badPhoto(c.wikiLead) ? c.wikiLead : null);
    if (!photo && manual.photo !== 'NONE') {
      photo = (c.photos || []).find((t) => !badPhoto(t)) || null;
    }
    // 音频：名称匹配度评分
    let audio = pick(manual.audio) || null;
    if (!audio && manual.audio !== 'NONE' && c.audios?.length) {
      const tokens = id.split('-').concat([QUERIES[id].audio.split(' ')[0]]);
      const ranked = [...c.audios].sort((a, b) => scoreByName(b, tokens) - scoreByName(a, tokens));
      audio = ranked[0];
    }
    manifest[id] = { photo, audio, manual: Boolean(manual.photo || manual.audio) };
    console.log(`${id}:\n  图 ${photo || '（无）'}\n  音 ${audio || '（无）'}`);
  }
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nmanifest 已写入 ${MANIFEST_PATH}，可手工编辑后执行 fetch`);
}

// ─────────── 阶段三：fetch ───────────

/**
 * upload.wikimedia.org 直链（不经 API）：文件按 MD5(文件名) 散列存储。
 * thumb.wikimedia.org 在本网络不可达，故图片下载原图后本地 cwebp 缩放。
 */
function uploadUrl(title) {
  const filename = title.replace(/^File:/, '').replace(/ /g, '_');
  const md5 = createHash('md5').update(filename).digest('hex');
  return `https://upload.wikimedia.org/wikipedia/commons/${md5[0]}/${md5.slice(0, 2)}/${encodeURIComponent(filename)}`;
}

/**
 * 缩略图 URL（960px，Wikimedia 认可的标准档位）。
 * 缩略图与原图是两个独立的限流桶：原图桶被 429 时缩略图仍可用，
 * 且 960px 已够卡片/详情展示，流量还更小。仅位图支持，音频用原图。
 */
function thumbUrl(title) {
  const filename = title.replace(/^File:/, '').replace(/ /g, '_');
  const md5 = createHash('md5').update(filename).digest('hex');
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${md5[0]}/${md5.slice(0, 2)}/${encodeURIComponent(filename)}/960px-${encodeURIComponent(filename)}`;
}

/** 批量取署名信息（imageinfo 一次最多 50 个标题，全部只需 ~3 次请求） */
async function batchCredits(titles) {
  const byTitle = {};
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    try {
      const data = await apiJson(COMMONS_API, {
        action: 'query',
        titles: chunk.join('|'),
        prop: 'imageinfo',
        iiprop: 'url|extmetadata', // descriptionurl 随 url 提供（credits 的 source 链接）
      });
      for (const page of Object.values(data.query?.pages || {})) {
        const ii = page?.imageinfo?.[0];
        if (!ii) continue;
        const em = ii.extmetadata || {};
        byTitle[page.title] = {
          title: String(page.title).replace(/^File:/, ''),
          artist: stripHtml(em.Artist?.value) || 'Wikimedia Commons',
          license: em.LicenseShortName?.value || '见源页面',
          source: ii.descriptionurl,
        };
      }
    } catch (e) {
      console.log(`  ⚠ 署名批量查询失败（${chunk.length} 个）: ${e.message}`);
    }
    await sleep(800);
  }
  return byTitle;
}

async function doFetch() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const credits = JSON.parse(await readFile(CREDITS_PATH, 'utf8').catch(() => '{}'));
  await mkdir(PHOTOS_DIR, { recursive: true });
  await mkdir(AUDIOS_DIR, { recursive: true });

  // 先批量补齐署名（3 次请求），后续下载失败也不丢已查到的署名
  const needTitles = [];
  for (const id of targets) {
    const m = manifest[id];
    if (m?.photo && !credits[id]?.photo) needTitles.push(m.photo);
    if (m?.audio && !credits[id]?.audio) needTitles.push(m.audio);
  }
  if (needTitles.length) {
    console.log(`署名批量查询：${needTitles.length} 个文件…`);
    const meta = await batchCredits(needTitles);
    for (const id of targets) {
      const m = manifest[id];
      if (!m) continue;
      credits[id] = credits[id] || {};
      if (m.photo && !credits[id].photo && meta[m.photo]) credits[id].photo = meta[m.photo];
      if (m.audio && !credits[id].audio && meta[m.audio]) credits[id].audio = meta[m.audio];
    }
    await writeFile(CREDITS_PATH, JSON.stringify(credits, null, 2));
  }

  let okPhoto = 0,
    okAudio = 0;
  const fail = [];
  // 窗口感知：本网络对 upload 主机的连通性呈"开-关"窗口。连续失败达到阈值 =
  // 撞上封闭窗口，全体 worker 等待窗口重开；成功即重置计数。
  let streak = 0;
  let gate = Promise.resolve(); // 封闭窗口期间所有 worker 在此闸门上排队
  const noteResult = (ok) => {
    if (ok) {
      streak = 0;
      return;
    }
    streak++;
    if (streak % 4 === 0) {
      console.log(`  ⏳ 连续失败 ${streak} 次，疑似封闭窗口，等待 60s…`);
      gate = gate.then(() => sleep(60000));
    }
  };

  // 任务队列：每件乐器的"图 / 音"各为一个任务，3 个并发 worker 消费。
  // 串行队列里一个卡住的文件会挡住整个队列；并发池让死窗口里的卡顿
  // 只影响单个 worker，开放窗口内吞吐 ×3。
  const tasks = [];
  for (const id of targets) {
    const m = manifest[id];
    if (!m) continue;
    const photoOut = resolve(PHOTOS_DIR, `${id}.webp`);
    if (m.photo && (FORCE || !(await exists(photoOut)))) {
      tasks.push({ kind: '图', id, title: m.photo, out: photoOut });
    }
    const audioOut = resolve(AUDIOS_DIR, `${id}.mp3`);
    if (m.audio && (FORCE || !(await exists(audioOut)))) {
      tasks.push({ kind: '音', id, title: m.audio, out: audioOut });
    }
  }
  console.log(`待处理任务 ${tasks.length} 个，1 路串行（深度限流恢复）…`);

  let cursor = 0;
  async function worker() {
    for (;;) {
      const t = tasks[cursor++];
      if (!t) return;
      await gate; // 封闭窗口时在此等待
      const filename = t.title.replace(/^File:/, '').replace(/ /g, '_');
      try {
        if (t.kind === '图') {
          const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] || 'jpg').toLowerCase();
          const tmp = resolve('/tmp', `ia-photo-${t.id}.${ext === 'svg' ? 'png' : ext}`);
          await download(thumbUrl(t.title), tmp);
          await run('cwebp', ['-q', '82', '-resize', '900', '0', tmp, '-o', t.out]);
          okPhoto++;
        } else {
          // ffmpeg 直接从 URL 流式读取：-t 12 使其只拉取前 12 秒对应的数据，
          // 避免下载整首录音（古典原件可达 20MB+），流量降一个数量级。
          await run('ffmpeg', [
            '-y',
            '-v', 'error',
            '-user_agent', UA,
            '-rw_timeout', '20000000', // 单次 IO 卡住 20s 即失败（死窗口快速跳过）
            '-i', uploadUrl(t.title),
            '-t',
            String(AUDIO_SECONDS),
            '-af',
            `afade=t=out:st=${AUDIO_SECONDS - 2}:d=2`,
            '-c:a',
            'libmp3lame',
            '-q:a',
            '5',
            t.out,
          ], SPAWN_ENV);
          // 时长闸门：限流期间错误响应体会被转成 <1s 的空 mp3，
          // 源文件本身过短同样过不了闸——一律视为失败并删除，下轮换源重下
          const probe = await run('ffprobe', [
            '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', t.out,
          ]);
          const dur = Number.parseFloat(probe.stdout.trim());
          if (!Number.isFinite(dur) || dur < 10) {
            await rm(t.out, { force: true });
            throw new Error(`时长仅 ${dur ?? '?'}s（需 ≥10s），源过短或响应体异常`);
          }
          okAudio++;
        }
        noteResult(true);
        console.log(`✓ ${t.kind} ${t.id} ← ${filename}`);
      } catch (e) {
        noteResult(false);
        fail.push(`${t.id} ${t.kind}: ${e.message}`);
        console.log(`✗ ${t.kind} ${t.id}: ${e.message}`);
        // 429 = 源站限流惩罚期：任何后续请求都会刷新计时器，
        // 立即清空任务队列让本轮静默退出，由外层循环长冷却后重试
        if (/429|Too Many Requests/i.test(String(e.message))) {
          console.log('  🚫 检测到 429 限流，中止本轮（继续请求会刷新惩罚计时器）');
          tasks.length = 0;
        }
      }
      await sleep(3000);
    }
  }
  await Promise.all(Array.from({ length: 1 }, () => worker()));

  await writeFile(CREDITS_PATH, JSON.stringify(credits, null, 2));
  console.log(`\n完成：图 ${okPhoto} / 音 ${okAudio}，失败 ${fail.length}`);
  if (fail.length) console.log(fail.join('\n'));
}

// ─────────── 入口 ───────────

const mode = process.argv[2];
if (mode === 'search') await doSearch();
else if (mode === 'pick') await doPick();
else if (mode === 'fetch') await doFetch();
else {
  console.log(
    '用法: node scripts/instrument-assets.mjs <search|pick|fetch> [--only id1,id2] [--force]',
  );
  process.exit(1);
}
