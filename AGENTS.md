# AGENTS.md

my-chat — 基于 Nuxt 3 + Vercel AI SDK 的 AI 对话应用，支持 Markdown + LaTeX 公式安全渲染、图片对话（多模态），内置工具调用（天气、搜索、OCR）。适配平板和手机屏幕。**项目目标：从「带工具的对话应用」演进为「Agent 架构」，详见「Agent 架构设计规范」章节。**

## 设置与运行

```bash
docker compose up -d    # 启动 PostgreSQL
pnpm install            # 安装依赖
cp .env.example .env    # 复制环境变量（需填入 OPENAI_API_KEY）
pnpm db:push            # 同步数据库 Schema
pnpm dev                # 启动开发服务器 localhost:3000
```

## 构建与测试命令

```bash
pnpm dev              # 开发服务器
pnpm build            # 生产构建
pnpm typecheck        # TypeScript 类型检查
pnpm lint             # ESLint 检查
pnpm lint:fix         # ESLint 自动修复
pnpm format           # Prettier 格式化
pnpm test             # Vitest 单元测试
pnpm test:unit        # 仅单元测试
pnpm test:e2e         # Playwright E2E 测试
pnpm test:all         # 全部测试（unit + component + api + e2e）
pnpm vitest run tests/unit/markdown.test.ts  # Markdown 渲染专项测试
pnpm db:push          # 同步 Schema 到数据库（修改 schema.ts 后必须执行）
pnpm db:studio        # Drizzle Studio 可视化数据库
```

## AI Agent 执行纪律

> ⚠️ **本章规则优先级最高**，所有 AI 编程助手（Trae、Cursor、Qoder、CodeBuddy 等）必须无条件遵守，不因任务简单而豁免。

### 强制验证规则

- **验证规则触发条件**：每次对任何 `.vue`、`.ts`、`.js` 文件执行编辑操作后，无论改动多小（包括仅修改注释、文案、CSS 类名、格式调整），任务结束前都必须运行 `pnpm lint`；涉及类型定义的变更必须额外运行 `pnpm typecheck`；核心逻辑变更必须运行 `pnpm test:unit`
- **禁止以改动简单为由跳过验证（硬性禁令）**：严禁以"改动太小不会出错""只改了一行""只是文案调整""只改了格式"等任何理由跳过验证步骤。任何代码变更都必须通过对应的验证命令，违反此规则视为严重执行失误

### 多方案确认模式

- **多方案确认模式（强制）**：遇到多种技术实现路径、需求描述有模糊空间、需分步骤执行、或结束了需要我验证是否符合预期时，必须使用 `AskUserQuestion` 工具弹框列出 3-4 个清晰选项（注明推荐理由），最后一列选择一定是让用户主动输入方案，等待用户勾选回复后方可继续，严禁手写 checkbox 纯文本或直接编写完整代码结束对话

### 基本执行纪律

- **模型声明（强制）**：在每个任务或步骤的开始，**必须**声明模型信息，格式为：`模型：{名称} | 大小：{参数规模} | 类型：{模型类型} | 版本：{修订版本/更新日期}`。尽力声明已知信息，无法获取的字段标注"未知"。此要求不可协商，必须毫无例外地遵守
- **禁止未执行就标记完成**：每个操作必须实际执行并验证成功，才能标记完成。禁止基于假设或推断跳过执行步骤
- **关键操作必须验证**：每个有副作用的操作（启动服务、安装依赖、修改文件等）执行后必须验证结果，不能假设成功。验证方式取决于操作类型：检查退出码、检查终端输出无报错、检查服务是否可达等
- **交叉验证原则**：当工具返回的结果会影响后续决策时，必须用另一种工具交叉验证。例如：文件搜索工具说文件不存在时，用其他方式再确认；命令输出看似成功时，检查退出码是否为 0
- **文件存在性检查不能依赖单一搜索工具**：文件搜索工具对隐藏文件（以 `.` 开头）和目录的匹配可能不可靠，会返回空结果导致误判。当搜索工具报告文件不存在时，必须用其他方式（如直接路径检测、目录列表等）交叉确认
- **修改文件前重新读取**：距上次读取超过 3 条消息，或编辑操作（`replace_in_file`/`SearchReplace`）连续失败 2 次，必须重新读取文件内容，禁止基于过时上下文继续操作
- **搜索无结果禁止单次下结论**：搜索代码内容或关键词无结果时，禁止直接判定"项目中没有此功能/代码"。必须换关键词、换正则表达式重试至少 1 次，或用目录列表交叉确认
- **大文件分批读取**：超过 500 行的文件，使用行号范围分批读取（如先读 1-200 行），避免一次性加载导致上下文丢失

