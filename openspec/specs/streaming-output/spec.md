## Requirements

### Requirement: SSE 流式响应构建

`server/api/chat.post.ts` SHALL 使用 Vercel AI SDK 的 `createUIMessageStream` 将 `streamText` 返回的 `result.fullStream`（ReadableStream of fullStream chunks）转换为 `UIMessageChunk` 流，并通过 `createUIMessageStreamResponse({ stream: uiStream })` 返回标准 SSE（Server-Sent Events）响应。转换过程在 `execute({ writer })` 回调中通过 `result.fullStream.getReader()` 的 `reader.read()` 递归循环读取每个 chunk，按 `chunk.type` 分发到不同处理分支，调用 `writer.write()` 写入对应的 UIMessageChunk。MUST NOT 使用 `onChunk` 回调执行数据库写入等有副作用操作，MUST NOT 在 `res.write`/`res.end` 层直接拼接 SSE 字符串。`streamText` 调用或流构建过程抛出异常时 MUST 通过 `createError({ statusCode: 500, statusMessage: 'AI 调用失败: <错误描述>' })` 抛出，不向客户端输出半截 SSE 流。

#### Scenario: streamText fullStream 转换为 UIMessageStream

- **WHEN** `streamText()` 调用成功并返回 `result`，`result.fullStream` 开始产出 chunk
- **THEN** `createUIMessageStream` 的 `execute` 回调通过 `result.fullStream.getReader()` 读取 chunk
- **AND** 按 `chunk.type` 分发处理（text-delta / reasoning-* / tool-* / finish / start / start-step / finish-step / error）
- **AND** 通过 `writer.write()` 写入对应的 UIMessageChunk
- **AND** 最终通过 `createUIMessageStreamResponse({ stream: uiStream })` 返回 SSE 响应

#### Scenario: streamText 抛出异常时返回 500

- **WHEN** `streamText` 调用或流构建过程抛出异常
- **THEN** catch 块捕获异常并通过 `createError({ statusCode: 500, statusMessage: 'AI 调用失败: <错误描述>' })` 抛出
- **AND** 不向客户端输出半截 SSE 流

### Requirement: text-delta → UIMessageChunk 转换与 textId 生成

`server/api/chat.post.ts` SHALL 将 fullStream 的 `text-delta` chunk 转换为 UIMessageChunk 的 `text-start` / `text-delta` / `text-end` 事件序列。每个文本流 MUST 在首次写入 text-delta 前发送 `text-start` 事件并生成唯一 `textId`（格式 `ts-${Date.now()}`），后续 text-delta 复用同一 textId；流结束时通过 `text-end` 事件关闭。MUST NOT 在每个 delta 都重新生成 textId，MUST NOT 在未发送 text-start 的情况下直接发送 text-delta。当 provider 原生产出 `text-start` / `text-end` chunk 时，直接透传并更新本地 `textId` / `textEnded` 状态。

#### Scenario: 首次 text-delta 触发 text-start + text-delta

- **WHEN** fullStream 产出一个普通 `text-delta` chunk（不含 REASONING 标记），且 `textId` 为空
- **THEN** 生成 `textId = ts-${Date.now()}`，先写入 `{ type: 'text-start', id: textId }`
- **AND** 再写入 `{ type: 'text-delta', id: textId, delta: chunk.text }`

#### Scenario: 后续 text-delta 复用已有 textId

- **WHEN** fullStream 产出后续 `text-delta` chunk，且 `textId` 已存在
- **THEN** 直接写入 `{ type: 'text-delta', id: textId, delta: chunk.text }`，不再发送 text-start

#### Scenario: provider 原生 text-start / text-end 透传

- **WHEN** fullStream 产出 `text-start` chunk
- **THEN** 将本地 `textId` 更新为 `chunk.id`，并原样 `writer.write(chunk)` 透传
- **WHEN** fullStream 产出 `text-end` chunk
- **THEN** 标记 `textEnded = true`，原样透传

### Requirement: reasoning_content → reasoning-delta 转换

