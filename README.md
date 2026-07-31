# 静态工具箱（static-toolkit）

一个可同时部署到 Cloudflare Pages 或 GitHub Pages 的静态工具站。每个工具是一个独立页面，纯浏览器运行，数据不上传。基于 **Vite + TypeScript + Tailwind CSS**，多页面（MPA）架构。首页带搜索、分类筛选与万年历（节假日来自国务院公告策展数据）。

## 技术栈

| 维度 | 选型 |
|------|------|
| 构建 | Vite + TypeScript（零额外运行时依赖） |
| 架构 | 多页面 MPA（每个工具一个独立 HTML 页） |
| 样式 | Tailwind CSS v4 |
| 模块注册 | `import.meta.glob` 自动发现 + 每模块 `tool.config.ts` 自描述 |
| SEO | 构建期 Vite 插件注入 meta / JSON-LD，产出 sitemap + robots |
| 部署 | Cloudflare Pages 或 GitHub Pages（`BASE_PATH` 自适应根/子路径） |

## 目录结构

```
.
├── .github/workflows/deploy.yml   # push main 自动构建+部署 Pages
├── public/                        # 不经构建的静态资源（favicon 等）
├── src/
│   ├── core/                      # 跨工具共享层
│   │   ├── components/            # 通用组件：ToolLayout、CopyButton、ThemeToggle、element(h)
│   │   ├── seo/seo-plugin.ts      # ★ 构建期 SEO 注入 + sitemap/robots
│   │   ├── utils/                 # 通用函数：dom、clipboard、random(密码学安全)
│   │   ├── styles/main.css        # Tailwind 入口 + 设计 token + 主题变量 + 节假日配色
│   │   └── types.ts               # 共享类型（ToolConfig / RegisteredTool / DayInfo 等）
│   ├── home/                      # 首页（工具导航 + 万年历）
│   │   ├── main.ts                # 两栏布局：搜索+分类+卡片网格 ＋ 侧栏万年历
│   │   ├── registry.ts            # ★ 用 import.meta.glob 自动发现所有工具
│   │   ├── registry-config.ts     # 策展配置：排序 / 启用 / SEO 开关
│   │   ├── components/            # SearchBar、CategoryChips、ToolCard、stagger 动画
│   │   └── calendar/              # 万年历：holidays.json(策展数据) + 渲染 + 可选在线更新
│   └── vite-env.d.ts
├── tools/                         # ★ 每个工具一个目录，自包含
│   └── password-generator/
│       ├── index.html             # 工具页入口
│       ├── tool.config.ts         # ★ 模块自描述（名称/描述/图标/关键词/配色）
│       ├── main.ts                # 入口脚本（UI + 事件）
│       ├── generator.ts           # 核心逻辑（与 UI 解耦）
│       └── assets/                # 可选：icon.svg / cover.svg（就地存放）
├── scripts/new-tool.mjs           # 脚手架：npm run new -- <slug>
├── index.html                     # 首页（Vite 根入口）
├── vite.config.ts                 # 自动扫描 tools/*/index.html + 接入 SEO 插件
└── tsconfig.json
```

## 快速开始

```bash
npm install      # 安装依赖
npm run dev      # 本地开发（http://localhost:5173）
npm run build    # 生产构建（产物在 dist/，含 sitemap.xml / robots.txt）
npm run preview  # 预览构建产物
```

> 注：本机需 Node 18+。若用 nvm，先 `nvm use`。

## 新增一个工具（零配置自发现）

```bash
# 1. 脚手架创建骨架（自动出现在首页，无需登记任何清单）
npm run new -- quote-card 金句卡片

# 2. 编辑 tools/quote-card/tool.config.ts 补全信息，在 main.ts 实现功能

# 3. 本地预览
npm run dev
```

脚手架会创建：
- `tools/<slug>/index.html`、`tool.config.ts`、`main.ts`、空 `assets/` 目录

首页会**自动发现**该工具并展示——无需编辑任何注册表。这是 v2 的核心改进：
`registry.ts` 用 `import.meta.glob` 扫描每个 `tools/*/tool.config.ts`，
SEO 插件在构建期读取同一份配置注入 meta/JSON-LD。

> 想调整顺序或临时隐藏某工具？编辑 `src/home/registry-config.ts` 的 `modules` 字段：
>   `'fancy-text': { order: 10, enabled: false }`

slug 规则：全小写、kebab-case，字母开头（如 `quote-card`、`fancy-text`）。

### tool.config.ts 字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `slug` | 是 | 路径片段，须与目录名一致 |
| `name` | 是 | 展示名称 |
| `description` | 是 | 卡片一句话描述（同时作为页面 meta description） |
| `category` | 是 | 分类（首页胶囊筛选 + 分组） |
| `icon` | 否 | emoji 兜底图标（无 assets/icon.* 时用） |
| `keywords` | 否 | SEO 关键词（见下方"关键词可见性"） |
| `card.accent` | 否 | 卡片强调色（无首图时用于渐变头） |

