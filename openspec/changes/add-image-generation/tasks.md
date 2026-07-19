## 1. 配置与基础设施

- [x] 1.1 **runtimeConfig 已存在**：`nuxt.config.ts` L176 已包含 `imageGenerationModel` 字段（默认值 `Kwai-Kolors/Kolors`）；`.env.example` L37 已包含 `IMAGE_GENERATION_MODEL=Kwai-Kolors/Kolors`。无需新增配置项。
- [x] 1.2 **vercel.json 已存在**：项目根目录已有 `vercel.json`，配置了 `server/**/*.ts` 的 `maxDuration: 60`，自动覆盖 `/api/generate-image` 等所有服务端路由。无需新增文件，部署到 Vercel Pro 时 60 秒超时即可满足生图需求。
- [ ] 1.3 验证：运行 `pnpm dev` 启动无报错，访问任意页面确认 runtimeConfig 加载成功（可通过 `useRuntimeConfig()` 在客户端打印验证）

## 2. 后端服务封装

- [x] 2.0 **API 探测已完成**：通过 `scripts/verify-siliconflow-image-api.mjs` 实测，5 个 `image_size` 取值（`1024x1024` / `960x1280` / `768x1024` / `720x1440` / `720x1280`）均被硅基流动 Kolors 接受；`image_size` 与 `size` 参数名均兼容；`num_inference_steps` 与 `step` 参数名均兼容。如未来硅基流动调整可用尺寸，rerun 该脚本验证
- [ ] 2.1 创建 `server/utils/image-generation.ts`，封装硅基流动 `POST /v1/images/generations` 调用：使用 **`AbortSignal.timeout(60_000)`**（标准静态方法，MDN Baseline 2024，Node 17.3+ 支持）控制 60 秒超时；参数校验；错误降级返回 `{ error, detail }`；复用 `useRuntimeConfig()` 读取 base URL / API Key / model
  - **API 选型说明（实测验证）**：`AbortController.prototype.timeout` 在 Node v22 中为 `undefined`（非有效 API），必须用 `AbortSignal.timeout(ms)` 静态方法。`fetch` 调用形如 `fetch(url, { signal: AbortSignal.timeout(60_000) })`
  - **超时控制不在 handler 层**：H3 `defineEventHandler` 不支持 `maxDuration` 选项（实测 `h3@1.15.11` 函数 `length === 1`），超时控制必须放在 fetch 层 + 部署平台层（Vercel `vercel.json` 配 `functions.maxDuration: 60`）
  - **参数名**：`image_size` 和 `size` 均已实测兼容（详见 `scripts/verify-siliconflow-image-api.mjs`），代码中优先使用 `image_size`。`num_inference_steps` / `step` 也已实测兼容，但当前默认不传（使用 Kolors 默认值，详见 design.md Open Questions 5）
- [ ] 2.2 在 `image-generation.ts` 中实现 `generateImageWithPersistence()` 函数：调用 Kolors 生成 → 复用 `server/utils/imgbb.ts` 的 `uploadUrlToImgBb()` 转存 → 返回持久化 URL；ImgBB 失败时降级返回原始 URL + `warning` 字段。返回结构统一为 camelCase：`{ imageUrl: string, markdown: string, seed: number, inferenceTime: number, warning?: string }`，其中 `inferenceTime` 从硅基流动响应 `timings.inference` 提取（秒）
- [ ] 2.3 创建单元测试 `tests/unit/image-generation.test.ts`：覆盖成功路径、API 失败、超时（用 `vi.useFakeTimers()` 推进时间触发 `AbortSignal.timeout()` 的 abort 事件）、ImgBB 转存失败降级、未配置 API Key 等场景（mock `fetch` 和 ImgBB 上传函数）
- [ ] 2.4 验证：运行 `pnpm vitest run tests/unit/image-generation.test.ts` 全部通过；运行 `pnpm lint` 和 `pnpm typecheck` 无报错

## 3. Agent 工具实现

