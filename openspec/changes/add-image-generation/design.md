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

**理由**：生图是重操作（耗时 10-30 秒、消耗 API 配额、带水印），既需要 AI 的语义理解能力（自然语言触发），也需要用户对重操作的精确控制（避免误触发浪费配额、避免无意义的水印图片被永久保存到 ImgBB）。

**Workflow 路径绕开 Agent 默认路径的理由**（满足 AGENTS.md「核心判定标准」红线要求）：

承认内部流程是「调 Kolors API → 转存 ImgBB → 返回 URL」的两步 Workflow 编排（`if/else` 写死在 `/api/generate-image.post.ts` 中），但**满足下列护栏条件**允许采用 Workflow：

1. **用户显式触发**：每次生图都需用户主动点击按钮并填写 prompt，无 LLM 自主触发路径
2. **不涉及工具组合决策**：调用顺序（生成 → 转存）是固定流水线，不存在 LLM 应自主决策的工具组合
3. **重操作护栏**：生图耗时 10-30 秒 + 消耗 API 配额 + 占用 ImgBB 存储 + 生成带水印图片，这些副作用的"是否发起"必须由用户决策，不应由 LLM 自动判断
4. **失败重试可由用户控制**：Workflow 路径可在 UI 提供"重试"按钮，Agent 路径则由 LLM 自主决定（详见 spec.md 7.2 失败状态分支）

**替代方案**：
- 纯 Agent 路径——缺点：用户无法精确控制何时生图，LLM 可能误触发消耗配额；且每次生图都会持久化到 ImgBB，浪费存储
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

### 决策 6：生图按钮位置 — 输入框旁的图标按钮（非 toggle chip）

**理由**：现有 `ChatInput.vue` 工具栏有两种交互模式：
- **toggle chip 区**（思考 / 联网 / OCR）：状态切换型，按钮高亮表示"已开启"
- **图标按钮区**（图片上传、语音输入、发送）：动作触发型，无"开启/关闭"状态

生图属于**动作触发型**（点击展开输入面板、提交即触发），与图片上传、语音输入同类。放在 toggle chip 区会与 OCR 等状态切换型按钮混淆，破坏视觉一致性。

**具体位置**：放在 `ChatInput.vue` 第 232 行的图片上传 `<label>` 之后，语音输入按钮（302 行）之前。按钮样式参照语音输入按钮（`min-w-[44px] min-h-[44px]` 手机端、`sm:min-w-[40px] sm:min-h-[40px]` 平板端、`active:scale-95` 反馈、v-tooltip 文字提示）。

**为什么不放在 toggle chip 区**：
- OCR 是 toggle（开启/关闭 OCR 能力），生图是动作（点击触发一次生图）
- 混在一起会让用户误以为"点击生图会持续生成图片"，与 OCR toggle 行为不一致

**替代方案**：
- toggle chip 区追加生图 chip — 拒绝：交互模式不匹配，与 OCR/联网混淆
- 浮动操作按钮（FAB）— 拒绝：遮挡内容，不符合聊天应用惯例
- 独立工具栏（ChatInput 上方）— 拒绝：与现有"图片上传 + 语音输入 + 发送"图标列视觉断裂

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

### 决策 10：SSR 水合防护 + isMobile 传递路径

**SSR 水合**：
- 生图按钮使用 `v-tooltip` 指令（项目规范），禁用原生 `title` 属性
- 加载状态 `ref(false)`，初始值 SSR 安全（SSR 与客户端均为 `false`，无水合不匹配）
- 图片预览组件用 `<ClientOnly>` 包裹（依赖浏览器 `Image()` 对象检测加载状态）
- 不在模板或 computed 中使用 `Date.now()`/`Math.random()` 等不确定值

**isMobile 传递路径**：

`isMobile` 状态在 `pages/ai-chat.vue` 中持有（166 行：`const isMobile = ref(false)`，172 行 onMounted 初始化），不通过 composable 暴露。传递路径：

1. `pages/ai-chat.vue` 的 `<ChatInput>` 标签新增 `:is-mobile="isMobile"` prop 绑定
2. `components/chat/ChatInput.vue` 的 `defineProps` 新增 `isMobile: boolean` 字段
3. 生图按钮的样式根据 `isMobile` 切换：手机端 `min-w-[44px] min-h-[44px]`，平板端 `sm:min-w-[40px] sm:min-h-[40px]`
4. **不**在 ChatInput 内部 `onMounted` 监听 `window.resize` 重复持有 isMobile（与现有 `speechSupported` 模式不同：speechSupported 是浏览器能力检测，只读一次；isMobile 需响应窗口变化，单一来源更可靠）

