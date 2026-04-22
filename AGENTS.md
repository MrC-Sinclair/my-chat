# AGENTS.md

sw-pad — AI 学习平板，面向深圳外国语学校学生的 H5 嵌入式 WebView 应用，运行于 Android 平板横屏环境。学生在平板上与 AI 助手对话，解答学科问题。AI 回复必须安全渲染 Markdown + LaTeX 公式，且支持工具调用（天气、搜索）。

## Setup

```bash
docker compose up -d    # 启动 PostgreSQL
pnpm install            # 安装依赖
cp .env.example .env    # 复制环境变量（需填入 OPENAI_API_KEY）
pnpm db:push            # 同步数据库 Schema
pnpm dev                # 启动开发服务器 localhost:3000
```

## Build & Test Commands

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

## Architecture

```
pages/              → Nuxt 3 文件路由（ai-chat.vue 核心页面）
components/chat/    → Vue 组件（ChatInput, MarkdownRenderer, CodeBlock, SessionSidebar, ThinkingProcess, ToolInvocation）
composables/        → 组合式函数（useChatConfig, useChatSession）
utils/              → 工具函数（markdown.ts 渲染管线, katex.ts 公式渲染）
server/api/         → API 路由（chat.post.ts, sessions.ts, sessions/[id].ts, models.ts）
server/tools/       → AI 工具（weather.ts, web-search.ts）
server/db/          → 数据库（schema.ts 表定义, index.ts 连接初始化）
server/config/      → 服务端配置（models.ts 模型白名单）
```

### 数据流

```
useChat() → POST /api/chat → streamText() 流式生成 → onFinish 持久化消息
```

### Markdown 渲染管线

```
公式提取(占位符替换) → marked.parse() → DOMPurify.sanitize() → 占位符还原为 math-block/math-inline → KaTeX 渲染
```

### 数据库表关系

```
sessions (1:N) → messages (1:N) → feedbacks（均级联删除）
```

## UI/UX Guidelines

所有可交互元素必须提供视觉反馈，让用户感知操作已被接收：

- **导航切换**：页面/视图切换使用 `transition` 过渡动画（如 `fade`、`slide`），避免硬切
- **悬浮反馈**：可点击元素 hover 时加 `shadow`、`scale` 或 `bg` 变化，用 `transition` 平滑过渡（推荐 `duration-150` ~ `duration-200`）
- **点击反馈**：按钮/卡片 active 时加 `scale-95` 或 `brightness-90`，提供按压感
- **状态切换**：展开/折叠、选中/未选中使用 `transition` 过渡，禁止瞬间跳变
- **加载状态**：异步操作显示 loading 指示器（spinner 或骨架屏），禁止无反馈的等待
- **过渡时长**：微交互 150-200ms，页面级动画 200-300ms，不超过 500ms
- **图标按钮提示**：纯图标按钮（无文字）必须用 `<UTooltip>` 包裹提供文字提示，禁止使用原生 `title` 属性

## Code Style

- Vue 组件：`<script setup lang="ts">`，禁止 Options API
- 文件名：kebab-case（`ai-chat.vue`、`chat.post.ts`）
- 组件名：PascalCase（`MarkdownRenderer`）
- 常量：UPPER_SNAKE_CASE（`LLM_MODEL`）
- 数据库列：snake_case（`created_at`、`session_id`）
- 前端 API 调用：统一用 Nuxt 的 `$fetch` / `useFetch`，禁止原生 `fetch`
- 不添加注释，除非明确要求

## Critical Rules

- 永远不要将未净化的字符串直接传入 `v-html`，必须经过 `renderMarkdown()` 处理（内含 DOMPurify 净化）
- DOMPurify 白名单必须包含 MathML（`math`, `mrow`, `mi`, `mfrac` 等）和 SVG（`svg`, `path`, `line` 等）标签，否则 KaTeX 公式会被过滤掉
- 消息持久化必须在 `streamText` 的 `onFinish` 回调中执行，禁止在 `onChunk` 中写库
- 密钥只能放在 `runtimeConfig` 的非 public 字段或 `.env` 文件中，禁止暴露到前端
- 修改 `server/db/schema.ts` 后必须运行 `pnpm db:push`
- 修改 Markdown 渲染相关代码后，运行 `pnpm vitest run tests/unit/markdown.test.ts` 验证
- 新增 AI 工具时，在 `server/tools/` 创建文件，用 `tool()` 定义，并在 `chat.post.ts` 的 `tools` 参数中注册
- 新增 API 路由时必须包含参数校验和 `createError()` 错误处理

