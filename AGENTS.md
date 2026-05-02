# AGENTS.md

my-chat — 基于 Nuxt 3 + Vercel AI SDK 的通用 AI 对话应用，支持 Markdown + LaTeX 公式安全渲染，内置工具调用（天气、搜索），支持图片对话（多模态）。适配平板和手机屏幕。

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
components/         → 全局组件（ToastProvider, ConfirmDialogProvider）
composables/        → 组合式函数（useChatConfig, useChatSession, useToast, useConfirmDialog, useTooltip）
utils/              → 工具函数（markdown.ts 渲染管线, katex.ts 公式渲染）
server/api/         → API 路由（chat.post.ts, sessions.ts, sessions/[id].ts, models.ts）
server/tools/       → AI 工具（weather.ts, web-search.ts）
server/utils/       → 服务端工具（imgbb.ts 图床上传）
server/db/          → 数据库（schema.ts 表定义, index.ts 连接初始化）
server/config/      → 服务端配置（models.ts 模型白名单）
```

### 数据流

```
纯文本: useChat() → POST /api/chat → streamText() 流式生成 → onFinish 持久化消息
图片:   useChat() → POST /api/chat(images字段) → uploadToImgBb() 图床 → 原生fetch调用LLM → SSE流式输出 → onFinish 持久化
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
- **图标按钮提示**：纯图标按钮（无文字）必须用 `v-tooltip` 包裹提供文字提示，禁止使用原生 `title` 属性

## Interaction & UX Optimization Rules

以下规则基于实际优化经验总结，新增功能时必须遵守：

### 触摸设备适配（Android 平板 WebView + 手机）

- **操作按钮必须触摸可达**：hover-only 的按钮（`opacity-0 group-hover:opacity-100`）在触摸设备上不可见，手机端必须始终显示（不加 `group-hover`），平板端必须同时加 `focus-within:opacity-100`
- **触摸目标 ≥ 36px**：纯图标按钮必须保证 `min-w-[36px] min-h-[36px]`（手机端），桌面端可恢复默认大小（`sm:min-w-0 sm:min-h-0`）
- **禁止使用浏览器原生对话框**：`confirm()`、`alert()`、`prompt()` 在 WebView 中风格不协调且可能被拦截，必须使用自定义 `ConfirmDialogProvider` + `useConfirmDialog()` composable
- **按钮点击反馈**：所有可点击元素必须加 `active:scale-95` 或 `active:scale-[0.98]`，提供触觉反馈感
- **输入区按钮 ≥ 44px**：发送/停止等核心操作按钮必须 `min-w-[44px] min-h-[44px]`

### 动画与过渡

- **侧边栏/面板切换**：桌面端用 `<Transition>` + `margin-left` + `opacity` 实现滑入滑出；手机端侧边栏为覆盖式（`fixed inset-y-0 left-0 z-50`），使用 `.slide-left` 动画从左侧滑入，同时显示半透明遮罩（`bg-black/50`）
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

## Responsive Design & Mobile Compatibility

本项目同时支持 **Android 平板横屏**和**手机竖屏**，断点为 `sm:640px`。新增 UI 组件时必须遵循以下规则：

### 响应式模式

所有 UI 变更必须用 Tailwind 前缀同时适配手机和平板，CSS 在手机上**默认（无前缀）**，平板上**加 `sm:` 前缀**：

```tailwind
class="px-3 sm:px-6 py-2 sm:py-3 text-base sm:text-xl"
```

手机端是"窄屏模式"，平板端是"宽屏模式"，不要反过来。

### 关键断点对照表

| 属性                 | 手机（默认）             | 平板（sm:）           |
| -------------------- | ------------------------ | --------------------- |
| Header padding       | `px-3 py-2`              | `sm:px-6 sm:py-3`     |
| Header 标题          | `text-base`              | `sm:text-xl`          |
| 侧边栏布局           | 覆盖式 overlay（fixed）  | 内联式 inline（flex） |
| 侧边栏宽度           | `w-[85vw]`               | `sm:w-64`             |
| 消息气泡圆角         | `rounded-xl`             | `sm:rounded-2xl`      |
| 消息气泡 padding     | `px-2.5 py-1.5`          | `sm:px-5 sm:py-3`     |
| 消息间距             | `space-y-2`              | `sm:space-y-6`        |
| 消息容器 top padding | `py-1`                   | `sm:py-6`             |
| 用户气泡宽度         | `max-w-[92%]`            | `sm:max-w-[85%]`      |
| AI 气泡宽度          | `max-w-[96%]`            | `sm:max-w-[90%]`      |
| 操作按钮             | 始终显示，`min-w-[36px]` | hover 显示，默认大小  |
| 发送按钮             | `min-w-[44px]` SVG 图标  | 同上                  |
| "新会话"按钮         | SVG 图标，无文字         | 显示文字              |

### 侧边栏（关键模式）

侧边栏在手机和平板上使用**完全不同的布局模式**，已封装在 `ai-chat.vue` 中：

```html
<!-- 桌面端：内联在 flex 流中 -->
<div class="hidden sm:flex">
  <SessionSidebar v-show="showSidebar" ... />
</div>

<!-- 手机端：覆盖式弹出层 + 遮罩 -->
<Transition name="slide-left">
  <div v-if="isMobile && showSidebar" class="fixed inset-y-0 left-0 z-50 sm:hidden">
    <SessionSidebar @close="showSidebar = false" />
  </div>
</Transition>
```

