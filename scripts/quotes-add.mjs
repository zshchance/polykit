// @ts-check
/**
 * 名言库更新：往 tools/quote-card/data/quotes.json 追加条目。
 *
 * 两种录入入口：
 *   1. 逐条交互（默认）：运行后按提示逐条录入，空正文结束。
 *   2. 批量导入：--file <临时JSON>，格式为数组
 *        [{ "text": "...", "author": "...", "source": "可选", "category": "哲理", "lang": "zh" }]
 *
 * 用法：
 *   npm run quotes:add
 *   npm run quotes:add -- --file _tmp-quotes-add.json
 *   npm run quotes:add -- --file _tmp.json --dry-run
 *
 * 校验：text/author 非空、source 留空归一为 null、lang ∈ {zh,en}、category 非空。
 * id 自动自增（扫现有最大 qNNN +1，保证全局唯一，匹配 expandOnline 的按 id 去重契约）。
 * 去重：text+author 完全相同则跳过（避免重复录入同一条）。
 * 详见 tools/quote-card/data/quotes.ts 的 QuoteRecord。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TARGET = resolve(ROOT, 'tools/quote-card/data/quotes.json');

const VALID_LANGS = /** @type {const} */ (['zh', 'en']);

// —— argv 解析 ——
const argv = process.argv.slice(2);
/** @type {string | null} */
let fileArg = null;
let dryRun = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--dry-run') dryRun = true;
  else if (a === '--file') fileArg = argv[++i] ?? null;
  else {
    console.error(`未知参数: ${a}`);
    console.error('用法: npm run quotes:add [-- --file <path>] [-- --dry-run]');
    process.exit(1);
  }
}

/**
 * 校验并归一化单条名言输入。
 * @param {{text?:string,author?:string,source?:string|null,category?:string,lang?:string}} raw
 * @returns {{text:string,author:string,source:string|null,category:string,lang:(typeof VALID_LANGS)[number]}}
 * @throws 校验失败抛错
 */
function validateEntry(raw) {
  const text = String(raw.text ?? '').trim();
  if (!text) throw new Error('名言正文不能为空');
  const author = String(raw.author ?? '').trim();
  if (!author) throw new Error('作者不能为空');
  const source = raw.source == null || String(raw.source).trim() === '' ? null : String(raw.source).trim();
  const category = String(raw.category ?? '').trim();
  if (!category) throw new Error('分类不能为空');
  const lang = String(raw.lang ?? 'zh').trim() || 'zh';
  if (!VALID_LANGS.includes(/** @type {any} */ (lang))) {
    throw new Error(`lang 非法: "${lang}"，需为 ${VALID_LANGS.join(' / ')}`);
  }
  return { text, author, source, category, lang };
}

/** 批量文件校验 */
function parseBatchFile(/** @type {any} */ arr) {
  if (!Array.isArray(arr)) {
    console.error('批量文件格式错误：需为 JSON 数组 [{ text, author, ... }]');
    process.exit(1);
  }
  /** @type {{text:string,author:string,source:string|null,category:string,lang:string}[]} */
  const entries = [];
  arr.forEach((v, idx) => {
    try {
      entries.push(validateEntry(v || {}));
    } catch (e) {
      console.error(`✗ 第 ${idx + 1} 条: ${(/** @type {Error} */ (e)).message}`);
      process.exit(1);
    }
  });
  return entries;
}

