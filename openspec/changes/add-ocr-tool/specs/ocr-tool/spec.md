## ADDED Requirements

### Requirement: OCR 工具定义

系统 SHALL 在 `server/tools/ocr-document.ts` 中定义 `ocrDocumentTool`，作为 AI SDK `tool()` 实现，用于提取图片中的文字并返回结构化 Markdown。

- 工具名称 SHALL 为 `extractTextFromImage`
- 工具 `description` SHALL 明确说明「仅在用户上传图片且需要 OCR 时调用，无图片时禁止调用」
- 工具 `inputSchema` SHALL 接受 `imageUrl: string`（URL 格式）单一参数
- 工具 `execute` 函数 SHALL 内部构造固定 OCR 指令（包含 Markdown 输出、表格语法、印章标记、公式 LaTeX 包裹、保持版面结构等要求）
- 工具 `execute` 函数 SHALL 内部 fetch 图片 URL → 转 base64 → 调用 PaddleOCR API（`PaddlePaddle/PaddleOCR-VL-1.5`）
- 工具 SHALL 不向 PaddleOCR API 传 `enable_thinking` 参数（实测 `enable_thinking=false` 会让输出降级）
- 工具调用失败时 SHALL 返回结构化错误对象（不抛异常），包含 `error`、`detail`、`imageUrl` 字段

#### Scenario: 工具成功提取图片文字

- **WHEN** LLM 调用 `extractTextFromImage` 工具，传入有效的图片 URL
- **THEN** 工具 SHALL 下载图片并转为 base64
- **AND** SHALL 调用 PaddleOCR API，传入固定的 OCR 指令作为 user message
- **AND** SHALL 返回 Markdown 格式的提取结果（含表格、标题、印章标记等）

#### Scenario: 图片 URL 不可达

- **WHEN** LLM 调用 `extractTextFromImage` 工具，传入的 URL 不可达（404、超时等）
- **THEN** 工具 SHALL 返回 `{ error: '图片下载失败', detail: '<具体错误>', imageUrl }` 结构化错误对象
- **AND** SHALL 不抛出异常，让 LLM 处理错误并告知用户

#### Scenario: PaddleOCR API 调用失败

- **WHEN** PaddleOCR API 返回非 200 状态码或响应格式异常
- **THEN** 工具 SHALL 返回 `{ error: 'OCR 服务调用失败', detail: '<状态码或错误信息>', imageUrl }` 结构化错误对象
- **AND** SHALL 不抛出异常

### Requirement: 服务端注册 OCR 工具

系统 SHALL 在 `chat.post.ts` 中，当 `caps.toolCalling === true && enable_ocr === true` 时，将 `ocrDocumentTool` 加入 `toolsConfig`。

- OCR 工具 SHALL 与 `webSearchTool`、weather MCP tools 共存于 `toolsConfig`
- `enable_ocr === false` 或未提供时 SHALL 不注册 OCR 工具
- `caps.toolCalling === false` 时 SHALL 不注册 OCR 工具（防御性兜底，前端应已隐藏 OCR 按钮）
- `webSearchTool` 注册条件 SHALL 增加 `caps.toolCalling` 检查（当前代码已隐式满足，因 `toolsConfig` 整体在 `caps.toolCalling` 分支下展开）
- 系统 SHALL 重构 `maxSteps` 计算逻辑：基于 `toolsConfig` 是否为空（即是否有工具实际注册）决定 `maxSteps`，而非基于 `caps.vision || caps.deepThinking`
  - 当 `hasActiveTools`（有工具注册）时 `maxSteps = 5`
  - 当无工具注册时 `maxSteps = 1`
- webSearch prompt 注入条件 SHALL 从 `!caps.vision` 改为 `caps.toolCalling`（视觉模型启用工具后也应允许 web 搜索提示词注入）

#### Scenario: OCR toggle 开启且模型支持工具调用

- **WHEN** 请求的 `model` 为 `Qwen/Qwen3-8B`（`toolCalling=true`）
- **AND** `enable_ocr === true`
- **THEN** `toolsConfig` SHALL 包含 `extractTextFromImage` 工具
- **AND** streamText SHALL 能在该对话中调用 OCR 工具

#### Scenario: OCR toggle 关闭

- **WHEN** 请求的 `model` 为 `Qwen/Qwen3-8B`
- **AND** `enable_ocr === false` 或未提供
- **THEN** `toolsConfig` SHALL 不包含 `extractTextFromImage` 工具
- **AND** LLM SHALL 无法调用 OCR 工具

#### Scenario: 模型不支持工具调用

- **WHEN** 请求的 `model` 为 `THUDM/GLM-Z1-9B-0414`（`toolCalling=false`）
- **THEN** `toolsConfig` SHALL 不包含 `extractTextFromImage` 工具
- **AND** SHALL 不包含 `webSearch` 工具
- **AND** SHALL 不包含 weather MCP tools

### Requirement: 服务端 OCR 工具使用规则注入

