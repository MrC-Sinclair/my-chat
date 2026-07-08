## Why

项目当前仅集成 1 个视觉模型（Qwen3.5-4B，通用多模态），缺少专用的 OCR 能力。用户上传扫描件、表格图片、印章文档时，通用视觉模型在版面结构化和文字提取精度上不如专用 OCR 模型。硅基流动平台已提供永久免费的 `PaddlePaddle/PaddleOCR-VL-1.5`（OmniDocBench v1.5 精度 94.5%，支持异形框、印章识别），适合作为 OCR 能力补充。

但 PaddleOCR 是**专用 OCR 模型**，不是通用视觉对话模型——它不能进行通用图像理解（如「图中是什么」）、不支持多图、不支持纯文本对话。如果作为「模型选择器」中的一个独立选项，会让用户面临「什么时候该选 OCR 模型」的认知负担，且切换模型时上下文丢失。

更好的模式是**作为工具调用集成**：PaddleOCR 隐入后端，前端只暴露一个「OCR」开关，通用对话模型（Qwen3-8B / Qwen3.5-4B）在用户上传图片且需要 OCR 时自主调用 OCR 工具，调用结果回到 LLM 进行总结。用户不需要切换模型，统一在通用对话里完成 OCR 任务，符合 AI 应用工具调用的主流模式。

实测 PaddleOCR API 关键特性：① 明确 OCR 指令时输出干净 Markdown（含表格语法）；② 多图 400 报错，必须单图；③ `enable_thinking=false` 会让输出降级，绝不能传；④ 纯文本无图调用返回无意义内容。

## What Changes

- **新增 OCR 工具**：在 `server/tools/ocr-document.ts` 新建 `ocrDocumentTool`，用 AI SDK `tool()` 定义，参数为 `imageUrl`（string），execute 内部经过 SSRF 三重防护（协议+域名+IP）后 fetch URL → base64 → 调用 PaddleOCR API → 返回 Markdown 文本
- **服务端注册工具**：`chat.post.ts` 在 `caps.toolCalling && enableOcr` 时把 `ocrDocumentTool` 加入 `toolsConfig`
- **服务端 prompt 强化**：OCR toggle 开启时，system prompt 追加 OCR 工具使用规则（仅图片场景调用、无图禁调、区分通用图像理解 vs OCR 提取、禁止重复调用同一图片）
- **maxSteps 关键修复**：将 `maxSteps` 计算从「基于 `caps.vision || caps.deepThinking`」改为「基于 `hasActiveTools`」。原逻辑导致 Qwen3-8B / Qwen3.5-4B 启用工具时 maxSteps=1，工具调用失效；修复后这两个模型的 web 搜索与 OCR 工具调用都恢复正常
- **图片流处理（关键修复）**：当前 chat.post.ts 不区分视觉/非视觉模型都给 `{type:'image'}` parts，会导致非视觉模型 API 报错。新增视觉/非视觉模型分流：
  - 视觉模型（`caps.vision=true`）：图片作为多模态 parts 传入
  - 非视觉模型（`caps.vision=false`）：图片 URL 文本注入 `[附图片N: URL]`，LLM 通过 URL 调 OCR 工具
  - ImgBB 失败降级（dataURL）时：非视觉模型注入降级提示，视觉模型复用 parseBase64Meta
- **前端 toggle 开关**：ChatInput 在「联网」按钮旁新增「OCR」toggle 按钮，与现有 toggle 按钮同模式
  - 显示条件：`currentCapabilities.toolCalling === true`（Qwen3-8B / Qwen3.5-4B 显示，GLM-Z1/R1 隐藏）
  - 默认关闭，开启后高亮
- **图片上传按钮联动**：从 `supportsVision` 改为 `canUploadImage = supportsVision || enableOcr`，非视觉模型在 OCR 关闭时图片上传按钮不可见（cursor-not-allowed + tooltip 提示开启 OCR）
- **useChatConfig 扩展**：新增 `enableOcr` ref + `currentSupportsOcr` computed；补全 FALLBACK_MODELS 中 Qwen3.5-4B 配置（之前依赖默认值碰巧正确，属脆弱行为）
- **ToolInvocation 组件扩展**：新增 `extractTextFromImage` 工具分支（当前组件只有 weather/webSearch 分支），不实现会 OCR 工具调用时 UI 渲染空白
- **请求体扩展**：`/api/chat` 请求 body 新增 `enable_ocr` 字段，透传到服务端
- **不修改模型选择器**：`AVAILABLE_MODELS` 不新增 PaddleOCR 配置，PaddleOCR 完全隐入后端工具层
- **不修改数据库**：OCR 输出作为 assistant 消息 content 存储，沿用现有 schema

## Capabilities

### New Capabilities

- `ocr-tool`: PaddleOCR 作为 AI SDK tool 集成到 chat 流程，覆盖工具定义、服务端注册、prompt 强化、前端 toggle 开关、显示条件控制等行为

### Modified Capabilities

无。现有 `chat-input` spec 仅覆盖语音输入，不涉及 toggle 按钮的扩展行为，因此不构成 spec 级别的需求变更。

## Impact

| 层级 | 影响范围 |
|---|---|
| 工具层 | `server/tools/ocr-document.ts`：**新建文件**，导出 `ocrDocumentTool` + SSRF 防护 |
| 服务端 API | `server/api/chat.post.ts`：**3 处关键修改**——① 注册 OCR 工具到 `toolsConfig`；② 重构 maxSteps 计算（基于 hasActiveTools）；③ 图片流按 vision 字段分流（视觉多模态 / 非视觉文本引用） |
| 前端 composables | `composables/useChatConfig.ts`：新增 `enableOcr` ref + `currentSupportsOcr` computed；补全 FALLBACK_MODELS 中 Qwen3.5-4B 配置 |
| 前端组件 | `components/chat/ChatInput.vue`：props 新增 `enableOcr`、`supportsOcr`；新增 `canUploadImage` computed；新增 OCR toggle 按钮；图片上传按钮 label/tooltip/disabled 联动 OCR 开关 |
| 前端组件 | `components/chat/ToolInvocation.vue`：**新增 `extractTextFromImage` 分支**（不实现会 UI 渲染空白） |
| 页面 | `pages/ai-chat.vue`：透传 `enableOcr` / `supportsOcr` props；useChat body 透传 `enable_ocr`（函数式 body，AI SDK v5） |
| 测试 | 新增 `ocr-document.ts` 单测（含 SSRF 防护）、ChatInput OCR 按钮渲染单测、`chat.post.ts` OCR 工具注册/maxSteps/图片分流单测、E2E 选 Qwen3-8B + 开启 OCR + 上传图片 → 看到 Markdown 输出 |
| 文档 | 同步更新 `docs/API.md` 中 `enable_ocr` 字段说明 + `extractTextFromImage` 工具说明 |
| 风险 | 顺带修复 Qwen3-8B/3.5-4B 的 web 搜索功能（原 maxSteps=1 阻断工具调用循环） |