- [ ] 3.1 创建 `server/tools/generate-image.ts`，用 `tool()` 定义 `generateImageTool`：`description` 明确「何时调用」和「何时不调用」；`inputSchema` 用 zod 定义 `prompt`（required, 1-2000 字符）、`seed`（optional）、`imageSize`（optional, enum）
- [ ] 3.2 在工具 `execute` 中调用 `generateImageWithPersistence()`，成功返回 `{ imageUrl, markdown, seed, inferenceTime, ...(warning?) }`，失败返回 `{ error, detail, query }` 不抛异常（参考 `server/tools/recall-memory.ts` 的错误处理模式）。`markdown` 中图片 alt 文本取 prompt 前 30 字符（超长截断加 "..."）或固定为 "AI 生成图片"，具体由实现统一
- [ ] 3.3 创建单元测试 `tests/unit/generate-image.test.ts`：覆盖正常调用、参数校验失败、服务降级等场景
- [ ] 3.4 验证：运行 `pnpm vitest run tests/unit/generate-image.test.ts` 通过；运行 `pnpm lint` 和 `pnpm typecheck` 无报错

## 4. 独立 API 路由

- [ ] 4.1 创建 `server/api/generate-image.post.ts`，用 zod 校验 body（`prompt` 必填 1-2000 字符、`seed` 0-9999999999、`imageSize` 枚举），失败返回 400 + `createError()`
- [ ] 4.2 路由内调用 `generateImageWithPersistence()`，成功返回 200 + `{ imageUrl, markdown, seed, inferenceTime, ...(warning?) }`；服务端错误返回 500 + `createError({ statusCode: 500, message: '图片生成服务不可用' })`。**注**：H3 `defineEventHandler` 不支持 `maxDuration` 选项（实测验证，详见 design.md 关键约束），超时控制由 `image-generation.ts` 内的 `AbortSignal.timeout(60_000)` 在 fetch 层完成；部署到 Vercel 等平台时还需在 `vercel.json` 配 `functions.maxDuration: 60`
- [ ] 4.3 创建 API 测试 `tests/api/generate-image.test.ts`：覆盖参数校验（缺失/超长/seed 越界/imageSize 非法）、成功响应、服务端错误等场景（参考 `tests/api/archive-memory.test.ts` 的测试模式）。**Mock 策略**：使用 `vi.mock('~/server/utils/image-generation')` 整体 mock 工具模块（不 mock fetch），在 mock 中提供 `generateImageWithPersistence` 的可控返回（成功返回 `{ imageUrl, markdown, seed, inferenceTime }`、ImgBB 降级返回 `{ imageUrl, markdown, seed, inferenceTime, warning }`、失败返回抛 `createError({ statusCode: 500 })`）。这样测试聚焦于路由层的参数校验、状态码、错误处理，不依赖 fetch 网络层。**注**：`createError` 等 Nitro auto-import 函数已在 `tests/setup.ts` 全局定义（项目工程约定），无需在测试文件内重复 import 或 mock
- [ ] 4.4 验证：运行 `pnpm test:api` 通过；运行 `pnpm lint` 和 `pnpm typecheck` 无报错

## 5. 注册到 chat.post.ts

- [ ] 5.1 在 `server/api/chat.post.ts` 的 `toolsConfig` 中注册 `generateImage` 工具：`...(caps.toolCalling && body.enable_image_generation !== false && { generateImage: generateImageTool })`。`enable_image_generation` 从前端 `useChat` 的 `body` 传入（snake_case，与 `enable_web_search`/`enable_ocr` 保持一致），默认 `true`
- [ ] 5.2 在 `chat.post.ts` 中追加 system prompt 规则（参考 `RECALL_MEMORY_TOOL_RULES` 模式，定义为 `const GENERATE_IMAGE_TOOL_RULES = \`...\``），指导 LLM 何时调用生图工具。**注入条件必须与工具注册条件严格一致**：仅在 `caps.toolCalling && body.enable_image_generation !== false` 时才将 GENERATE_IMAGE_TOOL_RULES 拼接到 system prompt，避免出现"规则说可以调用但工具未注册"（模型幻觉调用）或"工具注册了但规则未注入"（模型不知道有这个能力）。**规则草稿**（实施时按需微调）：
  ```
  【生图工具使用规则】
  1. 当且仅当用户明确请求生成图片时才调用 generateImage 工具。典型触发词：「画」「生成图片」「绘制」「画一张」「给我画」「能画吗」「帮我画」。
  2. 不要在以下场景调用：
     - 用户只要文字回答、解释、描述
     - 用户上传图片要求识别/分析（这是 OCR 工具的职责）
     - 用户描述一个场景但未要求生成图片
  3. Prompt 撰写建议：
     - 英文 prompt 对 Kolors 效果更佳；如用户用中文描述，先翻译为英文再调用
     - 包含：主体（subject）+ 风格（style）+ 场景/背景（setting）+ 关键细节
     - 例：用户说"画一只在月亮下的白猫" → 调用时 prompt = "A white cat under the moonlight, soft illustration style, starry night sky background, peaceful and dreamy atmosphere"
  4. 调用后基于工具返回的 imageUrl 在回答中用 markdown 图片语法 `![描述](imageUrl)` 嵌入，不要修改 URL。
  5. 工具失败时（返回 error 字段），向用户解释失败原因，**不要**自动重试（生成耗时高，避免浪费）。
  ```
