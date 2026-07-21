## Requirements

### Requirement: POST /api/messages 接口为 Workflow 路径提供单条消息保存能力

`server/api/messages.post.ts` SHALL 暴露 `POST /api/messages` HTTP 接口，用于 Workflow 路径（代码预编排）在独立 API 调用后保存单条消息到 `messages` 表。此接口与 `chat.post.ts` 的 `onFinish` 流式持久化逻辑互斥：`chat.post.ts` 处理 Agent 路径的对话落库（在 `streamText` 的 `onFinish` 回调中执行），本接口处理 Workflow 路径（如生图）的独立落库需求。调用时机由前端代码预编排决定（例如前端调用 `/api/generate-image` 成功后发起本接口调用），不由 LLM 决策。本接口遵循项目「新增 API 路由时必须包含参数校验和 `createError()` 错误处理」的硬性规则。修改此接口的入参/返回值/业务逻辑后必须同步更新 `docs/API.md`，禁止代码与文档脱节。

#### Scenario: 生图 Workflow 调用本接口保存 assistant 消息

- **WHEN** 前端调用 `/api/generate-image` 拿到 markdown 图片结果后，发起 `POST /api/messages`，body 为 `{ sessionId: "<uuid>", role: "assistant", content: "![image](https://...)", metadata: { source: "generate-image" } }`
- **THEN** 服务端校验通过、会话存在，消息插入 `messages` 表
- **AND** 返回 `{ success: true, messageId: "<uuid>" }`，HTTP 200

#### Scenario: Workflow 路径不参与 LLM 工具调用循环

- **WHEN** 检查 `messages.post.ts` 的实现
- **THEN** 接口不调用 `streamText`、不注册 `tools`、不依赖 `maxSteps`/`stopWhen`
- **AND** 控制流由代码预编排（参数校验 → 会话校验 → 插入 → 更新会话时间 → 返回），符合 Workflow 路径定义

### Requirement: 请求体参数通过 zod schema 严格校验

`messages.post.ts` SHALL 使用 zod 定义 `messageSchema`，对 `readBody(event)` 的请求体执行 `safeParse` 校验，校验失败时通过 `createError({ statusCode: 400, statusMessage: '参数校验失败: <错误消息>' })` 抛出错误。Schema 字段约束如下：

- `sessionId`: `z.string().uuid('sessionId 必须是有效的 UUID')`，必填
- `role`: `z.enum(['user', 'assistant', 'system'])`，必填，仅接受三种枚举值
- `content`: `z.string().min(1, 'content 不能为空')`，必填，非空字符串
- `metadata`: `z.record(z.unknown()).optional()`，可选任意键值对象

错误消息由 `validation.error.issues.map((i) => i.message).join(', ')` 拼接而成，可能包含多个字段错误。

#### Scenario: 合法请求体通过校验

- **WHEN** 请求 body 为 `{ sessionId: "550e8400-e29b-41d4-a716-446655440000", role: "assistant", content: "Hello", metadata: { foo: "bar" } }`
- **THEN** `messageSchema.safeParse` 返回 `success: true`
- **AND** 接口继续执行会话校验流程

#### Scenario: sessionId 缺失或非 UUID 返回 400

- **WHEN** 请求 body 缺少 `sessionId`，或 `sessionId` 为 `"not-a-uuid"`
- **THEN** 校验失败，接口抛出 `createError({ statusCode: 400, statusMessage: "参数校验失败: sessionId 必须是有效的 UUID" })`
- **AND** HTTP 响应状态码为 400

#### Scenario: role 不在枚举范围内返回 400

- **WHEN** 请求 body 的 `role` 为 `"bot"`、`"function"`、`"tool"` 或缺失
- **THEN** 校验失败，HTTP 响应状态码为 400
- **AND** statusMessage 包含 zod 的 `Invalid enum value` 错误信息

#### Scenario: content 为空字符串返回 400

- **WHEN** 请求 body 的 `content` 为 `""` 或缺失
- **THEN** 校验失败，HTTP 响应状态码为 400，statusMessage 包含 "content 不能为空"

#### Scenario: metadata 缺失时仍通过校验

- **WHEN** 请求 body 不包含 `metadata` 字段
- **THEN** `messageSchema.safeParse` 返回 `success: true`，`metadata` 解析为 `undefined`
- **AND** 接口继续执行后续流程

### Requirement: 插入消息前校验 sessionId 在 sessions 表存在

`messages.post.ts` SHALL 在插入消息前执行 `db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) })` 查询会话是否存在。若查询结果为空，MUST 通过 `createError({ statusCode: 404, statusMessage: '会话不存在' })` 抛出错误，且不执行插入操作。此校验避免违反外键约束（`messages.sessionId` 关联 `sessions.id`）和数据孤儿。

#### Scenario: sessionId 对应会话存在

- **WHEN** 请求 body 的 `sessionId` 在 `sessions` 表中存在记录
- **THEN** 接口继续执行消息插入流程
- **AND** 不抛出 404 错误

#### Scenario: sessionId 对应会话不存在返回 404

- **WHEN** 请求 body 的 `sessionId` 为合法 UUID 但在 `sessions` 表中无记录
- **THEN** 接口抛出 `createError({ statusCode: 404, statusMessage: "会话不存在" })`
- **AND** 不执行 `db.insert(messages)` 操作
- **AND** HTTP 响应状态码为 404

### Requirement: 消息插入 messages 表并同步更新会话时间