/** 逐条交互录入 */
async function interactiveCollect() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // 展示现有分类供参考
  const existing = JSON.parse(await readFile(TARGET, 'utf8'));
  const cats = [...new Set((existing.quotes || []).map((/** @type {any} */ q) => q.category).filter(Boolean))];
  console.log('逐条录入名言（空正文回车结束）：');
  console.log(`  现有分类：${cats.join(' / ')}（可直接输入新的）`);
  console.log(`  lang 可选：${VALID_LANGS.join(' / ')}（默认 zh）`);

  /** @type {{text:string,author:string,source:string|null,category:string,lang:string}[]} */
  const entries = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const text = (await rl.question('\n名言正文（空=结束）: ')).trim();
    if (!text) break;
    try {
      const author = (await rl.question('作者（必填）: ')).trim();
      const source = (await rl.question('出处（选填，回车跳过）: ')).trim();
      const category = (await rl.question('分类（如 哲理/励志/文学/科技）: ')).trim();
      const lang = (await rl.question(`lang [${VALID_LANGS.join('/')}]（默认 zh）: `)).trim() || 'zh';
      entries.push(validateEntry({ text, author, source, category, lang }));
      console.log('  ✓ 已加入');
    } catch (e) {
      console.error(`  ✗ 录入无效：${(/** @type {Error} */ (e)).message}，请重输该条。`);
    }
  }
  rl.close();
  return entries;
}

// —— 主流程 ——
let newEntries;
if (fileArg) {
  const filePath = resolve(ROOT, fileArg);
  let rawText;
  try {
    rawText = await readFile(filePath, 'utf8');
  } catch {
    console.error(`读取文件失败: ${filePath}`);
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    console.error(`JSON 解析失败: ${filePath}`);
    process.exit(1);
  }
  newEntries = parseBatchFile(parsed);
} else {
  newEntries = await interactiveCollect();
}

if (newEntries.length === 0) {
  console.log('没有要新增的名言，已退出。');
  process.exit(0);
}

// —— 读取现有数据，去重 + 分配 id ——
const existing = JSON.parse(await readFile(TARGET, 'utf8'));
/** @type {any[]} */
const quotes = existing.quotes || [];
const existingSet = new Set(quotes.map((/** @type {any} */ q) => `${q.text}\u0000${q.author}`));

// 找现有最大 qNNN 序号
let maxSeq = 0;
for (const q of quotes) {
  const m = /^q(\d+)$/.exec(String(q.id || ''));
  if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
}

/** @type {any[]} 要追加的（去重后） */
const toAdd = [];
let skipped = 0;
for (const e of newEntries) {
  const key = `${e.text}\u0000${e.author}`;
  if (existingSet.has(key)) {
    console.log(`· 跳过（已存在）：${e.text.slice(0, 16)}… — ${e.author}`);
    skipped++;
    continue;
  }
  existingSet.add(key); // 防同批次内重复
  maxSeq += 1;
  toAdd.push({ id: `q${String(maxSeq).padStart(3, '0')}`, ...e });
}

if (toAdd.length === 0) {
  console.log(`\n全部 ${skipped} 条已存在，无需更新。`);
  process.exit(0);
}

existing.quotes = [...quotes, ...toAdd];

// —— 序列化：保留现有行内条目布局 ——
function serialize(/** @type {any} */ data) {
  const lines = data.quotes.map(
    (/** @type {any} */ q) =>
      `    { "id": "${q.id}", "text": ${JSON.stringify(q.text)}, "author": ${JSON.stringify(q.author)}, "source": ${q.source === null ? 'null' : JSON.stringify(q.source)}, "category": ${JSON.stringify(q.category)}, "lang": "${q.lang}" }`,
  );
  return `{
  "version": ${JSON.stringify(data.version)},
  "source": ${JSON.stringify(data.source)},
  "quotes": [
${lines.join(',\n')}
  ]
}
`;
}

// —— 输出 diff ——
console.log(`\n本次将新增 ${toAdd.length} 条${skipped > 0 ? `（跳过已存在 ${skipped} 条）` : ''}：`);
for (const q of toAdd) {
  console.log(`  ${q.id}  ${q.text.slice(0, 24)}${q.text.length > 24 ? '…' : ''} — ${q.author} [${q.category}/${q.lang}]`);
}
console.log(`  目标文件: tools/quote-card/data/quotes.json`);

if (dryRun) {
  console.log('\n[dry-run] 未写入文件。');
  process.exit(0);
}

await writeFile(TARGET, serialize(existing), 'utf8');
console.log(`\n✓ 已写回 ${toAdd.length} 条。`);