`server/api/chat.post.ts` SHALL 将 fullStream 中带 `REASONING_PREFIX`（`\x00REASONING:`）/ `REASONING_END`（`\x00REASONING_END`）标记的 text-delta 拆分为 `reasoning-start` / `reasoning-delta` / `reasoning-end` 事件序列，与 `text-*` 事件区分。每个 reasoning 流 MUST 在首次写入前生成唯一 `reasoningId`（格式 `rs-${Date.now()}`）并发送 `reasoning-start`。MUST 处理以下四种 delta 形态：1) 整个 delta 以 `REASONING_PREFIX` 开头（纯 reasoning 片段）；2) delta 中间包含 `REASONING_PREFIX`（reasoning 与其他内容混合，按分隔符 split 后逐段处理）；3) delta 以 `REASONING_END` 开头（reasoning 结束、正式回答开始，发送 reasoning-end 后切换到 text）；4) delta 中间包含 `REASONING_END`（reasoning 尾部 + 正式回答开头，split 后先发 reasoning-delta 再发 reasoning-end 再发 text-delta）。MUST 在 reasoning → text 切换时同步维护 `isReasoning` / `reasoningEnded` 状态，避免重复发送 reasoning-end。当 provider 原生产出 `reasoning-start` / `reasoning-delta` / `reasoning-end` chunk 时，直接透传并更新本地状态。标记常量定义在 `server/utils/reasoning-provider.ts`，由 `customFetch` 在 SSE 流层将 `reasoning_content` 字段映射为带 `REASONING_PREFIX` 前缀的 `content`，并在 reasoning → content 切换时插入 `REASONING_END` 分隔标记。

#### Scenario: 纯 reasoning 片段（delta 以 REASONING_PREFIX 开头）

- **WHEN** fullStream 产出 text-delta，内容为 `\x00REASONING:思考过程片段`
- **AND** `isReasoning` 为 false
- **THEN** 设置 `isReasoning = true`，生成 `reasoningId = rs-${Date.now()}`
- **AND** 写入 `{ type: 'reasoning-start', id: reasoningId }`
- **AND** 写入 `{ type: 'reasoning-delta', id: reasoningId, delta: '思考过程片段' }`

#### Scenario: reasoning → 正式回答切换（delta 以 REASONING_END 开头）

- **WHEN** fullStream 产出 text-delta，内容为 `\x00REASONING_END正式回答内容`
- **AND** `isReasoning` 为 true
- **THEN** 写入 `{ type: 'reasoning-end', id: reasoningId }`，设置 `isReasoning = false`、`reasoningEnded = true`
- **AND** 生成 `textId = ts-${Date.now()}`，写入 `{ type: 'text-start', id: textId }`
- **AND** 写入 `{ type: 'text-delta', id: textId, delta: '正式回答内容' }`

#### Scenario: 单个 delta 内 REASONING_PREFIX 与 REASONING_END 混合

- **WHEN** fullStream 产出 text-delta，内容包含 `REASONING_PREFIX` 且同一 delta 后续包含 `REASONING_END`（如 `前缀\x00REASONING:思考\x00REASONING_END回答`）
- **THEN** 按 `REASONING_PREFIX` split 后逐段处理：reasoning 段发送 reasoning-start + reasoning-delta
- **AND** 遇到 `REASONING_END` 时对子段 split，先发送 reasoning-delta（前半部分）+ reasoning-end，再生成 textId 发送 text-start + text-delta（后半部分）

#### Scenario: delta 中间包含 REASONING_END（reasoning 尾部 + 正式回答开头）

- **WHEN** fullStream 产出 text-delta，内容为 `思考尾部\x00REASONING_END正式回答开头`
- **AND** `isReasoning` 为 true
- **THEN** 按 `REASONING_END` split，先写入 `{ type: 'reasoning-delta', id: reasoningId, delta: '思考尾部' }`
- **AND** 写入 `{ type: 'reasoning-end', id: reasoningId }`，设置 `isReasoning = false`、`reasoningEnded = true`
- **AND** 生成 `textId = ts-${Date.now()}`，写入 text-start + text-delta（正式回答开头）

#### Scenario: provider 原生 reasoning-delta 事件

- **WHEN** fullStream 产出原生 `reasoning-delta` chunk（provider 直接支持 reasoning 协议）
- **AND** `isReasoning` 为 false
- **THEN** 设置 `isReasoning = true`，使用 `chunk.id || rs-${Date.now()}` 作为 reasoningId
- **AND** 写入 `{ type: 'reasoning-start', id: reasoningId }`
- **AND** 写入 `{ type: 'reasoning-delta', id: reasoningId, delta: chunk.text }`

### Requirement: 工具调用事件归一化为 UIMessageChunk