## SSR Hydration Rules

Nuxt 3 使用 SSR，服务端和客户端必须渲染出相同的 HTML，否则产生水合不匹配（Hydration Mismatch）警告或错误。以下规则防止此类问题：

- **禁止在模板或 computed 中使用不确定值**：`Date.now()`、`new Date()`、`Math.random()`、`crypto.randomUUID()` 等在 SSR 和客户端会产生不同结果，必须放在 `onMounted` 内或用 `<ClientOnly>` 包裹
- **浏览器 API 必须守卫**：`window`、`document`、`navigator`、`localStorage` 等仅在客户端存在，访问前必须用 `import.meta.client` 或 `process.client` 守卫，或放在 `onMounted` 内
- **客户端条件渲染用 `<ClientOnly>`**：依赖浏览器 API 或客户端状态的组件（如地图、图表、富文本编辑器）必须用 `<ClientOnly>` 包裹，或使用 `client:only` 指令跳过 SSR
- **ref 初始值必须 SSR 安全**：`ref()` 的初始值在 SSR 和客户端必须一致。需要客户端才能确定的值（如屏幕宽度、用户偏好），应在 `onMounted` 中延迟赋值，初始值用安全的默认值
- **禁止 onMounted 后直接修改 SSR 渲染的 DOM**：`onMounted` 中直接操作 DOM（如 `createElement`、`replaceChild`）会破坏 Vue 的水合节点匹配。如需动态渲染，用 `<ClientOnly>` 包裹整个区域

## Testing

- 单元测试：`tests/unit/`，命名 `*.test.ts`
- E2E 测试：`tests/e2e/`，命名 `*.spec.ts`
- 覆盖率阈值：lines ≥ 70%，functions ≥ 65%，branches ≥ 60%
- 修改核心逻辑时必须补充对应的单元测试

## Environment Variables

| 变量 | 必需 | 说明 | Vercel 环境变量名 |
|------|------|------|-------------------|
| `OPENAI_API_KEY` | 是 | LLM API 密钥 | `NUXT_OPEN_AI_API_KEY` |
| `OPENAI_BASE_URL` | 否 | LLM API 地址 | `NUXT_OPEN_AI_BASE_URL` |
| `LLM_MODEL` | 否 | 模型名称（直接读 process.env） | `LLM_MODEL` |
| `ENABLE_THINKING` | 否 | 深度思考开关（直接读 process.env） | `ENABLE_THINKING` |
| `SYSTEM_PROMPT` | 否 | 系统提示词 | `NUXT_SYSTEM_PROMPT` |
| `DATABASE_URL` | 是 | PostgreSQL 连接串 | `NUXT_DATABASE_URL` |
| `DATABASE_TEST_URL` | 仅测试 | 测试数据库连接 | — |
| `APP_TITLE` | 否 | 应用标题（前端可见） | `NUXT_PUBLIC_APP_TITLE` |

`runtimeConfig` 的环境变量在 Vercel 中需要加 `NUXT_` 前缀。`LLM_MODEL` 和 `ENABLE_THINKING` 在 `chat.post.ts` 中直接读 `process.env`，不加前缀。

## Gotchas

- `MarkdownRenderer.vue` 中代码块通过 `createApp(CodeBlock).mount()` 动态挂载，不是声明式组件，修改时注意 Vue 实例生命周期
- `useChat` 的 `body` 参数必须用 `computed()` 包裹，否则 sessionId 等动态值不会随请求更新
- 数据库开发端口是 **5434**（非默认 5432），测试端口是 **5433**
- `saveMessagesToDb` 只保存最后一条用户消息（反向查找），避免重复插入历史消息
- `dompurify`、`highlight.js`、`katex`、`marked` 在 devDependencies 中但运行时使用，不要误删
- 模型白名单在 `server/config/models.ts`，`chat.post.ts` 通过 `ALLOWED_MODEL_VALUES` 校验，新增模型需同步两处

## Troubleshooting

| 问题 | 排查步骤 |
|------|---------|
| 数据库连接失败 | `docker compose ps` → 端口 5434 占用 → `.env` 中 `DATABASE_URL` |
| AI 回复报错 | `.env` 中 `OPENAI_API_KEY` 有效 → 网络可达 LLM Provider → 换 `LLM_MODEL` |
| Markdown 渲染异常 | DOMPurify 白名单是否包含所需标签 → KaTeX 公式语法 → 浏览器控制台 |