系统 SHALL 在 `chat.post.ts` 中，当 `caps.toolCalling === true && enable_ocr === true` 时，向 `finalSystemPrompt` 追加 OCR 工具使用规则。

- 追加的规则 SHALL 明确正向上调用场景：「提取文字」「OCR」「识别」「转文字」「表格转 Markdown」「文档结构化」「印章」「签名」「手写」「图片是文档、扫描件、发票、合同、表单等」
- 追加的规则 SHALL 明确负向禁调场景：「通用图像理解」「图中是什么」「描述图片」「用户未上传图片」「图片是普通照片、人物、风景等」
- 追加的规则 SHALL 明确「无图片时禁止调用此工具」

#### Scenario: OCR toggle 开启时 prompt 强化

- **WHEN** 请求的 `model` 为 `Qwen/Qwen3-8B`（`toolCalling=true`）
- **AND** `enable_ocr === true`
- **THEN** `finalSystemPrompt` SHALL 包含 OCR 工具使用规则
- **AND** 规则中 SHALL 包含正向上调场景列表
- **AND** 规则中 SHALL 包含负向禁调场景列表
- **AND** 规则中 SHALL 明确「无图片时禁止调用」

#### Scenario: OCR toggle 关闭时不追加规则

- **WHEN** `enable_ocr === false` 或未提供
- **THEN** `finalSystemPrompt` SHALL 不包含 OCR 工具使用规则

### Requirement: useChatConfig 提供 enableOcr 与 currentSupportsOcr

系统 SHALL 在 `useChatConfig` composable 中新增 `enableOcr` ref 与 `currentSupportsOcr` computed，供 ChatInput 组件使用。

- `enableOcr` SHALL 是 `ref<boolean>`，初始值为 `false`
- `currentSupportsOcr` SHALL 是 computed，基于 `currentCapabilities.toolCalling` 判断
- `currentSupportsOcr` SHALL 在 `currentModel` 变化时自动重算

#### Scenario: 切换到支持工具调用的模型

- **WHEN** 用户从 `THUDM/GLM-Z1-9B-0414`（`toolCalling=false`）切换到 `Qwen/Qwen3-8B`（`toolCalling=true`）
- **THEN** `currentSupportsOcr` SHALL 立即返回 `true`
- **AND** `enableOcr` SHALL 保持原值（不自动重置）

#### Scenario: 切换到不支持工具调用的模型

- **WHEN** 用户从 `Qwen/Qwen3-8B` 切换到 `THUDM/GLM-Z1-9B-0414`
- **THEN** `currentSupportsOcr` SHALL 立即返回 `false`
- **AND** `enableOcr` SHALL 自动设为 `false`（避免 toggle 开启但工具不可用的不一致状态）

### Requirement: ChatInput OCR toggle 按钮

系统 SHALL 在 ChatInput 组件中新增「OCR」toggle 按钮，与「思考」「联网」按钮同行。

- 按钮 SHALL 在 `currentCapabilities.toolCalling === true` 时显示（`v-if`）
- 按钮 SHALL 在 `currentCapabilities.toolCalling === false` 时隐藏
- 按钮 SHALL 默认关闭，开启时使用 `bg-semi-primary-light text-semi-primary` 高亮样式
- 按钮 SHALL 使用与「联网」按钮一致的 toggle 交互模式
- 按钮 SHALL 使用 SVG 图标（推荐文档/扫描类图标）+「OCR」文案
- 按钮 SHALL 提供 `v-tooltip` 提示，文案根据状态变化：「智能 OCR 已开启」/「智能 OCR 已关闭」
- 按钮触摸目标 SHALL ≥ 32px（`min-h-[32px]`），与「思考」「联网」按钮一致

#### Scenario: toolCalling 模型下显示 OCR 按钮

- **WHEN** 用户选中 `Qwen/Qwen3-8B`（`toolCalling=true`）
- **THEN** OCR toggle 按钮 SHALL 可见
- **AND** 默认状态 SHALL 为关闭（不高亮）
- **AND** tooltip SHALL 显示「智能 OCR 已关闭」

#### Scenario: 非 toolCalling 模型下隐藏 OCR 按钮

- **WHEN** 用户选中 `THUDM/GLM-Z1-9B-0414`（`toolCalling=false`）
- **THEN** OCR toggle 按钮 SHALL 不渲染

#### Scenario: 用户点击 OCR 按钮切换状态

- **WHEN** 用户点击 OCR toggle 按钮（当前为关闭状态）
- **THEN** `enableOcr` SHALL 变为 `true`
- **AND** 按钮样式 SHALL 变为高亮（`bg-semi-primary-light text-semi-primary`）
- **AND** tooltip SHALL 变为「智能 OCR 已开启」

#### Scenario: 切换到不支持工具调用的模型时自动关闭 OCR

- **WHEN** 用户在 `Qwen/Qwen3-8B` 下开启了 OCR toggle
- **AND** 切换到 `THUDM/GLM-Z1-9B-0414`
- **THEN** `enableOcr` SHALL 自动重置为 `false`
- **AND** OCR 按钮 SHALL 隐藏