### 美化素材（可选，就地存放）

把图标/首图放在 `tools/<slug>/assets/` 下，**文件名固定**（扩展名不限）：
- `icon.svg` / `icon.png` —— 工具图标
- `cover.svg` / `cover.png` —— 卡片首图（顶部带状图）

未提供时，卡片用 `icon` emoji + `card.accent` 渐变兜底。

## 部署（双平台自适应 + canonical 统一）

同一份代码可部署到 **Cloudflare Pages**（主站）或 **GitHub Pages**（镜像），由构建时的 `BASE_PATH` 环境变量决定资源路径前缀，应用代码无需任何改动。两平台都用同一 **canonical URL**（默认 GitHub Pages 域名），便于搜索引擎聚合、避免重复内容判定。

> 当前 canonical 前缀：`https://zshchance.github.io/polykit`（仓库 `zshchance/polykit`）。

### 工作原理

| 平台 | 路径 | BASE_PATH | SITE_URL（canonical） | 来源 |
|------|------|-----------|------|------|
| Cloudflare Pages（主） | 根路径 `xxx.pages.dev/` | 不设（默认 `/`） | `https://zshchance.github.io/polykit` | Dashboard 连 Git 自动构建 |
| GitHub Pages（镜像） | 子路径 `user.github.io/polykit/` | `/polykit/` | `https://zshchance.github.io/polykit` | `.github/workflows/deploy.yml` 注入 |

- `BASE_PATH`：决定**部署后的资源/链接前缀**（Cloudflare 根路径 vs GitHub 子路径）。`vite.config.ts` 的 `resolveBase()` 读取它，应用代码用 `import.meta.env.BASE_URL` 自动跟随。
- `SITE_URL`：决定 **canonical / sitemap / og:url**（与部署路径解耦）。两平台都指向同一 canonical，使 `dist/sitemap.xml`、各页 `<link rel="canonical">` 与 `og:url` 一致。

### 方式一：Cloudflare Pages（主站，根路径）

1. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**
2. 选择 `zshchance/polykit` 仓库，设置：
   - **Production branch**：`main`
   - **Framework preset**：`Vite`
   - **Build command**：`npm run build`
   - **Build output directory**：`dist`
   - **Environment variables**：
     - `NODE_VERSION = 22`
     - `SITE_URL = https://zshchance.github.io/polykit`（与镜像保持同一 canonical）
3. **不要**设置 `BASE_PATH`——根路径部署即默认 `/`。

访问 `https://<project>.pages.dev/`。

> 日后给 Cloudflare 绑定自定义域名时，把此处 `SITE_URL` 改成自定义域名即可，canonical 跟随主站切换。

### 方式二：GitHub Pages（镜像，子路径）

1. 推送仓库到 GitHub（仓库名 `polykit`，决定子路径）。
2. 仓库 **Settings → Pages → Source** 选择 **"GitHub Actions"**。
3. 推送到 `main` 自动触发 `.github/workflows/deploy.yml`，构建时注入 `BASE_PATH=/polykit/` 与 `SITE_URL=https://zshchance.github.io/polykit`。

访问 `https://zshchance.github.io/polykit/`。

> 改仓库名/用户名时，同步修改 `.github/workflows/deploy.yml` 里的 `BASE_PATH` 与 `SITE_URL` 值。

### 本地模拟子路径构建

```bash
BASE_PATH=/polykit/ npm run build   # 产物资源路径带前缀，可用 npm run preview 验证
npm run build                       # 不设则按根路径构建
```

## SEO 与关键词可见性

构建期 SEO 插件（`src/core/seo/seo-plugin.ts`）自动为每个页面注入：
- 工具页：`<meta description>` / `<meta keywords>` + `SoftwareApplication` JSON-LD
- 首页：站点 meta + `ItemList` 结构化数据 + Open Graph
- 构建产出 `dist/sitemap.xml` 与 `dist/robots.txt`（路径随 `BASE_PATH` 自适应）

**关键词可见性**（满足"默认对用户不可见，但始终可被 AI/搜索引擎读取"）：
- 关键词**始终**写入 `<meta keywords>` 与 JSON-LD → 爬虫 / AI 永远可读。
- 默认 `seo.showKeywordsInline = false`（在 `src/home/registry-config.ts` 配置）：
  关键词不渲染到卡片 UI，用户不可见。
- 设为 `true` 时，卡片会额外渲染关键词胶囊为可见标签。

> 部署时通过环境变量 `SITE_URL` 设置 canonical 前缀（含子路径，用于 sitemap/canonical/og:url），双平台保持一致即可。详见上方"部署"章节。

