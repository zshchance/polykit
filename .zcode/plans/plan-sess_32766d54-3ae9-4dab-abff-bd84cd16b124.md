# 静态工具站工程结构规划

## 一、技术栈（已确认）
| 维度 | 选型 |
|------|------|
| 构建 | Vite + TypeScript |
| 架构 | 多页面 MPA（每工具一个独立 HTML 页） |
| 部署 | GitHub Pages 项目页（子路径 `/repo-name/`） |
| 样式 | Tailwind CSS（v4，`@tailwindcss/vite` 插件） |

## 二、目录结构

```
静态工具站/
├── .github/
│   └── workflows/
│       └── deploy.yml            # GitHub Actions：push main 自动构建+部署 Pages
├── public/                       # 不经构建处理的静态资源
│   └── favicon.svg
├── src/
│   ├── core/                     # ★ 跨工具共享层（核心复用代码）
│   │   ├── components/           # 通用 UI 组件：ToolLayout(工具页外壳)、CopyButton、ThemeToggle
│   │   ├── utils/                # 通用函数：clipboard、downloadFile、dom helpers、random
│   │   ├── styles/
│   │   │   └── main.css          # Tailwind 入口 + 全局样式 + 设计 token(CSS 变量)
│   │   └── types.ts              # 共享类型定义
│   ├── home/                     # 首页（工具导航）
│   │   ├── main.ts               # 读取 manifest 渲染工具卡片网格
│   │   └── tools-manifest.ts     # ★ 工具清单（名称/描述/图标/分类），新增工具在此登记
│   └── tools/                    # ★ 每个工具一个目录，完全自包含
│       ├── password-generator/
│       │   ├── index.html        # 工具页面入口
│       │   ├── main.ts           # 入口脚本（挂载逻辑、绑定事件）
│       │   └── generator.ts      # 工具核心逻辑（与 UI 解耦，便于单测）
│       └── fancy-text/
│           ├── index.html
│           └── main.ts
├── scripts/
│   └── new-tool.mjs              # ★ 脚手架：npm run new -- <名称> 一键创建工具骨架+登记清单
├── index.html                    # 首页 HTML（Vite 根入口，引用 src/home/main.ts）
├── vite.config.ts                # 自动扫描 src/tools/*/index.html 生成 MPA 入口
├── tsconfig.json
├── package.json
├── .gitignore
└── README.md
```

## 三、四个核心设计点

### 1. MPA 入口自动扫描（消除"改配置"负担）
`vite.config.ts` 用 glob 扫描 `src/tools/*/index.html`，自动拼成 `rollupOptions.input`。**新增工具只需新建目录，零配置改动**。构建后输出：
- 首页：`/repo-name/`
- 工具：`/repo-name/password-generator/`、`/repo-name/fancy-text/`

### 2. base 路径正确配置（防 404）
- 开发环境 `base: '/'`，生产构建 `base: '/repo-name/'`，通过环境变量切换。
- ⚠️ **需你提供实际 repo 名**（部署路径取决于此）。若 repo 名含中文，URL 路径会编码，建议用英文 repo 名。

### 3. 首页工具导航自动维护
`tools-manifest.ts` 是单一数据源，记录所有工具的元信息。首页据此渲染卡片网格。新增工具时脚手架脚本自动在此登记 → **新工具自动出现在首页，无需手改**。

### 4. 通用布局复用
`core/components/ToolLayout` 统一每个工具页的头部（返回首页、工具名、主题切换），各工具页只写自身功能，避免重复。

## 四、新增一个工具的标准流程（目标：3 步）
1. `npm run new -- quote-card` → 脚手架自动创建 `src/tools/quote-card/`（含 index.html + main.ts）并登记到 manifest
2. 在新目录内实现工具逻辑
3. `npm run dev` 预览 → `git push` 自动部署

## 五、实施步骤
1. 初始化 `package.json`，安装依赖（vite、typescript、tailwindcss、@tailwindcss/vite、glob）
2. 写 `vite.config.ts`（MPA 自动扫描 + base 配置）、`tsconfig.json`
3. 搭 `src/core/`（样式入口、通用 utils、ToolLayout 组件）
4. 搭首页（`index.html` + `src/home/` + `tools-manifest.ts`）
5. 实现第一个示例工具 `password-generator`（验证整套流程跑通）
6. 写 `scripts/new-tool.mjs` 脚手架
7. 写 `.github/workflows/deploy.yml` 自动部署
8. 写 `.gitignore`、`README.md`
9. `npm run build` 验证构建产物路径正确

## 六、需要你后续提供的信息
- **GitHub 仓库名**（决定 `base` 路径，建议英文）。实施第一步我会先问你。