`server/api/chat.post.ts` SHALL 将 fullStream 的工具相关 chunk 归一化为 UIMessageChunk 事件：`tool-input-start` → `{ type: 'tool-input-start', toolCallId: chunk.id, toolName: chunk.toolName }`；`tool-input-delta` → `{ type: 'tool-input-delta', toolCallId: chunk.id, inputTextDelta: chunk.delta }`；`tool-call` → `{ type: 'tool-input-available', toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.input }`；`tool-result` → `{ type: 'tool-output-available', toolCallId: chunk.toolCallId, output: chunk.output }`；`tool-error` → `{ type: 'tool-output-error', toolCallId: chunk.toolCallId, errorText: <message> }`。MUST 跳过 `tool-input-end` chunk（UIMessageChunk schema 中无此类型，直接 `return processChunk()` 不写入）。MUST 将 `tool-error` 的 error 字段统一序列化为字符串（`Error` 实例取 `message`，其他取 `String()`）。此外，`server/utils/reasoning-provider.ts` 的 `customFetch` SHALL 在 SSE 流层过滤无效的 `tool_calls` 首帧（`id` 为 null 或 `function.name` 为空字符串），避免 AI SDK v5 解析后生成 `toolCallId=null` 的 tool-input-start 事件触发 schema 校验失败。

#### Scenario: tool-input-start 转换字段名

- **WHEN** fullStream 产出 `tool-input-start` chunk，包含 `{ id, toolName }`
- **THEN** 写入 `{ type: 'tool-input-start', toolCallId: chunk.id, toolName: chunk.toolName }`

#### Scenario: tool-call 转换为 tool-input-available

- **WHEN** fullStream 产出 `tool-call` chunk，包含 `{ toolCallId, toolName, input }`
- **THEN** 写入 `{ type: 'tool-input-available', toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.input }`

#### Scenario: tool-result 转换为 tool-output-available

- **WHEN** fullStream 产出 `tool-result` chunk，包含 `{ toolCallId, output }`
- **THEN** 写入 `{ type: 'tool-output-available', toolCallId: chunk.toolCallId, output: chunk.output }`

#### Scenario: tool-input-end 被跳过

- **WHEN** fullStream 产出 `tool-input-end` chunk
- **THEN** 不调用 `writer.write()`，直接 `return processChunk()` 继续下一个 chunk

#### Scenario: tool-error 序列化为字符串 errorText

- **WHEN** fullStream 产出 `tool-error` chunk，`chunk.error` 为 `Error` 实例
- **THEN** 写入 `{ type: 'tool-output-error', toolCallId: chunk.toolCallId, errorText: chunk.error.message }`
- **WHEN** `chunk.error` 为非 Error 值
- **THEN** 写入 `{ type: 'tool-output-error', toolCallId: chunk.toolCallId, errorText: String(chunk.error) }`

#### Scenario: 无效 tool_calls 首帧在 provider 层被过滤

- **WHEN** provider SSE 响应中 `delta.tool_calls` 包含 `{ id: null, function: { name: '' } }` 的空首帧
- **THEN** `customFetch` 在 SSE 流层过滤掉无效 tool_calls
- **AND** 若过滤后 `tool_calls` 为空且 `content` 为 null，跳过该帧避免触发空 tool 事件
- **AND** 避免下游生成 `toolCallId=null` 的 tool-input-start 事件触发 schema 校验失败

### Requirement: 流结束事件处理与资源释放

`server/api/chat.post.ts` SHALL 在 fullStream 产出 `finish` chunk 时执行三项收尾工作：1) 关闭未关闭的 reasoning（`isReasoning && reasoningId && !reasoningEnded` 时发送 `reasoning-end`）；2) 关闭未关闭的 text（`textId && !textEnded` 时发送 `text-end`）；3) 写入 `{ type: 'finish', finishReason: chunk.finishReason }` 并关闭 MCP 客户端（`mcpClient.close().catch(...)` 释放子进程资源，失败仅 `console.error` 不抛出）。MUST 对 `start` / `start-step` / `finish-step` chunk 剥离 fullStream 特有字段（如 request / warnings），仅保留 UIMessageChunk schema 允许的字段，避免 `uiMessageChunkSchema` 使用 `strictObject` 导致校验失败。`start` chunk MUST 重新生成 `messageId: crypto.randomUUID()`，`start-step` / `finish-step` 仅写入 `{ type: 'start-step' }` / `{ type: 'finish-step' }`。`error` chunk SHALL 转换为 `{ type: 'error', errorText: <message> }`（Error 取 message，其他取 String()）。