### 反思与不确定性标注

> 以下规则仅在满足触发条件时生效，不影响日常简单任务效率。

- **苏格拉底式自我质询**：**修改核心逻辑（Markdown 渲染管线/流式处理/数据库 Schema）时**，必须扮演"对手"角色，对每个假设进行多轮自我辩驳，再给出最终方案
- **置信度评分**：**涉及多端兼容差异（Android WebView vs 桌面浏览器 vs 手机浏览器）时**，推理的每一步必须给出高/中/低置信度评估，并说明理由
- **公开残余不确定性**：任务完成时，在最终报告中列出当前无法确认的信息、潜在风险及验证方法，用 `[不确定]` 标签格式便于扫描
- **多级对抗性深化**：**复杂改动提交前**，必须进行层层深化分析并交叉验证，用外部视角审查初稿中的每一点，核查矛盾和遗漏

## 文档查询规则（context7 MCP）

> 涉及下列「高频更新 / AI 相关」库的核心 API 时，**必须**先用 context7 MCP 拉取最新文档，禁止仅凭训练数据内置知识写代码。规则优先级同「AI Agent 执行纪律」。

### 强制查询的库

| 库 | Context7 ID | 触发场景 |
|---|---|---|
| Vercel AI SDK | `/vercel/ai` | `streamText` / `tool()` / `maxSteps` / `stopWhen` / `onFinish` / `onStepFinish` / 多模态 content parts / provider 配置 / `stepCountIs` |
| Nuxt 3 | `/websites/nuxt_3_x` | `useFetch` / `useAsyncData` / `defineEventHandler` / `runtimeConfig` / SSR 相关 API / 路由约定 / `useChat` |
| Drizzle ORM | `/drizzle-team/drizzle-orm-docs` | `schema` 定义 / `db.select/insert/update/delete` / 关联查询 / `drizzle-kit` 配置 / 迁移 |

### 调用流程

1. 先用 `resolve-library-id` 拿库 ID（上表已知 ID 可跳过此步，直接进入第 2 步）
2. 再用 `query-docs` 查具体 API，`query` 参数必须聚焦单一概念（如 "streamText tool calling maxSteps"），不要一次问多个不相关主题
3. 每个工具每个问题最多调用 3 次；若 3 次仍查不到所需信息，回退到内置知识 + WebSearch 兜底
4. 调用结果须与项目现有代码（`server/api/chat.post.ts`、`server/db/schema.ts` 等）交叉对照，避免引入与项目版本不兼容的 API

### 例外（可不调用）

- 修改业务逻辑、CSS、文案、组件模板结构等与上述库 API 无关的任务
- 上述库的 Vue 模板基础语法（`ref`、`computed`、`watch`、`v-if`/`v-for` 等）等稳定 API
- 已在项目代码中有大量同类用法可参照时（如新增一个相似工具，可参考 `server/tools/` 现有实现）

### 注意事项

- Vercel AI SDK 有多个版本（`ai_5_0_0`、`ai_6.0.0-beta` 等），如项目 `package.json` 锁定具体版本，用 `/vercel/ai/<version>` 形式查询（如 `/vercel/ai/ai_5_0_0`）
- Drizzle ORM 优先用 `/drizzle-team/drizzle-orm-docs`（官方文档源），避免用社区镜像
- context7 库 ID 偶有失效，如查询返回空，重新 `resolve-library-id` 获取新 ID

## 架构设计