- `isMobile` 通过 `window.innerWidth < 640` 判断，在 `onMounted` 中初始化并监听 `resize`
- 手机端侧边栏自带 X 关闭按钮，点击遮罩也可关闭
- 动画使用 `transform: translateX(-100%)` 从左侧滑入

### Viewport 设置

`app.vue` 中已设置：

```html
<meta
  name="viewport"
  content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
/>
```

禁止用户缩放，防止输入时页面意外缩放。

### 新增组件检测清单

新增或修改 UI 组件时，对照以下问题：

- [ ] 手机端按钮触摸目标是否 ≥ 36px（核心操作 ≥ 44px）？
- [ ] hover-only 的按钮在触摸设备上是否可见？
- [ ] 是否用了 Tailwind 前缀 `sm:` 区分手机和平板？
- [ ] 手机端侧边栏是否为 overlay 模式？
- [ ] 消息间距是否在手机上更紧凑（`space-y-2` vs `space-y-6`）？
- [ ] 操作栏是否在手机上始终显示（不依赖 hover）？
- [ ] 手机端 padding 是否比平板端小？

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
- 修改服务端中间件、`nuxt.config.ts` 的 Vite 插件、或任何涉及 `res.write`/`res.end` 的代码后，**必须验证流式输出（打字机效果）是否正常**，因为缓冲响应体会破坏 SSE 流
- **修改代码后必须调用 `read_lints` 检查 lint 错误**。特别是模板中的 HTML 结构变更（如添加/删除标签），每次 `replace_in_file` 后都要手动校验对应的起始/闭合标签是否完整

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

| 变量                | 必需   | 说明                                                             | Vercel 环境变量名       |
| ------------------- | ------ | ---------------------------------------------------------------- | ----------------------- |
| `OPENAI_API_KEY`    | 是     | LLM API 密钥                                                     | `NUXT_OPEN_AI_API_KEY`  |
| `OPENAI_BASE_URL`   | 否     | LLM API 地址                                                     | `NUXT_OPEN_AI_BASE_URL` |
| `LLM_MODEL`         | 否     | 模型名称（直接读 process.env）                                   | `LLM_MODEL`             |
| `ENABLE_THINKING`   | 否     | 深度思考开关（直接读 process.env）                               | `ENABLE_THINKING`       |
| `SYSTEM_PROMPT`     | 否     | 系统提示词                                                       | `NUXT_SYSTEM_PROMPT`    |
| `DATABASE_URL`      | 是     | PostgreSQL 连接串                                                | `NUXT_DATABASE_URL`     |
| `DATABASE_TEST_URL` | 仅测试 | 测试数据库连接                                                   | —                       |
| `APP_TITLE`         | 否     | 应用标题（前端可见）                                             | `NUXT_PUBLIC_APP_TITLE` |
| `IMGBB_API_KEY`      | 否     | ImgBB 图床 API Key（.env 中配置） | — |

`runtimeConfig` 的环境变量在 Vercel 中需要加 `NUXT_` 前缀。`LLM_MODEL` 和 `ENABLE_THINKING` 在 `chat.post.ts` 中直接读 `process.env`，不加前缀。

## Gotchas

- `nuxt.config.ts` 中的 `fix-windows-path-urls` Vite 中间件会拦截所有 HTTP 响应并缓冲 body。修改此中间件时**必须确保非 HTML 响应（特别是 `/api/chat` 的 SSE 流式响应）直接透传**，否则会破坏打字机效果。任何涉及 `res.write`/`res.end` 的修改都必须测试流式输出是否正常
- `MarkdownRenderer.vue` 中代码块通过 `createApp(CodeBlock).mount()` 动态挂载，不是声明式组件，修改时注意 Vue 实例生命周期
- `useChat` 的 `body` 参数必须用 `computed()` 包裹，否则 sessionId 等动态值不会随请求更新
- 数据库开发端口是 **5434**（非默认 5432），测试端口是 **5433**
- `saveMessagesToDb` 只保存最后一条用户消息（反向查找），避免重复插入历史消息
- `dompurify`、`highlight.js`、`katex`、`marked` 在 devDependencies 中但运行时使用，不要误删
- 模型白名单在 `server/config/models.ts`，`chat.post.ts` 通过 `ALLOWED_MODEL_VALUES` 校验，新增模型需同步两处
- **图片对话使用 ImgBB 图床**：硅基流动不支持 base64 图片，需先上传到 ImgBB 获取公网 URL。在 `.env` 中配置 `IMGBB_API_KEY`，免费注册 https://api.imgbb.com/ 获取
- **GLM-4.1V / 视觉模型不支持 `enable_thinking` 参数**：`handleImageChat` 中已排除（`!useModel.includes('1V')`），新增视觉模型时注意同步排除
- **带图片的请求绕过 AI SDK**：纯文本用 `streamText()`，带图片用原生 `fetch` 直接调用 LLM（因 AI SDK 内部处理多模态有兼容性问题）

## Troubleshooting

| 问题              | 排查步骤                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 数据库连接失败    | `docker compose ps` → 端口 5434 占用 → `.env` 中 `DATABASE_URL`                                                                              |
| AI 回复报错       | `.env` 中 `OPENAI_API_KEY` 有效 → 网络可达 LLM Provider → 换 `LLM_MODEL`                                                                     |
| Markdown 渲染异常 | DOMPurify 白名单是否包含所需标签 → KaTeX 公式语法 → 浏览器控制台                                                                             |
| 打字机效果消失    | `nuxt.config.ts` 中间件是否缓冲了非 HTML 响应 → `security.ts` 中间件是否拦截了流 → 浏览器 Network 面板检查 `/api/chat` 响应是否逐 chunk 到达 |