#### Scenario: finish 关闭未关闭的 reasoning 和 text

- **WHEN** fullStream 产出 `finish` chunk
- **AND** `isReasoning` 为 true 且 `reasoningEnded` 为 false
- **AND** `textId` 存在且 `textEnded` 为 false
- **THEN** 先写入 `{ type: 'reasoning-end', id: reasoningId }`
- **AND** 再写入 `{ type: 'text-end', id: textId }`
- **AND** 最后写入 `{ type: 'finish', finishReason: chunk.finishReason }`

#### Scenario: finish 关闭 MCP 客户端释放子进程

- **WHEN** `finish` chunk 处理完成
- **AND** `mcpClient` 存在（当前请求启用了 MCP 工具）
- **THEN** 调用 `mcpClient.close()`，不 await（使用 `.catch()` 捕获异常）
- **AND** 关闭失败时仅 `console.error('MCP 客户端关闭失败:', err)`，不影响流结束

#### Scenario: start / start-step / finish-step 剥离特有字段

- **WHEN** fullStream 产出 `start` chunk（含 request / warnings 等 fullStream 特有字段）
- **THEN** 仅写入 `{ type: 'start', messageId: crypto.randomUUID() }`，不透传 request / warnings
- **WHEN** fullStream 产出 `start-step` chunk
- **THEN** 仅写入 `{ type: 'start-step' }`
- **WHEN** fullStream 产出 `finish-step` chunk
- **THEN** 仅写入 `{ type: 'finish-step' }`

#### Scenario: error chunk 转换为 errorText

- **WHEN** fullStream 产出 `error` chunk，`chunk.error` 为 `Error` 实例
- **THEN** 写入 `{ type: 'error', errorText: chunk.error.message }`
- **WHEN** `chunk.error` 为非 Error 值
- **THEN** 写入 `{ type: 'error', errorText: String(chunk.error) }`

### Requirement: Windows 路径修复中间件透传非 HTML 响应

`nuxt.config.ts` SHALL 通过 Vite 插件 `fix-windows-path-urls` 拦截开发服务器所有 HTTP 响应，对 `text/html` 响应缓冲 body 修复 Windows 非 ASCII 路径问题。MUST 对非 HTML 响应（content-type 不包含 `text/html`）直接透传，不缓冲 body：首次 `res.write` 检测到非 HTML content-type 时立即设置 `bypassed = true`，将已缓冲内容通过 `originalWrite` flush，后续 `res.write` / `res.end` 直接调用原生方法透传。MUST NOT 缓冲 `/api/chat` 的 SSE 响应（content-type: `text/event-stream`），否则会破坏打字机效果（流式输出必须逐 chunk 到达浏览器）。`res.end` 时若 content-type 为 HTML 且 body 含 `brokenPrefix`，调用 `fixHtml(body)` 修复路径并更新 `content-length` 为修复后字节长度；否则直接透传。修改此中间件时 MUST 确保非 HTML 响应（特别是 `/api/chat` 的 SSE 流）直接透传不缓冲 body，否则破坏流式输出。

#### Scenario: HTML 响应被缓冲并修复路径

- **WHEN** 响应 content-type 包含 `text/html`
- **AND** 响应 body 包含 `brokenPrefix`（Windows 非 ASCII 路径错误前缀）
- **THEN** 中间件缓冲所有 `res.write` chunk 到 `body` 字符串
- **AND** `res.end` 时调用 `fixHtml(body)` 修复路径
- **AND** 更新 `content-length` 为修复后字节长度后调用 `originalEnd`

#### Scenario: 非 HTML 响应直接透传不缓冲

- **WHEN** 响应 content-type 不包含 `text/html`（如 `text/event-stream`、`application/json`、`image/*`）
- **THEN** 首次 `res.write` 时设置 `bypassed = true`
- **AND** 将已缓冲的 body 通过 `originalWrite` flush
- **AND** 当前 chunk 及后续所有 `res.write` / `res.end` 直接调用原生方法透传

#### Scenario: /api/chat SSE 流逐 chunk 透传保留打字机效果

