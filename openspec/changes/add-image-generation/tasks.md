## 1. 配置与基础设施

- [ ] 1.1 在 `nuxt.config.ts` 的 `runtimeConfig` 中新增 `imageGenerationModel` 字段，默认值 `Kwai-Kolors/Kolors`；`.env.example` 新增 `IMAGE_GENERATION_MODEL=Kwai-Kolors/Kolors` 示例项（含中文注释说明用途和默认值）
- [ ] 1.2 验证：运行 `pnpm dev` 启动无报错，访问任意页面确认 runtimeConfig 加载成功（可通过 `useRuntimeConfig()` 在客户端打印验证）

## 2. 后端服务封装

- [ ] 2.1 创建 `server/utils/image-generation.ts`，封装硅基流动 `POST /v1/images/generations` 调用：使用 `AbortController.timeout(60_000)` 控制 60 秒超时（与 `defineEventHandler` 的 `maxDuration: 60_000` 对齐）、参数校验、错误降级返回 `{ error, detail }`、复用 `useRuntimeConfig()` 读取 base URL / API Key / model
- [ ] 2.2 在 `image-generation.ts` 中实现 `generateImageWithPersistence()` 函数：调用 Kolors 生成 → 复用 `server/utils/imgbb.ts` 转存 → 返回持久化 URL；ImgBB 失败时降级返回原始 URL + `warning` 字段
- [ ] 2.3 创建单元测试 `tests/unit/image-generation.test.ts`：覆盖成功路径、API 失败、超时（mock `AbortController` 触发 timeout 事件）、ImgBB 转存失败降级、未配置 API Key 等场景（mock `fetch` 和 ImgBB 上传函数；测试 AbortController 行为用 `vi.useFakeTimers()` 推进时间触发 timeout）
- [ ] 2.4 验证：运行 `pnpm vitest run tests/unit/image-generation.test.ts` 全部通过；运行 `pnpm lint` 和 `pnpm typecheck` 无报错

## 3. Agent 工具实现

- [ ] 3.1 创建 `server/tools/generate-image.ts`，用 `tool()` 定义 `generateImageTool`：`description` 明确「何时调用」和「何时不调用」；`inputSchema` 用 zod 定义 `prompt`（required, 1-2000 字符）、`seed`（optional）、`imageSize`（optional, enum）
- [ ] 3.2 在工具 `execute` 中调用 `generateImageWithPersistence()`，成功返回 `{ image_url, markdown, seed }`，失败返回 `{ error, detail, query }` 不抛异常（参考 `server/tools/recall-memory.ts` 的错误处理模式）
- [ ] 3.3 创建单元测试 `tests/unit/generate-image.test.ts`：覆盖正常调用、参数校验失败、服务降级等场景
- [ ] 3.4 验证：运行 `pnpm vitest run tests/unit/generate-image.test.ts` 通过；运行 `pnpm lint` 和 `pnpm typecheck` 无报错

## 4. 独立 API 路由

- [ ] 4.1 创建 `server/api/generate-image.post.ts`，用 zod 校验 body（`prompt` 必填 1-2000 字符、`seed` 0-9999999999、`imageSize` 枚举），失败返回 400 + `createError()`
- [ ] 4.2 路由内调用 `generateImageWithPersistence()`，成功返回 200 + `{ image_url, markdown, seed, ...(warning?) }`；服务端错误返回 500 + `createError({ statusCode: 500, message: '图片生成服务不可用' })`；handler 显式声明 `maxDuration: 60_000`（第二参数 `defineEventHandler(handler, { maxDuration: 60_000 })`）以避免 Nitro 默认超时掐断生图
- [ ] 4.3 创建 API 测试 `tests/api/generate-image.test.ts`：覆盖参数校验（缺失/超长/seed 越界/imageSize 非法）、成功响应、服务端错误等场景（参考 `tests/api/archive-memory.test.ts` 的测试模式）。**Mock 策略**：使用 `vi.mock('~/server/utils/image-generation')` 整体 mock 工具模块（不 mock fetch），在 mock 中提供 `generateImageWithPersistence` 的可控返回（成功返回 `{ image_url, markdown, seed }`、ImgBB 降级返回 `{ image_url, markdown, seed, warning }`、失败返回抛 `createError({ statusCode: 500 })`）。这样测试聚焦于路由层的参数校验、状态码、错误处理，不依赖 fetch 网络层
- [ ] 4.4 验证：运行 `pnpm test:api` 通过；运行 `pnpm lint` 和 `pnpm typecheck` 无报错

