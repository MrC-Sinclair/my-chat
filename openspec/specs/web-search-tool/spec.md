## Requirements

### Requirement: webSearch 工具定义

系统 SHALL 在 `server/tools/web-search.ts` 中定义 `webSearchTool`，作为 AI SDK `tool()` 实现，用于通过 Tavily API 搜索互联网获取实时信息并返回结构化结果。

- 工具名称 SHALL 为 `webSearch`
- 工具 `description` SHALL 明确说明「何时调用」：当用户问题涉及新闻、最新数据、当前事件、或任何可能随时间变化的信息时必须调用此工具；即使你认为自己知道答案，也必须搜索以确认信息的时效性；不确定时优先使用搜索工具
- 工具 `description` SHALL 强调调用强制性（「必须调用」「禁止凭记忆回答」）
- 工具 `inputSchema` SHALL 接受 `query: string` 单一参数（zod schema），describe 为「搜索关键词，应简洁精准。例如："2025年高考政策变化" 或 "React 19 新特性"」
- 工具 SHALL 内部调用 `searchWithTavily()` 函数，向 `https://api.tavily.com/search` 发起 POST 请求
- Tavily 请求体 SHALL 包含 `api_key`、`query`、`search_depth: 'basic'`、`include_answer: false`、`max_results: 8`
- `searchWithTavily` SHALL 依赖 `process.env.TAVILY_API_KEY` 环境变量，缺失时抛出 `Error('未配置 TAVILY_API_KEY')`
- 工具 `execute` SHALL 将原始结果映射为 `{ index, title, url, snippet }` 数组，最多 8 条
- 每条结果的 `snippet` SHALL 截断到 200 字符（`searchWithTavily` 内部已截断到 300，`execute` 再次截断到 200），避免上下文膨胀
- 工具成功返回 SHALL 包含 `{ results, totalResults, query }` 结构
- 大对象（搜索结果）SHALL 通过结构化数据返回 LLM 上下文，但每条 snippet 严格截断到 200 字符，避免占用过多 token

#### Scenario: 工具成功返回搜索结果

- **WHEN** LLM 调用 `webSearch` 工具，传入有效的 `query` 参数
- **AND** `TAVILY_API_KEY` 已配置
- **AND** Tavily API 返回 200 且包含 `results` 数组
- **THEN** 工具 SHALL 调用 Tavily API 获取搜索结果
- **AND** SHALL 返回 `{ results, totalResults, query }` 结构
- **AND** `results` SHALL 为数组，每项包含 `index`（从 1 开始）、`title`、`url`、`snippet`（≤200 字符）
- **AND** `totalResults` SHALL 等于 `results.length`
- **AND** `results.length` SHALL 不超过 8

#### Scenario: 工具成功但 Tavily 返回空结果

- **WHEN** Tavily API 返回 200 但 `results` 为空数组
- **THEN** 工具 SHALL 返回 `{ results: [], totalResults: 0, query }`
- **AND** SHALL 不抛出异常

### Requirement: 工具失败返回结构化错误不抛异常

系统 SHALL 在 `webSearchTool.execute` 中捕获所有异常，返回结构化错误对象而非抛出异常，由 LLM 自主决定重试或换工具，遵循 Agent 架构「工具失败不中断流」原则。

- 工具失败时 SHALL 返回 `{ error: '搜索失败: <errorMessage>', results: [], totalResults: 0, query }` 结构
- 错误对象 SHALL 不抛出异常（不中断 `streamText` 流，不触发 500 错误）
- `errorMessage` SHALL 取自 `error instanceof Error ? error.message : '未知错误'`
- 错误来源包括但不限于：`TAVILY_API_KEY` 未配置、Tavily API 返回非 200 状态码、网络错误、响应 JSON 解析失败
- 错误返回后 SHALL 由 LLM 基于 `error` 字段自主决策（重试、换工具、或告知用户）

**关键约束**：遵循 AGENTS.md「工具系统设计原则」——工具执行失败返回结构化错误对象（不抛异常），由 LLM 决定重试/换工具，而非代码硬编码重试逻辑。

#### Scenario: TAVILY_API_KEY 未配置

