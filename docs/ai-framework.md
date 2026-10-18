# AI 接入框架设计（BYOK · 纯本地）

> 目标：让全站工具共享一套「用户自带密钥（BYOK）」的大模型接入能力。
> 用户在 **AI 接入设置**（`/tools/ai-settings/`）页全局配置供应商与模型，
> 各工具使用 AI 能力时自动引用该配置，前端直连大模型 API，
> **密钥与配置只存浏览器本地，不经过任何后端**——与站点「数据不出本地」的承诺一致。
>
> 配套调研结论（浏览器存储配额、Safari 淘汰规则、CORS 现状、同类项目实践）
> 见本文第 8 节，均来自 2026-10 核实的信息。

---

## 1. 设计原则

1. **BYOK**：密钥由用户自行申请并填入，本站无后端、不代理、不落库。
2. **零新依赖**：全部用浏览器原生 API（`fetch` / SSE / `localStorage` / `crypto`）实现，不引运行时包。
3. **全局一份配置**：MPA 架构下各工具页共享同一 localStorage key，配置改动跨页生效（storage 事件通知）。
4. **能力路由**：工具按需声明「我需要能读图的模型」，框架按供应商优先级自动选型、失败顺延。
5. **可迁移**：配置可导出/导入；站内地址用 `{ORIGIN}` 占位符存储，导入时按「导出来源」精确替换，多域名部署互迁零手工。

## 2. 模块结构

```
src/core/ai/
├── types.ts        # 共享类型（供应商 / 模型 / 能力 / 消息）
├── schema.ts       # 纯函数：配置校验与清洗（load 的安全层）
├── router.ts       # 纯函数：按能力 + 供应商优先级解析候选模型
├── http.ts         # 请求构建（纯函数）+ SSE 流式解析 + 连通性测试
├── store.ts        # localStorage CRUD + 跨页订阅（薄壳，逻辑在 schema）
├── transfer.ts     # 导出/导入 + {ORIGIN} 占位 + 域名替换（纯函数为主）
├── chat-core.ts    # 会话库纯逻辑：内容规划（data URL→资产）/ LRU 淘汰计划 / 记录清洗
├── chat-store.ts   # IndexedDB 会话库（conversations/messages/assets/usage + 配额守卫）
└── index.ts        # 门面：aiChat() —— 各工具唯一需要 import 的入口

tools/ai-settings/  # 设置页（工具页形态，自动进首页与 sitemap）
```

依赖方向：`index.ts` → `router/http/store` → `schema/types`，纯函数核心均可单测（Vitest，node 环境），DOM 交互只在设置页。

## 3. 配置模型与存储（Phase 1）

存储：localStorage，key `static-toolkit-ai-config`，JSON blob 带 `version`（沿用全站 settings 约定）。
只放配置不放内容，总量 < 100 KB，远低于 5 MiB 上限。

```ts
type ProviderProtocol = 'openai' | 'anthropic';
// openai    = OpenAI 兼容协议（OpenAI / DeepSeek / Kimi / GLM / Ollama / 多数中转）
// anthropic = Anthropic Messages API（需加浏览器直连头，见第 5 节）

type ModelCapability = 'text' | 'image' | 'audio';
// text  = 文本对话（语言大模型的基础能力）
// image = 图片输入（视觉理解 / 多模态）
// audio = 音频输入（语音理解）

interface AIProvider {
  id: string;              // crypto.randomUUID（非安全上下文回退随机串）
  name: string;            // 显示名，如 "OpenAI 官方"、"公司中转"
  protocol: ProviderProtocol;
  baseUrl: string;         // 指向本站的地址用 {ORIGIN} 占位（见第 6 节）
  apiKey: string;          // 明文存储——BYOK 固有属性，设置页明示风险
  enabled: boolean;
  addedAt: number;
}

interface AIModel {
  id: string;
  providerId: string;
  name: string;            // API 模型名，如 gpt-4o-mini / claude-sonnet-4-5
  capabilities: ModelCapability[];
  enabled: boolean;
}

interface AIConfig {
  version: 1;
  providers: AIProvider[]; // ★ 数组顺序即调用优先级，设置页拖拽/上下移调整
  models: AIModel[];
}
```

- **优先级语义**：供应商在数组中的位置 = 优先级（第 0 个最优先）。同一供应商内模型按添加顺序。
- **级联删除**：删供应商时删除其全部模型。
- **清洗规则**（`schema.ts`，读取与导入共用）：非法字段回退默认值；能力标签过滤白名单；
  丢弃 `providerId` 悬空的模型；id 去重；数量护栏（≤50 供应商 / ≤500 模型）。

## 4. 能力路由（router.ts）