## 5. 注册到 chat.post.ts

- [ ] 5.1 在 `server/api/chat.post.ts` 的 `toolsConfig` 中注册 `generate-image` 工具：`...(caps.toolCalling && { generateImage: generateImageTool })`
- [ ] 5.2 在 `chat.post.ts` 中追加 system prompt 规则（参考 `RECALL_MEMORY_TOOL_RULES` 模式，定义为 `const GENERATE_IMAGE_TOOL_RULES = \`...\``），指导 LLM 何时调用生图工具。**规则草稿**（实施时按需微调）：
  ```
  【生图工具使用规则】
  1. 当且仅当用户明确请求生成图片时才调用 generate-image 工具。典型触发词：「画」「生成图片」「绘制」「画一张」「给我画」「能画吗」「帮我画」。
  2. 不要在以下场景调用：
     - 用户只要文字回答、解释、描述
     - 用户上传图片要求识别/分析（这是 OCR 工具的职责）
     - 用户描述一个场景但未要求生成图片
  3. Prompt 撰写建议：
     - 英文 prompt 对 Kolors 效果更佳；如用户用中文描述，先翻译为英文再调用
     - 包含：主体（subject）+ 风格（style）+ 场景/背景（setting）+ 关键细节
     - 例：用户说"画一只在月亮下的白猫" → 调用时 prompt = "A white cat under the moonlight, soft illustration style, starry night sky background, peaceful and dreamy atmosphere"
  4. 调用后基于工具返回的 image_url 在回答中用 markdown 图片语法 `![描述](image_url)` 嵌入，不要修改 URL。
  5. 工具失败时（返回 error 字段），向用户解释失败原因，**不要**自动重试（生成耗时高，避免浪费）。
  ```
- [ ] 5.3 验证：运行 `pnpm lint` 和 `pnpm typecheck` 无报错；运行 `pnpm dev` 启动后，用自然语言触发"画一只猫"，确认 Agent 工具被调用

## 6. 前端生图按钮 + 输入面板

- [ ] 6.1 在 `components/chat/ChatInput.vue` 新增"生图"按钮，位置在图片上传 `<label>`（232 行）之后、语音输入按钮（302 行）之前（详见 design.md 决策 6）。按钮样式：手机端 `min-w-[44px] min-h-[44px]`、平板端 `sm:min-w-[40px] sm:min-h-[40px]`；加 `active:scale-95` 反馈；用 `v-tooltip` 包裹（禁用原生 `title`）；新增 props `isMobile: boolean`（由 `pages/ai-chat.vue` 传入），按钮尺寸根据 `isMobile` 切换前缀
- [ ] 6.2 实现生图 prompt 输入面板：点击按钮展开（用 `max-height` + `overflow-hidden` + `transition` 平滑过渡，禁止 `v-if` 直接切换）；面板包含以下元素（按从上到下顺序）：
  1. 标题栏："文生图 · Kwai-Kolors/Kolors" + 关闭按钮（✕，点击关闭面板）
  2. `<textarea>` 填写 prompt（监听 input 动态增高，max-h 120px）
  3. **imageSize 尺寸选择 row**：5 个 chip 横向排列（`1024×1024` / `960×1280` / `768×1024` / `720×1440` / `720×1280`），点击切换 active 状态，默认 `1024×1024` 高亮
  4. 操作按钮 row：取消按钮（关闭面板）+ 生成图片按钮（提交）
  5. 关闭交互：点击 ✕ 按钮、点击取消按钮、按 `Esc` 键、点击面板外部遮罩（用 `@click.self` 绑定外层容器），任一触发均关闭面板
