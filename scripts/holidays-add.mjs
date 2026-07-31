// @ts-check
/**
 * 节假日数据更新：往 src/home/calendar/holidays.json 增补/更新条目。
 *
 * 两种录入入口：
 *   1. 逐条交互（默认）：运行后按提示逐条录入，空行结束。
 *   2. 批量导入：--file <临时JSON>，格式为
 *        { "<YYYY-MM-DD>": { "type": "legal|workday|festival", "name": "名称", "year": "2027"(可选) } }
 *
 * 用法：
 *   npm run holidays:add                           # 逐条交互
 *   npm run holidays:add -- --file _tmp-holidays-add.json
 *   npm run holidays:add -- --file _tmp.json --dry-run      # 只看不写
 *   npm run holidays:add -- --source "国务院办公厅…通知"
 *
 * 校验：日期格式与合法性、type 枚举、name 非空、year 4 位数字。
 * 合并：按 year→dateKey 注入，同日期覆盖（last-wins，顺带消除重复 key）；
 *       自动更新顶层 updatedAt（今天）/ version（最大年）/ source（保留或 --source 覆盖）；
 *       输出按 year、dateKey 排序，保持文件整洁。
 * 详见 src/core/types.ts 的 DayInfo / HolidaysData。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TARGET = resolve(ROOT, 'src/home/calendar/holidays.json');

const VALID_TYPES = /** @type {const} */ (['legal', 'workday', 'festival']);
const TYPE_HINTS = { legal: '法定假日（休）', workday: '调休上班（班）', festival: '传统节日/节气' };

// —— argv 解析 ——
const argv = process.argv.slice(2);
/** @type {string | null} */
let fileArg = null;
let dryRun = false;
/** @type {string | null} */
let sourceOverride = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--dry-run') dryRun = true;
  else if (a === '--file') fileArg = argv[++i] ?? null;
  else if (a === '--source') sourceOverride = argv[++i] ?? null;
  else {
    console.error(`未知参数: ${a}`);
    console.error('用法: npm run holidays:add [-- --file <path>] [-- --dry-run] [-- --source <来源>]');
    process.exit(1);
  }
}

/**
 * 校验并归一化单条节假日输入。
 * @param {{date:string,type:string,name:string,year?:string}} raw
 * @returns {{year:string,dateKey:string,type:(typeof VALID_TYPES)[number],name:string}}
 * @throws 校验失败抛错（带中文说明）
 */
function validateEntry(raw) {
  const date = String(raw.date ?? '').trim();
  // 日期校验：YYYY-MM-DD，且 Date 解析后回格式化一致（防 2/30 这类非法日期）
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`日期格式错误: "${date}"，需 YYYY-MM-DD`);
  }
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const back = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  if (back !== date) throw new Error(`非法日期: "${date}"`);

  const year = (raw.year ? String(raw.year).trim() : String(y));
  if (!/^\d{4}$/.test(year)) throw new Error(`年份错误: "${year}"，需 4 位数字`);

  const type = String(raw.type ?? '').trim();
  if (!VALID_TYPES.includes(/** @type {any} */ (type))) {
    throw new Error(`type 非法: "${type}"，需为 ${VALID_TYPES.join(' / ')}`);
  }
  const name = String(raw.name ?? '').trim();
  if (!name) throw new Error('名称不能为空');
  return { year, dateKey: date, type, name };
}

/**
 * 把批量文件格式（{ dateKey: {type,name,year?} }）转为校验后的条目数组。
 * @param {Record<string, any>} obj
 */
function parseBatchFile(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    console.error('批量文件格式错误：需为 JSON 对象 { "<YYYY-MM-DD>": {...} }');
    process.exit(1);
  }
  /** @type {{year:string,dateKey:string,type:string,name:string}[]} */
  const entries = [];
  for (const [k, v] of Object.entries(obj)) {
    try {
      entries.push(validateEntry({ date: k, ...(v || {}) }));
    } catch (e) {
      console.error(`✗ ${k}: ${(/** @type {Error} */ (e)).message}`);
      process.exit(1);
    }
  }
  return entries;
}

