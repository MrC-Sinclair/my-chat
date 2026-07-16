## Context

当前项目已具备：多模态对话（图片理解）、Agent 工具系统（`webSearch`/`extractTextFromImage`/`recallMemory`/MCP `weather`）、ImgBB 图床上传能力（`server/utils/imgbb.ts`）、Vercel AI SDK `streamText` 流式调用。硅基流动已免费提供 `Kwai-Kolors/Kolors` 文生图模型，复用现有 `OPENAI_API_KEY` 即可调用，无需新增密钥。

关键约束：
- 硅基流动图片 URL **仅 1 小时有效**，必须立即转存到持久化存储
- 项目 `AGENTS.md` 规定「新功能默认走 Agent 路径」，Workflow 路径需在 design 说明理由
- 工具规范：失败返回 `{ error, detail }` 不抛异常，大对象通过 URL/ID 传递
- 触摸适配：按钮 ≥ 44px，`active:scale-95` 反馈，禁用 `confirm()`/`alert()`
- SSR 水合：禁止在模板/computed 用 `Date.now()`，浏览器 API 必须 `import.meta.client` 守卫

## Goals / Non-Goals

**Goals:**
- 让 LLM 在合适时机自主调用生图工具，自然语言即可触发（"画一只猫"）
- 让用户通过显式按钮精确控制生图时机和 prompt
- 自动转存到 ImgBB 解决 URL 1 小时过期问题，对调用方透明
- 复用现有渲染管线（MarkdownRenderer 已支持 `![](url)`），不改动流式协议

**Non-Goals:**
- 不做图生图（image-to-image）、图片编辑（inpainting/outpainting）
- 不引入本地图片缓存/CDN（复用 ImgBB 已有方案）
- 不做 prompt 翻译/优化服务（Agent 路径交给 LLM 自动优化；Workflow 路径用户自行输入）
- 不持久化"生图历史"到独立数据库表（图片 URL 通过 ImgBB 持久化；对话历史仍走现有 `messages` 表，AI 回复中嵌入的 markdown 图片 URL 自然落库）
- 不做服务端限流（单用户场景，前端按钮 disabled + Agent maxSteps=5 已够）

## Decisions

### 决策 1：采用混合模式（Agent 工具 + 前端按钮）

**理由**：生图是重操作（耗时 10-30 秒、消耗 API 配额），既需要 AI 的语义理解能力（自然语言触发），也需要用户对重操作的精确控制（避免误触发浪费配额）。

**Workflow 路径绕开 Agent 默认路径的理由**（满足 AGENTS.md「核心判定标准」红线要求）：
- 用户对重操作的显式控制权优先于自动化，符合「安全/合规护栏允许 Workflow」的精神
- 前端按钮路径是用户显式单次操作，不涉及工具组合编排，无控制流 if/else 写死工具调用步骤
- Workflow 路径仅做编排（调 API → 转存 → 返回 URL），不决策「是否生图」（由用户点击决策）

**替代方案**：
- 纯 Agent 路径——缺点：用户无法精确控制何时生图，LLM 可能误触发
- 纯 Workflow——缺点：无法在自然对话中触发，丢失 LLM 的 prompt 优化能力

### 决策 2：复用 ImgBB 转存，不引入新存储

