## Context

项目当前在 `server/tools/` 维护两类工具：① `web-search.ts`（直接 AI SDK tool）；② `server/mcp/weather-server.ts`（MCP stdio 传输）。`chat.post.ts` 在 `caps.toolCalling=true` 时把 `webSearchTool` + weather MCP tools 注册到 `streamText({ tools })`。

`useChatConfig.ts` 暴露 `enableThinking` / `enableWebSearch` 两个 ref 控制 toggle 开关，`ChatInput.vue` 渲染「思考」「联网」两个 toggle 按钮，用户主动开启后通过 `body` 透传到 `/api/chat`。

实测 PaddleOCR API 关键约束：
- 多图 400 报错（错误码 20015），必须单图
- 空 prompt 触发 raw token 输出（`<|LOC_54|>` 这种带坐标的原始 token），必须明确 OCR 指令
- `enable_thinking=false` 让输出降级为纯文本，绝不能传 false
- `enable_thinking=true` 不报错但被忽略
- 纯文本无图调用返回无意义内容（如「知」）

工具调用集成模式已确定：
- PaddleOCR 不在 `AVAILABLE_MODELS` 中暴露，完全隐入后端
- 前端只暴露「OCR」toggle 按钮，与「思考」「联网」按钮同行
- LLM 在用户上传图片且需要 OCR 时自主调用 OCR 工具
- 工具返回 Markdown 文本，LLM 拿到后总结输出给用户

## Goals / Non-Goals

**Goals:**

- PaddleOCR 作为 AI SDK tool 集成到 `server/tools/ocr-document.ts`，与 `webSearchTool` 同模式
- 前端「OCR」toggle 按钮与「思考」「联网」按钮同行，仅 `toolCalling=true` 模型显示
- OCR toggle 开启时，system prompt 追加 OCR 工具使用规则，强化 LLM 调用判断
- LLM 自主决策是否调用 OCR 工具（用户上传图片 + 涉及 OCR 场景时调用）
- 工具内部处理 PaddleOCR API 限制（单图、明确 prompt、不传 enable_thinking）
- 复用现有 ImgBB 上传流程：图片先上传 ImgBB 拿 URL
  - 视觉模型（vision=true）：URL 作为多模态消息传 LLM，LLM 既直接看到图片，又可把 URL 传给 OCR 工具
  - 非视觉模型（vision=false）：OCR 开启时允许上传图片，图片 URL 以文本形式注入最后一条用户消息（如 `[图片1: URL]`），LLM 通过 URL 调 OCR 工具获取文字
- **关键修复**：调整 `maxSteps` 逻辑——当有工具实际注册时（web 搜索或 OCR 开启 + toolCalling=true），`maxSteps=5` 允许多步工具调用循环；无工具时保持 `maxSteps=1`（纯对话/纯视觉/纯推理）

**Non-Goals:**

- 不在模型选择器中暴露 PaddleOCR（PaddleOCR 完全隐入后端）
- 不实现「OCR 输出可视化叠加」（在原图上画异形框 + 印章位置）
- 不修改 `AVAILABLE_MODELS`、`ModelCapabilities`、`ModelConfig` 任何字段
- 不修改数据库 schema：OCR 工具调用结果作为 assistant 消息 content 存储
- 不修改 Markdown 渲染管线
- 不限制用户上传图片数量（OCR 工具内部按单图处理，LLM 自主决定是否对每张图调用）
- 不为 OCR 工具添加 MCP server 封装（首期直接用 AI SDK tool）

## Decisions

### Decision 1: OCR 工具作为 AI SDK tool（不通过 MCP）

**选择**：在 `server/tools/ocr-document.ts` 用 `tool()` 定义 `ocrDocumentTool`，与 `webSearchTool` 同模式，直接在 `chat.post.ts` 注册。

**备选方案**：
- **A. 作为独立 MCP server（`server/mcp/ocr-server.ts`）**：与 weather MCP 一致，独立进程可复用。被否决，因为：① 每次对话启动子进程有开销（weather MCP 已证实启动慢）；② OCR 工具无外部状态共享需求，不需要独立进程；③ MCP 增加抽象层但无收益。
- **B. 作为独立 API 路由（`server/api/ocr.post.ts`）**：前端直接调。被否决，因为破坏「LLM 自主调用」的初衷，且无法复用 streamText 的 tool calling 流程。

