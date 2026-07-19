## Context

当前项目已具备：多模态对话（图片理解）、Agent 工具系统（`webSearch`/`extractTextFromImage`/`recallMemory`/MCP `weather`）、ImgBB 图床上传能力（`server/utils/imgbb.ts`）、Vercel AI SDK `streamText` 流式调用。硅基流动已免费提供 `Kwai-Kolors/Kolors` 文生图模型，复用现有 `OPENAI_API_KEY` 即可调用，无需新增密钥。

关键约束：
- 硅基流动图片 URL **仅 1 小时有效**，必须立即转存到持久化存储
- 项目 `AGENTS.md` 规定「新功能默认走 Agent 路径」，Workflow 路径需在 design 说明理由
- 工具规范：失败返回 `{ error, detail }` 不抛异常，大对象通过 URL/ID 传递
- 触摸适配：按钮 ≥ 44px，`active:scale-95` 反馈，禁用 `confirm()`/`alert()`
- SSR 水合：禁止在模板/computed 用 `Date.now()`，浏览器 API 必须 `import.meta.client` 守卫
- **超时控制 API 选型（实测验证）**：
  - `h3@1.15.11` 的 `defineEventHandler` 签名为 `function defineEventHandler(handler)`，**只接收一个参数**，不存在 `maxDuration` 选项（实测 `defineEventHandler.length === 1`）。对象语法仅支持 `{ handler, onRequest, onBeforeResponse, websocket }`。文档中任何 `defineEventHandler(handler, { maxDuration })` 写法均错误
  - `AbortController.prototype.timeout` 在 Node v22 中为 `undefined`，**不是有效 API**。正确标准 API 是 `AbortSignal.timeout(ms)` 静态方法（MDN Baseline 2024，Node 17.3+ 支持）
  - 部署平台函数超时由平台层决定：Vercel Hobby 10s / Pro 60s（需 `vercel.json` 配 `functions.maxDuration`）、Cloudflare Workers 默认 30s CPU。Nitro preset 不同超时不同，须在部署前确认

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
- 不做服务端限流（单用户场景，前端按钮 disabled + Agent stopWhen=stepCountIs(5) 已够）

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

**理由**：遵循「大对象通过 URL/ID 传递，不进 LLM 上下文」项目规范；LLM 收到 `{ imageUrl, markdown, seed, inferenceTime }` 后在回答中用 markdown 语法嵌入 URL；token 占用极小。注意硅基流动 API 响应格式为 `{ images: [{ url }], timings: { inference }, seed }`，需从 `images[0].url` 提取图片 URL，从 `timings.inference` 提取耗时（秒）作为 `inferenceTime` 返回给 LLM 和 UI。

**替代方案**：返回 base64——缺点：占用大量 token，破坏流式响应，无法在 SSE 中传输。

### 决策 6：Workflow 路径生图按钮位置 — 输入框旁的图标按钮（非 toggle chip）

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

### 决策 6b：Agent 路径增加「自动生图」toggle chip 开关

**决策**：在 `ChatInput.vue` 的 toggle chip 区（思考 / 联网 / OCR 之后）新增一个「生图」toggle chip，用于控制 Agent 路径是否允许 LLM 自动调用生图工具。默认状态为 **开启**。

**仅控制 Agent 路径**：开关状态通过 `body`（snake_case 字段名 `enable_image_generation`，与 `enable_web_search`/`enable_ocr` 保持一致）传入 `/api/chat`，`chat.post.ts` 根据该状态决定是否将 `generateImage` 工具注册到 `toolsConfig`。system prompt 中生图工具规则的注入条件必须与工具注册条件严格一致（`caps.toolCalling && body.enable_image_generation !== false`），避免模型幻觉调用。Workflow 路径（输入框旁图标按钮触发的 `/api/generate-image`）不受此开关影响。

**为什么与 Workflow 按钮分离**：
- Workflow 按钮是「动作触发型」：用户点击一次触发一次生图
- Agent 开关是「能力启停型」：决定 LLM 是否能根据对话内容主动生图
- 两者概念不同，合并会造成用户困惑：关闭开关后图标按钮也无法使用，或图标按钮能使用但 LLM 不能自动使用

**默认开启的理由**：用户首次使用时期待通过自然语言让 AI 生图；如发现误触发，可手动关闭。

**替代方案**：
- 不增加开关，完全依赖 LLM 自律 — 拒绝：生图是重操作（耗时、耗配额），存在误触发风险，需要用户可控的紧急制动
- 将开关与 Workflow 按钮合并为一个组件 — 拒绝：概念混淆，关闭 Agent 不应禁用显式生图按钮

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

### 决策 10：SSR 水合防护 + 响应式按钮尺寸（用 Tailwind `sm:` 前缀，不传 isMobile prop）

