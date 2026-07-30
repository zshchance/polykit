# 静态工具箱（static-toolkit）

一个可部署到 Cloudflare Pages 的静态工具站。每个工具是一个独立页面，纯浏览器运行，数据不上传。基于 **Vite + TypeScript + Tailwind CSS**，多页面（MPA）架构。

## 技术栈

| 维度 | 选型 |
|------|------|
| 构建 | Vite + TypeScript |
| 架构 | 多页面 MPA（每个工具一个独立 HTML 页） |
| 样式 | Tailwind CSS v4 |
| 部署 | Cloudflare Pages（根路径，连 Git 自动构建） |

## 目录结构

```
.
├── .github/workflows/deploy.yml   # push main 自动构建+部署 Pages
├── public/                        # 不经构建的静态资源（favicon 等）
├── src/
│   ├── core/                      # 跨工具共享层
│   │   ├── components/            # 通用组件：ToolLayout、CopyButton、ThemeToggle、element(h)
│   │   ├── utils/                 # 通用函数：dom、clipboard、random(密码学安全)
│   │   ├── styles/main.css        # Tailwind 入口 + 设计 token + 主题变量
│   │   └── types.ts               # 共享类型（ToolMeta 等）
│   ├── home/                      # 首页（工具导航）
│   │   ├── main.ts                # 按 manifest 渲染工具卡片网格
│   │   └── tools-manifest.ts      # ★ 工具清单（单一数据源）
│   └── vite-env.d.ts
├── tools/                         # ★ 每个工具一个目录，自包含
│   └── password-generator/
│       ├── index.html             # 工具页入口
│       ├── main.ts                # 入口脚本（UI + 事件）
│       └── generator.ts           # 核心逻辑（与 UI 解耦）
├── scripts/new-tool.mjs           # 脚手架：npm run new -- <slug>
├── index.html                     # 首页（Vite 根入口）
├── vite.config.ts                 # 自动扫描 tools/*/index.html 生成 MPA 入口
└── tsconfig.json
```

## 快速开始

```bash
npm install      # 安装依赖
npm run dev      # 本地开发（http://localhost:5173）
npm run build    # 生产构建（产物在 dist/）
npm run preview  # 预览构建产物
```

> 注：本机需 Node 18+。若用 nvm，先 `nvm use`。

## 新增一个工具（3 步）

```bash
# 1. 脚手架创建骨架并登记到首页清单
npm run new -- quote-card 金句卡片

# 2. 编辑 tools/quote-card/main.ts 实现功能

# 3. 本地预览
npm run dev
```

脚手架会：
- 创建 `tools/<slug>/index.html` 和 `main.ts`
- 在 `src/home/tools-manifest.ts` 登记一条记录（新工具自动出现在首页）

> 之后补全 manifest 里该工具的 `description`、`category`、`icon` 即可。

slug 规则：全小写、kebab-case，字母开头（如 `quote-card`、`fancy-text`）。

## 部署（Cloudflare Pages）

通过 Cloudflare 连接 GitHub 仓库实现自动部署：推送到默认分支即触发构建并发布。

### 首次配置

1. 在 Cloudflare Dashboard 进入 **Workers & Pages → Create → Pages → Connect to Git**
2. 授权并选择本仓库，设置：
   - **Production branch**：`main`（推送到此分支发布到生产环境；其他分支生成 Preview）
   - **Framework preset**：`Vite`
   - **Build command**：`npm run build`
   - **Build output directory**：`dist`
   - **Environment variables**：`NODE_VERSION = 22`（项目根 `.nvmrc` 也已指定，二者任一即可）
3. 保存并部署。之后每次 `git push main` 自动构建发布。

部署 URL：`https://<project-name>.pages.dev/`（也可绑定自定义域名，仍在根路径）。

### 路径说明

部署在**根路径**，`vite.config.ts` 中 `base` 固定为 `'/'`。
各页面用 `import.meta.env.BASE_URL` 拼接链接，会自动跟随 base——
若将来改部署到子路径（如 `example.com/tools/`），只需把 `base` 改为 `'/tools/'`。

## 核心设计

- **MPA 入口自动扫描**：`vite.config.ts` 用 glob 扫描 `tools/*/index.html` 生成入口，新增工具零配置。
- **首页清单单一数据源**：`src/home/tools-manifest.ts` 驱动首页渲染，脚手架自动登记。
- **工具自包含**：每个工具一个目录，含 HTML + TS，互不影响、独立加载。
- **共享层复用**：`src/core/` 提供布局、复制按钮、主题切换、安全随机、剪贴板等通用能力。
- **主题切换**：亮/暗双主题，跟随系统偏好，localStorage 持久化，无首屏闪烁。
