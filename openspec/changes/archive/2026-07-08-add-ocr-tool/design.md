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

**PaddleOCR API 集成方式**：

| 项 | 选择 | 依据 |
|---|---|---|
| **API 端点** | `https://api.siliconflow.cn/v1/chat/completions`（与 LLM 共享） | [reasoning-provider.ts#L183](file:///d:/code/codeWork/my-chat/server/utils/reasoning-provider.ts#L183) 已用此端点；PaddleOCR-VL-1.5 是 chat 模型（接收 messages + image），用 `chat/completions` 端点 |
| **API Key** | **复用 `OPENAI_API_KEY` 环境变量** | 硅基流动统一 Key，LLM 和 PaddleOCR 用同一 Key；不新增 `PADDLEOCR_API_KEY` 减少配置项 |
| **baseURL 来源** | 复用 `process.env.OPENAI_BASE_URL`（[reasoning-provider.ts#L184](file:///d:/code/codeWork/my-chat/server/utils/reasoning-provider.ts#L184)） | 与 LLM 调用保持一致，用户改 baseURL 时 OCR 跟随切换 Provider |
| **HTTP 库** | **Node 20+ 全局 `fetch`**（与 web-search.ts 一致） | 之前 task 1.3 写的"用 `https` 模块"是错的，已统一 |
| **请求超时** | 30 秒（OCR 推理比纯文本慢） | 单独 `AbortController` 控制 |
| **请求体** | `{ model: 'PaddlePaddle/PaddleOCR-VL-1.5', messages: [...], stream: false, temperature: 0, max_tokens: 4096 }`，**不传 `enable_thinking`** | 实测 `enable_thinking=false` 会让输出降级（见 proposal.md） |
| **响应处理** | 提取 `choices[0].message.content` 字符串（Markdown 文本） | 工具 `output` 字段保存为 `{ text, imageUrl, model }` 格式 |
| **错误处理** | 与 web-search 一致：返回 `{ error, detail, imageUrl }` 不抛异常 | 工具失败时 LLM 能看到错误信息并继续对话 |

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

- **视觉模型（caps.vision=true，如 `Qwen/Qwen3.5-4B`）**：URL 作为多模态 content parts 传给 LLM。AI SDK v5 中图片 part 的 `image` 字段支持 URL 字符串或 base64 字符串（`{ type: 'image', image: url, mimeType }` 或 `{ type: 'image', image: new URL(url) }`），因此：
  - 公网 URL：直接用 URL 字符串
  - ImgBB 降级 dataURL：通过 `parseBase64Meta` 提取 base64 字符串和 mimeType 后传入 `image` 字段（`{ type: 'image', image: base64String, mimeType }`）
  - LLM 既直接看到图片内容（视觉理解），又可把 URL 传给 OCR 工具进行精确文字提取
- **非视觉模型（caps.vision=false，如 `Qwen/Qwen3-8B`）**：不能传多模态图片 parts（会报错），改为将图片 URL 以文本引用形式注入最后一条用户消息（如 `\n\n[附图片1: https://...]`），LLM 看到 URL 文本后可以在需要时调用 OCR 工具提取文字。

**关键发现**：[chat.post.ts#L198-L216](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L198-L216) **当前代码完全没区分视觉/非视觉模型**——line 204-214 给所有模型都 push `{type:'image'}` parts。需要新增 `if (caps.vision)` 守卫。

**关键发现**：[chat.post.ts#L172-L180](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L172-L180) ImgBB 失败时会降级用 `data:` 开头的 base64 dataURL 填入 `imageUrls` 数组。需要增加边界处理：
- 视觉模型：line 204-214 已有 `if (url.startsWith('data:'))` 处理（`parseBase64Meta` 转 base64）→ OK
- 非视觉模型：dataURL 不能被 OCR 工具 fetch（不是合法 URL）。需要在 chat.post.ts 增加处理：检测到 dataURL 时给 LLM 明确提示「图片上传失败，OCR 不可用」并跳过 OCR 工具调用（或者静默删除该图片引用，仅保留成功上传的公网 URL）

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
- 边界情况（ImgBB 失败 → dataURL）必须防御性处理，否则 LLM 会传 `data:image/png;base64,xxx` 给 OCR 工具，工具 fetch 失败导致体验降级

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
     │                  │ "[附图片1: URL]" │              │
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
- 图片上传按钮涉及 **3 个相关属性**（label class/tooltip/disabled/点击行为），**全部需要联动 OCR 开关**：
  - `<label>` 的 `:class` 数组第一个条件从 `supportsVision ? 'text-semi-text-3 hover:text-semi-text-2 cursor-pointer' : 'text-semi-border cursor-not-allowed'` 改为 `canUploadImage ? 'text-semi-text-3 hover:text-semi-text-2 cursor-pointer' : 'text-semi-border cursor-not-allowed'`
  - `<label>` 的 `:class` 数组第二个条件从 `images.length > 0 && supportsVision ? 'text-semi-primary' : ''` 改为 `images.length > 0 && canUploadImage ? 'text-semi-primary' : ''`（图片上传后图标变色也需联动）
  - `<label>` 的 `v-tooltip` 从 `supportsVision ? '添加图片' : '当前模型不支持图片'` 改为 `canUploadImage ? '添加图片' : '当前模型不支持图片，请先开启 OCR 工具'`
  - `<input type="file">` 的 `:disabled` 从 `!supportsVision || images.length >= MAX_IMAGES` 改为 `!canUploadImage || images.length >= MAX_IMAGES`
  - **新增 `canUploadImage` computed**：`const canUploadImage = computed(() => supportsVision || enableOcr)`
    - 视觉模型：始终允许上传（现有行为不变）
    - 非视觉模型：只有 OCR 开启时才允许上传（图片通过 OCR 工具间接处理）
    - 非视觉模型 + OCR 关闭：隐藏上传按钮（现有行为不变，cursor-not-allowed + tooltip 提示）

**备选方案**：
- **A. 跟联网按钮一致 `v-if="!currentCapabilities.vision"`**：被否决，因为 Qwen3.5-4B（vision=true, toolCalling=true）下看不到 OCR 按钮，但用户可能想用 Qwen3.5-4B 调 OCR。
- **B. 永远显示，不支持时 disabled**：被否决，UI 拥挤，与「OCR 工具只在 toolCalling 模型上注册」决策不一致。
- **C. 非视觉模型始终不允许上传图片**：被否决，Qwen3-8B 就无法使用 OCR 功能，形同虚设。

**理由**：
- OCR 按钮显示与「OCR 工具只在 `caps.toolCalling=true` 时注册」决策完全对齐
- 图片上传按钮联动 OCR 开关，确保非视觉模型在 OCR 关闭时不会出现"上传了图片但模型看不到、也不会调 OCR"的死胡同
- UI 行为可预测：用户看到可点击的上传按钮（cursor-pointer）= 图片能被处理
- tooltip 明确告知用户"开启 OCR 后可以上传图片"，避免误以为功能不可用

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

重要提示：
- 当用户上传图片时，会以两种形式之一出现在对话中：
  1. 多模态消息 parts（视觉模型可见）
  2. `[附图片N: URL]` 格式的文本引用（非视觉模型可见）
- 无论哪种形式，只要用户上传了图片，都表示存在待识别的图片。
- 对于非视觉模型：你只能通过 `[附图片N: URL]` 文本引用知道用户上传了图片。当消息中包含 `[附图片N: URL]` 时，你应使用 extractTextFromImage 工具提取图片中的文字，先调用工具获取文字，再基于文字内容回答用户的问题。
- 对于视觉模型：你看到的是多模态消息 parts，同样可以调用 extractTextFromImage 工具获取更精确的文字内容（尤其是表格、公式、印章、手写等需要高精度文字提取的场景）。

不要在以下场景调用此工具：
- 通用图像理解（"图中是什么"、"描述图片"）
- 用户未上传图片（既无多模态 parts，也无 [附图片N: URL] 文本引用）
- 图片是普通照片、人物、风景等
- 你已经成功获取了图片文字，不要重复调用同一图片
```

**理由**：
- 明确正负向场景，减少 LLM 误判
- 「无图片禁止调用」防止 hallucinate URL
- 与 webSearch 的 TIME_KEYWORDS 模式一致

### Decision 8: 重构 maxSteps 逻辑以支持视觉/思考模型的工具调用

**问题**：[chat.post.ts#L231](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L231) 当前逻辑 `const maxSteps = caps.vision || caps.deepThinking ? 1 : 5` 导致**所有主流工具调用模型**的 `maxSteps=1`，工具调用无法完成多步循环（LLM 调工具后无法基于工具结果生成最终回答）：

| 模型 | caps.vision | caps.deepThinking | 当前 maxSteps | 实际影响 |
|---|---|---|---|---|
| `Qwen/Qwen3-8B` | false | true | **1** | web 搜索 + OCR 工具调用全部失效 |
| `Qwen/Qwen3.5-4B` | true | true | **1** | web 搜索 + OCR 工具调用全部失效 |
| `THUDM/GLM-Z1-9B-0414` | false | true | 1 | toolCalling=false，本就不注册工具（不变） |
| `deepseek-ai/DeepSeek-R1-0528-Qwen3-8B` | false | true | 1 | toolCalling=false，本就不注册工具（不变） |

**选择**：将 maxSteps 计算改为基于「是否有工具实际注册」而非模型能力：

```typescript
// 在 streamText 调用前，先构建 toolsConfig（替换原来的 line 231-232）
// 删除：const maxSteps = caps.vision || caps.deepThinking ? 1 : 5
// 删除：const stopWhen = stepCountIs(maxSteps)
// 替换为：
const hasActiveTools = caps.toolCalling && Object.keys(toolsConfig).length > 0
const stopWhen = stepCountIs(hasActiveTools ? 5 : 1)
```

**同时调整**：server 端的 webSearch prompt 注入条件从 `!caps.vision` 改为 `caps.toolCalling`（视觉模型启用工具后也应允许 web 搜索提示词注入到 system prompt，**前端按钮 v-if 保持 `!caps.vision` 不变**——这是刻意的产品决策：视觉模型用户主要用视觉能力，联网按钮不显示；但后端能力开放，视觉模型在后台仍可调用 webSearch 工具）。

**产品决策说明（Qwen3.5-4B 视觉模型的按钮策略）**：
- **OCR 按钮**：显示（`v-if="currentCapabilities.toolCalling"`），因为 Qwen3.5-4B 既支持工具调用又具备视觉能力，用户可能需要高精度 OCR（表格/印章/手写）。
- **联网按钮**：隐藏（`v-if="!currentCapabilities.vision"`），视觉模型对话以图像理解为主，联网入口保持精简。
- **后端能力**：两者都注册为工具并注入 prompt，只要用户打开对应开关（OCR 显式开启），视觉模型可以在后台调用 webSearch/OCR。
- 这种「后端能力开放、前端入口精简」的不对称是**有意为之**，避免实现者误以为是 bug。

**理由**：
- 工具调用（无论 web 搜索还是 OCR）本质需要多步：LLM 调用→工具执行→LLM 总结结果
- maxSteps=1 时工具调用是"死的"：工具执行了但 LLM 看不到结果
- 无工具时 maxSteps=1 保持现有行为（纯视觉对话、纯推理对话不走多步）
- Qwen3-8B（deepThinking=true, toolCalling=true）启用工具后 maxSteps=5 **顺带修复了 web 搜索在思考模型上失效的隐性 bug**
- 强制思考模型（R1/GLM-Z1，toolCalling=false）不受影响，因为不会注册任何工具，maxSteps=1 保持不变
- 前端按钮 v-if 与后端 prompt 注入是独立的两件事：前端决定 UI 可见性，后端决定 LLM 是否知道工具有效

**额外安全护栏**：为避免 LLM 反复调工具（死循环），`maxSteps=5` 是上限，但工具失败重试策略交由 LLM 自主判断（prompt 中已明确"无图片时禁止调用"等规则）。如需硬性限制工具调用次数，可在 LLM 工具调用超过 2 次时强制结束（见 Open Questions）。

**对历史 bug 的影响**：
- Qwen3-8B 启用「思考」开关 + 联网搜索，目前**工具调用也是失效的**（用户可能未察觉，因为 LLM 通常会基于记忆回答）
- Qwen3.5-4B 同上
- 修复后这两个模型的联网搜索功能也恢复正常

### Decision 9: OCR 工具的 SSRF 防护（协议 + 域名白名单 + 内网 IP 黑名单）

**问题**：OCR 工具的 `execute` 函数接收 LLM 传来的 `imageUrl` 参数。LLM 可能被诱导构造恶意 URL（如 `http://localhost:5432/`、`http://169.254.169.254/latest/meta-data/`、`http://10.0.0.1/admin`），服务端 `fetch` 没有任何限制，会导致：
- 内网端口扫描（数据库 5434、Redis、其他服务）
- 云元数据 API 调用（云厂商凭据泄露）
- 绕过外网 SSRF 防护访问内网
- DOS 攻击（fetch 慢/大文件）

**关键发现**：[security.ts](file:///d:/code/codeWork/my-chat/server/middleware/security.ts) 当前**没有任何 SSRF 防护**（不解析 IP、不验证重定向目标、不限制协议）。这是必须新增的防护层。

**选择**：在 `downloadImageAsBase64()` 内部实现 **三重防护**，任一条件不满足直接抛出错误（由 `execute` 包裹为错误返回对象）：

```typescript
// server/tools/ocr-document.ts
import dns from 'node:dns/promises'

// 协议白名单：只允许 HTTPS
const ALLOWED_PROTOCOLS = ['https:']

// 域名白名单：只允许常见公网图床
const ALLOWED_DOMAINS = [
  'i.ibb.co',           // ImgBB 直链（项目主用）
  'i.imgur.com',        // Imgur
  'cdn.discordapp.com', // Discord CDN
  'pbs.twimg.com',      // Twitter
  '*.alicdn.com',       // 阿里云 OSS
  '*.qpic.cn',          // 腾讯 QQ 图片
  '*.weixin.qq.com'     // 微信图片
]

// 内网 IP 黑名单（IPv4 + IPv6）
const PRIVATE_IP_PATTERNS = [
  /^127\./,            // loopback
  /^10\./,             // 私有 A 类
  /^192\.168\./,       // 私有 C 类
  /^172\.(1[6-9]|2[0-9]|3[01])\./,  // 私有 B 类
  /^169\.254\./,       // link-local（含云元数据）
  /^0\.0\.0\.0$/,      // 全零
  /^::1$/,             // IPv6 loopback
  /^fe80:/i,           // IPv6 link-local
  /^fc00:/i,           // IPv6 ULA
  /^fd[0-9a-f]{2}:/i   // IPv6 ULA
]

async function validateImageUrl(url: string): Promise<{ valid: boolean; reason?: string }> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { valid: false, reason: 'URL 解析失败' }
  }

  // 1. 协议检查
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return { valid: false, reason: `协议 ${parsed.protocol} 不被允许（仅支持 HTTPS）` }
  }

  // 2. 域名白名单（支持通配符 *.example.com）
  const hostname = parsed.hostname.toLowerCase()
  const domainAllowed = ALLOWED_DOMAINS.some(d => {
    if (d.startsWith('*.')) {
      return hostname.endsWith(d.slice(1))
    }
    return hostname === d
  })
  if (!domainAllowed) {
    return { valid: false, reason: `域名 ${hostname} 不在白名单中` }
  }

  // 3. 解析域名 IP 并检查内网
  const { address } = await dns.lookup(hostname)
  if (PRIVATE_IP_PATTERNS.some(p => p.test(address))) {
    return { valid: false, reason: `域名解析到内网 IP ${address}` }
  }

  return { valid: true }
}

async function downloadImageAsBase64(url: string): Promise<string> {
  // SSRF 验证
  const check = await validateImageUrl(url)
  if (!check.valid) {
    throw new Error(`URL 安全检查失败: ${check.reason}`)
  }

  // fetch + 禁用自动重定向（防重定向到内网）
  const response = await fetch(url, { redirect: 'manual' })

  if (response.status >= 300 && response.status < 400) {
    throw new Error('禁止自动重定向（防 SSRF）')
  }
  if (!response.ok) {
    throw new Error(`图片下载失败: ${response.status}`)
  }

  // 大小限制（10MB 上限，PaddleOCR 通常 4MB）
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > 10 * 1024 * 1024) {
    throw new Error(`图片过大: ${contentLength} 字节（上限 10MB）`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  const contentType = response.headers.get('content-type') || 'image/png'
  return `data:${contentType};base64,${buffer.toString('base64')}`
}
```

**测试场景**：
- ✓ 合法 ImgBB URL（`https://i.ibb.co/xxx/image.png`）→ 正常处理
- ✗ 协议错误（`http://...`、`file://...`）→ 拒绝
- ✗ 域名不在白名单（`https://evil.com/payload.png`）→ 拒绝
- ✗ DNS 解析到内网（`https://internal.example.com`）→ 拒绝
- ✗ 重定向（302 → 内网）→ 拒绝
- ✗ 图片过大（>10MB）→ 拒绝

**理由**：
- 三重防护覆盖协议层、域名层、IP 层
- ImgBB 是项目唯一上传图床（`i.ibb.co`），其他域名作为未来扩展预留
- 内网 IP 黑名单包含所有 RFC 1918 + 链路本地 + IPv6 ULA
- `redirect: 'manual'` 防止重定向到内网（攻击者先 302 到合法域名，再重定向到内网）
- `dns.lookup` 真实解析避免 DNS rebinding（如果用缓存 IP，攻击者可在两次查询间切换）
- 大小限制保护 PaddleOCR API 与服务端内存

**Open Question**：是否应允许用户配置自定义白名单域名（环境变量 `OCR_ALLOWED_DOMAINS`）？当前设计是写死在代码里，简单但不够灵活。建议先写死，后续按需扩展。

## Risks / Trade-offs

- **[风险] LLM 误判调用 OCR 工具**（hallucinate URL）→ 工具内部 URL 可达性校验 + 错误返回格式让 LLM 处理失败
- **[安全] SSRF 攻击面**（OCR 工具 fetch 任意 URL）→ 详见 Decision 9 协议/域名/IP 三重防护
- **[风险] LLM 在通用图像理解时误调 OCR** → system prompt 明确「不要在通用图像理解时调用」+ 给出负向场景示例
- **[风险] OCR toggle 开启但用户上传普通照片** → LLM 应基于 prompt 规则不调用，但仍有误判可能。**缓解**：prompt 中明确「普通照片、人物、风景」不要调用
- **[风险] reasoning 与工具调用交织**（Qwen3.5-4B/3-8B 都是 deepThinking=true）→ 见 Open Questions 验证项
- **[风险] 工具调用重试导致循环**（maxSteps=5 下 LLM 可能反复调工具）→ prompt 明确「禁止重复调用同一图片」+ maxSteps=5 是硬上限
- **[取舍] 多步骤延迟**（LLM 判断 + 工具调用 + 二次总结，2-3 倍延迟）→ 工具调用模式的固有成本
- **[取舍] token 成本高**（工具描述 + 调用结果都占上下文）→ OCR 输出 Markdown 文本相对紧凑，单次调用约 1000 tokens
- **[取舍] 不支持多图 OCR**（工具单次只处理 1 张图）→ LLM 可对多图分别调用工具（每次调一张），但延迟更高
- **[风险] 工具调用失败时用户体验** → LLM 应基于错误返回信息告知用户「OCR 失败，请重试」或「请上传有效图片」

## Open Questions

- **Q1: reasoning 事件与工具调用事件能否正常交织？** Qwen3.5-4B/3-8B 都是 `deepThinking=true + toolCalling=true`，开启 OCR 时 LLM 思考"我要调用 OCR 工具" 的 reasoning 文本会与 tool-input-available 事件交叉。需要在 E2E 测试中验证：[chat.post.ts#L344-L456](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L344-L456) 的 `mergeReasoningChunks` + 工具调用事件流能否被 `createUIMessageStream` 正确合成 UI Message。
- **Q2: 历史消息中的图片引用是否传递给 LLM？** 当前 [ai-chat.vue#L313](file:///d:/code/codeWork/my-chat/pages/ai-chat.vue#L313) 通过 `getMessageImages` 仅在前端展示，chat.post.ts 是否把历史图片作为多模态 parts 传给 LLM 待确认。如果不支持历史图片，OCR 工具的多轮对话价值有限（"基于你之前发的图" 类问题无法处理）。
- **Q3: ImgBB 直链是否会有 302 跳转？** `downloadImageAsBase64` 使用 `redirect: 'manual'`，但 ImgBB 直链 `i.ibb.co` 可能跳转。需要验证；如果跳转到其他白名单域名，扩展 `ALLOWED_DOMAINS` 即可；如果跳转到非白名单，需要在 `redirect: 'follow'` 模式下逐跳验证。

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
  - **需要修复**：当前 `FALLBACK_MODELS` 仅包含 3 个模型（`Qwen3-8B`、`DeepSeek-R1`、`GLM-Z1-9B-0414`），缺少 `Qwen/Qwen3.5-4B`。SSR 时 `Qwen/Qwen3.5-4B` 会走默认 capabilities `{ toolCalling: true, vision: true, deepThinking: true, toggleableThinking: true }`（因 [useChatConfig.ts#L15-L23](file:///d:/code/codeWork/my-chat/composables/useChatConfig.ts#L15-L23) 的 fallback 默认值），碰巧正确，但属于脆弱的隐式行为。
  - **修复方案**：在 `FALLBACK_MODELS` 中补充 Qwen3.5-4B 的配置（与 [server/config/models.ts#L43-L48](file:///d:/code/codeWork/my-chat/server/config/models.ts#L43-L48) 完全一致）：
    ```typescript
    {
      label: 'Qwen3.5-4B',
      value: 'Qwen/Qwen3.5-4B',
      capabilities: { vision: true, deepThinking: true, toggleableThinking: true, toolCalling: true }
    }
    ```
  - 补充后 SSR 默认模型（`LLM_MODEL` 环境变量或 `Qwen3-8B`）的 capabilities 判断在 SSR 和客户端完全一致
- 图片上传按钮显示条件改为 `canUploadImage`（即 `supportsVision || enableOcr`）：
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

### 已知限制

- **单条消息长度限制**：[chat.post.ts#L49](file:///d:/code/codeWork/my-chat/server/api/chat.post.ts#L49) 中 `MAX_MESSAGE_LENGTH = 1000` 是现有校验。OCR 输出可能很长（整页文档、大表格），当用户要求"把这张图所有文字给我"时，LLM 总结后的回答可能超过 1000 字符。该限制会触发 `createError({ statusCode: 400, message: '消息过长' })`。本次 OCR 功能不修改该限制，但实现后需观察：若 OCR 场景频繁触发长度限制，应单独评估是否对 AI 回复放宽（用户消息仍保持 1000 限制）。

## Migration Plan

1. 新建 `server/tools/ocr-document.ts`：定义 `ocrDocumentTool`
2. 修改 `server/api/chat.post.ts`：注册 OCR 工具 + OCR prompt 强化
3. 修改 `composables/useChatConfig.ts`：新增 `enableOcr` + `currentSupportsOcr`
4. 修改 `components/chat/ChatInput.vue`：新增 OCR toggle 按钮
5. 修改 `pages/ai-chat.vue`：透传 props + body 字段
6. 新增单测 + E2E 测试
7. 同步更新 `docs/API.md`

**回滚策略**：所有改动都是增量式（新增工具文件、新增 toggle 按钮、新增 prompt 追加分支），不修改现有行为。回滚只需 revert commit，无数据库迁移、无配置文件格式变更。

## Future Considerations

- `[待观察]` LLM 在实际使用中是否能准确判断何时调用 OCR 工具？需在真实对话中观察，必要时调整 prompt 规则。
- `[待观察]` LLM 是否会对多图分别调用 OCR 工具？首期不限制，观察实际行为。
- `[后续增强]` 是否需要为 OCR 工具调用结果显示特殊样式（如「OCR 结果」卡片）？首期直接作为 LLM 回复的一部分渲染。
- `[后续增强]` 是否需要让用户在工具调用过程中看到「正在 OCR 提取...」状态？现有 ToolInvocation 组件已支持工具调用状态展示，可能无需额外改动。
- `[后续增强]` 是否基于工具集合动态决定 `getVisibleToolInvocations` 过滤逻辑，而非为每个工具单独写 `if` 分支（当前 weather 工具始终显示，未来工具增多时建议重构为可见工具集合）。
