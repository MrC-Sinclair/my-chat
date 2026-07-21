## Requirements

### Requirement: 模型白名单 AVAILABLE_MODELS 单一事实来源

`server/config/models.ts` SHALL 导出 `AVAILABLE_MODELS: ModelConfig[]` 数组作为项目可用模型的唯一白名单。数组每项 MUST 包含三个字段：`label`（前端显示名称，如 "Qwen3-8B"）、`value`（模型唯一标识，对应 LLM API 的 model 参数，如 "Qwen/Qwen3-8B"）、`capabilities`（模型能力集合，见独立 Requirement）。当前白名单 MUST 包含以下四个模型，顺序与 `server/config/models.ts` 中一致：

1. `Qwen/Qwen3-8B` — 可切换思考 + 工具调用
2. `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B` — 强制思考，不支持工具调用
3. `THUDM/GLM-Z1-9B-0414` — 强制思考，不支持工具调用
4. `Qwen/Qwen3.5-4B` — 视觉 + 可切换思考 + 工具调用

`server/config/models.ts` SHALL 同时导出 `ALLOWED_MODEL_VALUES = new Set(AVAILABLE_MODELS.map(m => m.value))`，供 `chat.post.ts` 校验请求参数。新增或下线模型 MUST 在 `AVAILABLE_MODELS` 数组中同步修改，前端 `useChatConfig.ts` 中的 `FALLBACK_MODELS` 也 MUST 同步更新以保持 SSR 阶段能力判断准确（见 FALLBACK_MODELS Requirement）。

#### Scenario: 新增模型同步两处配置

- **WHEN** 维护者新增一个模型 `Foo/Bar-7B`（视觉模型，支持工具调用，可切换思考）
- **THEN** `server/config/models.ts` 的 `AVAILABLE_MODELS` 数组 MUST 添加 `{ label: "Bar-7B", value: "Foo/Bar-7B", capabilities: { vision: true, deepThinking: true, toggleableThinking: true, toolCalling: true } }`
- **AND** `composables/useChatConfig.ts` 的 `FALLBACK_MODELS` 数组 MUST 添加完全相同的配置项
- **AND** `ALLOWED_MODEL_VALUES` 集合自动包含新 value（由 `AVAILABLE_MODELS.map` 派生，无需手动修改）

#### Scenario: 白名单当前包含四个模型

- **WHEN** 检查 `AVAILABLE_MODELS` 数组
- **THEN** 数组长度为 4
- **AND** 包含 value 为 `Qwen/Qwen3-8B`、`deepseek-ai/DeepSeek-R1-0528-Qwen3-8B`、`THUDM/GLM-Z1-9B-0414`、`Qwen/Qwen3.5-4B` 的四项

#### Scenario: ALLOWED_MODEL_VALUES 由 AVAILABLE_MODELS 派生

- **WHEN** 检查 `ALLOWED_MODEL_VALUES`
- **THEN** 其类型为 `Set<string>`
- **AND** 包含 `AVAILABLE_MODELS` 中所有 `value` 字段
- **AND** 不包含任何额外值

### Requirement: 模型能力四维分类 ModelCapabilities

`server/config/models.ts` SHALL 导出 `ModelCapabilities` 接口，包含四个 boolean 字段，对每个模型的能力进行四维分类：

| 字段 | 含义 | true 示例 | false 示例 |
| --- | --- | --- | --- |
| `vision` | 是否支持图片理解（多模态） | Qwen3.5-4B | Qwen3-8B |
| `deepThinking` | 是否有思考能力（API 返回 `reasoning_content`），包含强制思考与可切换思考 | Qwen3-8B / DeepSeek-R1 / GLM-Z1 / Qwen3.5-4B | （当前所有模型均为 true） |
| `toggleableThinking` | 思考模式是否可通过 `enable_thinking` 参数开关控制。`true` = 可切换（默认启用，可关闭），`false` = 强制思考或不支持 | Qwen3-8B / Qwen3.5-4B | DeepSeek-R1 / GLM-Z1 |
| `toolCalling` | 是否支持工具调用（function calling）。控制工具是否注册到 `streamText` | Qwen3-8B / Qwen3.5-4B | DeepSeek-R1 / GLM-Z1 |