**理由**：项目已有 [server/utils/imgbb.ts](file:///d:/code/codeWork/my-chat/server/utils/imgbb.ts)，已用于图片对话上传；ImgBB 免费、公网可访问 URL、无需自建 CDN、`.env` 已配置 `IMGBB_API_KEY`。

**替代方案**：本地文件存储——缺点：需配置静态资源服务、容器卷映射、生产环境需暴露公网域名，与项目当前部署形态不符。

### 决策 3：生图 API 调用封装在 `server/utils/image-generation.ts`

**理由**：Agent 工具和独立 API 路由共用同一份调用逻辑，避免重复；与 `embedding.ts`/`reranker.ts` 的分层一致（utils 提供能力，tools/api 提供入口）。

**替代方案**：工具内 inline 调用——缺点：Workflow 路径无法复用，逻辑分叉。

### 决策 4：图片以 markdown `![](url)` 语法嵌入 AI 回答

**理由**：项目 MarkdownRenderer 已支持 markdown 图片渲染（含 DOMPurify 白名单 `<img>` 标签），无需改动渲染管线和流式协议；图片作为 AI 文本回答的一部分自然流式输出。

**替代方案**：自定义图片消息类型——缺点：需改 `messages` 表 schema、前端消息组件、流式协议，工作量大且引入水合风险。

### 决策 5：Agent 工具返回结构化对象，不返回 base64

**理由**：遵循「大对象通过 URL/ID 传递，不进 LLM 上下文」项目规范；LLM 收到 `{ image_url, markdown, seed }` 后在回答中用 markdown 语法嵌入 URL；token 占用极小。

**替代方案**：返回 base64——缺点：占用大量 token，破坏流式响应，无法在 SSE 中传输。

### 决策 6：前端生图按钮放在 ChatInput 工具栏，与 OCR 按钮并列

**理由**：保持与现有工具入口的视觉一致性；OCR 按钮已是参考实现（含 `canUploadImage` 能力守卫模式）。

**替代方案**：浮动操作按钮（FAB）——缺点：遮挡内容、不符合聊天应用惯例。

### 决策 7：Workflow 路径单次请求返回，不做 `maxSteps` 循环

**理由**：前端按钮路径是用户显式单次操作，不需要 LLM 多步决策；调用直接 → 转存 → 返回，不阻塞流式响应。

**替代方案**：复用 `streamText`——缺点：引入不必要的复杂性，独立路由无法用 SSE 流式（一次性返回即可）。

### 决策 8：参数校验策略

`POST /api/generate-image` body 用 zod 校验：

| 字段 | 类型 | 必填 | 校验规则 |
|---|---|---|---|
| `prompt` | string | 是 | 1-2000 字符（Kolors 推荐 ≤ 500 token） |
| `sessionId` | string (UUID) | 否 | 用于消息归属（可选） |
| `seed` | number | 否 | 0 < x < 9999999999（硅基流动 API 约束） |
| `imageSize` | enum | 否 | `1024x1024` / `960x1280` / `768x1024` / `720x1440` / `720x1280`（Kolors 支持的分辨率） |

校验失败返回 400 + `createError()`，与项目其他 API 路由一致（参考 [server/api/sessions/[id]/archive-memory.post.ts](file:///d:/code/codeWork/my-chat/server/api/sessions/[id]/archive-memory.post.ts)）。

### 决策 9：错误处理策略

| 错误类型 | Agent 路径响应 | Workflow 路径响应 |
|---|---|---|
| 硅基流动 API 失败/超时 | `{ error, detail, query }` 不抛异常 | HTTP 500 + `{ message }`，前端 `toast.error()` |
| ImgBB 转存失败 | 降级返回硅基流动原始 URL + `warning` 字段 | 同 Agent，前端显示 warning 提示 |
| 参数校验失败 | N/A（LLM 传参） | HTTP 400 + `createError()` |
| 未配置 API Key | `{ error, detail }` | HTTP 500 + `{ message: '图片生成服务不可用' }` |

### 决策 10：SSR 水合防护

- 生图按钮使用 `v-tooltip` 指令（项目规范），禁用原生 `title` 属性
- 加载状态 `ref(false)`，初始值 SSR 安全（SSR 与客户端均为 `false`，无水合不匹配）
- 图片预览组件用 `<ClientOnly>` 包裹（依赖浏览器 `Image()` 对象检测加载状态）
- 不在模板或 computed 中使用 `Date.now()`/`Math.random()` 等不确定值
- `isMobile` 判断复用 `ai-chat.vue` 中现有逻辑（`window.innerWidth < 640`，在 `onMounted` 内初始化）

## Risks / Trade-offs

| 风险 | 缓解措施 |
|---|---|
| 生图耗时 10-30 秒，用户等待焦虑 | 前端显示进度指示器（spinner + "正在生成图片..."文案），按钮 `disabled` 防重复提交 |
| Kolors 中文提示词理解偶尔偏差 | Agent 路径由 LLM 自动优化 prompt；Workflow 路径用户自行调整重试 |
| ImgBB 转存失败导致 URL 1 小时后失效 | 降级返回临时 URL + `warning` 字段提示前端，前端显示"图片链接 1 小时后失效，请及时保存" |
| 并发生图请求消耗 API 配额 | 前端按钮 `disabled` 防重复；Agent 路径受 `maxSteps=5` 限制；不做服务端限流（单用户场景） |
| 触摸设备按钮误触 | 按钮尺寸 ≥ 44px，加 `active:scale-95` 反馈 |
| 历史会话中 ImgBB 链接失效 | 接受此取舍：图片链接失效时显示 alt 文本，对话文本仍在；不做本地备份（成本高、收益低） |
| `maxSteps=5` 限制 Agent 多步生图+描述 | 单次生图场景足够；如需多步（如先生图再描述），LLM 可在 5 步内完成 |

## Migration Plan

**部署步骤**：
1. 后端先行：新增 `server/utils/image-generation.ts` + `server/tools/generate-image.ts` + `server/api/generate-image.post.ts`，注册到 `chat.post.ts`
2. 前端跟进：修改 `ChatInput.vue` 新增按钮，修改 `ToolInvocation.vue` 新增展示分支
3. 配置：`.env.example` 新增 `IMAGE_GENERATION_MODEL`（可选，有默认值），用户无需立即配置
4. 文档：同步更新 `docs/API.md` 和 `docs/模型.md`

**回滚策略**：
- 后端回滚：从 `toolsConfig` 移除 `generate-image` 注册即可禁用 Agent 路径
- 前端回滚：删除 `ChatInput.vue` 中的生图按钮（独立组件，无侵入）
- 数据库：**无 schema 变更**，无需迁移回滚

## Open Questions

1. Kolors 是否需要默认 `negative_prompt`（反向提示词）？硅基流动 API 支持，但默认不传。可在实施时根据生成质量决定是否暴露给用户。
2. 是否需要为生图功能单独计费/限流？当前不做（单用户场景），如未来上线多用户需补。
3. `imageSize` 默认值取 `1024x1024`（正方形）还是 `960x1280`（竖屏，更适合手机）？建议默认 `1024x1024`，前端可让用户选择。