**理由**：
- 与 `webSearchTool` 完全同模式，代码风格一致
- 直接注册到 `streamText({ tools })`，AI SDK 自动处理工具调用生命周期
- 无需新增子进程或独立路由
- `chat.post.ts` 已有 `caps.toolCalling` 分支，注册逻辑简单扩展

### Decision 2: 工具接收图片通过 URL（不通过 base64），视觉/非视觉模型分流处理

**选择**：工具的 `inputSchema` 只接受 `imageUrl: string`（公网 URL）。图片先上传 ImgBB 获取公网 URL，然后根据模型能力分流：

- **视觉模型（caps.vision=true，如 Qwen3.5-4B）**：URL 作为多模态 content parts（`{ type: 'image', image: new URL(url) }`）传给 LLM，LLM 既直接看到图片内容（视觉理解），又可把 URL 传给 OCR 工具进行精确文字提取。
- **非视觉模型（caps.vision=false，如 Qwen3-8B）**：不能传多模态图片 parts（会报错），改为将图片 URL 以文本引用形式注入最后一条用户消息（如 `\n\n[附图片1: https://...]`），LLM 看到 URL 文本后可以在需要时调用 OCR 工具提取文字。

**备选方案**：
- **A. 直接传 base64 给 LLM，让 LLM 把 base64 放进 tool call 参数**：不现实，5MB base64 字符串会让 LLM 上下文爆炸，且模型不会复制如此长的字符串。
- **B. 图片不经过 LLM，前端把图片 ID 与对话上下文一起传，工具通过 ID 取图**：破坏 streamText 标准流程，LLM 看不到图片无法判断是否需要 OCR。
- **C. OCR 按钮只在视觉模型上显示**：被否决，因为这样 Qwen3-8B（通用模型 toolCalling=true）无法使用 OCR，违背"通用模型也能 OCR"的目标。

**理由**：
- 项目已有 ImgBB 上传流程（`chat.post.ts` 中的 `uploadToImgBb`），图片原本就会上传得到 URL
- URL 字符串短，不占 LLM 上下文
- 视觉模型直接看图 + OCR 工具双重能力：快速理解图片内容，需要精确文字时调 OCR
- 非视觉模型通过 URL 文本引用知道有图片，调 OCR 工具获取文字后再回答
- 工具内部 fetch URL → base64 是标准做法

**数据流（视觉模型 Qwen3.5-4B）**：
```
ChatInput.vue      chat.post.ts         LLM          ocrDocumentTool
     │                  │                │              │
     │ 上传图           │                │              │
     │ ───────────────▶ │                │              │
     │                  │ 上传 ImgBB     │              │
     │                  │ → URL          │              │
     │                  │ 把 URL 作为    │              │
     │                  │ 多模态图片part │              │
     │                  │ 传给 LLM       │              │
     │                  │ ─────────────▶ │ 看到图片内容 │
     │                  │                │ 决定调工具   │
     │                  │                │ 传 URL 参数   │
     │                  │                │ ────────────▶│
     │                  │                │              │ fetch URL→base64
     │                  │                │              │ → 调 PaddleOCR
     │                  │                │              │ → 返回 Markdown
     │                  │                │ ◀────────────│
     │                  │                │ 综合视觉理解 │
     │                  │                │ +OCR结果回答 │
```

**数据流（非视觉模型 Qwen3-8B）**：
```
ChatInput.vue      chat.post.ts         LLM          ocrDocumentTool
     │                  │                │              │
     │ 上传图(需OCR开启)│                │              │
     │ ───────────────▶ │                │              │
     │                  │ 上传 ImgBB     │              │
     │                  │ → URL          │              │
     │                  │ 注入文本引用   │              │
     │                  │ "[图片1:URL]"  │              │
     │                  │ ─────────────▶ │ 知道有图片   │
     │                  │                │ (但看不到内容)│
     │                  │                │ 调 OCR 工具  │
     │                  │                │ 传 URL 参数   │
     │                  │                │ ────────────▶│
     │                  │                │              │ fetch URL→base64
     │                  │                │              │ → 调 PaddleOCR
     │                  │                │              │ → 返回 Markdown
     │                  │                │ ◀────────────│
     │                  │                │ 基于OCR结果  │
     │                  │                │ 组织回答     │
```

### Decision 3: OCR toggle 默认关闭，开启后 LLM 自主判断

**选择**：`enableOcr` ref 默认 `false`，用户主动开启。开启后 system prompt 追加 OCR 工具使用规则，但 LLM 仍有最终决策权（不强制调用）。