`toggleableThinking` 字段 MUST 用于区分「可切换思考」与「强制思考」模型：强制思考模型（DeepSeek-R1、GLM-Z1）MUST 设置 `toggleableThinking: false`，可切换思考模型（Qwen3-8B、Qwen3.5-4B）MUST 设置 `toggleableThinking: true`。该字段直接驱动 `chat.post.ts` 是否向硅基流动注入 `enable_thinking` 顶层参数（见模型参数校验 Requirement）。

模型配置 MUST 包含 `toggleableThinking` 字段以区分可切换和强制思考模型，缺失该字段会导致 `chat.post.ts` 错误地向强制思考模型传 `enable_thinking`（GLM-Z1 传了会 400 报错，R1 传了被忽略但属冗余）。

#### Scenario: 强制思考模型不传 enable_thinking

- **WHEN** 请求 model 为 `THUDM/GLM-Z1-9B-0414`（capabilities: `toggleableThinking: false`）
- **THEN** `chat.post.ts` 中 `thinkingOptions` 为 `undefined`
- **AND** `reasoning-provider.ts` 的 `createThinkingFetch` 不会被调用，请求体不包含 `enable_thinking` 字段
- **AND** 模型按其默认行为强制启用思考

#### Scenario: 可切换思考模型按用户开关传 enable_thinking

- **WHEN** 请求 model 为 `Qwen/Qwen3-8B`（capabilities: `toggleableThinking: true`）
- **AND** 请求体 `enable_thinking` 为 `false`
- **THEN** `thinkingOptions = { enableThinking: false }`
- **AND** `reasoning-provider.ts` 的 `createThinkingFetch(false)` 在请求体顶层注入 `enable_thinking: false`
- **AND** 模型按用户选择关闭思考

#### Scenario: 不支持工具调用的模型不注册任何工具

- **WHEN** 请求 model 为 `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B`（capabilities: `toolCalling: false`）
- **THEN** `chat.post.ts` 中 `toolsConfig` 不包含 `webSearch` / `extractTextFromImage` / `recallMemory` / `generateImage` 任一项
- **AND** `streamText` 调用的 `tools` 字段不传入
- **AND** `maxSteps` 为 1（`hasActiveTools = caps.toolCalling && Object.keys(toolsConfig).length > 0` 为 false）

### Requirement: getModelCapabilities 函数默认能力回退

`server/config/models.ts` SHALL 导出 `getModelCapabilities(modelValue: string): ModelCapabilities` 函数。函数内部 SHALL 通过模块内私有常量 `MODEL_CONFIG_MAP = new Map(AVAILABLE_MODELS.map(m => [m.value, m]))` 进行 O(1) 查找。当传入的 `modelValue` 在 `MODEL_CONFIG_MAP` 中未匹配时，函数 MUST 返回默认能力对象 `{ vision: false, deepThinking: false, toggleableThinking: false, toolCalling: true }`（默认信任工具调用，关闭视觉与思考能力，避免对未知模型误传 `enable_thinking` 或误判为视觉模型）。

#### Scenario: 查询白名单内模型返回其配置能力

- **WHEN** 调用 `getModelCapabilities("Qwen/Qwen3.5-4B")`
- **THEN** 返回 `{ vision: true, deepThinking: true, toggleableThinking: true, toolCalling: true }`

#### Scenario: 查询白名单内强制思考模型

- **WHEN** 调用 `getModelCapabilities("THUDM/GLM-Z1-9B-0414")`
- **THEN** 返回 `{ vision: false, deepThinking: true, toggleableThinking: false, toolCalling: false }`

#### Scenario: 查询未知模型回退默认能力

- **WHEN** 调用 `getModelCapabilities("unknown/model-id")`
- **THEN** 返回默认能力 `{ vision: false, deepThinking: false, toggleableThinking: false, toolCalling: true }`
- **AND** 不抛出异常
- **AND** 不向请求注入 `enable_thinking`（因为 `toggleableThinking: false`）

### Requirement: /api/models 接口返回白名单列表

`server/api/models.ts` SHALL 实现 `GET /api/models` 接口，通过 `defineEventHandler` 直接返回 `AVAILABLE_MODELS` 数组（不复制、不脱敏）。返回的 JSON 数组每项 MUST 完整包含 `label`、`value`、`capabilities` 三个字段，前端据此动态渲染模型选择器并计算能力。