- [ ] 5.3 验证：运行 `pnpm lint` 和 `pnpm typecheck` 无报错；运行 `pnpm dev` 启动后，用自然语言触发"画一只猫"，确认 Agent 工具被调用

## 6. 前端 Workflow 生图按钮 + Agent 自动生图开关 + 输入面板

- [ ] 6.0 在 `composables/useChatConfig.ts` 中新增生图开关状态管理：
  1. 新增 `const enableImageGeneration = ref(true)`（默认开启，与 `enableWebSearch` 一致）
  2. 在 `watch(currentModel)` 回调中补充：切换到 `toolCalling: false` 的模型时自动 `enableImageGeneration.value = false`；切换回 `toolCalling: true` 的模型时恢复 `enableImageGeneration.value = true`（与现有 `enableOcr` 的重置逻辑一致）
  3. 在 return 中导出 `enableImageGeneration`
- [ ] 6.1 在 `components/chat/ChatInput.vue` 做两处 UI 修改：
  1. **Workflow 生图按钮**：位置在图片上传 `<label>`（232 行）之后、语音输入按钮（302 行）之前（详见 design.md 决策 6）。按钮样式：直接用 Tailwind 响应式前缀 `min-w-[44px] min-h-[44px] sm:min-w-[40px] sm:min-h-[40px]`（与现有语音输入按钮一致，详见 design.md 决策 10）；加 `active:scale-95` 反馈；用 `v-tooltip` 包裹（禁用原生 `title`）。**不新增 `isMobile` prop**（Tailwind `sm:` 前缀已足够实现响应式，且现有语音/发送按钮均无此 prop）
  2. **Agent「自动生图」toggle chip**：在 toggle chip 区（思考 / 联网 / OCR 之后）新增「生图」chip。状态由父组件 `pages/ai-chat.vue` 维护（通过 `useChatConfig` 的 `enableImageGeneration` ref），通过 prop 传入 `ChatInput`；chip 高亮表示 Agent 可自动生图。点击切换状态，同步更新 `useChat` 的 `body`（`enable_image_generation` 字段，snake_case 与 `enable_web_search`/`enable_ocr` 一致），使 `/api/chat` 下次请求时注册/注销 `generateImage` 工具。**可见性约束**：在 `toolCalling: false` 的模型（GLM-Z1、DeepSeek-R1）上隐藏此 chip（与 OCR 按钮一致，用 `v-if="currentSupportsToolCalling"` 控制）；切换到不支持工具调用的模型时自动关闭开关
- [ ] 6.2 实现生图 prompt 输入面板：点击按钮展开（用 `max-height` + `overflow-hidden` + `transition` 平滑过渡，禁止 `v-if` 直接切换）；面板包含以下元素（按从上到下顺序）：
  1. 标题栏："文生图 · Kwai-Kolors/Kolors" + 关闭按钮（✕，点击关闭面板）
  2. `<textarea>` 填写 prompt（监听 input 动态增高，max-h 120px）
  3. **imageSize 尺寸选择 row**：5 个 chip 横向排列（`1024×1024` / `960×1280` / `768×1024` / `720×1440` / `720×1280`），点击切换 active 状态，默认 `1024×1024` 高亮。**注**：chip 列表必须与任务 2.0 实测后保留的尺寸一致，未被 API 接受的尺寸需从此处移除
  4. 操作按钮 row：取消按钮（关闭面板）+ 生成图片按钮（提交）
  5. 关闭交互：点击 ✕ 按钮、点击取消按钮、按 `Esc` 键、点击面板外部遮罩（用 `@click.self` 绑定外层容器），任一触发均关闭面板
