# my-chat

基于 Nuxt 3 + Vercel AI SDK 的通用 AI 对话应用，支持 Markdown + LaTeX 公式安全渲染，内置工具调用（天气、搜索），支持图片对话（多模态）。适配平板和手机屏幕。

## 技术栈

| 层级         | 技术                                 | 说明                          |
| ------------ | ------------------------------------ | ----------------------------- |
| **前端框架** | Nuxt 3 + Vue 3                       | SSR/SSG 支持，组合式 API      |
| **AI SDK**   | Vercel AI SDK (`@ai-sdk/vue` + `ai`) | `useChat()` 流式对话          |
| **UI**       | Tailwind CSS + shadcn-vue 风格       | 响应式布局，手机/平板双端适配 |
| **后端 API** | Nuxt Server Routes (Nitro)           | 无需额外服务器                |
| **数据库**   | PostgreSQL + Drizzle ORM             | 类型安全的 SQL                |
| **Markdown** | marked + DOMPurify                   | 安全渲染                      |
| **数学公式** | KaTeX                                | LaTeX 公式支持                |
| **流程图**   | Mermaid                              | 流程图渲染                    |
| **测试**     | Vitest + Playwright                  | 单元测试 + E2E 测试           |

## 项目结构

```
pages/              → Nuxt 3 文件路由（ai-chat.vue 核心页面）
components/chat/    → Vue 组件（ChatInput, MarkdownRenderer, CodeBlock, SessionSidebar, ThinkingProcess, ToolInvocation, MermaidBlock）
components/         → 全局组件（ToastProvider, ConfirmDialogProvider）
composables/        → 组合式函数（useChatConfig, useChatSession, useToast, useConfirmDialog, useTooltip）
utils/              → 工具函数（markdown.ts 渲染管线, katex.ts 公式渲染, mermaid.ts 流程图）
server/api/         → API 路由（chat.post.ts, sessions.ts, sessions/[id].ts, models.ts）
server/tools/       → AI 工具（weather.ts, web-search.ts）
server/utils/       → 服务端工具（imgbb.ts 图床上传, reasoning-provider.ts）
server/db/          → 数据库（schema.ts 表定义, index.ts 连接初始化）
server/config/      → 服务端配置（models.ts 模型白名单）
tests/              → 测试（unit/ 单元测试, e2e/ E2E 测试）
```

## 关键数据流

```
纯文本: useChat() → POST /api/chat → streamText() 流式生成 → onFinish 持久化消息
图片:   useChat() → POST /api/chat(images字段) → uploadToImgBb() 图床 → 原生fetch调用LLM → SSE流式输出 → onFinish 持久化
```

## 数据库设计

```
sessions (1:N) → messages (1:N) → feedbacks（均级联删除）
```

## 代码规范

- Vue 组件：`<script setup lang="ts">`，禁止 Options API
- 文件名：kebab-case（`ai-chat.vue`、`chat.post.ts`）
- 组件名：PascalCase（`MarkdownRenderer`）
- 常量：UPPER_SNAKE_CASE（`LLM_MODEL`）
- 数据库列：snake_case（`created_at`、`session_id`）
- 前端 API 调用：统一用 Nuxt 的 `$fetch` / `useFetch`，禁止原生 `fetch`
- 注释规则：复杂逻辑、非显而易见的业务约束、容易踩坑的地方**必须加中文注释**

## 安全红线

- 永远不要将未净化的字符串直接传入 `v-html`，必须经过 `renderMarkdown()` 处理（内含 DOMPurify 净化）
- DOMPurify 白名单必须包含 MathML 和 SVG 标签，否则 KaTeX 公式会被过滤掉
- 密钥只能放在 `runtimeConfig` 的非 public 字段或 `.env` 文件中，禁止暴露到前端

## 响应式设计

- 断点：`sm:640px`
- 手机端默认（无前缀），平板端加 `sm:` 前缀
- 侧边栏：手机端覆盖式（fixed overlay），平板端内联式（flex）
- 触摸目标：纯图标按钮 ≥ 36px，核心操作按钮 ≥ 44px

## 环境变量

| 变量              | 必需 | 说明                 |
| ----------------- | ---- | -------------------- |
| `OPENAI_API_KEY`  | 是   | LLM API 密钥         |
| `OPENAI_BASE_URL` | 否   | LLM API 地址         |
| `DATABASE_URL`    | 是   | PostgreSQL 连接串    |
| `LLM_MODEL`       | 否   | 模型名称             |
| `ENABLE_THINKING` | 否   | 深度思考开关         |
| `APP_TITLE`       | 否   | 应用标题（前端可见） |
| `IMGBB_API_KEY`   | 否   | ImgBB 图床 API Key   |

## 常用命令

```bash
pnpm dev              # 开发服务器
pnpm build            # 生产构建
pnpm typecheck        # TypeScript 类型检查
pnpm lint             # ESLint 检查
pnpm test             # Vitest 单元测试
pnpm test:e2e         # Playwright E2E 测试
pnpm db:push          # 同步 Schema 到数据库
pnpm db:studio        # Drizzle Studio 可视化数据库
```

## 已知陷阱

- `nuxt.config.ts` 中的 `fix-windows-path-urls` Vite 中间件会拦截所有 HTTP 响应并缓冲 body，修改时必须确保非 HTML 响应（特别是 `/api/chat` 的 SSE 流式响应）直接透传
- `MarkdownRenderer.vue` 中代码块通过 `createApp(CodeBlock).mount()` 动态挂载，不是声明式组件
- `useChat` 的 `body` 参数必须用 `computed()` 包裹，否则 sessionId 等动态值不会更新
- 消息持久化必须在 `streamText` 的 `onFinish` 回调中执行，禁止在 `onChunk` 中写库
- 图片对话使用 ImgBB 图床，硅基流动不支持 base64 图片
- GLM-4.1V / 视觉模型不支持 `enable_thinking` 参数