- **WHEN** `process.env.TAVILY_API_KEY` 为空或未定义
- **AND** LLM 调用 `webSearch` 工具
- **THEN** `searchWithTavily` SHALL 抛出 `Error('未配置 TAVILY_API_KEY')`
- **AND** `execute` SHALL 捕获该异常
- **AND** SHALL 返回 `{ error: '搜索失败: 未配置 TAVILY_API_KEY', results: [], totalResults: 0, query }`
- **AND** SHALL 不抛出异常，不中断流式输出

#### Scenario: Tavily API 返回非 200 状态码

- **WHEN** Tavily API 返回 401/429/500 等非 200 状态码
- **THEN** `searchWithTavily` SHALL 抛出 `Error('Tavily 请求失败 (<status>): <errorText>')`
- **AND** `execute` SHALL 捕获该异常
- **AND** SHALL 返回 `{ error: '搜索失败: Tavily 请求失败 (...): ...', results: [], totalResults: 0, query }`
- **AND** SHALL 不抛出异常

#### Scenario: 网络错误或响应解析失败

- **WHEN** fetch 抛出网络错误，或 `response.json()` 解析失败
- **THEN** `execute` SHALL 捕获异常
- **AND** SHALL 返回包含 `error: '搜索失败: <errorMessage>'` 的结构化对象
- **AND** SHALL 不抛出异常

### Requirement: 服务端注册 webSearch 工具

系统 SHALL 在 `chat.post.ts` 中，当 `caps.toolCalling === true && webSearchEnabled !== false` 时，将 `webSearchTool` 注册到 `toolsConfig`。

- `webSearchEnabled` SHALL 由 `enable_web_search !== false` 计算得出（默认开启，仅显式 `false` 才关闭）
- `toolsConfig` 中 SHALL 使用 `webSearch` 作为工具键名
- 注册条件 SHALL 同时满足 `webSearchEnabled` 和 `caps.toolCalling`（使用展开运算符短路求值：`...(webSearchEnabled && caps.toolCalling && { webSearch: webSearchTool })`）
- `caps.toolCalling === false` 时 SHALL 不注册 webSearch 工具（防御性兜底）
- webSearch 工具 SHALL 与 `extractTextFromImage`、`recallMemory`、`generateImage`、weather MCP tools 共存于 `toolsConfig`
- `maxSteps` SHALL 基于 `toolsConfig` 是否非空决定（`hasActiveTools = caps.toolCalling && Object.keys(toolsConfig).length > 0`）：有工具时 `maxSteps=5`，无工具时 `maxSteps=1`
- `stopWhen` SHALL 为 `stepCountIs(hasActiveTools ? 5 : 1)`

#### Scenario: webSearch 开启且模型支持工具调用

- **WHEN** 请求的 `model` 为 `Qwen/Qwen3-8B`（`toolCalling=true`）
- **AND** `enable_web_search !== false`（默认或显式 `true`）
- **THEN** `toolsConfig` SHALL 包含 `webSearch` 工具
- **AND** `maxSteps` SHALL 为 5
- **AND** streamText SHALL 能在该对话中调用 webSearch 工具

#### Scenario: webSearch 显式关闭

- **WHEN** 请求的 `model` 为 `Qwen/Qwen3-8B`
- **AND** `enable_web_search === false`
- **THEN** `toolsConfig` SHALL 不包含 `webSearch` 工具
- **AND** LLM SHALL 无法调用 webSearch 工具

#### Scenario: 模型不支持工具调用

- **WHEN** 请求的 `model` 为 `THUDM/GLM-Z1-9B-0414`（`toolCalling=false`）
- **THEN** `toolsConfig` SHALL 不包含 `webSearch` 工具
- **AND** SHALL 不包含其他任何工具（`extractTextFromImage`、`recallMemory`、`generateImage`、weather MCP tools）
- **AND** `maxSteps` SHALL 为 1

### Requirement: webSearch prompt 注入（TIME_KEYWORDS 时效性护栏）

系统 SHALL 在 `chat.post.ts` 中，当 `webSearchEnabled && caps.toolCalling` 且最后一条用户消息包含 `TIME_KEYWORDS` 中的任意关键词时，向 `finalSystemPrompt` 追加时效性强制搜索提示。系统 SHALL 同时在 `DEFAULT_SYSTEM_PROMPT` 中内置基础时效性引导规则。