**备选方案**：
- **A. 默认开启**：被否决，因为通用图像理解（「图中是什么」）不需要 OCR，误触发会多一次工具调用延迟。
- **B. 开启后强制调用**：被否决，便失了通用图像理解能力。
- **C. 开启后弹选择让用户决定**：被否决，多一次交互。

**理由**：
- 默认关闭避免误触发
- LLM 自主判断让用户不需要理解工具调用细节
- system prompt 强化规则确保 LLM 在正确场景调用

### Decision 4: OCR toggle 按钮显示条件按 toolCalling 判断，图片上传按钮联动 OCR 开关

**选择**：
- OCR 按钮 `v-if="currentCapabilities.toolCalling"`。Qwen3-8B / Qwen3.5-4B 显示，GLM-Z1 / R1 隐藏。
- 图片上传按钮显示条件从 `supportsVision` 改为 `supportsVision || enableOcr`：
  - 视觉模型：始终允许上传（现有行为不变）
  - 非视觉模型：只有 OCR 开启时才允许上传（图片通过 OCR 工具间接处理）
  - 非视觉模型 + OCR 关闭：隐藏上传按钮（现有行为不变）

**备选方案**：
- **A. 跟联网按钮一致 `v-if="!currentCapabilities.vision"`**：被否决，因为 Qwen3.5-4B（vision=true, toolCalling=true）下看不到 OCR 按钮，但用户可能想用 Qwen3.5-4B 调 OCR。
- **B. 永远显示，不支持时 disabled**：被否决，UI 拥挤，与「OCR 工具只在 toolCalling 模型上注册」决策不一致。
- **C. 非视觉模型始终不允许上传图片**：被否决，Qwen3-8B 就无法使用 OCR 功能，形同虚设。

**理由**：
- OCR 按钮显示与「OCR 工具只在 `caps.toolCalling=true` 时注册」决策完全对齐
- 图片上传按钮联动 OCR 开关，确保非视觉模型在 OCR 关闭时不会出现"上传了图片但模型看不到、也不会调 OCR"的死胡同
- UI 行为可预测：用户看到上传按钮 = 图片能被处理

### Decision 5: 工具内部硬编码 OCR 系统 prompt

**选择**：`ocrDocumentTool` 的 `execute` 函数内部构造完整的 OCR 指令作为 user message 传给 PaddleOCR API，不让 LLM 决定 prompt 内容。

**OCR 指令内容**：
```
请提取图片中的文字，按结构化 Markdown 输出：
- 标题用 ## / ###
- 表格用 Markdown 表格语法（| 列 | 列 | + --- 分隔行）
- 印章用「印章：内容」标记
- 公式用 LaTeX 包裹
- 保持原文版面结构
```

**备选方案**：
- **A. 让 LLM 自由构造 OCR 指令**：被否决，实测空 prompt 触发 raw token 输出，LLM 生成的 prompt 可能不够明确。
- **B. 把 LLM 的用户输入作为附加指令拼接到 OCR 指令后**：可行但复杂，首期先固定 prompt，后续可考虑支持附加指令。

**理由**：实测证明明确 OCR 指令能稳定输出 Markdown，固定 prompt 保证一致性。

### Decision 6: 工具内部 URL 可达性校验

**选择**：`ocrDocumentTool.execute` 在 fetch 图片 URL 失败时返回结构化错误信息（不抛异常），让 LLM 处理错误。

**错误返回格式**：
```typescript
{
  error: '图片下载失败',
  detail: 'HTTP 404',
  imageUrl: 'http://...'
}
```

