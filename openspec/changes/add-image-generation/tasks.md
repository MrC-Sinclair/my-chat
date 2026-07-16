## 1. 配置与基础设施

- [ ] 1.1 在 `nuxt.config.ts` 的 `runtimeConfig` 中新增 `imageGenerationModel` 字段，默认值 `Kwai-Kolors/Kolors`；`.env.example` 新增 `IMAGE_GENERATION_MODEL=Kwai-Kolors/Kolors` 示例项（含中文注释说明用途和默认值）
- [ ] 1.2 验证：运行 `pnpm dev` 启动无报错，访问任意页面确认 runtimeConfig 加载成功（可通过 `useRuntimeConfig()` 在客户端打印验证）

## 2. 后端服务封装

- [ ] 2.1 创建 `server/utils/image-generation.ts`，封装硅基流动 `POST /v1/images/generations` 调用：含 60 秒超时、参数校验、错误降级返回 `{ error, detail }`、复用 `useRuntimeConfig()` 读取 base URL / API Key / model
- [ ] 2.2 在 `image-generation.ts` 中实现 `generateImageWithPersistence()` 函数：调用 Kolors 生成 → 复用 `server/utils/imgbb.ts` 转存 → 返回持久化 URL；ImgBB 失败时降级返回原始 URL + `warning` 字段
- [ ] 2.3 创建单元测试 `tests/unit/image-generation.test.ts`：覆盖成功路径、API 失败、超时、ImgBB 转存失败降级、未配置 API Key 等场景（mock `fetch` 和 ImgBB 上传函数）
- [ ] 2.4 验证：运行 `pnpm vitest run tests/unit/image-generation.test.ts` 全部通过；运行 `pnpm lint` 和 `pnpm typecheck` 无报错

## 3. Agent 工具实现

- [ ] 3.1 创建 `server/tools/generate-image.ts`，用 `tool()` 定义 `generateImageTool`：`description` 明确「何时调用」和「何时不调用」；`inputSchema` 用 zod 定义 `prompt`（required, 1-2000 字符）、`seed`（optional）、`imageSize`（optional, enum）
- [ ] 3.2 在工具 `execute` 中调用 `generateImageWithPersistence()`，成功返回 `{ image_url, markdown, seed }`，失败返回 `{ error, detail, query }` 不抛异常（参考 `server/tools/recall-memory.ts` 的错误处理模式）
- [ ] 3.3 创建单元测试 `tests/unit/generate-image.test.ts`：覆盖正常调用、参数校验失败、服务降级等场景
- [ ] 3.4 验证：运行 `pnpm vitest run tests/unit/generate-image.test.ts` 通过；运行 `pnpm lint` 和 `pnpm typecheck` 无报错

## 4. 独立 API 路由

- [ ] 4.1 创建 `server/api/generate-image.post.ts`，用 zod 校验 body（`prompt` 必填 1-2000 字符、`seed` 0-9999999999、`imageSize` 枚举），失败返回 400 + `createError()`
- [ ] 4.2 路由内调用 `generateImageWithPersistence()`，成功返回 200 + `{ image_url, markdown, seed, ...(warning?) }`；服务端错误返回 500 + `createError({ statusCode: 500, message: '图片生成服务不可用' })`
- [ ] 4.3 创建 API 测试 `tests/api/generate-image.test.ts`：覆盖参数校验（缺失/超长/seed 越界/imageSize 非法）、成功响应、服务端错误等场景（参考 `tests/api/archive-memory.test.ts` 的测试模式）
- [ ] 4.4 验证：运行 `pnpm test:api` 通过；运行 `pnpm lint` 和 `pnpm typecheck` 无报错

## 5. 注册到 chat.post.ts

- [ ] 5.1 在 `server/api/chat.post.ts` 的 `toolsConfig` 中注册 `generate-image` 工具：`...(caps.toolCalling && { generateImage: generateImageTool })`
- [ ] 5.2 在 `chat.post.ts` 中追加 system prompt 规则（参考 `RECALL_MEMORY_TOOL_RULES` 模式），指导 LLM 何时调用生图工具（用户请求生成图片时调用，纯文字问答时不调用）
- [ ] 5.3 验证：运行 `pnpm lint` 和 `pnpm typecheck` 无报错；运行 `pnpm dev` 启动后，用自然语言触发"画一只猫"，确认 Agent 工具被调用

## 6. 前端生图按钮 + 输入面板

- [ ] 6.1 在 `components/chat/ChatInput.vue` 工具栏新增"生图"按钮，与 OCR 按钮并列：手机端 `min-w-[44px] min-h-[44px]`、平板端 `sm:min-w-0 sm:min-h-0`；加 `active:scale-95` 反馈；用 `v-tooltip` 包裹（禁用原生 `title`）
- [ ] 6.2 实现生图 prompt 输入面板：点击按钮展开（用 `max-height` + `overflow-hidden` + `transition` 平滑过渡，禁止 `v-if` 直接切换）；含 textarea + 提交按钮 + 取消按钮；textarea 监听 input 动态增高（项目输入规范）
- [ ] 6.3 实现防重复提交：生图请求中提交按钮 `disabled`，显示 spinner + "正在生成图片..."文案；提交完成后重置 `disabled`
- [ ] 6.4 调用 `POST /api/generate-image`，成功后将返回的 `markdown`（含图片 URL）追加到当前会话消息列表；失败用 `useToast().error()` 反馈
- [ ] 6.5 验证：运行 `pnpm lint` 和 `pnpm typecheck` 无报错；运行 `pnpm dev` 在手机端和平板端分别测试按钮尺寸和交互反馈

## 7. 工具调用展示组件

- [ ] 7.1 在 `components/chat/ToolInvocation.vue` 中新增 `generate-image` 工具类型的展示分支（项目硬约束：每个工具类型显式分支）
- [ ] 7.2 实现 3 种状态展示：加载中（spinner + "正在生成图片..."文案）、成功（图片缩略图 `max-w-[200px]` + 耗时 + seed 值，点击放大用 `<ClientOnly>` 包裹）、失败（错误信息 + Agent 路径显示"等待 AI 重试"、Workflow 路径显示"重试"按钮）
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