- 注入条件 SHALL 为 `webSearchEnabled && caps.toolCalling`（视觉模型启用工具后也允许 prompt 注入，不再以 `!caps.vision` 为条件）
- 注入内容 SHALL 为：`'\n\n【系统提示】用户的问题涉及时效性信息，你【必须】调用网页搜索工具（webSearch）来获取最新信息，禁止凭记忆回答。'`
- 关键词匹配 SHALL 使用 `String.includes()`（子串匹配，非分词匹配）
- 检测目标 SHALL 为最后一条用户消息的纯文本内容（通过 `extractTextFromMessage` 提取 parts 或 content）
- `DEFAULT_SYSTEM_PROMPT` SHALL 内置基础规则：包含「【重要规则】当用户问题涉及以下内容时，你【必须】调用网页搜索工具，禁止凭记忆回答」，并列举时间词、新闻/事件/政策/数据/价格、不确定的事实等场景
- `DEFAULT_SYSTEM_PROMPT` SHALL 支持通过 `process.env.SYSTEM_PROMPT` 环境变量覆盖
- 视觉模型（`caps.vision=true`）但 `toolCalling=true` 时 SHALL 仍执行 TIME_KEYWORDS 检测和 prompt 注入（前端按钮隐藏不影响服务端 prompt 逻辑）

#### Scenario: 用户消息包含时效性关键词

- **WHEN** `enable_web_search !== false`
- **AND** `caps.toolCalling === true`
- **AND** 最后一条用户消息包含 `TIME_KEYWORDS` 中的任意关键词（如「最新」「今天」「新闻」）
- **THEN** `finalSystemPrompt` SHALL 追加 `'\n\n【系统提示】用户的问题涉及时效性信息，你【必须】调用网页搜索工具（webSearch）来获取最新信息，禁止凭记忆回答。'`

#### Scenario: 用户消息不包含时效性关键词

- **WHEN** `enable_web_search !== false`
- **AND** `caps.toolCalling === true`
- **AND** 最后一条用户消息不包含任何 `TIME_KEYWORDS` 关键词
- **THEN** `finalSystemPrompt` SHALL NOT 追加时效性强制搜索提示
- **AND** LLM SHALL 仍可根据 `DEFAULT_SYSTEM_PROMPT` 基础规则和工具 `description` 自主决定是否调用 webSearch

#### Scenario: 模型不支持工具调用时不注入

- **WHEN** `caps.toolCalling === false`
- **THEN** SHALL NOT 执行 TIME_KEYWORDS 检测
- **AND** SHALL NOT 注入时效性强制搜索提示

#### Scenario: 视觉模型启用工具后仍注入

- **WHEN** 请求的 `model` 为 `Qwen/Qwen3.5-4B`（`vision=true, toolCalling=true`）
- **AND** `enable_web_search !== false`
- **AND** 最后一条用户消息包含 `TIME_KEYWORDS` 关键词
- **THEN** SHALL 执行 prompt 注入（尽管前端联网按钮对视觉模型隐藏）
- **AND** `toolsConfig` SHALL 包含 `webSearch` 工具

### Requirement: TIME_KEYWORDS 时效性关键词列表（历史护栏）

系统 SHALL 在 `chat.post.ts` 中维护固定的 `TIME_KEYWORDS` 数组，用于检测用户消息是否涉及时效性信息。

- `TIME_KEYWORDS` SHALL 为固定数组：`['最新', '今天', '近期', '当前', '现在', '最近', '新闻', '实时', '最新消息', '热点', '动态']`
- 数组 SHALL 包含 11 个关键词
- 关键词匹配 SHALL 使用 `Array.some()` + `String.includes()`，任意一个关键词命中即触发 prompt 注入
- `TIME_KEYWORDS` SHALL 仅用于 webSearch 工具的 prompt 注入，SHALL NOT 用于其他工具

**关键约束（历史护栏，禁止复制）**：`TIME_KEYWORDS` 是历史护栏模式（代码硬编码关键词列表触发强制工具调用），违反 Agent 架构「工具调用由 LLM 自主决策」原则。新功能 SHALL NOT 复制此模式， SHALL NOT 新增类似的硬编码关键词列表触发工具调用。新工具的调用决策 SHALL 完全由 LLM 基于 `description` 和 prompt 规则自主判断。

