## ADDED Requirements

### Requirement: 文生图 Agent 工具

系统 SHALL 提供 `generateImage` Agent 工具，让 LLM 在用户请求生成图片时自主调用硅基流动 `Kwai-Kolors/Kolors` 模型生成图片。工具 MUST 遵循项目工具规范：执行失败返回 `{ error, detail }` 结构化对象不抛异常，由 LLM 决定后续处理。

工具 description MUST 明确说明「何时调用」（用户请求生成图片、画图、绘制示意图、艺术创作）和「何时不调用」（用户只要文字回答、用户只要描述现有图片）。

#### Scenario: LLM 自主调用生图工具

- **WHEN** 用户输入"画一只在月光下的猫"
- **THEN** LLM 调用 `generateImage` 工具，传入优化后的英文/中文 prompt
- **AND** 工具调用硅基流动 `POST /v1/images/generations` API
- **AND** 工具返回 `{ imageUrl, markdown, seed, inferenceTime }` 给 LLM（不含 base64）
- **NOTE** 硅基流动 API 响应格式为 `{ images: [{ url }], timings: { inference }, seed }`，需从 `images[0].url` 提取图片 URL，从 `timings.inference` 提取耗时（秒）作为 `inferenceTime`
- **AND** LLM 在最终回答中用 markdown 图片语法 `![描述](imageUrl)` 嵌入生成的图片

#### Scenario: 工具调用失败降级

- **WHEN** 硅基流动 API 返回 5xx 错误或 60 秒超时
- **THEN** 工具返回 `{ error: '图片生成失败', detail, query }` 不抛异常
- **AND** LLM 基于错误信息向用户解释失败原因，不中断流式响应

#### Scenario: ImgBB 转存失败降级

- **WHEN** 图片生成成功但 ImgBB 上传失败
- **THEN** 工具返回硅基流动原始 URL + `warning: '图片链接 1 小时后失效，请及时保存'` 字段 + `inferenceTime`
- **AND** 不阻塞主流程

#### Scenario: 未配置 API Key

- **WHEN** `process.env.OPENAI_API_KEY` 为空
- **THEN** 工具返回 `{ error: '图片生成服务不可用', detail: '未配置 OPENAI_API_KEY' }` 不抛异常

### Requirement: 前端显式生图入口

系统 SHALL 在 `ChatInput` 提供两处生图相关交互：
1. **图标按钮区**（图片上传之后、语音输入之前）提供"生图"按钮，作为动作触发型按钮（与图片上传、语音输入同类），供 Workflow 路径显式触发生图。用户点击后弹出 prompt 输入面板，提交后调用 `POST /api/generate-image` 独立路由生成图片。
2. **toggle chip 区**（思考 / 联网 / OCR 之后）提供"自动生图"开关，作为状态切换型按钮，控制 Agent 路径是否允许 LLM 自主调用 `generateImage` 工具。默认开启，状态通过 `useChat` 的 `body`（snake_case 字段名 `enable_image_generation`，与 `enable_web_search`/`enable_ocr` 一致）传入 `/api/chat`。system prompt 中生图工具规则的注入条件必须与工具注册条件严格一致：仅在 `caps.toolCalling && body.enable_image_generation !== false` 时注入。在 `toolCalling: false` 的模型上隐藏此 chip。

按钮和 chip MUST 遵循触摸设备适配规范。

#### Scenario: 用户通过按钮触发生图

- **WHEN** 用户点击"生图"按钮
- **THEN** 显示 prompt 输入面板（textarea + imageSize 5 选 1 + 提交按钮 + 取消按钮）
- **AND** 用户输入 prompt 并点击提交后
- **THEN** 调用 `POST /api/generate-image`
- **AND** 显示加载状态（spinner + "正在生成图片..."文案）
- **AND** 收到响应后必须执行**两个同步操作**（详见 design.md 决策 11）：
  1. **持久化到 DB**：调用 `useChatSession().saveMessage(sessionId, 'assistant', markdown, { model: 'Kwai-Kolors/Kolors' })`，走 `/api/messages` 路由插入 DB
  2. **同步到 Chat 状态机**：通过 `chat.messages = [...chat.messages, newMsg]` 将新消息加入 `chat.messages` 数组，让前端对话流立即显示图片消息（仅持久化不同步会导致"点了按钮但看不到图"，需刷新才显示）
  - **消息格式**：须符合 AI SDK 5.0 `UIMessage` 格式，使用 `parts` 数组：`{ id: crypto.randomUUID(), role: 'assistant', parts: [{ type: 'text', text: markdown }] }`
  - **注意**：`messages` 是 `computed(() => chat.messages)`，不可直接 push 到 computed；须操作 `chat.messages` 数组本身
