## ADDED Requirements

### Requirement: 文生图 Agent 工具

系统 SHALL 提供 `generate-image` Agent 工具，让 LLM 在用户请求生成图片时自主调用硅基流动 `Kwai-Kolors/Kolors` 模型生成图片。工具 MUST 遵循项目工具规范：执行失败返回 `{ error, detail }` 结构化对象不抛异常，由 LLM 决定后续处理。

工具 description MUST 明确说明「何时调用」（用户请求生成图片、画图、绘制示意图、艺术创作）和「何时不调用」（用户只要文字回答、用户只要描述现有图片）。

#### Scenario: LLM 自主调用生图工具

- **WHEN** 用户输入"画一只在月光下的猫"
- **THEN** LLM 调用 `generate-image` 工具，传入优化后的英文/中文 prompt
- **AND** 工具调用硅基流动 `POST /v1/images/generations` API
- **AND** 工具返回 `{ image_url, markdown, seed }` 给 LLM（不含 base64）
- **AND** LLM 在最终回答中用 markdown 图片语法 `![描述](image_url)` 嵌入生成的图片

#### Scenario: 工具调用失败降级

- **WHEN** 硅基流动 API 返回 5xx 错误或 60 秒超时
- **THEN** 工具返回 `{ error: '图片生成失败', detail, query }` 不抛异常
- **AND** LLM 基于错误信息向用户解释失败原因，不中断流式响应

#### Scenario: ImgBB 转存失败降级

- **WHEN** 图片生成成功但 ImgBB 上传失败
- **THEN** 工具返回硅基流动原始 URL + `warning: '图片链接 1 小时后失效，请及时保存'` 字段
- **AND** 不阻塞主流程

#### Scenario: 未配置 API Key

- **WHEN** `runtimeConfig.openAiApiKey` 为空
- **THEN** 工具返回 `{ error: '图片生成服务不可用', detail: '未配置 OPENAI_API_KEY' }` 不抛异常

### Requirement: 前端显式生图入口

系统 SHALL 在 `ChatInput` 工具栏提供"生图"按钮，与 OCR 按钮并列。用户点击后弹出 prompt 输入面板，提交后调用 `POST /api/generate-image` 独立路由生成图片。按钮 MUST 遵循触摸设备适配规范。

#### Scenario: 用户通过按钮触发生图

- **WHEN** 用户点击"生图"按钮
- **THEN** 显示 prompt 输入面板（textarea + 提交按钮 + 取消按钮）
- **AND** 用户输入 prompt 并点击提交后
- **THEN** 调用 `POST /api/generate-image`
- **AND** 显示加载状态（spinner + "正在生成图片..."文案）
- **AND** 收到响应后在聊天区显示生成的图片卡片

#### Scenario: 防重复提交

- **WHEN** 生图请求进行中
- **THEN** 提交按钮处于 `disabled` 状态
- **AND** 显示加载指示器
- **AND** 不允许并发提交同一请求

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

#### Scenario: 成功响应

- **WHEN** 请求合法且生成成功
- **THEN** 返回 HTTP 200 + `{ image_url, markdown, seed }`
- **AND** 若 ImgBB 转存失败，额外返回 `warning` 字段

#### Scenario: 服务端错误

- **WHEN** 硅基流动 API 不可用或未配置 `OPENAI_API_KEY`
- **THEN** 返回 HTTP 500 + `createError({ statusCode: 500, message: '图片生成服务不可用' })`

### Requirement: 工具调用展示

系统 SHALL 在 `ToolInvocation` 组件为 `generate-image` 工具类型提供专门的展示分支，含加载/预览/失败三种状态。MUST 为每个工具类型显式分支（项目硬约束）。

#### Scenario: 加载中状态

- **WHEN** 工具调用进行中（`state === 'call'`）
- **THEN** 显示 spinner + "正在生成图片..."文案
- **AND** 不显示空内容占位

#### Scenario: 成功预览

- **WHEN** 工具返回 `image_url`（`state === 'result'` 且无 `error`）
- **THEN** 显示图片缩略图（`max-w-[200px]` 限制宽度）
- **AND** 点击图片可放大查看（用 `<ClientOnly>` 包裹图片预览组件）
- **AND** 显示生成耗时和 seed 值

#### Scenario: 失败状态

- **WHEN** 工具返回 `error` 字段
- **THEN** 显示错误信息
- **AND** Agent 路径显示"等待 AI 重试"提示（LLM 自主决定是否重试）
- **AND** Workflow 路径显示"重试"按钮（用户手动重试）

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