#### Scenario: 关键词列表完整性

- **WHEN** 系统初始化 `TIME_KEYWORDS` 常量
- **THEN** 数组 SHALL 包含 `'最新'`、`'今天'`、`'近期'`、`'当前'`、`'现在'`、`'最近'`、`'新闻'`、`'实时'`、`'最新消息'`、`'热点'`、`'动态'` 共 11 个关键词

#### Scenario: 子串匹配触发

- **WHEN** 最后一条用户消息为「最近有什么好看的电影」
- **AND** `webSearchEnabled && caps.toolCalling`
- **THEN** `TIME_KEYWORDS.some(kw => '最近有什么好看的电影'.includes(kw))` SHALL 返回 `true`（命中「最近」）
- **AND** SHALL 触发 prompt 注入

#### Scenario: 新功能禁止复制此模式

- **WHEN** 新增其他工具（如生图、OCR、记忆检索等）
- **THEN** SHALL NOT 为新工具维护类似的硬编码关键词列表
- **AND** SHALL 通过工具 `description` 和 prompt 规则引导 LLM 自主决策
- **AND** `TIME_KEYWORDS` 模式 SHALL 仅作为 webSearch 历史遗留护栏存在

### Requirement: 前端 enableWebSearch 开关（useChatConfig + ChatInput）

系统 SHALL 在 `useChatConfig` composable 中提供 `enableWebSearch` ref，并在 ChatInput 组件中提供「联网」toggle 按钮，供前端控制 webSearch 工具的注册。

- `enableWebSearch` SHALL 是 `ref<boolean>`，初始值为 `true`（默认开启，与 `enable_image_generation` 一致）
- `enableWebSearch` SHALL 通过 composable 返回值暴露给消费者
- ChatInput SHALL 通过 `props.enableWebSearch` 接收状态，通过 `emit('update:enableWebSearch', !enableWebSearch)` 切换状态
- ChatInput 联网按钮 SHALL 在 `!currentCapabilities.vision` 时显示（产品决策：视觉模型对话以图像理解为主，联网入口保持精简）
- ChatInput 联网按钮 SHALL 在 `currentCapabilities.vision === true` 时隐藏
- 按钮 SHALL 默认开启（继承 `enableWebSearch` 初始值 `true`），开启时使用 `bg-semi-primary-light text-semi-primary-active` 高亮样式，关闭时使用 `bg-semi-fill-0 text-semi-text-2` 样式
- 按钮 SHALL 使用 SVG 图标（地球图标，含 `<line>` 和 `<path>` 经纬线）+「联网」文案
- 按钮 SHALL 提供 `v-tooltip` 提示，文案根据状态变化：「联网搜索已开启」/「联网搜索已关闭」
- 按钮触摸目标 SHALL ≥ 32px（`min-h-[32px]`），与「思考」「OCR」「生图」按钮一致
- 按钮 SHALL 使用 `transition-all duration-semi-normal` 实现平滑过渡

#### Scenario: 初始状态默认开启

- **WHEN** 应用初始化
- **THEN** `enableWebSearch.value` SHALL 为 `true`

#### Scenario: 非视觉模型显示联网按钮

- **WHEN** 用户选中 `Qwen/Qwen3-8B`（`vision=false`）
- **THEN** 联网 toggle 按钮 SHALL 可见
- **AND** 默认状态 SHALL 为开启（高亮 `bg-semi-primary-light text-semi-primary-active`）
- **AND** tooltip SHALL 显示「联网搜索已开启」

#### Scenario: 视觉模型隐藏联网按钮

- **WHEN** 用户选中 `Qwen/Qwen3.5-4B`（`vision=true`）
- **THEN** 联网 toggle 按钮 SHALL 不渲染
- **AND** `enableWebSearch` SHALL 保持原值（服务端仍按 `enable_web_search !== false` 注册工具）

#### Scenario: 用户点击联网按钮切换状态

- **WHEN** 用户点击联网 toggle 按钮（当前为开启状态）
- **THEN** ChatInput SHALL `emit('update:enableWebSearch', false)`
- **AND** `enableWebSearch.value` SHALL 变为 `false`
- **AND** 按钮样式 SHALL 变为非高亮（`bg-semi-fill-0 text-semi-text-2`）
- **AND** tooltip SHALL 变为「联网搜索已关闭」