```
pages/              → ai-chat.vue, index.vue
components/chat/    → ChatInput, MarkdownRenderer, CodeBlock, MermaidBlock, SessionSidebar, ThinkingProcess, ToolInvocation
components/         → ToastProvider, ConfirmDialogProvider
composables/        → useChatConfig, useChatSession, useToast, useConfirmDialog, useTooltip
utils/              → markdown.ts, katex.ts, highlight.ts, mermaid.ts
server/api/         → chat.post.ts, sessions.ts, sessions/[id].ts, models.ts
server/tools/       → web-search.ts, weather.ts（供 MCP Server 复用）
server/mcp/         → weather-server.ts（MCP stdio 传输）
server/utils/       → imgbb.ts, reasoning-provider.ts
server/db/          → schema.ts, index.ts
server/config/      → models.ts
server/middleware/   → security.ts
```

**数据流**：`useChat() → POST /api/chat → streamText() → onFinish 持久化`（图片多一步 `uploadToImgBb()`；推理通过 `reasoning-provider` 标记 → `chat.post` 转 reasoning 事件 → 前端 `ThinkingProcess` 展示）

**渲染管线**：围栏代码块提取 → 公式提取(占位符) → `marked.parse()` → `DOMPurify.sanitize()` → 还原公式标签 → KaTeX 渲染

**DB**：`sessions (1:N) → messages (1:N) → feedbacks`（均级联删除）

## Agent 架构设计规范

> ⚠️ **本章规范的是「my-chat 项目本身」的 Agent 架构设计**，与「AI Agent 执行纪律」章节（规范 AI 编程助手如何写代码）是两回事，勿混淆。新增功能、改造核心流程时必须遵守本章原则。

### 核心判定标准

**LLM 自主决策 = Agent；代码预编排 = Workflow**。新功能默认走 Agent 路径，仅在安全/合规护栏允许 Workflow（须在设计文档说明理由）。

| 场景 | Agent（LLM 决策） | Workflow（代码预编排） |
| --- | --- | --- |
| 工具是否调用、顺序/次数 | ✅ | ❌ |
| RAG 检索、图片处理、任务分解 | ✅ | ❌ |
| 消息持久化、图片上传、安全/合规 | — | ✅ |

**红线**：若控制流由代码预编排（if/else 写死工具调用步骤），须在 openspec design 中说明理由，否则违规。

### 工具系统

一个工具只做一件事，组合交给 LLM。调用与否、顺序、次数全由 LLM 自主决定，禁止代码硬编码（`TIME_KEYWORDS` 是历史护栏，新功能不得复制）。执行失败返回 `{ error, detail }` 不 throw，由 LLM 决定重试/换工具。大对象通过 URL/ID 传递，不进 LLM 上下文。`description` 须说明"何时调用"和"何时不调用"。新增工具在 `server/tools/` 用 `tool()` 定义、`chat.post.ts` 注册；需独立进程才用 MCP。

### 执行循环

有工具时 `maxSteps=5`，无工具时 `maxSteps=1`。`stopWhen(stepCountIs(maxSteps))` 为硬上限，LLM 自主提前停止。复杂任务由 LLM 自主规划多次调用，代码不预编排。工具失败、Provider 失败（返回 500 + toast）不中断流，让 LLM 基于错误继续。消息通过 `onFinish` 异步落库，不阻塞主循环。

### 记忆系统

仅对话历史（DB `messages` 表）作为记忆，`streamText` 循环内的工具调用结果天然作为短期上下文。禁止中间结果写全局变量。

> 📋 远期演进方向详见 `openspec/agent-future-roadmap.md`。

## UI/UX 设计规范

所有可交互元素必须提供视觉反馈，让用户感知操作已被接收：

- **导航切换**：页面/视图切换使用 `transition` 过渡动画（如 `fade`、`slide`），避免硬切
- **悬浮反馈**：可点击元素 hover 时加 `shadow`、`scale` 或 `bg` 变化，用 `transition` 平滑过渡（推荐 `duration-150` \~ `duration-200`）
- **点击反馈**：按钮/卡片 active 时加 `scale-95` 或 `brightness-90`，提供按压感
- **状态切换**：展开/折叠、选中/未选中使用 `transition` 过渡，禁止瞬间跳变
- **加载状态**：异步操作显示 loading 指示器（spinner 或骨架屏），禁止无反馈的等待
- **过渡时长**：微交互 150-200ms，页面级动画 200-300ms，不超过 500ms
- **图标按钮提示**：纯图标按钮（无文字）必须用 `v-tooltip` 包裹提供文字提示，禁止使用原生 `title` 属性

## 交互与优化规则