- **AND** **消息归属**：`role: 'assistant'`（生图由 AI 服务生成，归属 AI 端）
- **AND** **渲染路径**：图片通过 MarkdownRenderer 自然渲染（API 返回的 markdown 字符串 `![描述](imageUrl)` 作为消息内容），**不走 ToolInvocation**（详见 design.md 决策 12）
- **AND** 若响应中含 `warning` 字段，额外用 `useToast().warning()` 提示"图片链接 1 小时后失效，请及时保存"

#### Scenario: 防重复提交

- **WHEN** 生图请求进行中
- **THEN** 提交按钮处于 `disabled` 状态
- **AND** 显示加载指示器
- **AND** 不允许并发提交同一请求

#### Scenario: 会话切换时取消进行中的生图请求

- **WHEN** 生图请求进行中用户切换到其他会话（或组件卸载）
- **THEN** 通过 `AbortController.abort()` 取消进行中的 fetch 请求
- **AND** 不将未完成的生图结果写入新会话
- **AND** 释放按钮 `disabled` 状态以便新会话可发起生图

#### Scenario: 触摸设备适配（手机端 < 640px）

- **WHEN** 在手机端使用
- **THEN** 生图按钮 `min-w-[44px] min-h-[44px]`，始终可见（不加 `group-hover:opacity-0`）
- **AND** 点击时 `active:scale-95` 反馈
- **AND** 不使用 `confirm()`/`alert()` 原生对话框

#### Scenario: 平板端适配（≥ 640px）

- **WHEN** 在平板端使用
- **THEN** 生图按钮可恢复默认尺寸（`sm:min-w-0 sm:min-h-0`）
- **AND** 可加 `group-hover` 效果

#### Scenario: SSR 水合安全

- **WHEN** 服务端渲染 ChatInput 组件
- **THEN** 加载状态 `ref(false)` 初始值 SSR 与客户端一致
- **AND** 不在模板或 computed 中使用 `Date.now()`/`Math.random()`
- **AND** 浏览器 API（`window`/`navigator`）访问前用 `import.meta.client` 守卫

### Requirement: 图片 URL 持久化转存

系统 SHALL 在图片生成成功后立即将硅基流动返回的临时 URL（1 小时有效）转存到 ImgBB 获取持久化 URL，对调用方透明。

#### Scenario: 转存成功

- **WHEN** Kolors 返回图片 URL
- **THEN** 系统调用 `server/utils/imgbb.ts` 的上传 API
- **AND** 返回 ImgBB 持久化 URL 给调用方（Agent 工具或 API 路由）

#### Scenario: 转存失败降级

- **WHEN** ImgBB 上传失败或超时
- **THEN** 返回硅基流动原始 URL + `warning` 字段
- **AND** 不抛异常，不阻塞主流程

### Requirement: 独立生图 API 路由

系统 SHALL 提供 `POST /api/generate-image` 路由，接收 prompt 参数，调用 Kolors 生成图片并返回持久化 URL。路由 MUST 用 zod 做参数校验，失败返回 400 + `createError()`。

**超时控制**：60 秒超时由 `image-generation.ts` 内的 `AbortSignal.timeout(60_000)` 在 fetch 层完成（**不**通过 H3 `defineEventHandler` 的 `maxDuration` 选项——该选项不存在，实测 `h3@1.15.11` `defineEventHandler.length === 1`）。部署到 Vercel 等平台时还需在 `vercel.json` 配 `functions.maxDuration: 60`（平台层硬超时）。

#### Scenario: 参数校验 - prompt 缺失

- **WHEN** 请求 body 缺少 `prompt` 字段或 `prompt` 为空字符串
- **THEN** 返回 HTTP 400 + `createError({ statusCode: 400, message: 'prompt 不能为空' })`

#### Scenario: 参数校验 - prompt 超长

- **WHEN** `prompt` 超过 2000 字符
- **THEN** 返回 HTTP 400 + `createError({ statusCode: 400, message: 'prompt 不能超过 2000 字符' })`

#### Scenario: 参数校验 - seed 越界

- **WHEN** `seed` 不在 `0 < x < 9999999999` 范围内
- **THEN** 返回 HTTP 400 + `createError({ statusCode: 400, message: 'seed 必须在 0-9999999999 之间' })`

#### Scenario: 参数校验 - imageSize 非法

- **WHEN** `imageSize` 不在 `1024x1024`/`960x1280`/`768x1024`/`720x1440`/`720x1280` 枚举内
- **THEN** 返回 HTTP 400 + `createError({ statusCode: 400, message: 'imageSize 取值非法' })`
- **NOTE** 上述 5 个取值已通过 `scripts/verify-siliconflow-image-api.mjs` 实测被 `Kwai-Kolors/Kolors` 接受