### Requirement: 请求 body 透传 enable_ocr

系统 SHALL 在 `useChat` 的 `body` 参数中透传 `enable_ocr` 字段到 `/api/chat`。

- `body` SHALL 是 `computed()` 包裹（参考 AGENTS.md 中关于 `body` 必须用 `computed()` 的规则）
- `enable_ocr` 字段值 SHALL 来自 `enableOcr.value`
- 当 `enableOcr.value === false` 时 SHALL 透传 `false`（不省略）

#### Scenario: OCR toggle 开启时请求体包含 enable_ocr

- **WHEN** 用户开启 OCR toggle
- **AND** 发送消息
- **THEN** `/api/chat` 请求 body SHALL 包含 `enable_ocr: true`

#### Scenario: OCR toggle 关闭时请求体包含 enable_ocr

- **WHEN** 用户未开启 OCR toggle
- **AND** 发送消息
- **THEN** `/api/chat` 请求 body SHALL 包含 `enable_ocr: false`

### Requirement: 图片上传按钮联动 OCR 开关

系统 SHALL 修改 ChatInput 中图片上传按钮的显示条件，从 `supportsVision` 改为 `supportsVision || enableOcr`。

- 视觉模型（`supportsVision=true`）SHALL 始终显示上传按钮（现有行为不变）
- 非视觉模型（`supportsVision=false`）SHALL 仅在 `enableOcr=true` 时显示上传按钮
- 非视觉模型且 OCR 关闭时 SHALL 隐藏上传按钮（现有行为不变）

#### Scenario: 视觉模型始终可上传图片

- **WHEN** 用户选中 `Qwen/Qwen3.5-4B`（`vision=true`）
- **THEN** 图片上传按钮 SHALL 始终可见，无论 OCR 是否开启

#### Scenario: 非视觉模型 OCR 开启时可上传图片

- **WHEN** 用户选中 `Qwen/Qwen3-8B`（`vision=false`）
- **AND** `enableOcr=true`
- **THEN** 图片上传按钮 SHALL 可见
- **AND** 用户 SHALL 能选择并上传图片

#### Scenario: 非视觉模型 OCR 关闭时隐藏上传按钮

- **WHEN** 用户选中 `Qwen/Qwen3-8B`（`vision=false`）
- **AND** `enableOcr=false`
- **THEN** 图片上传按钮 SHALL 不可见

### Requirement: 非视觉模型图片 URL 文本注入

系统 SHALL 在 `chat.post.ts` 中，当 `enableOcr=true && caps.vision=false && hasImages` 时，将图片 URL 以文本引用形式注入最后一条用户消息。

- 注入格式 SHALL 为 `\n\n[附图片{N}: {URL}]`（N 从 1 开始）
- 注入位置 SHALL 为最后一条用户消息的文本内容末尾
- 非视觉模型 SHALL 不将图片作为多模态 content parts 传入（避免 API 报错）
- 视觉模型 SHALL 保持现有行为：图片作为多模态 content parts 传入

#### Scenario: 非视觉模型 OCR 开启且上传了图片

- **WHEN** 请求的 `model` 为 `Qwen/Qwen3-8B`（`vision=false, toolCalling=true`）
- **AND** `enable_ocr=true`
- **AND** 用户上传了 1 张图片
- **THEN** 最后一条用户消息的文本末尾 SHALL 追加 `\n\n[附图片1: https://...]`
- **AND** 图片 SHALL NOT 作为 `{ type: 'image' }` part 传入 LLM
- **AND** LLM SHALL 通过文本中的 URL 调用 `extractTextFromImage` 工具

#### Scenario: 视觉模型图片处理保持不变

- **WHEN** 请求的 `model` 为 `Qwen/Qwen3.5-4B`（`vision=true`）
- **AND** 用户上传了图片
- **THEN** 图片 SHALL 作为 `{ type: 'image' }` 多模态 parts 传入 LLM
- **AND** SHALL NOT 注入文本引用（视觉模型可直接看到图片）

### Requirement: FALLBACK_MODELS 补全

系统 SHALL 在 `useChatConfig.ts` 的 `FALLBACK_MODELS` 数组中补充 Qwen3.5-4B 的配置，确保 SSR 时 capabilities 判断准确。

- 补充项 SHALL 为：`{ label: 'Qwen3.5-4B', value: 'Qwen/Qwen3.5-4B', capabilities: { vision: true, deepThinking: false, toggleableThinking: false, toolCalling: true } }`

#### Scenario: SSR 时 Qwen3.5-4B capabilities 正确

- **WHEN** SSR 阶段 `currentModel` 为 `Qwen/Qwen3.5-4B`
- **AND** `modelOptions` 为 `FALLBACK_MODELS`（未加载 API）
- **THEN** `currentCapabilities.toolCalling` SHALL 为 `true`
- **AND** `currentCapabilities.vision` SHALL 为 `true`
- **AND** OCR 按钮 SHALL 在 SSR 中正确显示