- **WHEN** 客户端请求 `/api/chat`
- **AND** 服务端返回 content-type 为 `text/event-stream` 的 SSE 响应
- **THEN** 中间件不缓冲 body，每个 SSE chunk 通过 `originalWrite` 立即发送到浏览器
- **AND** 浏览器 Network 面板可观察到 `/api/chat` 响应逐 chunk 到达（打字机效果正常）

### Requirement: 消息持久化在 onFinish 回调异步执行

`server/api/chat.post.ts` SHALL 在 `streamText` 的 `onFinish` 回调中异步执行 `saveMessagesToDb`，MUST NOT 在 `onChunk` 回调中写库（`onChunk` 无法获取完整文本且会阻塞主循环）。`onFinish` 回调接收 `{ text }`，MUST 从 text 中移除 reasoning 标记内容只保留正式回答：若 text 同时包含 `REASONING_PREFIX` 和 `REASONING_END`，取 `REASONING_END` 之后的内容并 trim；若仅有 `REASONING_PREFIX`（极端情况，只有思考无正式回答），cleanText 设为空字符串；若无 reasoning 标记，cleanText 原样使用。清理后的 cleanText 连同 `messages`、`useModel`、`hasImages ? imageUrls : undefined` 传入 `saveMessagesToDb`。MUST 用 try-catch 包裹持久化逻辑，失败仅 `console.error('保存消息到数据库失败:', err)` 不抛出（不阻塞流结束信号）。若 `sessionId` 为空则直接 return 不持久化。

#### Scenario: onFinish 清理 reasoning 标记后持久化

- **WHEN** `streamText` 流结束触发 `onFinish({ text })`
- **AND** text 为 `\x00REASONING:思考过程\x00REASONING_END正式回答`
- **AND** `sessionId` 存在
- **THEN** 提取 `cleanText = '正式回答'`（REASONING_END 之后的内容，trim 后）
- **AND** 调用 `saveMessagesToDb(sessionId, messages, '正式回答', useModel, imageUrls?)`
- **AND** 持久化失败时 `console.error` 但不抛出

#### Scenario: 仅有 reasoning 无正式回答时 cleanText 为空

- **WHEN** `onFinish({ text })` 的 text 为 `\x00REASONING:思考过程`（无 REASONING_END）
- **THEN** `cleanText = ''`（空字符串）
- **AND** 调用 `saveMessagesToDb(sessionId, messages, '', useModel, ...)`

#### Scenario: 无 reasoning 标记时原样持久化

- **WHEN** `onFinish({ text })` 的 text 为普通文本（无 REASONING_PREFIX / REASONING_END）
- **THEN** `cleanText = text`（原样）
- **AND** 调用 `saveMessagesToDb(sessionId, messages, text, useModel, ...)`

#### Scenario: sessionId 为空时跳过持久化

- **WHEN** `onFinish` 触发但 `sessionId` 为空
- **THEN** 直接 return，不调用 `saveMessagesToDb`

### Requirement: 服务端归档兜底 fire-and-forget

`server/api/chat.post.ts` SHALL 在 `onFinish` 回调中执行服务端归档兜底：当请求 body 的 `lastSessionId` 存在、为 string 类型、且不等于当前 `sessionId` 时，fire-and-forget 触发 `archiveSessionMessages(lastSessionId)`（不 await 完成，使用 `.catch()` 捕获异常）。MUST NOT await 归档完成（会阻塞 `onFinish` 返回和流结束信号）。归档失败时 `console.error('[chat.post] 服务端归档兜底失败（会话 <id>）:', err)` 不影响主流程。此兜底覆盖浏览器关闭/刷新场景（前端 fire-and-forget 可能因网络抖动失败，服务端兜底补齐），`archiveSessionMessages` 内置进程内并发锁保证重复请求不重复执行。

#### Scenario: lastSessionId 与当前 sessionId 不同时触发归档

- **WHEN** `onFinish` 触发
- **AND** 请求 body 的 `lastSessionId = 'session-old-uuid'`
- **AND** 当前 `sessionId = 'session-new-uuid'`
- **THEN** 调用 `archiveSessionMessages('session-old-uuid')`，不 await
- **AND** 使用 `.catch()` 捕获异常，失败时 `console.error` 但不影响流结束

#### Scenario: lastSessionId 等于当前 sessionId 时不触发归档

- **WHEN** `onFinish` 触发
- **AND** `lastSessionId === sessionId`
- **THEN** 不调用 `archiveSessionMessages`