- [ ] 6.3 实现防重复提交：生图请求中提交按钮 `disabled`，显示 spinner + "正在生成图片..."文案；提交完成后重置 `disabled`
- [ ] 6.4 调用 `POST /api/generate-image`，成功后处理流程（**两件事必须都做**，详见 design.md 决策 11）：
  1. **持久化到 DB**：`try/catch` 包裹 `useChatSession().saveMessage(sessionId, 'assistant', markdown, { model: 'Kwai-Kolors/Kolors' })`，走 `/api/messages` 路由插入 DB；`saveMessage` 抛异常时用 `useToast().error('保存消息失败')` 反馈，但前端仍保留已生成的图片消息（UX 优先，不丢失用户可见内容）
  2. **同步到 Chat 状态机**：通过 `chat.messages = [...chat.messages, newMsg]` 将新消息加入 `chat.messages` 数组，让前端对话流立即显示图片消息（仅持久化不同步会导致"点了按钮但看不到图"，需刷新才显示）。**消息格式**：须符合 AI SDK 5.0 `UIMessage` 格式，使用 `parts` 数组：`{ id: crypto.randomUUID(), role: 'assistant', parts: [{ type: 'text', text: markdown }] }`。**注意**：`messages` 是 `computed(() => chat.messages)`，不可直接 push 到 computed；`UIMessage` 无 `createdAt` 字段
  3. **消息归属**：`role: 'assistant'`（生图是 AI 服务生成，归属 AI 端；与 Agent 路径 LLM 调用工具后嵌入图片的行为一致）
  4. **渲染路径**：图片通过 MarkdownRenderer 自然渲染（API 返回的 markdown 字符串 `![描述](imageUrl)` 作为消息内容），**不走 ToolInvocation**（详见 design.md 决策 12）。`markdown` 中图片 alt 文本取 prompt 前 30 字符（超长截断加 "..."）或固定为 "AI 生成图片"，由 `image-generation.ts` 统一生成
  5. **AbortController**：生图请求创建 `AbortController` 实例，绑定到 fetch 信号；`ChatInput` 新增 prop `currentSessionId: string`（从 `pages/ai-chat.vue` 传入），内部 `watch(currentSessionId, () => abortController?.abort())` 监听会话切换；在 `onUnmounted` 中也调用 `abort()` 清理
  6. 失败用 `useToast().error()` 反馈（错误信息包含 `error.message`）
  7. 成功后用 `useToast().success('图片已生成')` 轻量提示（避免弹窗打断阅读流）；若响应含 `warning` 字段，额外用 `useToast().warning()` 提示"图片链接 1 小时后失效，请及时保存"
- [ ] 6.5 验证：运行 `pnpm lint` 和 `pnpm typecheck` 无报错；运行 `pnpm dev` 在手机端和平板端分别测试按钮尺寸和交互反馈
- [ ] 6.6 修改 `pages/ai-chat.vue` 集成前端生图功能：
  1. 将 `useChatConfig().enableImageGeneration` 传入 `ChatInput` 组件对应 prop，toggle chip 的状态更新直接操作 `enableImageGeneration.value`
  2. 将 `currentSessionId` 传入 `ChatInput` 组件的 `currentSessionId` prop（供 AbortController 会话切换取消使用）
  3. 在 `useChat` 的 `body` computed 中加入 `enable_image_generation: enableImageGeneration.value`（snake_case，与 `enable_web_search`/`enable_ocr` 一致），确保开关状态随请求发送到后端
  4. 在 `getVisibleToolInvocations` 函数中补充 `generateImage` 的过滤逻辑：当 `enableImageGeneration.value === false` 时过滤掉历史消息中的 `generateImage` 工具调用，与现有 `webSearch`/`extractTextFromImage` 过滤模式一致（关闭开关后不显示对应工具调用历史）