### Requirement: 模型切换时 enableWebSearch 保持不变

系统 SHALL 在 `useChatConfig` 的 `watch(currentModel)` 中保持 `enableWebSearch` 值不变，不随模型切换重置。

- `watch(currentModel)` SHALL 重置 `enableThinking`（基于 `currentCapabilities.deepThinking`）
- `watch(currentModel)` SHALL 在切换到 `toolCalling=false` 模型时重置 `enableOcr` 为 `false`
- `watch(currentModel)` SHALL 在切换到 `toolCalling=false` 模型时重置 `enableImageGeneration` 为 `false`，切回 `toolCalling=true` 时恢复为 `true`
- `watch(currentModel)` SHALL NOT 修改 `enableWebSearch`（保持当前值）
- 视觉模型隐藏联网按钮时 `enableWebSearch` SHALL 保持原值（不重置为 `false`），服务端仍按 `enable_web_search !== false` 注册工具
- 当切换到 `toolCalling=false` 模型时，虽然 `enableWebSearch` 保持 `true`，但服务端 `caps.toolCalling === false` 兜底 SHALL 阻止 webSearch 工具注册

#### Scenario: 切换模型时 enableWebSearch 保持原值

- **WHEN** 用户从 `Qwen/Qwen3-8B`（`toolCalling=true`）切换到 `THUDM/GLM-Z1-9B-0414`（`toolCalling=false`）
- **AND** `enableWebSearch.value` 当前为 `true`
- **THEN** `enableWebSearch.value` SHALL 保持为 `true`
- **AND** `watch(currentModel)` SHALL NOT 修改 `enableWebSearch`
- **AND** 服务端 SHALL 因 `caps.toolCalling === false` 不注册 webSearch 工具（防御性兜底）

#### Scenario: 切换到视觉模型时 enableWebSearch 保持原值

- **WHEN** 用户从 `Qwen/Qwen3-8B`（`vision=false`）切换到 `Qwen/Qwen3.5-4B`（`vision=true, toolCalling=true`）
- **AND** `enableWebSearch.value` 当前为 `true`
- **THEN** `enableWebSearch.value` SHALL 保持为 `true`
- **AND** 联网按钮 SHALL 隐藏（`v-if="!currentCapabilities.vision"`）
- **AND** 服务端 SHALL 因 `enable_web_search !== false && caps.toolCalling` 注册 webSearch 工具

### Requirement: 请求 body 透传 enable_web_search

系统 SHALL 在 `useChat` 的 `body` 参数中透传 `enable_web_search` 字段到 `/api/chat`。

- `body` SHALL 是函数式写法（`() => ({...})`），AI SDK v5 DefaultChatTransport 每次请求重新调用以获取最新值
- `enable_web_search` 字段值 SHALL 来自 `enableWebSearch.value`
- `enable_web_search` 字段类型 SHALL 为布尔值，前端保证其值始终为 `true` 或 `false`
- 服务端 SHALL 通过 `enable_web_search !== false` 计算最终是否启用 webSearch（默认开启，与 `enable_image_generation` 一致）
- `body` 函数 SHALL 同时透传 `enable_thinking`、`thinking_budget`、`model`、`enable_ocr`、`enable_image_generation`、`sessionId`、`lastSessionId`、`images` 字段

#### Scenario: 联网开启时请求体包含 enable_web_search

- **WHEN** 用户开启联网 toggle（或未操作，默认开启）
- **AND** 发送消息
- **THEN** `/api/chat` 请求 body SHALL 包含 `enable_web_search: true`
- **AND** 服务端 `webSearchEnabled` SHALL 为 `true`
- **AND** `toolsConfig` SHALL 包含 `webSearch` 工具（若 `caps.toolCalling === true`）

#### Scenario: 联网关闭时请求体包含 enable_web_search

- **WHEN** 用户关闭联网 toggle
- **AND** 发送消息
- **THEN** `/api/chat` 请求 body SHALL 包含 `enable_web_search: false`
- **AND** 服务端 `webSearchEnabled` SHALL 为 `false`
- **AND** `toolsConfig` SHALL 不包含 `webSearch` 工具
- **AND** SHALL 不注入 TIME_KEYWORDS 强制搜索提示