#### Scenario: lastSessionId 为空或不为 string 时不触发归档

- **WHEN** `onFinish` 触发
- **AND** `lastSessionId` 为 undefined / null / 空字符串 / 非 string 类型
- **THEN** 不调用 `archiveSessionMessages`

### Requirement: security 中间件不拦截 SSE 流

`server/middleware/security.ts` SHALL 对所有请求设置安全响应头（CSP、X-Content-Type-Options、X-Frame-Options、X-XSS-Protection、Referrer-Policy、Permissions-Policy）和 `/api/` 路径的速率限制（60 秒窗口内 30 次），MUST NOT 拦截或缓冲 `/api/chat` 的 SSE 流式响应。中间件仅设置响应头、处理 OPTIONS 预检、校验 `/api/sessions/:id` 路径的 UUID 格式、执行速率限制，不读取/缓冲 response body，SSE 流通过 `createUIMessageStreamResponse` 直接写入 response 流。修改此中间件时 MUST 确保不引入 body 缓冲或 SSE 流拦截逻辑，否则会破坏流式输出。

#### Scenario: /api/chat 请求通过安全中间件不缓冲

- **WHEN** 客户端 POST `/api/chat`
- **THEN** security 中间件设置 CSP / X-Content-Type-Options 等安全头
- **AND** 执行速率限制校验（未超限则放行）
- **AND** 不读取或缓冲 response body
- **AND** `streamText` 的 SSE 流通过 `createUIMessageStreamResponse` 直接写入 response

#### Scenario: 速率超限返回 429 不进入流式处理

- **WHEN** 同一 IP 在 60 秒内对 `/api/` 路径发起超过 30 次请求
- **THEN** security 中间件抛出 `createError({ statusCode: 429, statusMessage: '请求过于频繁，请稍后再试' })`
- **AND** 设置 `Retry-After: 60` 响应头
- **AND** 不进入 `chat.post.ts` 的流式处理逻辑

### Requirement: 流式输出保护性维护约束

修改流式输出相关代码时 MUST 遵守以下保护性约束：1) 修改 `nuxt.config.ts` 的 `fix-windows-path-urls` 中间件时，必须确保非 HTML 响应（特别是 `/api/chat` 的 SSE 流）直接透传不缓冲 body，否则破坏打字机效果；2) 修改涉及 `res.write` / `res.end` 的代码后，必须验证流式输出（打字机效果）正常，验证方式为浏览器 Network 面板检查 `/api/chat` 响应是否逐 chunk 到达；3) 修改 `server/middleware/security.ts` 时，必须确保不引入 body 缓冲或 SSE 流拦截逻辑；4) 消息持久化必须在 `streamText` 的 `onFinish` 回调中执行，禁止在 `onChunk` 中写库（`onChunk` 无法获取完整文本且会阻塞主循环）。

#### Scenario: 修改 nuxt.config.ts 中间件后验证 SSE 透传

- **WHEN** 修改 `fix-windows-path-urls` Vite 中间件的 `res.write` / `res.end` 拦截逻辑
- **THEN** 必须验证非 HTML 响应（content-type 非 `text/html`）走 `bypassed = true` 透传路径
- **AND** 通过浏览器 Network 面板确认 `/api/chat` 响应逐 chunk 到达（打字机效果正常）

#### Scenario: 修改 security 中间件后验证不拦截 SSE

- **WHEN** 修改 `server/middleware/security.ts`
- **THEN** 必须确认中间件仅设置响应头和速率限制，不读取/缓冲 response body
- **AND** `/api/chat` 的 SSE 流不受影响

#### Scenario: 禁止在 onChunk 中写库

- **WHEN** 检查 `streamText` 调用的 `onChunk` 回调（若存在）
- **THEN** `onChunk` 中 MUST NOT 调用 `saveMessagesToDb` 或任何数据库写入操作
- **AND** 消息持久化只能出现在 `onFinish` 回调中

#### Scenario: 修改 res.write/res.end 后验证打字机效果

- **WHEN** 修改任何涉及 `res.write` / `res.end` 的代码（中间件、API 路由、SSR 处理）
- **THEN** 必须在浏览器 Network 面板验证 `/api/chat` 响应是否逐 chunk 到达
- **AND** 确认打字机效果正常，无 body 被缓冲导致一次性吐出