/** 逐条交互录入 */
async function interactiveCollect() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  /** @type {{year:string,dateKey:string,type:string,name:string}[]} */
  const entries = [];
  console.log('逐条录入节假日（空日期回车结束）：');
  console.log(`  type 可选：${VALID_TYPES.map((t) => `${t}(${TYPE_HINTS[t]})`).join(' / ')}`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const date = (await rl.question('日期 YYYY-MM-DD（空=结束）: ')).trim();
    if (!date) break;
    try {
      const typeRaw = (await rl.question(`type [${VALID_TYPES.join('/')}]（默认 legal）: `)).trim() || 'legal';
      const name = (await rl.question('名称（如 春节/国庆节/立春）: ')).trim();
      entries.push(validateEntry({ date, type: typeRaw, name }));
      console.log(`  ✓ 已加入 ${date} = ${typeRaw} ${name}`);
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
  console.log('没有要新增的条目，已退出。');
  process.exit(0);
}

// —— 读取现有数据并合并 ——
const existing = JSON.parse(await readFile(TARGET, 'utf8'));
/** @type {Record<string, Record<string, {type:string,name:string}>>} */
const years = existing.years || {};

/** @type {Record<string, {added:string,changed:string}[]>} 按年分组的变更日志 */
const log = {};
let added = 0;
let changed = 0;
for (const e of newEntries) {
  if (!years[e.year]) years[e.year] = {};
  const prev = years[e.year][e.dateKey];
  if (prev && prev.type === e.type && prev.name === e.name) {
    continue; // 完全相同，跳过
  }
  (log[e.year] ||= []).push({ added: e.dateKey, changed: prev ? '覆盖' : '新增' });
  if (prev) changed++;
  else added++;
  years[e.year][e.dateKey] = { type: e.type, name: e.name };
}

if (added === 0 && changed === 0) {
  console.log('所有条目均已存在且相同，无需更新。');
  process.exit(0);
}

// —— 更新顶层 meta ——
const today = new Date().toISOString().slice(0, 10);
existing.updatedAt = today;
if (sourceOverride) existing.source = sourceOverride;
existing.version = Object.keys(years).sort().at(-1) || existing.version;
existing.years = years;

// —— 序列化：保留现有行内条目布局 ——
/**
 * 序列化为与现文件一致的格式：
 *   "2026-01-01": { "type": "legal", "name": "元旦" },
 * 字段顺序固定 type→name，2 空格缩进，年份/dateKey 排序。
 */
function serialize(data) {
  const sortedYears = Object.keys(data.years).sort();
  const yearBlocks = sortedYears.map((yr) => {
    const dates = Object.keys(data.years[yr]).sort();
    const lines = dates.map(
      (dk) =>
        `      ${JSON.stringify(dk)}: { "type": "${data.years[yr][dk].type}", "name": ${JSON.stringify(data.years[yr][dk].name)} }`,
    );
    return `    ${JSON.stringify(yr)}: {\n${lines.join(',\n')}\n    }`;
  });
  return `{
  "version": ${JSON.stringify(data.version)},
  "source": ${JSON.stringify(data.source)},
  "updatedAt": ${JSON.stringify(data.updatedAt)},
  "years": {
${yearBlocks.join(',\n')}
  }
}
`;
}

// —— 输出 diff ——
console.log(`\n本次将 ${added > 0 ? `新增 ${added} 条` : ''}${added > 0 && changed > 0 ? '、' : ''}${changed > 0 ? `覆盖 ${changed} 条` : ''}：`);
for (const yr of Object.keys(log).sort()) {
  console.log(`  [${yr}]`);
  for (const item of log[yr]) {
    console.log(`    ${item.added} (${item.changed})`);
  }
}
console.log(`  updatedAt → ${today}`);
if (sourceOverride) console.log(`  source → ${sourceOverride}`);
console.log(`  目标文件: src/home/calendar/holidays.json`);

if (dryRun) {
  console.log('\n[dry-run] 未写入文件。');
  process.exit(0);
}

await writeFile(TARGET, serialize(existing), 'utf8');
console.log(`\n✓ 已写回 ${added + changed} 条变更。`);
