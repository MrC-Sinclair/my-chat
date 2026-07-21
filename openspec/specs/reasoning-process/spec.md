## Requirements

### Requirement: 自定义 OpenAI-compatible Provider

系统 SHALL 在 `server/utils/reasoning-provider.ts` 中通过 `createReasoningProvider()` 工厂函数创建自定义 OpenAI-compatible Provider 实例，用于桥接 `@ai-sdk/openai` v2 与硅基流动等兼容 API 的差异。

- SHALL 通过 `createOpenAI({ ...baseConfig, fetch: fetchFn })` 创建 provider，其中 `baseConfig` 包含 `baseURL`（默认 `https://api.siliconflow.cn/v1`，可由 `OPENAI_BASE_URL` 环境变量覆盖）与 `apiKey`（来自 `OPENAI_API_KEY`）
- SHALL 显式调用 `provider.chat(modelId)` 走 Chat Completions API，禁止使用 `@ai-sdk/openai` v2 默认的 Responses API（硅基流动不支持 Responses API）
- SHALL 返回 `(modelId: string, options?: { enableThinking?: boolean }) => LanguageModel` 工厂函数签名
- 当 `options.enableThinking` 为 `undefined` 时 SHALL 使用原生 `customFetch`；否则 SHALL 使用 `createThinkingFetch(options.enableThinking)` 包装
- `createOpenAI` 仅创建配置对象（无连接池），per-request 创建无性能问题
- `chat.post.ts` SHALL 在模块顶层调用 `createReasoningProvider()` 一次得到 `llmProvider`，每次请求调用 `llmProvider(useModel, thinkingOptions)` 获取模型实例（参见 [chat.post.ts#L22](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L22) 与 [chat.post.ts#L521](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L521)）

#### Scenario: 走 Chat Completions API 而非 Responses API

- **WHEN** `chat.post.ts` 调用 `llmProvider(useModel, thinkingOptions)` 创建语言模型
- **THEN** SHALL 通过 `provider.chat(modelId)` 获取模型实例
- **AND** 该实例 SHALL 走 `/v1/chat/completions` 端点
- **AND** SHALL NOT 走 Responses API 端点

#### Scenario: enableThinking 未传时使用原生 customFetch

- **WHEN** 调用 `llmProvider('THUDM/GLM-Z1-9B-0414', undefined)`（强制思考模型，`thinkingOptions` 为 `undefined`）
- **THEN** SHALL 使用原生 `customFetch`
- **AND** SHALL NOT 在请求体注入 `enable_thinking` 字段

### Requirement: reasoning_content 字段映射

系统 SHALL 在 `customFetch` 中拦截 SSE 响应流，将硅基流动在 `delta.reasoning_content` 字段返回的思考内容映射为带 `REASONING_PREFIX` 前缀的 `delta.content`，因 `@ai-sdk/openai` v2 流式解析器只处理 `delta.content` 和 `delta.tool_calls`，直接忽略 `reasoning_content` 会导致思考过程数据在 provider 层被静默丢弃。

- 仅当响应状态 `ok` 且 `content-type` 包含 `text/event-stream` 时 SHALL 进行流转换，否则直接透传原响应
- SHALL 通过 `TransformStream` 拦截 `response.body.pipeThrough(...)`
- 当 `delta.reasoning_content != null && delta.reasoning_content !== ''` 时 SHALL 重写为 `delta.content = REASONING_PREFIX + delta.reasoning_content`，并 `delete delta.reasoning_content`，置 `wasReasoning = true`
- 当 `delta.reasoning_content === ''`（首帧标记）时 SHALL 仅 `delete delta.reasoning_content` 透传，不在 content 中插入前缀
- 当 `delta.reasoning_content` 为 `null`/`undefined` 时 SHALL 透传原始行
- 转换后的 SSE 行 SHALL 以 `data: ` + `JSON.stringify(json)` 形式重新输出

#### Scenario: 非空 reasoning_content 映射为带前缀 content

- **WHEN** SSE 流中收到 `data: {"choices":[{"delta":{"reasoning_content":"思考中..."}}]}`
- **THEN** SHALL 转换为 `data: {"choices":[{"delta":{"content":"\x00REASONING:思考中..."}}]}`
- **AND** SHALL `delete delta.reasoning_content`
- **AND** SHALL 置 `wasReasoning = true`

#### Scenario: 空字符串 reasoning_content 首帧仅删除字段

- **WHEN** SSE 流中收到 `data: {"choices":[{"delta":{"reasoning_content":""}}]}`（首帧标记）
- **THEN** SHALL 仅 `delete delta.reasoning_content`
- **AND** SHALL NOT 在 content 中插入 REASONING_PREFIX
- **AND** SHALL 透传该行

#### Scenario: 非 SSE 响应直接透传

- **WHEN** 响应 `content-type` 不包含 `text/event-stream`（如 JSON 错误响应）
- **OR** 响应状态非 `ok`（如 4xx/5xx）
- **OR** 响应 `body` 为 `null`
- **THEN** SHALL 直接透传原始 `response`，不进行流转换

### Requirement: REASONING 标记协议

系统 SHALL 使用两个特殊标记标识思考过程的边界，供 `chat.post.ts` 的 `createUIMessageStream.execute` 流处理逻辑识别 reasoning → text 切换点，并在 `onFinish` 持久化时剥离思考内容。

- `REASONING_PREFIX = '\x00REASONING:'` SHALL 标识思考片段开始（`\x00` 为不可见控制字符，避免与正常内容冲突）
- `REASONING_END = '\x00REASONING_END'` SHALL 标识思考结束
- 当 `wasReasoning === true` 且当前帧 `delta.content != null`（reasoning → content 切换）时 SHALL 在 `delta.content` 前插入 `REASONING_END`，并重置 `wasReasoning = false`
- `chat.post.ts` 的 `createUIMessageStream.execute` SHALL 按 REASONING 标记分类 `text-delta`（参见 [chat.post.ts#L582-L650](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L582)）：
  - delta 以 `REASONING_PREFIX` 开头 → 转为 `reasoning-start` + `reasoning-delta` 事件
  - delta 中间包含 `REASONING_PREFIX` → 拆分后分别处理 reasoning 与 text 部分
  - 包含 `REASONING_END` → 触发 `reasoning-end` 事件并切换回 `text-delta`
- `onFinish` 持久化时 SHALL 从 `text` 中剥离 reasoning 标记内容，仅保存 `REASONING_END` 之后的正式回答（参见 [chat.post.ts#L536-L549](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L536)）

#### Scenario: reasoning → content 切换时插入分隔标记

- **WHEN** 上一帧为 reasoning（`wasReasoning === true`）
- **AND** 当前帧 `delta.content != null`（无 reasoning_content，已切换到正式回答）
- **THEN** SHALL 重写为 `delta.content = REASONING_END + delta.content`
- **AND** SHALL 重置 `wasReasoning = false`

#### Scenario: 持久化时剥离 reasoning 内容

- **WHEN** `streamText` 的 `onFinish` 回调收到完整 `text`
- **AND** `text` 同时包含 `REASONING_PREFIX` 与 `REASONING_END`
- **THEN** SHALL 取 `REASONING_END` 之后的内容作为 `cleanText` 持久化到 `messages` 表
- **AND** SHALL NOT 将 reasoning 内容写入正文 `text` 字段

#### Scenario: 极端情况只有 reasoning 没有正式回答

- **WHEN** `text` 包含 `REASONING_PREFIX` 但不包含 `REASONING_END`
- **THEN** `cleanText` SHALL 为空字符串
- **AND** SHALL NOT 抛出异常

### Requirement: developer 角色替换为 system

系统 SHALL 在 `customFetch` 的请求拦截阶段将请求体中 `role: 'developer'` 的消息替换为 `role: 'system'`，因 `@ai-sdk/openai` v2 对非 `gpt-3/4/5-chat` 的模型 ID 一律判定为 `isReasoningModel`，导致 system 消息被转为 developer 角色，而硅基流动不支持 developer 角色。

- SHALL 在发起 `globalThis.fetch` 之前解析请求体
- 仅当 `options.body` 为 string 且 JSON 解析成功、`body.messages` 为数组时 SHALL 执行替换
- SHALL 遍历 `messages`，将 `msg.role === 'developer'` 改为 `'system'`
- 当发生修改时 SHALL 重新序列化请求体并赋值给 `options.body`
- JSON 解析失败时 SHALL 静默透传原始请求（不抛异常）

#### Scenario: system 消息被错误转为 developer 时还原

- **WHEN** `@ai-sdk/openai` v2 判定模型为 reasoning model（非 `gpt-3/4/5-chat` 命名）
- **AND** 将 system 消息转为 `{ role: 'developer', content: '...' }` 放入请求体
- **THEN** `customFetch` SHALL 将该消息 `role` 替换为 `'system'`
- **AND** 硅基流动 SHALL 正确接收 system 角色消息

#### Scenario: JSON 解析失败时透传

- **WHEN** `options.body` 不是合法 JSON 字符串
- **THEN** SHALL 静默透传原始 `options`
- **AND** SHALL NOT 抛出异常

### Requirement: structuredOutputs 禁用

系统 SHALL 通过 `provider.chat(modelId)` 的 `providerOptions` 禁用 `structuredOutputs` strict 模式，因 `@ai-sdk/openai` v2 默认启用 `structuredOutputs`，硅基流动不支持 strict 参数会导致 400 Bad Request。

- 禁用方式 SHALL 为 `providerOptions: { openai: { structuredOutputs: false } }`
- 该项禁用 SHALL 在所有模型上一致生效（不区分能力）
- 该修复在 `reasoning-provider.ts` 文件头注释第 18-21 行明确说明

#### Scenario: 硅基流动不接收 strict 参数

- **WHEN** 使用 `provider.chat(modelId)` 调用 LLM
- **THEN** 请求体 SHALL NOT 包含 `strict` 字段
- **AND** 硅基流动 SHALL NOT 返回 400 Bad Request（与 strict 相关）

### Requirement: enable_thinking 顶层字段注入

系统 SHALL 通过 `createThinkingFetch(enableThinking: boolean)` 在 fetch 层拦截请求体，注入 `body.enable_thinking = enableThinking` 顶层字段，因 `@ai-sdk/openai` v2 的 `providerOptions` 使用严格 zod schema 校验，不支持透传自定义字段（会被静默剥离），必须注入到请求体顶层。

- `chat.post.ts` 计算 `thinkingOptions`（参见 [chat.post.ts#L416-L424](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L416)）：
  - `thinkingEnabled` 取值优先级：请求 body 的 `enable_thinking` 字段 > `DEFAULT_ENABLE_THINKING` 默认值
  - 当 `caps.toggleableThinking === true` 时 `thinkingOptions = { enableThinking: thinkingEnabled }`
  - 否则 `thinkingOptions = undefined`
- `thinkingOptions` SHALL 传入 `llmProvider(useModel, thinkingOptions)`，由其决定是否使用 `createThinkingFetch`
- 仅可切换思考模型（`toggleableThinking: true`，如 Qwen3-8B / Qwen3.5-4B）SHALL 注入 `enable_thinking` 字段
- 强制思考模型（R1 / GLM-Z1）SHALL NOT 注入 `enable_thinking`：
  - GLM-Z1-9B-0414：传 `enable_thinking` 会返回 400 报错
  - DeepSeek-R1-0528-Qwen3-8B：传 `enable_thinking` 被忽略
- 不支持思考的模型 SHALL NOT 注入 `enable_thinking`
- JSON 解析失败时 SHALL 静默透传原始请求

#### Scenario: 可切换思考模型注入 enable_thinking

- **WHEN** 请求的 `model` 为 `Qwen/Qwen3-8B`（`toggleableThinking=true`）
- **AND** 用户在前端开启思考开关（请求 body `enable_thinking: true`）
- **THEN** `thinkingOptions` SHALL 为 `{ enableThinking: true }`
- **AND** `createThinkingFetch(true)` SHALL 在请求体顶层注入 `enable_thinking: true`
- **AND** 硅基流动 SHALL 接收该字段并切换思考行为

#### Scenario: 强制思考模型 GLM-Z1 不传 enable_thinking

- **WHEN** 请求的 `model` 为 `THUDM/GLM-Z1-9B-0414`（`toggleableThinking=false`）
- **THEN** `thinkingOptions` SHALL 为 `undefined`
- **AND** SHALL 使用原生 `customFetch`（不注入 `enable_thinking`）
- **AND** 请求体 SHALL NOT 包含 `enable_thinking` 字段
- **AND** 硅基流动 SHALL NOT 返回 400 错误（若误传会 400）

#### Scenario: 不支持思考的模型不传 enable_thinking

- **WHEN** `caps.deepThinking === false` 且 `caps.toggleableThinking === false`
- **THEN** `thinkingOptions` SHALL 为 `undefined`
- **AND** 请求体 SHALL NOT 包含 `enable_thinking` 字段

#### Scenario: providerOptions 透传 enable_thinking 失败

- **WHEN** 开发者尝试通过 `providerOptions.openai.enable_thinking` 透传字段
- **THEN** `@ai-sdk/openai` v2 的 zod schema SHALL 静默剥离该字段
- **AND** 请求体 SHALL NOT 包含 `enable_thinking`
- **AND** 因此 MUST 走 `createThinkingFetch` 的请求体拦截路径，禁止依赖 `providerOptions`

### Requirement: 无效 tool_calls 过滤

系统 SHALL 在 `customFetch` 的 SSE 流转换阶段过滤掉 `id === null` 或 `function.name === ''` 的空 `tool_calls`，因部分模型（如 GLM-4-9B-0414）会发送此类无效首帧，AI SDK v5 解析后会生成 `toolCallId=null` 的 `tool-input-start` 事件触发 schema 校验失败。

- 当 `delta.tool_calls` 为数组时 SHALL 执行过滤：保留 `tc.id != null && tc.function && tc.function.name !== ''` 的项
- 过滤后 `validToolCalls.length === 0` 时 SHALL `delete delta.tool_calls`
- 当过滤后 `delta.tool_calls` 被删除且 `delta.content == null` 时 SHALL `continue` 跳过该帧（避免触发空 tool 事件）
- 当 `validToolCalls.length > 0` 时 SHALL 用 `validToolCalls` 替换原 `delta.tool_calls`

#### Scenario: 过滤 id=null 的空 tool_calls

- **WHEN** SSE 流中收到 `data: {"choices":[{"delta":{"tool_calls":[{"id":null,"function":{"name":"","arguments":""}}]}}]}`
- **THEN** `validToolCalls` SHALL 为空数组
- **AND** SHALL `delete delta.tool_calls`
- **AND** 当 `delta.content == null` 时 SHALL 跳过该帧
- **AND** AI SDK SHALL NOT 生成 `tool-input-start` 事件
- **AND** SHALL NOT 触发 schema 校验失败

#### Scenario: 保留有效的 tool_calls

- **WHEN** SSE 流中收到有效的 `tool_calls`（`id` 非空、`function.name` 非空）
- **THEN** SHALL 保留并原样透传该 `tool_calls`
- **AND** AI SDK SHALL 正常生成工具调用事件

### Requirement: SSE 行缓冲区跨 TCP 包处理

系统 SHALL 在 `customFetch` 的 `TransformStream.transform` 中使用 `lineBuffer` 字符串缓冲区处理 SSE 行跨 TCP 包边界的情况。

- 每个新 chunk 解码后 SHALL 追加到 `lineBuffer`
- SHALL 按 `\n` 分割 `lineBuffer` 得到 `lines` 数组
- 当 `lines` 最后一个元素非空字符串时（不完整行）SHALL `lines.pop()` 保留在 `lineBuffer`；否则清空 `lineBuffer = ''`
- 每行处理完成后 SHALL 以 `modifiedLines.join('\n') + '\n'` 形式 enqueue 编码后的 chunk
- `TransformStream.flush` SHALL 在流结束时输出 `lineBuffer` 中的残留行并清空

#### Scenario: SSE 行跨两个 TCP 包

- **WHEN** 第一个 TCP 包以 `data: {"choices":[{"delta":{"content":"hel` 结尾（不完整 JSON）
- **AND** 第二个 TCP 包以 `lo"}}]}\n` 开头
- **THEN** 第一个包处理后 SHALL 将不完整行保留在 `lineBuffer`
- **AND** 第二个包处理后 SHALL 拼接成完整行 `data: {"choices":[{"delta":{"content":"hello"}}]}`
- **AND** SHALL 正确解析并转换该行

#### Scenario: 流结束时残留行输出

- **WHEN** 流结束（`flush` 被调用）
- **AND** `lineBuffer` 非空（有残留不完整行）
- **THEN** SHALL `enqueue` 输出 `lineBuffer` 内容
- **AND** SHALL 清空 `lineBuffer`

### Requirement: ThinkingProcess UI 组件

系统 SHALL 在 `components/chat/ThinkingProcess.vue` 中实现可折叠展开的思考过程展示组件，并通过 `ai-chat.vue` 异步加载与渲染。

- 组件 props SHALL 为 `content: string` 与 `isExpanded: boolean`
- 组件 SHALL 通过 `emit('toggle')` 通知父组件切换展开状态（不在内部维护状态）
- 折叠/展开 SHALL 使用 `max-h-0 opacity-0` ↔ `max-h-[600px] opacity-100` + `transition-all duration-semi-normal ease-in-out` 平滑过渡，禁止 `v-if` 瞬间跳变（遵循项目「折叠/展开区域」UI 规范）
- 折叠状态 SHALL 显示前 60 字符的预览（`\n` 替换为空格，超出加 `...`）
- 展开状态 SHALL 完整显示 `content`（`whitespace-pre-wrap leading-relaxed`）
- 头部圆形进度图标 SHALL 在展开时 `rotate-90`，使用 `transition-transform duration-semi-normal`
- 展开状态 SHALL 显示底部 chevron-down 图标
- `ai-chat.vue` SHALL 通过 `LazyThinkingProcess = defineAsyncComponent(...)` 异步加载该组件（参见 [ai-chat.vue#L27-L30](file:///d:/code/codeWork/my-chat/pages/ai-chat.vue#L27)）
- 渲染条件 SHALL 为 `enableThinking && getReasoningContent(messages[i])`（思考开关开启且该消息有 reasoning 内容，参见 [ai-chat.vue#L943-L948](file:///d:/code/codeWork/my-chat/pages/ai-chat.vue#L943)）
- `getReasoningContent(msg)` SHALL 从 `msg.parts` 中筛选 `type === 'reasoning'` 的 part，取 `p.text || p.reasoning || ''` 拼接（v5 中 reasoning part 的文本字段是 `text`，旧版是 `reasoning`，参见 [ai-chat.vue#L412-L418](file:///d:/code/codeWork/my-chat/pages/ai-chat.vue#L412)）
- 展开状态 SHALL 由父组件 `expandedThinkingMap.get(message.id)` 控制，通过 `toggleThinkingExpand(messageId)` 切换

#### Scenario: 流式输出期间持续追加 reasoning-delta

- **WHEN** AI 流式输出期间，后端通过 `createUIMessageStream` 发送 `reasoning-start` → 多个 `reasoning-delta` 事件
- **THEN** `messages[i].parts` SHALL 累积 `type: 'reasoning'` 的 part
- **AND** `getReasoningContent` SHALL 返回拼接后的最新内容
- **AND** ThinkingProcess 组件 SHALL 在流式期间持续更新显示

#### Scenario: 用户点击头部切换展开/折叠

- **WHEN** 用户点击 ThinkingProcess 头部按钮
- **THEN** 组件 SHALL `emit('toggle')`
- **AND** 父组件 SHALL 通过 `toggleThinkingExpand(messageId)` 切换 `expandedThinkingMap`
- **AND** 折叠/展开 SHALL 经过 `max-height` + `opacity` transition 平滑过渡（约 `duration-semi-normal`）

#### Scenario: 折叠状态显示前 60 字符预览

- **WHEN** `isExpanded === false`
- **AND** `content.length > 60`
- **THEN** 头部 SHALL 显示 `content` 前 60 字符（换行替换为空格）+ `...`
- **AND** 用户 SHALL 能预判思考内容相关性

### Requirement: 模型能力四维分类

系统 SHALL 在 `server/config/models.ts` 中通过 `ModelCapabilities` 接口定义模型能力的四个维度，并在 `useChatConfig.ts` 的 `FALLBACK_MODELS` 中保持完全一致，确保 SSR 时 capabilities 判断准确。

- `vision`：是否支持图片理解（多模态）
- `deepThinking`：是否有思考能力（API 返回 `reasoning_content`），包含强制思考与可切换思考
- `toggleableThinking`：思考模式是否可通过 `enable_thinking` 参数开关控制（`true` = 可切换，`false` = 强制或不支持）
- `toolCalling`：是否支持工具调用（function calling）
- `AVAILABLE_MODELS` 数组 SHALL 是模型白名单，新增模型需在此处同步添加
- `ALLOWED_MODEL_VALUES` SHALL 是 `Set<string>`，由 `AVAILABLE_MODELS` 派生，用于 `chat.post.ts` 校验请求的 `model` 参数
- `getModelCapabilities(modelValue)` SHALL 返回对应 capabilities；未匹配时返回默认能力 `{ vision: false, deepThinking: false, toggleableThinking: false, toolCalling: true }`
- `useChatConfig.ts` 的 `FALLBACK_MODELS` SHALL 与 `AVAILABLE_MODELS` 完全一致，确保 SSR 时 capabilities 判断准确（缺失项时 SSR 走默认 capabilities 属脆弱的隐式行为）
- `useChatConfig.ts` 的 `currentCapabilities` computed SHALL 在 `currentModel` 变化时自动重算
- 切换模型时 SHALL 重置开关：`enableThinking.value = currentCapabilities.value.deepThinking`（有思考能力的模型默认开启，无思考能力的模型关闭）

**关键约束**：
- 视觉/推理模型不支持 `enable_thinking` 参数：通过 `getModelCapabilities()` 能力系统判断，`!caps.vision && !caps.deepThinking` 时才允许启用思考，新增模型需在 `server/config/models.ts` 中正确配置 capabilities
- GLM-Z1 模型返回 400 错误当 `enable_thinking` 参数被传递
- `enable_thinking` 参数必须注入到请求体顶层（不能通过 `providerOptions` 透传，因 zod schema 严格校验）
- 模型配置必须包含 `toggleableThinking` 字段以区分可切换思考模型与强制思考模型

#### Scenario: 可切换思考模型正确传 enable_thinking

- **WHEN** 请求的 `model` 为 `Qwen/Qwen3-8B`（`vision=false, deepThinking=true, toggleableThinking=true`）
- **THEN** `thinkingOptions` SHALL 为 `{ enableThinking: thinkingEnabled }`
- **AND** SHALL 在请求体顶层注入 `enable_thinking`
- **AND** 硅基流动 SHALL 正常处理

#### Scenario: 视觉/强制推理模型不传 enable_thinking

- **WHEN** 模型 `caps.toggleableThinking === false`（强制思考模型 R1 / GLM-Z1，或纯视觉模型）
- **THEN** `thinkingOptions` SHALL 为 `undefined`
- **AND** SHALL NOT 向 API 注入 `enable_thinking` 字段
- **AND** 通过 `getModelCapabilities()` 能力系统判断（结合 `!caps.vision && !caps.deepThinking` 规则与 `toggleableThinking` 区分）

#### Scenario: GLM-Z1 模型传 enable_thinking 返回 400

- **WHEN** 请求的 `model` 为 `THUDM/GLM-Z1-9B-0414`
- **AND** 请求体包含 `enable_thinking` 字段
- **THEN** 硅基流动 SHALL 返回 400 Bad Request
- **AND** 因此系统 SHALL NOT 为该模型注入 `enable_thinking`（通过 `toggleableThinking: false` 配置实现）

#### Scenario: DeepSeek-R1 传 enable_thinking 被忽略

- **WHEN** 请求的 `model` 为 `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B`（`toggleableThinking=false`）
- **THEN** `thinkingOptions` SHALL 为 `undefined`
- **AND** SHALL NOT 注入 `enable_thinking`（即使注入也会被 API 忽略，无效果）

#### Scenario: 新增模型需正确配置 capabilities

- **WHEN** 开发者在 `AVAILABLE_MODELS` 中新增模型
- **THEN** SHALL 正确设置 `vision` / `deepThinking` / `toggleableThinking` / `toolCalling` 四个字段
- **AND** SHALL 同步在 `useChatConfig.ts` 的 `FALLBACK_MODELS` 中添加完全一致的配置
- **AND** 若遗漏 `toggleableThinking` 字段，`thinkingOptions` 判断 SHALL 出错（可能向强制思考模型误传 `enable_thinking` 导致 400）

#### Scenario: 切换模型时自动重置思考开关

- **WHEN** 用户从 `Qwen/Qwen3-8B`（`deepThinking=true`）切换到不支持思考的模型（`deepThinking=false`）
- **THEN** `enableThinking` SHALL 自动设为 `false`
- **AND** 当切回 `Qwen/Qwen3-8B` 时 `enableThinking` SHALL 自动设为 `true`

#### Scenario: SSR 时 FALLBACK_MODELS capabilities 与服务端一致

- **WHEN** SSR 阶段 `currentModel` 为 `Qwen/Qwen3.5-4B`
- **AND** `modelOptions` 为 `FALLBACK_MODELS`（API 未加载）
- **THEN** `currentCapabilities.vision` SHALL 为 `true`
- **AND** `currentCapabilities.deepThinking` SHALL 为 `true`
- **AND** `currentCapabilities.toggleableThinking` SHALL 为 `true`
- **AND** `currentCapabilities.toolCalling` SHALL 为 `true`
- **AND** 思考按钮 SHALL 在 SSR 中正确显示