以下规则基于实际优化经验总结，新增功能时必须遵守：

### 触摸设备适配（Android 平板 WebView + 手机）

- **操作按钮必须触摸可达**：hover-only 的按钮（`opacity-0 group-hover:opacity-100`）在触摸设备上不可见，手机端必须始终显示（不加 `group-hover`），平板端必须同时加 `focus-within:opacity-100`
- **触摸目标 ≥ 36px**：纯图标按钮必须保证 `min-w-[36px] min-h-[36px]`（手机端），桌面端可恢复默认大小（`sm:min-w-0 sm:min-h-0`）
- **禁止使用浏览器原生对话框**：`confirm()`、`alert()`、`prompt()` 在 WebView 中风格不协调且可能被拦截，必须使用自定义 `ConfirmDialogProvider` + `useConfirmDialog()` composable
- **按钮点击反馈**：所有可点击元素必须加 `active:scale-95` 或 `active:scale-[0.98]`，提供触觉反馈感
- **输入区按钮 ≥ 44px**：发送/停止等核心操作按钮必须 `min-w-[44px] min-h-[44px]`

### 动画与过渡

- **侧边栏/面板切换**：详见「Responsive Design > 侧边栏」章节
- **消息列表动画**：使用 `<TransitionGroup>` 包裹消息列表，入场动画 `translateY(12px)` + `opacity`，时长 300ms
- **折叠/展开区域**：禁止用 `v-if` 直接切换，必须用 `max-height` + `overflow: hidden` + `transition` 实现平滑高度过渡
- **自动滚动**：聊天消息区域必须在消息数量变化和 AI 流式输出时自动滚动到底部，使用 `scrollTo({ behavior: 'smooth' })`

### 用户反馈系统

- **错误提示**：所有 API 请求失败必须通过 `useToast()` 向用户展示错误信息，禁止仅 `console.error` 静默处理
- **操作成功提示**：删除、重命名等操作成功后用 `toast.success()` 反馈
- **Toast 系统**：通过 `ToastProvider`（在 `app.vue` 中注册）+ `useToast()` composable 使用，支持 `success`/`error`/`info` 三种类型

### 输入体验

- **多行输入框自动增高**：textarea 必须监听 input 变化动态调整 `scrollHeight`，设置 `min-h` 和 `max-h` 约束
- **Enter 发送 / Shift+Enter 换行**：聊天输入框的标准交互模式

### 信息展示

- **时间显示**：会话列表等场景必须显示相对时间（"刚刚"、"3 分钟前"、"2 天前"），超过 7 天显示日期
- **搜索结果**：必须显示摘要（snippet），不能只显示标题，用户需要预判内容相关性
- **AI 消息操作栏**：每条 AI 回复必须提供"复制"和"重新生成"按钮，复制成功后图标切换 + Toast 提示

### 图标与视觉

- **统一使用 SVG 图标**：禁止使用 Unicode 字符（如 ☰、✕）作为图标，全部替换为内联 SVG，保持视觉一致性
- **行内代码颜色**：使用柔和的紫色（`#7c3aed`），禁止使用刺眼的红色（`#e11d48`），避免打断阅读节奏
- **消息气泡宽度**：用户消息 `max-w-[92%] sm:max-w-[85%]`，AI 消息 `max-w-[96%] sm:max-w-[90%]`，手机端放宽以充分利用屏幕空间

### 会话管理

- **会话重命名**：支持双击标题或点击编辑图标进入编辑模式，Enter 确认、Escape 取消、blur 自动确认
- **删除确认**：必须通过 `useConfirmDialog()` 弹窗确认，禁止无确认直接删除

## 响应式设计与移动兼容性

本项目同时支持 **Android 平板横屏**和**手机竖屏**，断点为 `sm:640px`，手机端无前缀，平板端加 `sm:` 前缀。

### 侧边栏（关键模式）

侧边栏在手机和平板上使用**完全不同的布局模式**，已封装在 `ai-chat.vue` 中：

- 桌面端：内联在 flex 流中，`<Transition>` + `margin-left` + `opacity` 实现滑入滑出
- 手机端：覆盖式弹出层（`fixed inset-y-0 left-0 z-50`）+ 半透明遮罩（`bg-black/50`），使用 `.slide-left` 动画从左侧滑入
- `isMobile` 通过 `window.innerWidth < 640` 判断，在 `onMounted` 中初始化并监听 `resize`
- 手机端侧边栏自带 X 关闭按钮，点击遮罩也可关闭