- [ ] 6.3 实现防重复提交：生图请求中提交按钮 `disabled`，显示 spinner + "正在生成图片..."文案；提交完成后重置 `disabled`
- [ ] 6.4 调用 `POST /api/generate-image`，成功后处理流程：
  1. 将 API 返回的 `markdown` 字符串（如 `![描述](https://i.ibb.co/xxx/xxx.png)`）作为新消息内容追加到当前会话的 `messages` 数组
  2. **消息归属**：`role: 'assistant'`（生图是 AI 服务生成，归属 AI 端；与 Agent 路径 LLM 调用工具后嵌入图片的行为一致）
  3. **持久化路径**：通过 `useChatSession().saveMessage()` 持久化（参考现有 saveMessagesToDb 模式），不要在 `ai-chat.vue` 内联写 db 调用
  4. **AbortController**：生图请求创建 `AbortController` 实例，绑定到 fetch 信号；`ChatInput` 新增 prop `currentSessionId: string`（从 `pages/ai-chat.vue` 传入），内部 `watch(currentSessionId, () => abortController?.abort())` 监听会话切换；在 `onUnmounted` 中也调用 `abort()` 清理
  5. 失败用 `useToast().error()` 反馈（错误信息包含 `error.message`）
  6. 成功后用 `useToast().success('图片已生成')` 轻量提示（避免弹窗打断阅读流）
- [ ] 6.5 验证：运行 `pnpm lint` 和 `pnpm typecheck` 无报错；运行 `pnpm dev` 在手机端和平板端分别测试按钮尺寸和交互反馈

## 7. 工具调用展示组件

- [ ] 7.1 在 `components/chat/ToolInvocation.vue` 中新增 `generate-image` 工具类型的展示分支（项目硬约束：每个工具类型显式分支）
- [ ] 7.2 实现 3 种状态展示：加载中（spinner + "正在生成图片..."文案）、成功（图片缩略图 `max-w-[200px]` + 耗时 + seed 值，点击放大用 `<ClientOnly>` 包裹；**附加 4 个 icon button**：「放大查看」「下载图片」「复制链接」「重新生成」，每个按钮用 `v-tooltip` 包裹提供文字提示，icons-only 按钮遵循项目规范 `min-w-[28px] min-h-[28px]`）、失败（错误信息 + Agent 路径显示"等待 AI 重试"、Workflow 路径显示"重试"按钮）
- [ ] 7.3 验证：运行 `pnpm lint` 和 `pnpm typecheck` 无报错；运行 `pnpm dev` 触发 Agent 路径生图，确认 3 种状态展示正常

## 8. 文档同步

- [ ] 8.1 更新 `docs/API.md`：新增 `POST /api/generate-image` 接口定义，含请求/响应 schema、错误码、示例、ImgBB 转存逻辑和降级行为说明
- [ ] 8.2 更新 `docs/模型.md`：在「四、生图模型」章节标记 `Kwai-Kolors/Kolors` 为「已接入」状态，注明使用方式（Agent 工具 + 独立路由）和配置项 `IMAGE_GENERATION_MODEL`

## 9. 端到端验证

- [ ] 9.1 创建 E2E 测试 `tests/e2e/generate-image.e2e.test.ts`：覆盖 Agent 路径自然语言触发生图、Workflow 路径按钮触发生图、加载状态显示、失败降级等场景（参考 `tests/e2e/recall-memory.e2e.test.ts` 的 mock 模式）
- [ ] 9.2 运行 `pnpm test:unit` 全部通过；运行 `pnpm test:api` 全部通过；运行 `pnpm test:e2e` 全部通过（含生图新增测试）
- [ ] 9.3 运行 `pnpm lint` 和 `pnpm typecheck` 全项目无报错
- [ ] 9.4 运行 `pnpm build` 验证生产构建无报错
- [ ] 9.5 在浏览器实际测试：手机端（< 640px）和平板端分别测试生图按钮尺寸、点击反馈、加载状态、图片展示、失败 toast；测试自然语言触发 Agent 工具调用