**为什么不抽 composable**：项目已有侧边栏响应式逻辑全部集中在 ai-chat.vue 中，isMobile 的窗口监听与 showSidebar 状态紧耦合（177-178 行：`if (!mobile && !showSidebar.value) showSidebar.value = true`），抽 composable 会破坏现有状态机。

## Risks / Trade-offs

| 风险 | 缓解措施 |
| --- | --- |
| 生图耗时 10-30 秒，用户等待焦虑 | 前端显示进度指示器（spinner + "正在生成图片..."文案），按钮 `disabled` 防重复提交 |
| Nitro 默认 handler 超时较短，生图 30 秒可能被掐断 | `defineEventHandler` 显式声明 `maxDuration: 60_000`；`image-generation.ts` fetch 中用 `AbortController.timeout(60_000)`；nuxt.config.ts 不需要额外配置（`maxDuration` 是 handler 局部配置） |
| Kolors 中文提示词理解偶尔偏差 | Agent 路径由 LLM 自动优化 prompt；Workflow 路径用户自行调整重试 |
| ImgBB 转存失败导致 URL 1 小时后失效 | 降级返回临时 URL + `warning` 字段提示前端，前端显示"图片链接 1 小时后失效，请及时保存" |
| 并发生图请求消耗 API 配额 | 前端按钮 `disabled` 防重复；Agent 路径受 `maxSteps=5` 限制；多标签页并发接受为风险（单用户场景下 L4） |
| 触摸设备按钮误触 | 按钮尺寸 ≥ 44px，加 `active:scale-95` 反馈 |
| 历史会话中 ImgBB 链接失效 | 接受此取舍：图片链接失效时显示 alt 文本，对话文本仍在；不做本地备份（成本高、收益低） |
| `maxSteps=5` 限制 Agent 多步生图+描述 | 1 次生图（生成 + 返回）+ 1 步 LLM 引用 = 2 步；5 步上限充裕。如未来需多步（如先生图再描述再二次生图），需重新评估 `maxSteps` 上限 |
| Kolors 生成图片带 AI 水印 | 接受为取舍：硅基流动在图片右下角添加半透明"AI 生成"水印，符合监管要求；不另行加水印；UI 上不专门提示（避免水印焦虑） |
| 用户输入违规 prompt（NSFW/政治敏感） | 接受：硅基流动服务端自动 NSFW 过滤，超出范围的 prompt 会返回 4xx 错误；本项目不重复做内容审核（成本高、与 Kolors 默认行为重复） |
| Agent 路径 LLM 误触发生图 | LLM 自主决策遵守工具 description 的「何时不调用」规则；如多次观察误触发，添加 rate-limit（5 分钟内最多 3 次）或 cost cap |
| 多标签页同时触发 Workflow 生图 | 接受为取舍：服务端未做并发去重，理论可同时生成多张图。修复需引入内存级并发锁（进程内 Map），与单用户场景收益不匹配 |

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

1. Kolors 的 `negative_prompt`（反向提示词）：**不暴露给用户和 LLM**。硅基流动 API 支持此参数，但默认不传（依赖 Kolors 内置 NSFW/低质量过滤）。Agent 路径 LLM 不传此参数；Workflow 路径前端 UI 不提供此输入框。如未来需要高级用户控制，可在 `/api/generate-image` 路由 body 增 `negativePrompt` 字段（zod 校验 0-500 字符），UI 在面板底部折叠展开「高级选项」。

2. 多用户场景的生图限流：**当前不做**。单用户场景下前端按钮 `disabled` + Agent `maxSteps=5` 已够。如未来上线多用户，需引入：
   - 服务端内存级并发锁（按 userId 限流）
   - DB 计数（每日配额）
   - 或对接 API 网关层限流

3. `imageSize` 默认值：**`1024x1024`**（正方形，通用性最佳）。前端 UI 暴露 5 个预设可选（详见 tasks.md 6.2）：
   - `1024x1024`（默认，通用）
   - `960x1280`（3:4 竖屏，适合手机壁纸）
   - `768x1024`（3:4 经典竖屏）
   - `720x1440`（9:20 超长竖屏，手机壁纸）
   - `720x1280`（9:16 竖屏）