**SSR 水合**：
- 生图按钮使用 `v-tooltip` 指令（项目规范），禁用原生 `title` 属性
- 加载状态 `ref(false)`，初始值 SSR 安全（SSR 与客户端均为 `false`，无水合不匹配）
- 图片预览组件用 `<ClientOnly>` 包裹（依赖浏览器 `Image()` 对象检测加载状态）
- 不在模板或 computed 中使用 `Date.now()`/`Math.random()` 等不确定值

**响应式按钮尺寸（不传 isMobile prop）**：

生图按钮直接用 Tailwind 响应式前缀实现手机/平板自适应，**不需要从父组件传 `isMobile` prop**：

```
class="min-w-[44px] min-h-[44px] sm:min-w-[40px] sm:min-h-[40px]"
```

**为什么不传 isMobile prop**：
1. ChatInput 现有按钮（如语音输入 L302-336、发送按钮 L338-364）均直接用 `sm:` 前缀实现响应式，从未依赖 isMobile prop。生图按钮保持一致即可
2. `pages/ai-chat.vue` 的 `isMobile` 状态（L166）紧耦合侧边栏状态机（L177-178 `if (!mobile && !showSidebar.value) showSidebar.value = true`），向下传 prop 会破坏封装、增加耦合
3. Tailwind `sm:` 前缀在 SSR 阶段也能正确生成两套样式，无水合风险

### 决策 11：Workflow 路径消息持久化与 useChat 状态机同步