**理由**：
- LLM hallucinate URL 时工具会失败，返回错误让 LLM 告诉用户「请上传有效图片」
- 不抛异常避免 streamText 中断
- 与 `webSearchTool` 的错误处理模式一致（[web-search.ts#L69-L77](file:///d:/code/codeWork/my-chat/server/tools/web-search.ts#L69-L77)）

### Decision 7: 服务端 prompt 强化规则

**选择**：OCR toggle 开启时，`finalSystemPrompt` 追加 OCR 工具使用规则。

**追加内容**：
```
【OCR 工具使用规则】
当用户上传图片且问题涉及以下场景时，调用 extractTextFromImage 工具提取文字：
- "提取文字"、"OCR"、"识别"、"转文字"
- "表格转 Markdown"、"文档结构化"
- "印章"、"签名"、"手写"
- 图片是文档、扫描件、发票、合同、表单等

不要在以下场景调用此工具：
- 通用图像理解（"图中是什么"、"描述图片"）
- 用户未上传图片
- 图片是普通照片、人物、风景等
```

**理由**：
- 明确正负向场景，减少 LLM 误判
- 「无图片禁止调用」防止 hallucinate URL
- 与 webSearch 的 TIME_KEYWORDS 模式一致

### Decision 8: 重构 maxSteps 逻辑以支持视觉模型的工具调用

**问题**：[chat.post.ts#L231](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L231) 当前逻辑 `const maxSteps = caps.vision || caps.deepThinking ? 1 : 5` 导致视觉模型（Qwen3.5-4B，vision=true）和深度思考模型（Qwen3-8B，deepThinking=true）的 `maxSteps=1`，工具调用无法完成多步循环（LLM 调工具后无法基于工具结果生成最终回答）。

**选择**：将 maxSteps 计算改为基于「是否有工具实际注册」而非模型能力：

```typescript
// 先构建 toolsConfig（包含 MCP tools + webSearch + ocrDocumentTool）
const toolsConfig: Record<string, any> = {
  ...mcpTools,
  ...(webSearchEnabled && caps.toolCalling && { webSearch: webSearchTool }),
  ...(enableOcr && caps.toolCalling && { extractTextFromImage: ocrDocumentTool })
}

// 有工具注册时允许多步（工具调用需要 LLM→工具→LLM 至少 2 步）
// 无工具时保持单步（纯对话/纯视觉/纯推理无需多步）
const hasActiveTools = caps.toolCalling && Object.keys(toolsConfig).length > 0
const maxSteps = hasActiveTools ? 5 : 1
```

**同时调整**：视觉模型的 webSearch prompt 注入条件从 `!caps.vision` 改为 `caps.toolCalling`（视觉模型启用工具后也应允许 web 搜索提示）。

**理由**：
- 工具调用（无论 web 搜索还是 OCR）本质需要多步：LLM 调用→工具执行→LLM 总结结果
- maxSteps=1 时工具调用是"死的"：工具执行了但 LLM 看不到结果
- 无工具时 maxSteps=1 保持现有行为（纯视觉对话、纯推理对话不走多步）
- Qwen3-8B（deepThinking=true, toolCalling=true）启用工具后 maxSteps=5 也解决了 web 搜索在思考模型上同样可能失效的问题
- 强制思考模型（R1/GLM-Z1，toolCalling=false）不受影响，因为不会注册任何工具，maxSteps=1 保持不变

## Risks / Trade-offs

- **[风险] LLM 误判调用 OCR 工具**（hallucinate URL）→ 工具内部 URL 可达性校验 + 错误返回格式让 LLM 处理失败。
- **[风险] LLM 在通用图像理解时误调 OCR** → system prompt 明确「不要在通用图像理解时调用」+ 给出负向场景示例。
- **[风险] OCR toggle 开启但用户上传普通照片** → LLM 应基于 prompt 规则不调用，但仍有误判可能。**缓解**：prompt 中明确「普通照片、人物、风景」不要调用。
- **[取舍] 多步骤延迟**（LLM 判断 + 工具调用 + 二次总结，2-3 倍延迟）→ 工具调用模式的固有成本，用户期望工具调用结果更准确时可接受。
- **[取舍] token 成本高**（工具描述 + 调用结果都占上下文）→ OCR 输出 Markdown 文本相对紧凑，单次调用约 1000 tokens，可接受。
- **[取舍] 不支持多图 OCR**（工具单次只处理 1 张图）→ LLM 可对多图分别调用工具（每次调一张），但延迟更高。首期不限制，让 LLM 自主决定。
- **[风险] 工具调用失败时用户体验** → LLM 应基于错误返回信息告知用户「OCR 失败，请重试」或「请上传有效图片」。

## UI 适配方案

### 手机端（默认，无 `sm:` 前缀）

| 元素 | 适配 |
|---|---|
| OCR toggle 按钮 | 与「思考」「联网」按钮同行，`min-h-[32px]`（保持现有触摸目标），`active:scale-95` 点击反馈 |
| 按钮文案 | 「OCR」短文案，避免手机端拥挤 |
| 按钮顺序 | [思考] [联网] [OCR] 字符计数，OCR 在联网后面 |
| 换行 | 现有 `flex-wrap` 自动换行，手机端窄屏时 OCR 按钮可能换到第二行 |

### 平板端（`sm:` 前缀）

- 按钮恢复 `sm:min-w-0 sm:min-h-0`，与现有「思考」「联网」按钮一致

## SSR 水合考虑

- `enableOcr` ref 初始值 `false`，SSR 与客户端一致，无水合风险
- `currentSupportsOcr` computed 依赖 `modelOptions`（初始 `FALLBACK_MODELS`，客户端 `onMounted` 后 `loadModels()` 更新），computed 重算时 UI 更新，无水合不匹配
- OCR toggle 按钮的 `v-if` 在 SSR 阶段基于 `FALLBACK_MODELS` 判断
  - **需要修复**：当前 `FALLBACK_MODELS` 仅包含 3 个模型（Qwen3-8B、DeepSeek-R1、GLM-Z1），缺少 Qwen3.5-4B。SSR 时 Qwen3.5-4B 会走默认 capabilities `{ toolCalling: true }`，碰巧 OCR 按钮能显示，但这是脆弱的隐式行为。
  - **修复方案**：在 `FALLBACK_MODELS` 中补充 Qwen3.5-4B 的配置：`{ label: 'Qwen3.5-4B', value: 'Qwen/Qwen3.5-4B', capabilities: { vision: true, deepThinking: false, toggleableThinking: false, toolCalling: true } }`
  - 补充后 SSR 默认模型（LLM_MODEL 环境变量或 Qwen3-8B）的 capabilities 判断在 SSR 和客户端完全一致
- 图片上传按钮显示条件改为 `supportsVision || enableOcr`：
  - SSR 时 `enableOcr=false`，所以只有 `supportsVision` 生效，行为与现有一致
  - 客户端 `onMounted` 后 `enableOcr` 变化时按钮显示/隐藏，无水合问题

## API 参数校验与错误处理

### 请求 body 新增字段

```
enable_ocr?: boolean  // 是否开启 OCR 工具，默认 false
```

### 服务端校验

- `enable_ocr` 解析：`const enableOcr = enable_ocr === true`（非严格 `true` 值一律按 `false` 处理，默认 `false`）
- `enable_ocr === true` 但 `caps.toolCalling === false` 时：不注册 OCR 工具，正常处理（前端应已隐藏 OCR 按钮，此处是防御性兜底）
- `enableOcr === true` 且 `caps.vision === false`（非视觉模型）且有图片上传时：将图片 URL 以文本引用形式注入最后一条用户消息，而非作为多模态 content parts

### 工具内部错误处理

- 图片 URL 下载失败：返回 `{ error: '图片下载失败', detail, imageUrl }`
- PaddleOCR API 调用失败：返回 `{ error: 'OCR 服务调用失败', detail, imageUrl }`
- PaddleOCR 返回 raw token（空 prompt 触发）：工具内部已固定 prompt，不应出现；若出现则返回 `{ error: 'OCR 输出异常', rawOutput }`

## Migration Plan

1. 新建 `server/tools/ocr-document.ts`：定义 `ocrDocumentTool`
2. 修改 `server/api/chat.post.ts`：注册 OCR 工具 + OCR prompt 强化
3. 修改 `composables/useChatConfig.ts`：新增 `enableOcr` + `currentSupportsOcr`
4. 修改 `components/chat/ChatInput.vue`：新增 OCR toggle 按钮
5. 修改 `pages/ai-chat.vue`：透传 props + body 字段
6. 新增单测 + E2E 测试
7. 同步更新 `docs/API.md`

**回滚策略**：所有改动都是增量式（新增工具文件、新增 toggle 按钮、新增 prompt 追加分支），不修改现有行为。回滚只需 revert commit，无数据库迁移、无配置文件格式变更。

## Open Questions

- `[待观察]` LLM 在实际使用中是否能准确判断何时调用 OCR 工具？需在真实对话中观察，必要时调整 prompt 规则。
- `[待观察]` LLM 是否会对多图分别调用 OCR 工具？首期不限制，观察实际行为。
- `[后续增强]` 是否需要为 OCR 工具调用结果显示特殊样式（如「OCR 结果」卡片）？首期直接作为 LLM 回复的一部分渲染。
- `[后续增强]` 是否需要让用户在工具调用过程中看到「正在 OCR 提取...」状态？现有 ToolInvocation 组件已支持工具调用状态展示，可能无需额外改动。
