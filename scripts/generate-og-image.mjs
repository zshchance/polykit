/**
 * 生成站点级 OG 分享图 public/og-image.png（1200×630）。
 *
 * 用法：node scripts/generate-og-image.mjs
 * 依赖：puppeteer-core（devDependency）+ 本机 Chrome；
 *       Chrome 路径可用环境变量 CHROME_PATH 覆盖（CI / 非 macOS 环境）。
 *
 * 产物已提交仓库，仅当品牌视觉（配色/站点名/标语）调整时才需要重跑。
 * 设计沿用 favicon 视觉：靛蓝圆角方块 + 三道白色横线（宝匣/清单意象）。
 */
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/og-image.png');

// 1200×630 是 og:image 推荐尺寸；deviceScaleFactor=1 保证产物像素与 og:image:width/height 一致
const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background:
      radial-gradient(900px 500px at 85% -10%, rgba(255,255,255,.18), transparent 60%),
      radial-gradient(700px 500px at -10% 110%, rgba(124,58,237,.55), transparent 60%),
      linear-gradient(135deg, #4338ca 0%, #4f46e5 45%, #6d28d9 100%);
    color: #fff;
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 72px 80px;
  }
  .brand { display: flex; align-items: center; gap: 36px; }
  .logo {
    width: 148px; height: 148px; border-radius: 34px; flex: none;
    background: rgba(255,255,255,.14);
    border: 2px solid rgba(255,255,255,.35);
    box-shadow: 0 18px 45px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.25);
    display: flex; flex-direction: column; justify-content: center; gap: 22px;
    padding: 0 30px;
  }
  .logo i { display: block; height: 12px; border-radius: 6px; background: #fff; }
  .logo i:nth-child(3) { width: 62%; }
  h1 { font-size: 92px; font-weight: 800; letter-spacing: 6px; line-height: 1.1;
       text-shadow: 0 4px 18px rgba(0,0,0,.25); }
  .tagline { margin-top: 18px; font-size: 34px; color: rgba(255,255,255,.88); letter-spacing: 2px; }
  .chips { display: flex; flex-wrap: wrap; gap: 14px; }
  .chips span {
    font-size: 24px; padding: 10px 22px; border-radius: 999px;
    background: rgba(255,255,255,.14); border: 1.5px solid rgba(255,255,255,.32);
    color: rgba(255,255,255,.92); letter-spacing: 1px;
  }
  .url { margin-top: 28px; font-size: 22px; color: rgba(255,255,255,.55); letter-spacing: 1px; }
</style></head>
<body>
  <div class="brand">
    <div class="logo"><i></i><i></i><i></i></div>
    <div>
      <h1>即开宝匣</h1>
      <div class="tagline">即开即用 · 数据不出本地的在线小工具合集</div>
    </div>
  </div>
  <div>
    <div class="chips">
      <span>密码生成器</span><span>二维码生成</span><span>图片压缩</span>
      <span>名言卡片</span><span>AI 提示词</span><span>配色工具</span>
      <span>字符画</span><span>歌曲生成视频</span>
    </div>
    <div class="url">zshchance.github.io/polykit</div>
  </div>
</body>
</html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: OUT, type: 'png' });
  console.log(`[og-image] 已生成 ${OUT}（1200×630）`);
} finally {
  await browser.close();
}