`messages.post.ts` SHALL 使用 `crypto.randomUUID()` 生成 `messageId`，通过 `db.insert(messages).values({ id: messageId, sessionId, role, content, metadata: metadata || undefined, createdAt: new Date() })` 插入 `messages` 表。插入成功后 SHALL 同步执行 `db.update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, sessionId))` 更新会话的 `updatedAt` 字段，保证会话列表按最新活动时间排序。`metadata` 为 `undefined` 时数据库写入 NULL，不为空时写入 JSON 对象。整个插入+更新流程 MUST 包裹在 `try-catch` 中。

#### Scenario: 成功插入消息并更新会话时间

- **WHEN** 请求通过参数校验和会话校验，数据库操作无异常
- **THEN** 接口生成 `crypto.randomUUID()` 作为 `messageId`
- **AND** 执行 `db.insert(messages).values({ id: messageId, sessionId, role, content, metadata: metadata || undefined, createdAt: new Date() })`
- **AND** 执行 `db.update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, sessionId))`
- **AND** 返回 `{ success: true, messageId: "<uuid>" }`，HTTP 200

#### Scenario: metadata 为空时写入 undefined

- **WHEN** 请求 body 未提供 `metadata` 字段，或 `metadata` 为 `undefined`
- **THEN** 插入 `messages` 表时 `metadata` 字段传入 `undefined`（数据库存储 NULL）
- **AND** 接口正常返回 `messageId`，不报错

#### Scenario: metadata 为对象时写入 JSON

- **WHEN** 请求 body 的 `metadata` 为 `{ source: "generate-image", url: "https://..." }`
- **THEN** 插入 `messages` 表时 `metadata` 字段保存为 JSON 对象
- **AND** 接口正常返回 `messageId`

### Requirement: 错误处理覆盖参数、会话、数据库三层失败场景

`messages.post.ts` SHALL 通过 `createError()` 显式处理三类错误：1) 参数校验失败返回 HTTP 400 + 拼接的错误消息；2) 会话不存在返回 HTTP 404 + "会话不存在"；3) 数据库操作异常（插入或更新失败）返回 HTTP 500 + "保存消息失败"。数据库错误 MUST 通过 `try-catch` 捕获，使用 `console.error('[messages.post] 保存消息失败:', err)` 记录原始错误用于排查，但不向客户端暴露堆栈、SQL 语句或内部细节。所有错误路径通过 `throw createError(...)` 中断执行流，由 Nuxt 的错误处理器统一返回 JSON 错误响应。

#### Scenario: 参数校验失败返回 400

- **WHEN** 请求 body 缺少必填字段或字段类型不匹配
- **THEN** 接口返回 HTTP 400
- **AND** statusMessage 为 "参数校验失败: <具体错误消息列表>"（由 `validation.error.issues.map((i) => i.message).join(', ')` 拼接）

#### Scenario: 会话不存在返回 404

- **WHEN** `sessionId` 为合法 UUID 但 `db.query.sessions.findFirst` 返回空
- **THEN** 接口返回 HTTP 404，statusMessage 为 "会话不存在"
- **AND** 不进入 `try-catch` 数据库插入分支

#### Scenario: 数据库插入失败返回 500

- **WHEN** `db.insert(messages)` 抛出异常（如连接断开、唯一约束冲突、外键错误）
- **THEN** `try-catch` 捕获异常，`console.error('[messages.post] 保存消息失败:', err)` 记录原始错误
- **AND** 接口返回 HTTP 500，statusMessage 为 "保存消息失败"
- **AND** 响应 body 不包含原始错误堆栈或 SQL 语句

#### Scenario: sessions.updatedAt 更新失败返回 500

- **WHEN** 消息插入成功但 `db.update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, sessionId))` 抛出异常
- **THEN** `try-catch` 捕获异常，返回 HTTP 500，statusMessage 为 "保存消息失败"
- **AND** 消息已插入但 `sessions.updatedAt` 未更新（数据一致性影响：会话列表排序可能略滞后，下次消息保存时会再次尝试更新）

### Requirement: 返回值结构为 { success: true, messageId: string }

`messages.post.ts` SHALL 在成功路径返回 `{ success: true, messageId: string }` 结构，其中 `messageId` 为 `crypto.randomUUID()` 生成的 UUID v4 字符串。`success` 字段固定为 `true`（失败路径通过 `throw createError` 中断，不会返回 `success: false`）。此返回结构 MUST 与 `docs/API.md` 文档保持一致，修改入参/返回值/业务逻辑后必须同步更新 `docs/API.md`，禁止代码与文档脱节。

#### Scenario: 成功返回 messageId

- **WHEN** 请求完整通过参数校验、会话校验、数据库插入及会话时间更新
- **THEN** HTTP 响应状态码为 200
- **AND** 响应 body 为 `{ success: true, messageId: "<UUID v4 字符串>" }`

#### Scenario: messageId 为合法 UUID v4 格式

- **WHEN** 接口成功返回
- **THEN** `messageId` 字段为 `crypto.randomUUID()` 生成的字符串
- **AND** 符合 UUID v4 格式（8-4-4-4-12 十六进制字符，如 `550e8400-e29b-41d4-a716-446655440000`）

#### Scenario: 失败路径不返回 success: false

- **WHEN** 请求在参数校验、会话校验或数据库操作任一阶段失败
- **THEN** 接口通过 `throw createError(...)` 抛出错误，不进入 `return { success: true, ... }` 分支
- **AND** 响应 body 为 Nuxt 错误处理器的标准 JSON 错误结构（包含 `statusCode`、`statusMessage`、`message` 等字段），不含 `success` 字段
