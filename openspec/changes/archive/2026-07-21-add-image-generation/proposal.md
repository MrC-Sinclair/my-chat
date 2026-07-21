## Why

项目目前仅支持文字对话、图片理解（OCR/视觉模型）和工具调用（搜索/天气/记忆检索），用户无法让 AI 主动产出图像内容。当对话涉及示意图、艺术创作、概念图、可视化场景时，AI 只能用文字描述，信息密度低。引入文生图能力后，AI 可在合适时机主动生成图片嵌入回答；同时提供前端显式入口，满足用户对重操作的精确控制需求。硅基流动已免费提供 `Kwai-Kolors/Kolors` 文生图模型（中英文提示词理解优秀），复用现有 Provider 配置即可接入，无需新增密钥。

## What Changes

- 新增 `generateImage` Agent 工具（`server/tools/generate-image.ts`）：LLM 自主决定何时调用、调用什么 prompt，调用硅基流动 `POST /v1/images/generations` 生成图片
- 新增独立 API 路由 `POST /api/generate-image`（`server/api/generate-image.post.ts`）：供前端显式按钮触发的 Workflow 路径，做编排（调 API → 转存 ImgBB → 返回持久化 URL）
- 新增 `server/utils/image-generation.ts`：封装硅基流动图片生成 API 调用，含 60 秒超时、错误降级、参数校验
- 复用 `server/utils/imgbb.ts` 解决 Kolors 返回的图片 URL 仅 1 小时有效问题：生成后立即转存到 ImgBB 获取持久化 URL
- 修改 `server/api/chat.post.ts`：将 `generateImage` 工具注册到 `toolsConfig`，受 `caps.toolCalling` 和前端「自动生图」开关共同守卫；system prompt 追加工具使用规则
- 修改前端 `components/chat/ChatInput.vue`：新增 Workflow 路径"生图"图标按钮 + prompt 输入面板；新增 Agent 路径"自动生图"toggle chip，控制 LLM 是否能自主调用生图工具
- 修改 `components/chat/ToolInvocation.vue`：为 `generateImage` 工具添加专门展示分支（含加载状态、图片预览、失败重试提示），符合项目"显式分支每个工具类型"的硬约束
- 修改 `nuxt.config.ts` 与 `.env.example`：`nuxt.config.ts` L176 和 `.env.example` L37 已包含 `imageGenerationModel` 配置（默认 `Kwai-Kolors/Kolors`），无需新增
- `vercel.json` 已存在且配置了 `server/**/*.ts` 的 `maxDuration: 60`，自动覆盖生图路由，无需新增文件
- 修改 `docs/API.md` 与 `docs/模型.md`：同步接口定义和模型接入状态

## Capabilities

### New Capabilities

- `image-generation-tool`: 文生图能力——支持 Agent 自主调用（LLM 决策何时生图）和前端显式触发（用户点击按钮输入 prompt）两种路径，统一调用硅基流动 Kolors 模型生成图片，通过 ImgBB 转存获取持久化 URL

### Modified Capabilities

无。本变更新增独立能力，不修改现有 `chat-input` / `ocr-tool` / `ip-location-tool` / `mcp-weather-tool` / `lazy-rendering` 的 spec 级需求。

## Impact

| 层级 | 影响 |
| --- | --- |
| 后端 | 新增 `server/utils/image-generation.ts`（硅基流动图片生成 API 封装）、`server/tools/generate-image.ts`（Agent 工具）、`server/api/generate-image.post.ts`（独立路由）；修改 `chat.post.ts` 注册 `generateImage` 工具 + 注入 system prompt 规则 |
| 前端 | 修改 `ChatInput.vue` 新增 Workflow 生图按钮 + prompt 输入面板 + Agent「自动生图」toggle chip；修改 `ToolInvocation.vue` 新增 `generateImage` 展示分支（加载/预览/失败状态）；可能新增 `ImageGenerationPanel.vue` 子组件 |
| Agent 架构 | 混合模式：Agent 工具路径（LLM 自主调用，受前端开关控制）+ Workflow 路径（前端按钮显式触发，须在 design.md 说明绕开 Agent 默认路径的理由） |
| 配置 | `nuxt.config.ts` L176 已有 `imageGenerationModel` runtimeConfig（默认 `Kwai-Kolors/Kolors`）；`.env.example` L37 已有 `IMAGE_GENERATION_MODEL` 示例；无需新增配置项 |
| 部署 | 项目已有 `vercel.json`（`server/**/*.ts` maxDuration: 60），自动覆盖生图路由，无需新增配置 |
| 依赖 | 调用硅基流动图片生成 API（base URL 从 runtimeConfig 读取，复用 `OPENAI_API_KEY`）；复用现有 ImgBB 图床做 URL 持久化转存（`IMGBB_API_KEY`） |
| 文档 | 需同步更新 `docs/API.md`（新增 `/api/generate-image` 接口）、`docs/模型.md`（标记 Kolors 已接入） |

## Validation

阻塞项已通过 `scripts/verify-siliconflow-image-api.mjs` 实测验证：

- 5 个 `image_size` 候选值（`1024x1024` / `960x1280` / `768x1024` / `720x1440` / `720x1280`）均被 `Kwai-Kolors/Kolors` 接受
- `image_size` 与 `size` 参数名均兼容
- `num_inference_steps` 与 `step` 参数名均兼容

运行方式：`node --env-file=.env scripts/verify-siliconflow-image-api.mjs`。如未来硅基流动调整 API 行为，rerun 该脚本即可更新验证结论。