```ts
// 解析「满足指定能力集合」的候选模型，按 供应商优先级 × 模型添加顺序 排列
resolveCandidates(config, need: ModelCapability[]): { provider: AIProvider; model: AIModel }[]
```

- 匹配规则：`model.capabilities ⊇ need`（`['text','image']` 的模型可服务 `['text']` 的请求，反之不行）。
- 工具缺省 `need: ['text']`。
- **自动顺延**：`aiChat()` 依次尝试候选；某候选在**产出首个增量之前**失败（网络/HTTP 错误），
  自动换下一个；已开始输出后失败则如实抛错（避免重复输出）。全部失败时抛聚合错误。

## 5. 调用适配层（http.ts）

### 端点规范化（确定性规则，测试覆盖）

| 协议 | 用户填写的 baseUrl | 实际请求 |
|---|---|---|
| openai | `https://api.x.com/v1`（约定含 `/v1`） | `POST {base}/chat/completions`、`GET {base}/models` |
| openai | 路径为 `/`（忘填 /v1） | 自动补 `/v1` 再拼 |
| anthropic | `https://api.anthropic.com` 或 `…/v1` | 一律规整为 `POST {base 去掉尾部 /v1}/v1/messages`、`GET …/v1/models` |

### 请求头

| 协议 | 头 |
|---|---|
| openai | `Authorization: Bearer <key>` |
| anthropic | `x-api-key: <key>` + `anthropic-version: 2023-06-01` + `anthropic-dangerous-direct-browser-access: true`（官方为浏览器直连提供的开关） |

### 消息体

统一消息类型（框架内标准），适配层负责转协议格式：

```ts
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string };  // http(s) 或 data: URL；anthropic 侧自动拆 base64
```

- openai：`{type:'image_url', image_url:{url}}`；anthropic：`{type:'image', source:{type:'base64', media_type, data}}`（从 data URL 拆出，http 图片 anthropic 不支持 source url，Phase 1 限 data URL 并在校验时报友好错误）。
- system 消息：openai 原样传；anthropic 提升为顶层 `system` 字段。
- 音频输入（`audio` 能力）Phase 1 仅作能力标记，消息体格式待主流协议稳定后补。

### 流式与错误规范

- SSE 解析为纯函数（喂缓冲区 → 事件数组 + 剩余缓冲），openai 增量取 `choices[0].delta.content`
  （兼容 deepseek 的 `delta.reasoning_content`），anthropic 按 `content_block_delta` 的 `delta.text` / `thinking_delta`。
- `onDelta({ content?, reasoning? })` 回调驱动 UI 增量渲染。
- 错误统一为 `AIError`，含 `code`：`no-model` / `http`（带状态码与截断到 300 字的响应体）/
  `network`（fetch TypeError，提示检查网络、URL 与 CORS）/ `aborted`。

### 连通性测试

- `testProvider()`：`GET /models`，成功返回模型 id 列表（设置页「拉取模型列表」直接用它批量建模型）。
- 部分兼容网关不实现 `/models` → 模型行「测试」按钮走 `probeChat()`：max_tokens=1 的极小请求，测真实通路并计延迟。

## 6. 导入导出与多域名迁移（transfer.ts）

双域名部署（Cloudflare Pages / GitHub Pages）= 两个独立 origin，配置互不可见。迁移方案：

1. **占位符约定（第一道防线）**：凡可能指向本站的 URL（如部署在同域的 CORS 代理），
   配置里存 `{ORIGIN}/api/proxy`，调用时替换为 `location.origin` + BASE_URL。这类字段天然可移植。
2. **导出元数据 + 精确替换（第二道防线）**：导出文件头带
   `meta: { format: 'polykit-ai-config', version, exportedAt, exportedFrom, includeKeys }`；
   导出时把当前站点根（origin + BASE_URL，如 `https://user.github.io/polykit/`）出现处替换为 `{ORIGIN}`；
   导入时反向替换 `exportedFrom → 当前站点根`（无该字段则退化为只替换 `{ORIGIN}`）。
   **只替换记录在案的旧站前缀**——`api.openai.com` 等外部 URL 永远不受影响。
3. **密钥可选剔除**：`exportAIConfigJSON(config, { includeKeys })`，默认含密钥（自用迁移），
   可导出脱敏版分享给他人。
4. 导入走与 load 相同的 `sanitize` 清洗，非法数据整体拒绝并提示「文件无效或格式不符」。

## 7. 工具接入标准

各工具页只 import 门面：

```ts
import { aiChat } from '@/core/ai';

const res = await aiChat({
  messages: [{ role: 'user', content: '帮我把这段话改成小红书风格' }],
  need: ['text'],
  onDelta: (d) => render(d.content),   // 可选，流式渲染
});
// res.content / res.reasoning / res.model.providerName / res.model.modelName / res.latencyMs
// 未配置模型时抛 AIError(code='no-model')，工具应捕获并引导用户去设置页：
//   `${import.meta.env.BASE_URL}tools/ai-settings/`
```