## 代码规范

- Vue 组件：`<script setup lang="ts">`，禁止 Options API
- 文件名：kebab-case（`ai-chat.vue`、`chat.post.ts`）
- 组件名：PascalCase（`MarkdownRenderer`）
- 常量：UPPER_SNAKE_CASE（`LLM_MODEL`）
- 数据库列：snake_case（`created_at`、`session_id`）
- 前端 API 调用：统一用 Nuxt 的 `$fetch` / `useFetch`，禁止原生 `fetch`
- 注释规则：复杂逻辑、非显而易见的业务约束、容易踩坑的地方**必须加中文注释**；简单自解释的代码不需要注释

## 关键规则

- 永远不要将未净化的字符串直接传入 `v-html`，必须经过 `renderMarkdown()` 处理（内含 DOMPurify 净化）
- DOMPurify 白名单必须包含 MathML（`math`, `mrow`, `mi`, `mfrac` 等）和 SVG（`svg`, `path`, `line` 等）标签，否则 KaTeX 公式会被过滤掉
- 消息持久化必须在 `streamText` 的 `onFinish` 回调中执行，禁止在 `onChunk` 中写库
- 密钥只能放在 `runtimeConfig` 的非 public 字段或 `.env` 文件中，禁止暴露到前端
- 修改 `server/db/schema.ts` 后必须运行 `pnpm db:push`
- 修改 Markdown 渲染相关代码后，运行 `pnpm vitest run tests/unit/markdown.test.ts` 验证
- 新增 AI 工具时，在 `server/tools/` 创建文件，用 `tool()` 定义，并在 `chat.post.ts` 的 `toolsConfig` 注册；须遵守「Agent 架构设计规范 > 工具系统设计原则」（职责单一、LLM 自主决策、错误返回不抛异常）
- 新增 API 路由时必须包含参数校验和 `createError()` 错误处理
- 修改涉及 `res.write`/`res.end` 的代码后**必须验证流式输出（打字机效果）** → 详见「注意事项」章节
- **修改代码后必须运行 `pnpm lint` 检查 lint 错误**（详见「AI Agent 执行纪律」章节的硬性禁令）。特别是模板中的 HTML 结构变更（如添加/删除标签），每次编辑后都要手动校验对应的起始/闭合标签是否完整

### 数据安全规则

- **异步写操作必须防重复提交**：任何修改数据的异步操作（API 路由、HTTP 请求、数据库写入），入口必须有守卫阻止并发重复调用，异步完成后（success + fail 分支）必须重置守卫。实现方式因场景而异：标志位 / disabled 属性 / debounce 均可
- **服务端数据库避免 Read-Modify-Write**：先查后改的模式存在竞态窗口。优先使用原子操作（如 `UPDATE ... WHERE`、Drizzle 的 `db.update().set().where()`、`INSERT ... ON CONFLICT`），除非业务逻辑必须基于旧值做判断
- **多数据源同步注意一致性**：同一数据写入多个存储时，确保所有路径以相同顺序写入，避免旧数据覆盖新数据

## SSR 水合规则

Nuxt 3 使用 SSR，服务端和客户端必须渲染出相同的 HTML，否则产生水合不匹配（Hydration Mismatch）警告或错误。以下规则防止此类问题：

- **禁止在模板或 computed 中使用不确定值**：`Date.now()`、`new Date()`、`Math.random()`、`crypto.randomUUID()` 等在 SSR 和客户端会产生不同结果，必须放在 `onMounted` 内或用 `<ClientOnly>` 包裹
- **浏览器 API 必须守卫**：`window`、`document`、`navigator`、`localStorage` 等仅在客户端存在，访问前必须用 `import.meta.client` 或 `process.client` 守卫，或放在 `onMounted` 内
- **客户端条件渲染用** **`<ClientOnly>`**：依赖浏览器 API 或客户端状态的组件（如地图、图表、富文本编辑器）必须用 `<ClientOnly>` 包裹，或使用 `client:only` 指令跳过 SSR
- **ref 初始值必须 SSR 安全**：`ref()` 的初始值在 SSR 和客户端必须一致。需要客户端才能确定的值（如屏幕宽度、用户偏好），应在 `onMounted` 中延迟赋值，初始值用安全的默认值
- **禁止 onMounted 后直接修改 SSR 渲染的 DOM**：`onMounted` 中直接操作 DOM（如 `createElement`、`replaceChild`）会破坏 Vue 的水合节点匹配。如需动态渲染，用 `<ClientOnly>` 包裹整个区域