## 7. 工具调用展示组件（仅 Agent 路径）

> **重要**：本节仅处理 **Agent 路径** 的工具调用展示。Workflow 路径（用户点击按钮触发生图）**不走 ToolInvocation**，图片通过 MarkdownRenderer 直接渲染（详见 design.md 决策 12、tasks.md 6.4 步骤 4）。原 spec.md 7.2 中"Workflow 路径显示重试按钮"的设计已被决策 12 取代，Workflow 路径失败时仅通过 `useToast().error()` 反馈，无 ToolInvocation 调用。

- [ ] 7.1 在 `components/chat/ToolInvocation.vue` 中新增 `generateImage` 工具类型的展示分支（项目硬约束：每个工具类型显式分支）
- [ ] 7.2 实现 3 种状态展示：
  - **加载中**：`isCalling(state)` 即 `input-streaming` 或 `input-available` 时显示 spinner + "正在生成图片..."文案
  - **成功**：`output-available` 且无 `error` 时显示图片缩略图 `max-w-[200px]` + 耗时（`inferenceTime` 秒）+ seed 值，点击放大用 `<ClientOnly>` 包裹；**附加 3 个 icon button**（注意：原设计的 4 个按钮中"重新生成"在 Agent 路径下不应暴露——Agent 路径的 prompt 是 LLM 生成的英文优化版，用户直接重试可能产生意外结果；若需重试应由 LLM 在对话中自主决定）：
    1. **放大查看**：点击在 modal 中查看原图（`max-w-[90vw] max-h-[90vh]`，保留宽高比）
    2. **下载图片**：通过 `<a download>` 触发下载（`fetch(url).then(r => r.blob()).then(blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = \`kolors-\${seed}.png\`; a.click(); })`，避免直接跳转新标签）
    3. **复制链接**：调用 `navigator.clipboard.writeText(imageUrl)` 复制图片公网 URL；复制成功后按钮文案切换为「已复制」1.5 秒后恢复（参考 OCR 复制按钮模式）
    - 每个按钮用 `v-tooltip` 包裹提供文字提示，icons-only 按钮遵循项目规范 `min-w-[28px] min-h-[28px]`
  - **失败**：`output-error` 或 `output-available` 且有 `error` 时显示错误信息 + "等待 AI 重试"提示（Agent 路径下由 LLM 自主决定是否重试，不暴露手动重试按钮）
- [ ] 7.3 验证：运行 `pnpm lint` 和 `pnpm typecheck` 无报错；运行 `pnpm dev` 触发 Agent 路径生图（如发送"画一只猫"），确认 3 种状态展示正常

## 8. 文档同步

- [ ] 8.1 更新 `docs/API.md`：新增 `POST /api/generate-image` 接口定义，含请求/响应 schema、错误码、示例、ImgBB 转存逻辑和降级行为说明
- [ ] 8.2 更新 `docs/模型.md`：在「四、生图模型」章节标记 `Kwai-Kolors/Kolors` 为「已接入」状态，注明使用方式（Agent 工具 + 独立路由）和配置项 `IMAGE_GENERATION_MODEL`

## 9. 端到端验证

- [ ] 9.1 创建 E2E 测试 `tests/e2e/generate-image.e2e.test.ts`：覆盖 Agent 路径自然语言触发生图、Workflow 路径按钮触发生图、加载状态显示、失败降级等场景（参考 `tests/e2e/recall-memory.e2e.test.ts` 的 mock 模式）
- [ ] 9.2 运行 `pnpm test:unit` 全部通过；运行 `pnpm test:api` 全部通过；运行 `pnpm test:e2e` 全部通过（含生图新增测试）
- [ ] 9.3 运行 `pnpm lint` 和 `pnpm typecheck` 全项目无报错
- [ ] 9.4 运行 `pnpm build` 验证生产构建无报错
- [ ] 9.5 在浏览器实际测试：手机端（< 640px）和平板端分别测试生图按钮尺寸、点击反馈、加载状态、图片展示、失败 toast；测试自然语言触发 Agent 工具调用