UX 约定：工具内 AI 入口旁放「⚙ 设置」链接；调用失败按 `AIError.code` 分支提示；
工具产生的**临时上下文**放内存即可，需要跨会话保留的结构化对话/多模态资产走 Phase 2 会话库（下一节）。

## 8. 浏览器存储容量调研（会话库 Phase 2 的依据）

| 存储 | 容量 | 淘汰风险 |
|---|---|---|
| localStorage | 每源 5 MiB，仅字符串 | 无自动淘汰，满即 QuotaExceededError |
| IndexedDB / OPFS | Chrome 60% 磁盘；Safari 约 60%（起步 1 GiB，满时询问用户）；Firefox persist 后 50% | 默认 best-effort，磁盘紧张按 LRU **整源清除**；Safari 7 天无访问清脚本数据 |

结论：纯文本对话在 IndexedDB 下几乎不可能触顶（1 条消息 1~4 KB，一年重度使用约百 MB 级），
大头是多模态资产（图 0.5~2 MB / 分钟音频约 1 MB）。

**Phase 2 已落地**（`chat-core.ts` 纯逻辑 + `chat-store.ts` IndexedDB 层）：

- IndexedDB 独立库 `polykit-ai`：`conversations`（元信息，bytes 含其资产字节）/ `messages`
  （按 `[conversationId, seq]` 复合索引，多模态部分只存资产 id）/ `assets`（**Blob 原生存储**，
  sha-256 去重 + lastAccessed 供 LRU）/ `usage`（按日聚合调用量与 token）。
- **绝不存完整请求体**：每轮请求会重发全部历史，按原始日志存会近似平方级膨胀；
  上下文由 `hydrateForApi()` 从 messages 即时拼装（资产还原为 data URL）。
- 配额管理：配置 `budgetMB`（缺省 500，50~5000，随配置导出导入）；所有写入经配额守卫——
  遇 `QuotaExceededError` 先按预算自动 LRU 清理再重试一次，仍失败抛 `AIError('quota')`。
  淘汰策略纯函数化（`computeEvictionPlan`）：先清最久未访问的孤儿资产，再按 updatedAt 删最旧会话
  （连带消息与独占资产；sha-256 去重的共享资产按引用计数决定去留）。
- 设置页面板：会话/消息/资产统计、今日调用量、预算调整、「整理存储」手动清理、
  会话列表（单条导出自包含 JSON / 删除）、「清空会话数据」。
- `aiChat()` 成功后自动记账当日调用次数（fire-and-forget，会话库不可用时静默跳过）。

## 9. CORS 现状备忘（2026-10）

| 供应商 | 浏览器直连 |
|---|---|
| OpenAI 及绝大多数 OpenAI 兼容端点（DeepSeek / Kimi / GLM / Ollama 等） | ✅ 通常放行 |
| Anthropic | ✅ 需 `anthropic-dangerous-direct-browser-access: true` 头 |
| Gemini 原生端点 | ✅ 基本可用；其 OpenAI 兼容端点有 CORS 报告，建议 Gemini 用户走原生协议（Phase 1 未内置，文档注明） |
| 自建网关 / 部分中转 | ⚠️ 因人而异，设置页「测试」按钮即为此设计；不放行的需用户自配代理 |

## 10. 安全边界（如实告知用户）

- 密钥明文存于 localStorage：这是 BYOK 无后端形态的固有属性（NextChat / LobeChat 同款做法）。
  防的是「换设备/共享电脑忘清理」，防不了页面内 XSS——本站纯静态、零三方运行时脚本（分析统计类亦无），面已尽量小。
  设置页对此有明确文案；将来可选加 WebCrypto 口令加密（口令不落盘）。
- API 调用直连供应商域名：请求与密钥不经过本站（本站也没有任何后端）。
- AI 返回的**代码**回填执行（quote-card / qr-code 既有玩法）继续走 `src/core/utils/ai-code-guard.ts` 黑名单扫描，与本文框架正交。

## 11. 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| P1 | 配置框架（schema/router/http/store/transfer）+ AI 接入设置页 + 工具页头部设置入口 | ✅ 已交付 |
| P2 | IndexedDB 会话库（chat-core/chat-store）+ 配额守卫与 LRU 淘汰 + 设置页会话数据面板 | ✅ 已交付（见第 8 节） |
| P3 | 各工具 AI 增强迁移（提示词组装 → 直连调用 + 会话记忆），Gemini 原生协议适配 | 候选 |