`composables/useChatConfig.ts` SHALL 通过 `$fetch<ModelConfig[]>('/api/models')` 在 `onMounted` 内异步加载模型列表，加载成功时覆写 `modelOptions.value`；加载失败时静默降级使用 `FALLBACK_MODELS`（见 FALLBACK_MODELS Requirement），仅 `console.error` 不抛错。

#### Scenario: 前端首次加载模型列表成功

- **WHEN** 客户端 `onMounted` 触发 `loadModels()` 调用
- **AND** `GET /api/models` 返回 200 与 `AVAILABLE_MODELS` JSON 数组
- **THEN** `modelOptions.value` 被覆写为接口返回的数组
- **AND** `currentCapabilities` computed 基于新的 `modelOptions` 重新计算

#### Scenario: 接口加载失败降级使用 FALLBACK_MODELS

- **WHEN** `GET /api/models` 返回非 200 或网络失败
- **THEN** `loadModels()` catch 块仅 `console.error('加载模型列表失败，使用本地 fallback:', err)`
- **AND** `modelOptions.value` 保留 `FALLBACK_MODELS` 初始值，UI 正常渲染

#### Scenario: 接口返回空数组时保留 fallback

- **WHEN** `GET /api/models` 返回 200 但 body 为空数组 `[]`
- **THEN** `loadModels()` 中 `data && data.length > 0` 判断为 false
- **AND** `modelOptions.value` 保留 `FALLBACK_MODELS` 初始值，不覆写为空

### Requirement: 请求 model 参数白名单校验

`server/api/chat.post.ts` SHALL 在 `streamText` 调用前对请求体的 `model` 字段进行白名单校验，使用表达式 `const useModel = ALLOWED_MODEL_VALUES.has(model) ? model : DEFAULT_LLM_MODEL`。其中 `DEFAULT_LLM_MODEL = process.env.LLM_MODEL || 'Qwen/Qwen3-8B'`，即环境变量未配置时回退到 `Qwen/Qwen3-8B`。校验失败时不抛异常、不返回 400，而是静默回退到默认模型，确保前端误传或恶意传值不影响服务可用性。

`useModel` 随后传入 `getModelCapabilities(useModel)` 获取能力对象 `caps`，驱动后续 `enable_thinking` 注入、工具注册、视觉分流等所有分支决策。模型白名单在 `server/config/models.ts`，`chat.post.ts` 通过 `ALLOWED_MODEL_VALUES` 校验，新增模型需同步两处（`AVAILABLE_MODELS` 数组与 `FALLBACK_MODELS`）。

视觉模型 MUST NOT 设置 `temperature` 参数（推理模型不支持），项目当前通过不向 `streamText` 传入 `temperature` 字段实现此约束，依赖 provider 默认值。

#### Scenario: 请求合法 model 时使用该模型

- **WHEN** 请求体 `model` 为 `Qwen/Qwen3.5-4B`（在 `ALLOWED_MODEL_VALUES` 中）
- **THEN** `useModel = "Qwen/Qwen3.5-4B"`
- **AND** `caps = getModelCapabilities("Qwen/Qwen3.5-4B")` 返回视觉能力为 true 的对象
- **AND** `streamText` 使用 `Qwen/Qwen3.5-4B` 模型 ID

#### Scenario: 请求非法 model 时回退默认模型

- **WHEN** 请求体 `model` 为 `"gpt-4"` 或 `"unknown-model"` 或 `null`（不在 `ALLOWED_MODEL_VALUES` 中）
- **THEN** `useModel = DEFAULT_LLM_MODEL`（即 `process.env.LLM_MODEL || 'Qwen/Qwen3-8B'`）
- **AND** 不抛异常、不返回 400，请求继续处理
- **AND** `caps` 为 `Qwen/Qwen3-8B` 的能力 `{ vision: false, deepThinking: true, toggleableThinking: true, toolCalling: true }`

#### Scenario: 环境变量配置 LLM_MODEL 时使用环境变量

- **WHEN** `process.env.LLM_MODEL = "Qwen/Qwen3.5-4B"`
- **AND** 请求体 `model` 为非法值
- **THEN** `useModel = "Qwen/Qwen3.5-4B"`（来自环境变量）

#### Scenario: streamText 不传入 temperature 参数

- **WHEN** 检查 `chat.post.ts` 中 `streamText({ ... })` 调用
- **THEN** 调用参数对象中不存在 `temperature` 字段
- **AND** 视觉模型与推理模型均依赖 provider 默认 temperature