首页还会注入 `WebSite` + `Organization`（含开发者邮箱 `email` 与开源仓库 `sameAs`）JSON-LD，提升"软件服务 / 技术支持 / 自媒体工具"等检索的可发现性。每个页面底部均有统一页脚，含**邮件联系**与**GitHub 开源**链接。

## 万年历与节假日数据

首页侧栏内置万年历，标记法定假日（休）、调休上班（班）、传统节日/节气（节）。

- **数据来源**：`src/home/calendar/holidays.json`，源自**国务院办公厅年度部分节假日安排通知**（权威公告）。
  每年初更新一次即可。文件顶部记录了 `source`（出处）与 `updatedAt`（核对日期）。
- **默认离线**：日常浏览零网络请求，数据打包进产物，符合"数据不出本地"。
- **可选在线更新**：用户主动点击"检查更新"才联网拉取同结构 JSON，缓存到 localStorage；
  失败时静默回退本地数据。

### 更新策展数据（CLI 脚本）

内置两个本地脚本，用于定期增补节假日与名言库。两种录入入口：**终端逐条交互**（默认）或 **批量导入**（`--file <临时JSON>`）。校验、去重、合并、写回都由脚本统一处理，无需手编源 JSON。

```bash
# 节假日：逐条交互录入（日期/类型/名称，空行结束）
npm run holidays:add
# 节假日：从临时 JSON 批量导入（建议先 --dry-run 预览）
npm run holidays:add -- --file _tmp-holidays-add.json --dry-run
npm run holidays:add -- --file _tmp-holidays-add.json

# 名言库：逐条交互录入
npm run quotes:add
# 名言库：批量导入（id 自动自增、text+author 去重）
npm run quotes:add -- --file _tmp-quotes-add.json
```

**临时 JSON 格式**（用完即删，已加入 `.gitignore`）：

```jsonc
// _tmp-holidays-add.json —— 节假日（对象，key=日期）
{
  "2027-01-01": { "type": "legal", "name": "元旦" },
  "2027-02-08": { "type": "workday", "name": "春节调休上班" },
  "2027-10-08": { "type": "festival", "name": "寒露" }
}
// type: legal=法定假日(休) / workday=调休上班(班) / festival=传统节日·节气

// _tmp-quotes-add.json —— 名言（数组，id 由脚本自增，无需填写）
[
  { "text": "正文", "author": "作者", "source": "出处(选填)", "category": "哲理", "lang": "zh" },
  { "text": "Quote.", "author": "Author", "category": "科技", "lang": "en" }
]
```

脚本会校验日期合法性、type/lang 枚举、必填字段，非法条目逐条报错并退出（不写文件）；合法条目合并写回时自动更新 `updatedAt`/`version` 并按年份/日期排序。节假日每年只需更新一次（11 月国务院发布次年安排后）；名言库可随时增量补充。

> **AI 辅助**：本仓库另配有一个 ZCode 技能（`.zcode/skills/data-update`，本地不入 `.zcode/` 不入库），可在对话中帮你从国务院公告/名言来源网页提取结构化数据、生成上述临时 JSON、再调脚本校验合并。技能**绝不直接改源 JSON**，始终经脚本入口，保证校验单一来源。

## 核心设计

- **MPA 入口自动扫描**：`vite.config.ts` 用 glob 扫描 `tools/*/index.html` 生成入口，新增工具零配置。
- **模块自描述 + 自动发现**：每个工具自带 `tool.config.ts`（内容身份），`registry.ts` 用 `import.meta.glob` 自动发现；中央 `registry-config.ts` 仅管排序/启用。**新增工具零改注册表。**
- **SEO 构建期统一注入**：同一份 `tool.config.ts` 同时驱动首页展示与 SEO meta/JSON-LD，单一数据源。
- **工具自包含**：每个工具一个目录，含 HTML + TS + 可选 assets，互不影响、独立加载。
- **共享层复用**：`src/core/` 提供布局、复制按钮、主题切换、安全随机、剪贴板等通用能力。
- **主题切换**：亮/暗双主题，跟随系统偏好，localStorage 持久化，无首屏闪烁。
- **微交互动效**：卡片入场逐项 fade-up（尊重 `prefers-reduced-motion`）、hover 抬升、搜索/分类筛选实时反馈。

## 联系 / 关于

由个人开发者维护的开源项目，纯浏览器运行、数据不出本地。

- **邮件**：[978107204@qq.com](mailto:978107204@qq.com)（联系 / 合作 / 技术支持）
- **GitHub**：[zshchance/polykit](https://github.com/zshchance/polykit)（欢迎 Issue / PR）

每个页面底部的统一页脚均提供以上入口；首页 `Organization` JSON-LD 也包含同样的联系方式，便于搜索引擎/AI 识别。