#### Scenario: 成功响应

- **WHEN** 请求合法且生成成功
- **THEN** 返回 HTTP 200 + `{ imageUrl, markdown, seed, inferenceTime }`
- **AND** 若 ImgBB 转存失败，额外返回 `warning` 字段

#### Scenario: 服务端错误

- **WHEN** 硅基流动 API 不可用或未配置 `OPENAI_API_KEY`
- **THEN** 返回 HTTP 500 + `createError({ statusCode: 500, message: '图片生成服务不可用' })`

### Requirement: 工具调用展示（仅 Agent 路径）

系统 SHALL 在 `ToolInvocation` 组件为 `generateImage` 工具类型提供专门的展示分支，含加载/预览/失败三种状态。MUST 为每个工具类型显式分支（项目硬约束）。

**适用范围**：本 Requirement 仅适用于 **Agent 路径**（LLM 自主调用工具）。**Workflow 路径**（用户点击按钮触发）**不走 ToolInvocation**——图片通过 MarkdownRenderer 自然渲染，失败时通过 `useToast().error()` 反馈（详见 design.md 决策 12）。

#### Scenario: 加载中状态

- **WHEN** 工具调用进行中（`state === 'input-streaming'` 或 `state === 'input-available'`）
- **THEN** 显示 spinner + "正在生成图片..."文案
- **AND** 不显示空内容占位

#### Scenario: 成功预览

- **WHEN** 工具返回 `imageUrl`（`state === 'output-available'` 且无 `error`）
- **THEN** 显示图片缩略图（`max-w-[200px]` 限制宽度）
- **AND** 点击图片可放大查看（用 `<ClientOnly>` 包裹图片预览组件）
- **AND** 显示生成耗时（`inferenceTime`，秒）和 seed 值
- **AND** 缩略图下方提供 3 个 icon 按钮（用 `v-tooltip` 提供文字提示）：
  1. **放大查看**：点击在 modal 中查看原图（`max-w-[90vw] max-h-[90vh]`，保留宽高比）
  2. **下载图片**：通过 `<a download>` 触发下载（`fetch(url).then(r => r.blob()).then(blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = \`kolors-\${seed}.png\`; a.click(); })`，避免直接跳转新标签）
  3. **复制链接**：调用 `navigator.clipboard.writeText(imageUrl)` 复制图片公网 URL；复制成功后按钮文案切换为「已复制」1.5 秒后恢复（参考 OCR 复制按钮模式）
- **NOTE** 原设计的"重新生成"按钮在 Agent 路径下不暴露——Agent 路径的 prompt 是 LLM 生成的英文优化版，用户直接重试可能产生意外结果；若需重试应由 LLM 在对话中自主决定

#### Scenario: 失败状态

- **WHEN** 工具返回 `error` 字段（`state === 'output-error'` 或 `state === 'output-available'` 且 `output` 含 `error`）
- **THEN** 显示错误信息
- **AND** 显示"等待 AI 重试"提示（Agent 路径下由 LLM 自主决定是否重试，不暴露手动重试按钮）

### Requirement: 配置项

系统 SHALL 在 `runtimeConfig` 暴露 `imageGenerationModel` 字段，默认值为 `Kwai-Kolors/Kolors`。配置项 MUST 在 `.env.example` 中登记，并在 `nuxt.config.ts` 中读取。

#### Scenario: 默认配置

- **WHEN** `.env` 未设置 `IMAGE_GENERATION_MODEL`
- **THEN** 系统使用默认值 `Kwai-Kolors/Kolors` 调用 API

#### Scenario: 自定义模型

- **WHEN** `.env` 设置 `IMAGE_GENERATION_MODEL=another-model`
- **THEN** 系统使用配置值调用 API
- **AND** 不影响其他模型配置（`LLM_MODEL`/`EMBEDDING_MODEL`/`RERANKER_MODEL` 独立）

### Requirement: 文档同步

系统 MUST 同步更新 `docs/API.md` 和 `docs/模型.md`，禁止代码与文档脱节。

#### Scenario: API 文档更新

- **WHEN** `POST /api/generate-image` 路由实现完成
- **THEN** `docs/API.md` 新增接口定义（含请求/响应 schema、错误码、示例）
- **AND** 标注 ImgBB 转存逻辑和降级行为

#### Scenario: 模型文档更新

- **WHEN** Kolors 接入完成
- **THEN** `docs/模型.md` 在「四、生图模型」章节标记 Kolors 为「已接入」状态
- **AND** 注明使用方式（Agent 工具 + 独立路由）