### Requirement: 模型切换时重置工具开关

`composables/useChatConfig.ts` SHALL 通过 `watch(currentModel, () => { ... })` 监听模型切换事件，并在回调中重置以下开关以避免「toggle 开启但工具不可用」的不一致状态：

- `enableThinking.value = currentCapabilities.value.deepThinking`：有思考能力的模型默认开启，无思考能力的模型关闭
- 当 `currentCapabilities.value.toolCalling === false` 时：`enableOcr.value = false` 且 `enableImageGeneration.value = false`（强制关闭，避免 toggle 开启但工具未注册）
- 当 `currentCapabilities.value.toolCalling === true` 时：`enableImageGeneration.value = true`（恢复默认开启，与 `enableWebSearch` 一致，让用户在新会话中能自然语言触发生图）

`watch(currentModel)` 在 `useChatConfig` 中 MUST 重置工具开关，包括 `enableImageGeneration`。该约束确保从 `toolCalling=true` 切换到 `toolCalling=false` 模型再切回时，工具开关状态一致。

#### Scenario: 从工具调用模型切换到非工具调用模型

- **WHEN** 用户当前 model 为 `Qwen/Qwen3-8B`（toolCalling: true），`enableOcr=true`、`enableImageGeneration=true`
- **AND** 用户切换到 `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B`（toolCalling: false）
- **THEN** `watch(currentModel)` 触发回调
- **AND** `enableThinking.value` 被设置为 `true`（R1 仍有 `deepThinking: true`）
- **AND** `enableOcr.value` 被设置为 `false`
- **AND** `enableImageGeneration.value` 被设置为 `false`

#### Scenario: 从非工具调用模型切回工具调用模型

- **WHEN** 用户当前 model 为 `THUDM/GLM-Z1-9B-0414`（toolCalling: false）
- **AND** 用户切换到 `Qwen/Qwen3-8B`（toolCalling: true）
- **THEN** `watch(currentModel)` 触发回调
- **AND** `enableThinking.value` 被设置为 `true`（`deepThinking: true`）
- **AND** `enableImageGeneration.value` 被设置为 `true`（恢复默认开启）
- **AND** `enableOcr.value` 保留原值（回调未显式设置为 true，避免用户主动关闭后被强制重开）

#### Scenario: 切换到无思考能力模型时关闭思考开关

- **WHEN** 用户从 `Qwen/Qwen3-8B`（deepThinking: true）切换到一个 `deepThinking: false` 的模型（如未来新增的纯对话模型）
- **THEN** `enableThinking.value` 被设置为 `false`
- **AND** UI 思考按钮基于 `currentCapabilities.deepThinking` 隐藏，开关状态不产生不一致

### Requirement: FALLBACK_MODELS 确保 SSR 阶段能力判断准确

`composables/useChatConfig.ts` SHALL 定义模块级常量 `FALLBACK_MODELS: ModelConfig[]`，作为 SSR 阶段（`useFetch` / `$fetch` 尚未返回数据时）的回退模型列表。`FALLBACK_MODELS` MUST 与 `server/config/models.ts` 的 `AVAILABLE_MODELS` 完全一致（相同的四项模型、相同的 capabilities 字段），确保 SSR 阶段 `currentCapabilities` computed 计算结果与客户端 hydration 后一致，避免水合不匹配。

`useChatConfig` 中 `modelOptions = ref<ModelConfig[]>(FALLBACK_MODELS)` 作为初始值，`onMounted` 内的 `loadModels()` 异步加载成功后才覆写。若 `FALLBACK_MODELS` 与 `AVAILABLE_MODELS` 不一致，SSR 阶段 `currentCapabilities` 会基于错误的能力对象渲染 UI（如误判视觉模型为非视觉），导致 `v-if` 控制的按钮在 hydration 后跳变。

#### Scenario: SSR 阶段使用 FALLBACK_MODELS 渲染

- **WHEN** Nuxt SSR 渲染 `ai-chat.vue` 时调用 `useChatConfig()`
- **AND** `onMounted` 尚未执行（`loadModels` 未发起）
- **THEN** `modelOptions.value` 为 `FALLBACK_MODELS`
- **AND** `currentCapabilities` 基于当前 `currentModel` 在 `FALLBACK_MODELS` 中查找
- **AND** SSR 渲染的工具按钮可见性与 hydration 后一致