**问题背景**：`useChatSession().saveMessage()` 走 `/api/messages` 插入 DB（已验证 [server/api/messages.post.ts](file:///d:/code/codeWork/my-chat/server/api/messages.post.ts) 已实现），但 `useChat`（Vercel AI SDK）维护的 `messages` 是另一个状态机。**仅调用 `saveMessage()` 不会让图片出现在前端对话流中**，用户会看到"点了按钮但没图"。

**同步策略**：Workflow 路径生图成功后必须做两件事：

1. **持久化到 DB**：`useChatSession().saveMessage(sessionId, 'assistant', markdown, { model: 'Kwai-Kolors/Kolors' })`
2. **同步到 useChat 状态机**：通过 `chat.messages.push()` 或 `chat.messages = [...chat.messages, newMsg]` 将新消息加入 `chat.messages` 数组（参考 [ai-chat.vue](file:///d:/code/codeWork/my-chat/pages/ai-chat.vue) 中 `chat.messages` 的维护模式），让前端对话流立即显示图片消息。**注意**：`messages` 是 `computed(() => chat.messages)`，不可直接 push 到 computed；须操作 `chat.messages` 数组本身

**消息格式**：Workflow 路径构造的消息须符合 AI SDK 5.0 `UIMessage` 格式，使用 `parts` 数组而非 `content` 字符串：

```typescript
const newMsg: UIMessage = {
  id: crypto.randomUUID(),
  role: 'assistant',
  parts: [{ type: 'text', text: markdown }]
}
chat.messages = [...chat.messages, newMsg]
```

**为什么不只用 saveMessage**：`saveMessage` 是 useChatSession 的方法，与 Chat 实例是两套状态机；不同步前者会让 DB 有数据但前端看不到，刷新页面才能看到。

**为什么不只用 push**：仅前端 push 不持久化，刷新页面后丢失。

**消息归属**：`role: 'assistant'`（生图由 AI 服务生成，归属 AI 端，与 Agent 路径 LLM 调用工具后嵌入图片的行为一致）。

### 决策 12：Workflow 路径不走 ToolInvocation，直接通过 MarkdownRenderer 渲染

**问题背景**：spec.md 7.2 原设计要求 ToolInvocation 同时处理 Agent 路径和 Workflow 路径的生图展示，并区分"Agent 路径等待 AI 重试"vs"Workflow 路径重试按钮"。但 `ToolInvocation` 组件只接收 `invocation` 对象，**没有任何字段能区分调用来源**，强行区分会引入 `source: 'agent' | 'workflow'` prop 增加 ToolInvocation 复杂度。

**决策**：
- **Agent 路径**：通过 ToolInvocation 显式分支展示（加载中 spinner / 成功预览 / 失败提示），符合项目「每个工具类型显式分支」硬约束
- **Workflow 路径**：**不走 ToolInvocation**。生图成功后，API 返回的 `markdown` 字符串（如 `![描述](imageUrl)`）作为 `assistant` 消息内容直接 push 到 messages 数组，由现有 `MarkdownRenderer` 自然渲染为 `<img>` 标签。失败时通过 `useToast().error()` 反馈，无 ToolInvocation 调用

**理由**：
1. Workflow 路径没有"工具调用"语义（是用户点击按钮触发的 HTTP 请求，不是 LLM 调用 tool），强行套 ToolInvocation 是概念错配
2. MarkdownRenderer 已支持 `![](url)` 渲染（DOMPurify 白名单含 `<img>`），无需新增组件
3. 失败时 Workflow 路径用 toast + 按钮保持原状让用户重试，比 ToolInvocation 的"重试按钮"更直接

**替代方案**：在 ToolInvocation 增加 `source` prop 区分来源——拒绝：增加组件复杂度，且 Workflow 路径无 invocation 对象（不是 LLM 调用），强行构造 invocation 反而绕路。

## Risks / Trade-offs

| 风险 | 缓解措施 |
| --- | --- |
| 生图耗时 10-30 秒，用户等待焦虑 | 前端显示进度指示器（spinner + "正在生成图片..."文案），按钮 `disabled` 防重复提交 |
| 部署平台函数超时限制（Vercel Hobby 10s / Pro 60s、Cloudflare Workers 30s CPU）可能掐断 30s+ 生图请求 | 1. `image-generation.ts` fetch 用 `AbortSignal.timeout(60_000)` 主动控制客户端超时；2. 部署前在目标平台配置函数超时：Vercel `vercel.json` 配 `functions.maxDuration: 60`，Cloudflare Workers 启用 60s CPU 限制；3. Nitro preset 不同超时不同，须在 `nitro.config` 或部署平台文档确认。**注**：H3 的 `defineEventHandler` 不支持 `maxDuration` 选项（实测 `h3@1.15.11` 函数 `length === 1`，第二参数被忽略），超时控制必须放在 fetch 层 + 部署平台层 |
| Kolors 中文提示词理解偶尔偏差 | Agent 路径由 LLM 自动优化 prompt；Workflow 路径用户自行调整重试 |
| ImgBB 转存失败导致 URL 1 小时后失效 | 降级返回临时 URL + `warning` 字段提示前端，前端显示"图片链接 1 小时后失效，请及时保存" |
| 并发生图请求消耗 API 配额 | 前端按钮 `disabled` 防重复；Agent 路径受 `stopWhen=stepCountIs(5)` 限制；多标签页并发接受为风险（单用户场景下 L4） |
| 触摸设备按钮误触 | 按钮尺寸 ≥ 44px，加 `active:scale-95` 反馈 |
| 历史会话中 ImgBB 链接失效 | 接受此取舍：图片链接失效时显示 alt 文本，对话文本仍在；不做本地备份（成本高、收益低） |
| `stopWhen=stepCountIs(5)` 限制 Agent 多步生图+描述 | 1 次生图（生成 + 返回）+ 1 步 LLM 引用 = 2 步；5 步上限充裕。如未来需多步（如先生图再描述再二次生图），需重新评估 `stopWhen` 上限 |
| Kolors 生成图片带 AI 水印 | 接受为取舍：硅基流动在图片右下角添加半透明"AI 生成"水印，符合监管要求；不另行加水印；UI 上不专门提示（避免水印焦虑） |
| 用户输入违规 prompt（NSFW/政治敏感） | 接受：硅基流动服务端自动 NSFW 过滤，超出范围的 prompt 会返回 4xx 错误；本项目不重复做内容审核（成本高、与 Kolors 默认行为重复） |
| Agent 路径 LLM 误触发生图 | 1. 前端提供「自动生图」toggle chip，默认开启，用户可一键关闭；2. LLM 遵守工具 description 的「何时不调用」规则；3. 如仍观察到误触发，添加 rate-limit（5 分钟内最多 3 次）或 cost cap |
| 多标签页同时触发 Workflow 生图 | 接受为取舍：服务端未做并发去重，理论可同时生成多张图。修复需引入内存级并发锁（进程内 Map），与单用户场景收益不匹配 |

## Migration Plan

**部署步骤**：
1. 后端先行：新增 `server/utils/image-generation.ts` + `server/tools/generate-image.ts` + `server/api/generate-image.post.ts`，在 `chat.post.ts` 注册 `generateImage` 工具
2. 前端跟进：修改 `ChatInput.vue` 新增 Workflow 生图按钮 + Agent「自动生图」toggle chip，修改 `ToolInvocation.vue` 新增 `generateImage` 展示分支
3. 配置：`.env.example` 已包含 `IMAGE_GENERATION_MODEL`（L37，有默认值 Kwai-Kolors/Kolors），`nuxt.config.ts` L176 已暴露 `imageGenerationModel` runtimeConfig，无需新增配置
4. 部署：项目根目录已有 `vercel.json`，配置了 `server/**/*.ts` 的 `maxDuration: 60`，自动覆盖 `/api/generate-image` 等所有服务端路由；部署到 Vercel Pro 即可满足 60 秒超时需求
5. 文档：同步更新 `docs/API.md` 和 `docs/模型.md`

**回滚策略**：
- 后端回滚：从 `toolsConfig` 移除 `generateImage` 注册即可禁用 Agent 路径
- 前端回滚：删除 `ChatInput.vue` 中的生图按钮和 toggle chip（独立组件，无侵入）
- 数据库：**无 schema 变更**，无需迁移回滚

## Open Questions

1. Kolors 的 `negative_prompt`（反向提示词）：**不暴露给用户和 LLM**。硅基流动 API 支持此参数，但默认不传（依赖 Kolors 内置 NSFW/低质量过滤）。Agent 路径 LLM 不传此参数；Workflow 路径前端 UI 不提供此输入框。如未来需要高级用户控制，可在 `/api/generate-image` 路由 body 增 `negativePrompt` 字段（zod 校验 0-500 字符），UI 在面板底部折叠展开「高级选项」。

2. 多用户场景的生图限流：**当前不做**。单用户场景下前端按钮 `disabled` + Agent `stopWhen=stepCountIs(5)` 已够。如未来上线多用户，需引入：
   - 服务端内存级并发锁（按 userId 限流）
   - DB 计数（每日配额）
   - 或对接 API 网关层限流

3. `imageSize` 默认值：**`1024x1024`**（正方形，通用性最佳）。前端 UI 暴露 5 个预设可选（详见 tasks.md 6.2）：
   - `1024x1024`（默认，通用）
   - `960x1280`（3:4 竖屏，适合手机壁纸）
   - `768x1024`（3:4 经典竖屏）
   - `720x1440`（9:20 超长竖屏，手机壁纸）
   - `720x1280`（9:16 竖屏）

   **✅ 已验证**：通过 `scripts/verify-siliconflow-image-api.mjs` 实测，上述 5 个尺寸均被 `Kwai-Kolors/Kolors` 接受（HTTP 200）。zod enum 可直接采用这 5 个值。若未来硅基流动调整可用尺寸， rerun 该脚本即可更新。
   
   **参数名验证**：`image_size`（硅基流动文档明确字段）和 `size`（OpenAI 兼容字段）均被服务端接受。实施时代码优先使用 `image_size`，保留 `size` 作为兼容备选的心理储备，但不必在代码中同时实现两套。

4. Workflow 路径的「重新生成」按钮：**当前不做**。spec.md 7.2 原设计提到「重新生成」按钮，但决策 12 已明确 Workflow 路径不走 ToolInvocation，因此没有「重新生成」按钮挂载点。如需重新生成，用户直接再次点击生图按钮、修改 prompt 后提交即可（与"图片预览缩略图右下角的操作按钮"是不同概念）。原 spec.md 7.2 中"放大查看 / 下载图片 / 复制链接 / 重新生成"4 个按钮需在 Agent 路径 ToolInvocation 中实现，**Workflow 路径仅由 MarkdownRenderer 渲染原图，无操作按钮**（保持与现有 markdown 图片渲染一致）。

5. `num_inference_steps`（推理步数）：**不暴露给用户和 LLM**。硅基流动 API 支持此参数（Python SDK 中为 `extra_body={ "step": 20 }`）。**✅ 已验证**：HTTP 字段名 `num_inference_steps` 和 `step` 均被服务端接受。但当前默认不传，使用 Kolors 内置默认值。Agent 路径 LLM 不传此参数；Workflow 路径前端 UI 不提供此滑块。如未来需要高级用户控制，可在 `/api/generate-image` 路由 body 增 `numInferenceSteps` 字段（zod 校验 1-50 整数），代码层映射为 `step` 或 `num_inference_steps` 均可，UI 在面板底部折叠展开「高级选项」。

6. `navigator.clipboard.writeText` 兼容性：**仅 HTTPS / localhost 可用**。Agent 路径 ToolInvocation 的「复制链接」按钮使用 `navigator.clipboard.writeText()`，在非 HTTPS 部署环境下可能不可用。实现时须加 fallback：`navigator.clipboard?.writeText?.(...)`，失败时静默降级（不弹 toast），避免误导用户。

## 验证脚本

阻塞项验证已封装在 `scripts/verify-siliconflow-image-api.mjs`，运行方式：

```bash
node --env-file=.env scripts/verify-siliconflow-image-api.mjs
```

该脚本会依次探测：
1. 5 个 `image_size` 枚举值是否被 `Kwai-Kolors/Kolors` 接受
2. `image_size` 与 `size` 参数名是否兼容
3. `num_inference_steps` 与 `step` 参数名是否兼容

脚本内置 20 秒请求间隔和 429 限流重试。如未来硅基流动调整 API 行为，rerun 该脚本即可更新 openspec 中的验证结论。