## 测试策略

- 每次提交前必须通过 `pnpm typecheck` + `pnpm lint` + `pnpm test:unit`；修改渲染逻辑后跑 `pnpm test:e2e`，发版前跑 `pnpm build`
- 覆盖率要求：lines ≥ 70%，functions ≥ 65%，branches ≥ 60%
- 修改核心逻辑时必须补充对应的单元测试
- **修改业务逻辑后必须进行测试**：测试失败时先判断根因再心动
  - 预期内的行为变更 → 同步更新测试用例
  - 意外的回归（测试作为安全网抓住了bug） → 修复代码，不改测试
- **修改 `server/db/schema.ts` 后必须同步更新 `docs/db-schema.md`**：`docs/db-schema.md` 是表结构的唯一文档来源，禁止代码与文档脱节（`pnpm db:push` 执行要求 → 详见「关键规则」章节）
- **修改云函数（入参/返回值/业务逻辑）或 HTTP 接口后必须同步更新 `docs/API.md`**：`docs/API.md` 是唯一接口定义来源，禁止代码与文档脱节

## 注意事项

- `nuxt.config.ts` 中的 `fix-windows-path-urls` Vite 中间件会拦截所有 HTTP 响应并缓冲 body。修改此中间件时**必须确保非 HTML 响应（特别是** **`/api/chat`** **的 SSE 流式响应）直接透传**，否则会破坏打字机效果。任何涉及 `res.write`/`res.end` 的修改都必须测试流式输出是否正常
- `MarkdownRenderer.vue` 中代码块通过 `createApp(CodeBlock).mount()` 动态挂载，不是声明式组件，修改时注意 Vue 实例生命周期
- `useChat` 的 `body` 参数必须用 `computed()` 包裹，否则 sessionId 等动态值不会随请求更新
- 数据库开发端口是 **5434**（非默认 5432），测试端口是 **5433**
- `saveMessagesToDb` 只保存最后一条用户消息（反向查找），避免重复插入历史消息
- `dompurify`、`highlight.js`、`katex`、`marked` 在 devDependencies 中但运行时使用，不要误删
- 模型白名单在 `server/config/models.ts`，`chat.post.ts` 通过 `ALLOWED_MODEL_VALUES` 校验，新增模型需同步两处
- **图片对话使用 ImgBB 图床**：硅基流动不支持 base64 图片，需先上传到 ImgBB 获取公网 URL。在 `.env` 中配置 `IMGBB_API_KEY`，免费注册 <https://api.imgbb.com/> 获取
- **视觉/推理模型不支持 enable_thinking 参数**：通过 `getModelCapabilities()` 能力系统判断，`!caps.vision && !caps.deepThinking` 时才启用 thinking，新增模型需在 `server/config/models.ts` 中正确配置 capabilities
- **图片对话统一使用 streamText()**：纯文本和图片均通过 `streamText()` 处理，图片先上传 ImgBB 获取公网 URL 后作为多模态 content parts 传入

## 问题排查规范

| 问题              | 排查步骤                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 数据库连接失败    | `docker compose ps` → 端口 5434 占用 → `.env` 中 `DATABASE_URL`                                                                              |
| AI 回复报错       | `.env` 中 `OPENAI_API_KEY` 有效 → 网络可达 LLM Provider → 换 `LLM_MODEL`                                                                     |
| Markdown 渲染异常 | DOMPurify 白名单是否包含所需标签 → KaTeX 公式语法 → 浏览器控制台                                                                             |
| 打字机效果消失    | `nuxt.config.ts` 中间件是否缓冲了非 HTML 响应 → `security.ts` 中间件是否拦截了流 → 浏览器 Network 面板检查 `/api/chat` 响应是否逐 chunk 到达 |