#### Scenario: FALLBACK_MODELS 与 AVAILABLE_MODELS 字段一一对应

- **WHEN** 对比 `composables/useChatConfig.ts` 的 `FALLBACK_MODELS` 与 `server/config/models.ts` 的 `AVAILABLE_MODELS`
- **THEN** 两者数组长度相同（均为 4）
- **AND** 每一项的 `label` / `value` / `capabilities` 字段完全一致
- **AND** 包含 `Qwen/Qwen3.5-4B` 项（缺失会导致该模型 SSR 阶段走默认 capabilities，属脆弱的隐式行为）

#### Scenario: 新增模型未同步 FALLBACK_MODELS 时 SSR 不准确

- **WHEN** 维护者在 `AVAILABLE_MODELS` 新增模型 `Foo/Bar-7B`（vision: true）
- **AND** 未在 `FALLBACK_MODELS` 同步新增
- **AND** 用户在 SSR 阶段 `currentModel` 为 `Foo/Bar-7B`
- **THEN** `currentCapabilities` 走默认能力回退（vision: false）
- **AND** SSR 渲染时图片上传按钮不可见，hydration 后 `loadModels` 完成覆写，按钮突然可见，产生水合不匹配警告

### Requirement: 能力系统驱动 UI 按钮可见性

`composables/useChatConfig.ts` SHALL 通过 `currentCapabilities` computed（基于 `modelOptions.value.find(opt => opt.value === currentModel.value)?.capabilities ?? 默认能力`）派生三个 UI 可见性 computed：

- `supportsVision = computed(() => currentCapabilities.value.vision)`：控制图片上传按钮可见性。视觉模型（`vision: true`）显示图片上传入口；非视觉模型隐藏，图片只能通过 OCR 工具间接处理（图片 URL 以文本引用形式注入最后一条用户消息）
- `currentSupportsOcr = computed(() => currentCapabilities.value.toolCalling)`：控制 OCR 按钮可见性。仅 `toolCalling: true` 的模型（Qwen3-8B / Qwen3.5-4B）显示，强制思考模型（GLM-Z1 / R1）隐藏
- `currentCapabilities.value.deepThinking`：控制思考按钮可见性。有思考能力的模型显示思考开关，无思考能力的模型隐藏

工具开关按钮（联网搜索、生图）的可见性同样基于 `currentCapabilities.value.toolCalling`，前端组件 SHOULD 通过 `v-if="currentSupportsOcr"` 或等效判断条件渲染，并在 `chat.post.ts` 服务端通过 `caps.toolCalling &&` 守卫工具注册，形成前后端双重防御。

#### Scenario: 视觉模型显示图片上传按钮

- **WHEN** `currentModel` 为 `Qwen/Qwen3.5-4B`（vision: true）
- **THEN** `supportsVision.value` 为 `true`
- **AND** 图片上传按钮在 UI 中渲染
- **AND** 用户上传图片后，`chat.post.ts` 中 `caps.vision` 为 true，图片作为多模态 parts 传入 LLM

#### Scenario: 非视觉模型隐藏图片上传按钮

- **WHEN** `currentModel` 为 `Qwen/Qwen3-8B`（vision: false）
- **THEN** `supportsVision.value` 为 `false`
- **AND** 图片上传按钮在 UI 中不渲染
- **AND** 即使用户通过其他方式提交图片，`chat.post.ts` 也会将图片 URL 以文本引用形式注入最后一条用户消息

#### Scenario: 强制思考模型隐藏 OCR 与工具开关

- **WHEN** `currentModel` 为 `THUDM/GLM-Z1-9B-0414`（toolCalling: false）
- **THEN** `currentSupportsOcr.value` 为 `false`
- **AND** OCR 按钮在 UI 中不渲染
- **AND** 联网搜索、生图等工具开关按钮在 UI 中不渲染
- **AND** `chat.post.ts` 中 `toolsConfig` 不包含任何工具，`streamText` 不传入 `tools` 字段

#### Scenario: 可切换思考模型显示思考按钮且默认开启

- **WHEN** `currentModel` 为 `Qwen/Qwen3-8B`（deepThinking: true, toggleableThinking: true）
- **THEN** 思考按钮在 UI 中渲染
- **AND** `enableThinking.value` 默认为 `true`
- **AND** 用户可点击切换 `enableThinking`，切换后请求体 `enable_thinking` 字段相应变化
