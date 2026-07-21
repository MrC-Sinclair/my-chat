## Requirements

### Requirement: 创建会话

`server/api/sessions.ts` SHALL 通过 `POST /api/sessions` 创建新会话：使用 `crypto.randomUUID()` 生成会话 ID，请求体（可选）`{ title?: string }` 不传或为空时 SHALL 自动生成默认标题 `新对话 ${new Date().toLocaleString('zh-CN')}`，插入数据库后返回新建会话记录 `{ id, title, createdAt, updatedAt }`。其他未支持的 HTTP 方法 SHALL 返回 `405 方法不允许`。

前端 `composables/useChatSession.ts` 的 `createNewSession()` SHALL 在切换 `currentSessionId` 之前保存旧值，若旧值非空则 fire-and-forget 触发上一个会话的归档（详见「会话切换归档」Requirement），然后调用 POST 接口、更新 `currentSessionId`、清空消息列表、重新拉取会话列表。创建失败 SHALL 通过 `useToast().error()` 提示「创建会话失败」。

#### Scenario: 请求体未传 title 时使用默认标题

- **WHEN** 客户端发送 `POST /api/sessions`，请求体为空或 `{ }`
- **THEN** 服务端使用 `crypto.randomUUID()` 生成会话 ID
- **AND** 标题自动生成为 `新对话 <当前日期时间的 zh-CN 本地化字符串>`
- **AND** 返回新建会话记录 `{ id, title, createdAt, updatedAt }`，title 为自动生成的默认值

#### Scenario: 请求体显式传入 title

- **WHEN** 客户端发送 `POST /api/sessions`，请求体为 `{ title: "我的对话" }`
- **THEN** 服务端使用请求体中的 title 插入数据库
- **AND** 返回新建会话记录，title 为「我的对话」

#### Scenario: 前端创建会话时触发上一个会话归档

- **WHEN** 用户当前会话 ID 为 `sess-A`，点击「新建会话」触发 `createNewSession()`
- **THEN** `useChatSession` 先把 `lastSessionId` 置为 `sess-A`
- **AND** fire-and-forget 调用 `POST /api/sessions/sess-A/archive-memory`（不阻塞主流程）
- **AND** 随后发起 `POST /api/sessions` 创建新会话并切换 `currentSessionId` 为新 ID

#### Scenario: 创建失败时提示错误

- **WHEN** POST 请求因网络或数据库异常失败
- **THEN** `useChatSession` 捕获错误并 `console.error` 记录
- **AND** 通过 `useToast().error()` 向用户展示「创建会话失败」提示

### Requirement: 会话列表

`server/api/sessions.ts` SHALL 通过 `GET /api/sessions` 返回所有会话列表：LEFT JOIN `messages` 表统计每个会话的消息数量，按 `sessions.updatedAt` 降序排列（最近活跃的会话排在前面），返回格式为 `[{ id, title, createdAt, updatedAt, messageCount }, ...]`。前端 `useChatSession.loadSessions()` SHALL 通过 `$fetch<SessionItem[]>('/api/sessions')` 拉取并赋值给 `sessionsList`，失败时 `console.error` 并通过 `useToast().error()` 提示「加载会话列表失败」。

#### Scenario: 返回按 updatedAt 倒序的会话列表

- **WHEN** 客户端发送 `GET /api/sessions`，数据库中存在会话 A（updatedAt 较新）和会话 B（updatedAt 较旧）
- **THEN** 服务端返回数组中会话 A 排在会话 B 之前
- **AND** 每条记录包含 `messageCount` 字段（通过 LEFT JOIN messages 表 + `count(messages.id)` 统计）
- **AND** 数组按 `sessions.updatedAt` 降序排列

#### Scenario: 会话无消息时 messageCount 为 0

- **WHEN** 数据库中存在一条会话记录但 messages 表中无关联消息
- **THEN** LEFT JOIN 仍返回该会话记录
- **AND** `messageCount` 字段为 0（由 `count(messages.id)` 在无匹配行时返回 0）

#### Scenario: 加载列表失败时提示错误

- **WHEN** `loadSessions()` 调用 `$fetch` 失败（网络错误或服务端异常）
- **THEN** `useChatSession` 捕获错误并 `console.error` 记录
- **AND** 通过 `useToast().error()` 向用户展示「加载会话列表失败」提示

### Requirement: 加载会话消息

`server/api/sessions/[id]/index.ts` SHALL 通过 `GET /api/sessions/:id` 返回指定会话的所有历史消息：从 `messages` 表查询 `sessionId` 等于路径参数的所有记录，按 `createdAt` 升序排列（最早的在前，符合聊天阅读顺序），返回格式为 `[{ id, sessionId, role, content, metadata, createdAt }, ...]`。前端 `useChatSession.switchSession(sessionId)` SHALL 在切换 `currentSessionId` 之前保存旧值并触发旧会话归档（详见「会话切换归档」Requirement），然后拉取消息列表：若列表非空则通过 `setMessages()` 写入聊天状态（每条消息转换为 `{ id, role, parts: [{ type: 'text', text }] }` 格式），若为空则清空消息列表。加载失败 SHALL 通过 `useToast().error()` 提示「加载会话消息失败」。

#### Scenario: 返回指定会话的全部消息按时间升序

- **WHEN** 客户端发送 `GET /api/sessions/sess-A`，该会话在 messages 表中有 3 条记录（createdAt 分别为 t1 < t2 < t3）
- **THEN** 服务端返回数组按 createdAt 升序排列（t1 在前、t3 在后）
- **AND** 每条记录包含 `{ id, sessionId, role, content, metadata, createdAt }` 完整字段

#### Scenario: 前端切换会话时拉取消息并写入聊天状态

- **WHEN** 用户在侧边栏点击会话 `sess-B`，触发 `switchSession("sess-B")`
- **AND** 当前 `currentSessionId` 为 `sess-A`（非空且不等于 `sess-B`）
- **THEN** 先将 `lastSessionId` 置为 `sess-A` 并 fire-and-forget 触发 `sess-A` 的归档
- **AND** 将 `currentSessionId` 切换为 `sess-B`
- **AND** 调用 `$fetch` 拉取 `/api/sessions/sess-B` 的消息列表
- **AND** 若列表非空则 `setMessages()` 写入消息（每条转为 `{ id, role, parts: [{ type: 'text', text: content }] }`），若为空则 `setMessages([])`

#### Scenario: 加载消息失败时提示错误

- **WHEN** `switchSession()` 调用 `$fetch` 失败
- **THEN** `useChatSession` 捕获错误并 `console.error` 记录
- **AND** 通过 `useToast().error()` 向用户展示「加载会话消息失败」提示
- **AND** `currentSessionId` 已切换为新值（消息加载失败不影响会话切换本身）

### Requirement: 重命名会话

`server/api/sessions/[id]/index.ts` SHALL 通过 `PATCH /api/sessions/:id` 修改会话标题：请求体 `{ title: string }` 必须存在、为字符串且 `trim()` 后非空，否则 SHALL 抛出 `createError({ statusCode: 400, statusMessage: '标题不能为空' })`；校验通过后 SHALL 通过 `db.update(sessions).set({ title: newTitle.trim(), updatedAt: new Date() }).where(eq(sessions.id, sessionId))` 原子更新（同时刷新 `updatedAt`），返回 `{ success: true }`。前端 `useChatSession.renameSession(sessionId, newTitle)` SHALL 调用此接口，成功后重新拉取会话列表并通过 `useToast().success()` 提示「重命名成功」，失败通过 `useToast().error()` 提示「重命名失败」。

#### Scenario: 提交合法新标题

- **WHEN** 客户端发送 `PATCH /api/sessions/sess-A`，请求体为 `{ title: "新标题" }`
- **THEN** 服务端 `trim()` 后校验非空通过
- **AND** 原子更新 sessions 表中 `title` 为「新标题」、`updatedAt` 为当前时间
- **AND** 返回 `{ success: true }`
- **AND** 前端重新拉取会话列表并 `toast.success('重命名成功')`

#### Scenario: 提交空标题被拒绝

- **WHEN** 客户端发送 `PATCH /api/sessions/sess-A`，请求体为 `{ title: "" }` 或 `{ title: "   " }`
- **THEN** 服务端 `trim()` 后判断为空
- **AND** 抛出 `createError({ statusCode: 400, statusMessage: '标题不能为空' })`
- **AND** 数据库中该会话的 title 不变

### Requirement: 删除会话

`server/api/sessions/[id]/index.ts` SHALL 通过 `DELETE /api/sessions/:id` 删除指定会话：执行 `db.delete(sessions).where(eq(sessions.id, sessionId))`，关联的 `messages`、`feedbacks`、`memory_vectors` 由数据库级联删除（详见「级联删除」Requirement），返回 `{ success: true }`。前端 `useChatSession.deleteSession(sessionId, event)` SHALL 在调用 DELETE 接口前通过 `useConfirmDialog()` 弹窗确认（详见「删除确认」Requirement），确认后发起请求；若删除的是当前会话 SHALL 清空 `currentSessionId` 和消息列表；无论删除的是哪个会话 SHALL 重新拉取会话列表，成功后 `toast.success('会话已删除')`，失败 `toast.error('删除会话失败')`。

#### Scenario: 删除当前会话并清空聊天状态

- **WHEN** 用户在 `currentSessionId === "sess-A"` 的状态下确认删除 `sess-A`
- **THEN** 前端发起 `DELETE /api/sessions/sess-A`
- **AND** 服务端删除 sessions 表中 `sess-A` 记录（关联 messages/feedbacks/memory_vectors 由数据库级联删除）
- **AND** 前端清空 `currentSessionId` 为空字符串、`setMessages([])`
- **AND** 重新拉取会话列表，`toast.success('会话已删除')`

#### Scenario: 删除非当前会话不影响聊天状态

- **WHEN** 用户在 `currentSessionId === "sess-A"` 的状态下确认删除 `sess-B`
- **THEN** 前端发起 `DELETE /api/sessions/sess-B`
- **AND** 服务端删除 `sess-B` 记录
- **AND** 前端 `currentSessionId` 保持为 `sess-A`，消息列表不变
- **AND** 重新拉取会话列表，`toast.success('会话已删除')`

### Requirement: 级联删除

`server/db/schema.ts` SHALL 在外键定义中声明 `onDelete: 'cascade'`，确保删除会话时自动级联删除所有关联数据。级联链路：`sessions (1:N) → messages (1:N) → feedbacks`，以及 `sessions (1:N) → memory_vectors` 和 `messages (1:N) → memory_vectors`。具体约束：`messages.sessionId` 引用 `sessions.id` 且 `onDelete: 'cascade'`；`feedbacks.messageId` 引用 `messages.id` 且 `onDelete: 'cascade'`；`memoryVectors.sessionId` 引用 `sessions.id` 且 `onDelete: 'cascade'`；`memoryVectors.messageId` 引用 `messages.id` 且 `onDelete: 'cascade'`。应用层 SHALL NOT 在删除会话前手动遍历并删除子表数据，依赖数据库级联保证一致性。

#### Scenario: 删除会话自动级联删除所有消息和反馈

- **WHEN** 服务端执行 `db.delete(sessions).where(eq(sessions.id, "sess-A"))`
- **AND** `sess-A` 在 messages 表中有 3 条消息，每条消息在 feedbacks 表中各有 2 条反馈
- **THEN** PostgreSQL 数据库自动级联删除该会话关联的 3 条 messages 记录
- **AND** 进一步级联删除这 3 条消息关联的 6 条 feedbacks 记录
- **AND** 同时级联删除 memory_vectors 表中 `sessionId = "sess-A"` 或其消息 ID 关联的所有向量记录
- **AND** 应用层不需要手动遍历删除子表

#### Scenario: 删除消息自动级联删除其反馈

- **WHEN** 服务端执行 `db.delete(messages).where(eq(messages.id, "msg-A"))`（不删除 session）
- **AND** `msg-A` 在 feedbacks 表中有 2 条反馈、在 memory_vectors 表中有 1 条向量
- **THEN** 数据库自动级联删除该消息关联的 2 条 feedbacks 记录
- **AND** 数据库自动级联删除 memory_vectors 表中 `messageId = "msg-A"` 的向量记录
- **AND** sessions 表中对应会话记录不受影响

### Requirement: 按时间分组展示

`components/chat/SessionSidebar.vue` SHALL 通过 `getDateGroup(dateStr)` 函数将每个会话按 `updatedAt` 归入四个分组之一：「今天」「昨天」「7天内」「更早」。分组判定基于会话 `updatedAt` 的日期部分与当前日期的比较：与今日同一天归入「今天」；与昨日同一天归入「昨天」；7 天内（早于昨日但晚于 7 天前）归入「7天内」；其余归入「更早」。`groupedSessions` computed SHALL 按 `['今天', '昨天', '7天内', '更早']` 固定顺序输出，且仅输出有会话的分组（空分组不渲染）。

#### Scenario: 今天的会话归入「今天」分组

- **WHEN** 当前时间为 `2026-07-21 14:00`，会话 X 的 `updatedAt` 为 `2026-07-21 08:30`
- **THEN** `getDateGroup` 返回「今天」
- **AND** 该会话出现在 `groupedSessions` 的「今天」分组中

#### Scenario: 昨天的会话归入「昨天」分组

- **WHEN** 当前时间为 `2026-07-21 14:00`，会话 Y 的 `updatedAt` 为 `2026-07-20 22:15`
- **THEN** `getDateGroup` 返回「昨天」
- **AND** 该会话出现在 `groupedSessions` 的「昨天」分组中

#### Scenario: 7 天内的会话归入「7天内」分组

- **WHEN** 当前时间为 `2026-07-21 14:00`，会话 Z 的 `updatedAt` 为 `2026-07-18`（3 天前）
- **THEN** `getDateGroup` 返回「7天内」
- **AND** 该会话出现在 `groupedSessions` 的「7天内」分组中

#### Scenario: 超过 7 天的会话归入「更早」分组

- **WHEN** 当前时间为 `2026-07-21 14:00`，会话 W 的 `updatedAt` 为 `2026-07-10`（11 天前）
- **THEN** `getDateGroup` 返回「更早」
- **AND** 该会话出现在 `groupedSessions` 的「更早」分组中

#### Scenario: 空分组不渲染

- **WHEN** 当前会话列表中没有「昨天」分组的会话
- **THEN** `groupedSessions` computed 通过 `order.filter((g) => groups[g]?.length)` 过滤掉空分组
- **AND** 「昨天」分组标题与列表项不渲染到 DOM

### Requirement: 相对时间格式化

`components/chat/SessionSidebar.vue` SHALL 通过 `formatRelativeTime(dateStr)` 函数将会话的 `updatedAt` 格式化为相对时间字符串。规则：差值 < 1 分钟返回「刚刚」；< 60 分钟返回「N 分钟前」（N 为整数分钟）；< 24 小时返回「N 小时前」（N 为整数小时）；< 7 天返回「N 天前」（N 为整数天）；≥ 7 天使用 `date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })` 显示日期。时间差基于 `now.getTime() - date.getTime()` 的毫秒差向下取整计算。

#### Scenario: 不到 1 分钟显示「刚刚」

- **WHEN** 当前时间为 `2026-07-21 14:00:00`，会话 `updatedAt` 为 `2026-07-21 13:59:30`（30 秒前）
- **THEN** `formatRelativeTime` 返回「刚刚」

#### Scenario: 不到 1 小时显示「N 分钟前」

- **WHEN** 当前时间为 `2026-07-21 14:00:00`，会话 `updatedAt` 为 `2026-07-21 13:35:00`（25 分钟前）
- **THEN** `formatRelativeTime` 返回「25 分钟前」

#### Scenario: 不到 24 小时显示「N 小时前」

- **WHEN** 当前时间为 `2026-07-21 14:00:00`，会话 `updatedAt` 为 `2026-07-21 09:00:00`（5 小时前）
- **THEN** `formatRelativeTime` 返回「5 小时前」

#### Scenario: 不到 7 天显示「N 天前」

- **WHEN** 当前时间为 `2026-07-21 14:00:00`，会话 `updatedAt` 为 `2026-07-19 09:00:00`（2 天前）
- **THEN** `formatRelativeTime` 返回「2 天前」

#### Scenario: 超过 7 天显示日期

- **WHEN** 当前时间为 `2026-07-21 14:00:00`，会话 `updatedAt` 为 `2026-07-10 09:00:00`（11 天前）
- **THEN** `formatRelativeTime` 返回 `date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })` 的结果（如「7月10日」）

### Requirement: 双击重命名

`components/chat/SessionSidebar.vue` SHALL 支持两种方式进入重命名编辑模式：双击会话标题（通过 `@dblclick.stop="startRename(session)"` 触发），或点击会话项右侧的「重命名」图标按钮（`v-tooltip="'重命名'"` 包裹，`@click.stop="startRename(session)"` 触发）。`startRename(session)` SHALL 将 `renamingId` 置为该会话 ID、`renamingText` 置为当前 `session.title`。进入编辑模式后渲染 `<input>` 替换标题文本，input SHALL 绑定以下事件：`@keydown.enter="confirmRename"`（Enter 确认）、`@keydown.escape="cancelRename"`（Escape 取消）、`@blur="confirmRename"`（失焦自动确认）、`@click.stop`（阻止冒泡到会话项的 switch 事件）。

`confirmRename()` SHALL 对 `renamingText` 执行 `trim()`，若结果非空则 `emit('rename', renamingId, trimmed)` 触发父组件调用 `renameSession`，最后清空 `renamingId` 与 `renamingText`。`cancelRename()` SHALL 仅清空 `renamingId` 与 `renamingText`，不发起任何请求。

#### Scenario: 双击标题进入编辑模式

- **WHEN** 用户双击会话项中的标题文本（`session.id === "sess-A"`，`session.title === "旧标题"`）
- **THEN** `startRename(session)` 被触发，`renamingId` 置为 `"sess-A"`，`renamingText` 置为「旧标题」
- **AND** 标题文本被 `<input v-model="renamingText">` 替换，input 内显示「旧标题」
- **AND** `@dblclick.stop` 阻止事件冒泡到会话项的 `@click="emit('switch', ...)"`

#### Scenario: 点击编辑图标按钮进入编辑模式

- **WHEN** 用户点击会话项右侧的「重命名」图标按钮
- **THEN** `startRename(session)` 被触发，进入编辑模式
- **AND** `@click.stop` 阻止事件冒泡到会话项的 switch 事件

#### Scenario: Enter 确认重命名

- **WHEN** 用户在编辑模式的 input 中修改文本为「新标题」后按下 Enter 键
- **THEN** `confirmRename()` 被触发，`trim()` 后「新标题」非空
- **AND** `emit('rename', renamingId, "新标题")` 触发父组件调用 `renameSession`
- **AND** `renamingId` 与 `renamingText` 被清空，退出编辑模式

#### Scenario: Escape 取消重命名

- **WHEN** 用户在编辑模式的 input 中按下 Escape 键
- **THEN** `cancelRename()` 被触发
- **AND** `renamingId` 与 `renamingText` 被清空，退出编辑模式
- **AND** 不发起任何重命名请求，标题保持原值

#### Scenario: 失焦自动确认

- **WHEN** 用户在编辑模式的 input 中修改文本后点击页面其他区域导致 input 失焦
- **THEN** `confirmRename()` 被触发（与 Enter 行为一致）
- **AND** 若 `trim()` 后非空则 emit rename 事件，否则仅清空状态不发起请求

#### Scenario: 提交空标题不发起请求

- **WHEN** 用户清空 input 内容（或仅输入空格）后触发 `confirmRename()`
- **THEN** `trim()` 后为空字符串，`confirmRename()` 跳过 emit
- **AND** `renamingId` 与 `renamingText` 被清空，退出编辑模式
- **AND** 不调用 `renameSession`，标题保持原值

### Requirement: 删除确认

`composables/useChatSession.ts` 的 `deleteSession(sessionId, event?)` SHALL 在发起 DELETE 请求前通过 `useConfirmDialog()` 弹窗确认，禁止无确认直接删除。`event?.stopPropagation()` SHALL 阻止点击事件冒泡到会话项的 switch 事件。`dialog.open()` 接收 `{ title: '删除会话', message: '确定删除该会话？删除后无法恢复。' }`，返回 `confirmed: boolean`：若 `false` SHALL 直接 return 不发请求；若 `true` 才发起 `DELETE /api/sessions/:id`。确认后的行为详见「删除会话」Requirement。

#### Scenario: 用户确认删除后执行删除

- **WHEN** 用户点击会话项右侧的「删除」图标按钮
- **AND** `useConfirmDialog` 弹窗显示「删除会话 / 确定删除该会话？删除后无法恢复。」
- **AND** 用户点击「确认」按钮，`dialog.open()` 返回 `true`
- **THEN** 前端发起 `DELETE /api/sessions/<sessionId>` 请求
- **AND** 后续按「删除会话」Requirement 处理（清空状态、重新拉取列表、toast 成功）

#### Scenario: 用户取消删除不发请求

- **WHEN** 用户点击「删除」图标按钮
- **AND** `useConfirmDialog` 弹窗显示
- **AND** 用户点击「取消」按钮或关闭弹窗，`dialog.open()` 返回 `false`
- **THEN** `deleteSession` 直接 return，不发任何 DELETE 请求
- **AND** 数据库中该会话记录不受影响
- **AND** 不重新拉取会话列表

#### Scenario: 删除按钮点击事件不冒泡到会话切换

- **WHEN** 用户点击会话项中的「删除」图标按钮
- **THEN** `event.stopPropagation()` 阻止事件冒泡
- **AND** 会话项的 `@click="emit('switch', ...)"` 不被触发
- **AND** 不会出现「既打开删除确认弹窗又切换到该会话」的副作用

### Requirement: 会话切换归档

`composables/useChatSession.ts` SHALL 在会话切换时通过 `triggerArchive(sessionId)` fire-and-forget 调用 `POST /api/sessions/:id/archive-memory`，将上一个会话的短期记忆归档为长期记忆。归档触发时机：`createNewSession()` 和 `switchSession(sessionId)` 中，在修改 `currentSessionId` 之前保存旧值为 `previousSessionId`，仅当 `previousSessionId` 非空且（在 switchSession 场景下）不等于目标 `sessionId` 时才触发归档，同时将 `lastSessionId.value` 置为 `previousSessionId` 供 `chat.post.ts` 的 `DefaultChatTransport.body` 读取。

`triggerArchive()` SHALL 不 `await` 完成以避免阻塞会话切换；失败仅 `console.error` 记录，不弹 toast（归档是增强操作，失败不影响主流程）。前端 SHALL 通过 `archivingSessions: Set<string>` 防重复守卫避免同一会话归档进行中时重复请求；`finally` 分支 SHALL 移除守卫以允许后续重试。

#### Scenario: 切换到另一个会话时触发旧会话归档

- **WHEN** 当前 `currentSessionId === "sess-A"`，用户点击侧边栏会话 `sess-B` 触发 `switchSession("sess-B")`
- **THEN** `previousSessionId = "sess-A"`（非空且不等于 `sess-B`）
- **AND** `lastSessionId.value` 被置为 `"sess-A"`
- **AND** `triggerArchive("sess-A")` 被 fire-and-forget 调用 `POST /api/sessions/sess-A/archive-memory`
- **AND** 不 await 完成即继续后续切换流程（更新 currentSessionId、拉取消息）

#### Scenario: 创建新会话时触发旧会话归档

- **WHEN** 当前 `currentSessionId === "sess-A"`，用户点击「新建会话」触发 `createNewSession()`
- **THEN** `previousSessionId = "sess-A"`（非空）
- **AND** `lastSessionId.value` 被置为 `"sess-A"`
- **AND** `triggerArchive("sess-A")` 被 fire-and-forget 调用
- **AND** 随后继续创建新会话流程

#### Scenario: 首次进入无旧会话不触发归档

- **WHEN** `currentSessionId` 为空字符串（首次加载或刚删除当前会话）
- **AND** 用户点击侧边栏某个会话或新建会话
- **THEN** `previousSessionId` 为空字符串
- **AND** `triggerArchive` 不被调用
- **AND** `lastSessionId.value` 保持为空字符串

#### Scenario: 切换到当前已选会话不触发归档

- **WHEN** 当前 `currentSessionId === "sess-A"`，用户再次点击 `sess-A`（switchSession 场景）
- **THEN** `previousSessionId === "sess-A"` 等于目标 `sessionId`
- **AND** `triggerArchive` 不被调用（条件 `previousSessionId !== sessionId` 不满足）
- **AND** `lastSessionId.value` 不被修改

#### Scenario: 归档失败不影响主流程

- **WHEN** `triggerArchive("sess-A")` 发起的 `POST /api/sessions/sess-A/archive-memory` 请求失败
- **THEN** `.catch` 分支仅 `console.error` 记录错误
- **AND** 不通过 `useToast()` 弹任何错误提示
- **AND** `.finally` 分支从 `archivingSessions` Set 中移除 `"sess-A"`
- **AND** 会话切换流程正常完成

#### Scenario: 同一会话归档进行中不重复请求

- **WHEN** `triggerArchive("sess-A")` 已发起但未完成（`archivingSessions` 中存在 `"sess-A"`）
- **AND** 用户快速操作再次触发 `triggerArchive("sess-A")`
- **THEN** 函数在 `if (archivingSessions.has(sessionId)) return` 处直接返回
- **AND** 不发起第二次 `POST /api/sessions/sess-A/archive-memory` 请求
- **AND** 等首次请求 `finally` 分支移除守卫后，后续触发才会再次发起

### Requirement: 路径参数 UUID 校验

会话管理 API 的 `:id` 路径参数 SHALL 接受标准 UUID 格式。校验分两层：

1. **通用 UUID 格式校验（security.ts 中间件）**：`server/middleware/security.ts` SHALL 对匹配 `/^\/api\/sessions\/[^/]+$/` 的路径（即 `/api/sessions/:id` 但不匹配子路径如 `/api/sessions/:id/archive-memory`）执行通用 UUID 格式校验，正则 `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`，不通过 SHALL 抛出 `createError({ statusCode: 400, statusMessage: '会话ID格式无效' })`。该校验对 `GET / DELETE / PATCH /api/sessions/:id` 三种方法生效。
2. **严格 UUID v4 校验（路由内）**：`server/api/sessions/[id]/archive-memory.post.ts` SHALL 在路由内对 `:id` 执行严格 UUID v4 校验，正则 `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`（第 3 段以 `4` 开头、第 4 段以 `8/9/a/b` 开头），不通过 SHALL 抛出 `createError({ statusCode: 400, statusMessage: '会话ID格式无效（要求标准 UUID v4）' })`。

`server/api/sessions/[id]/index.ts` 自身 SHALL NOT 重复 UUID 校验，依赖 security.ts 中间件拦截非法格式。

#### Scenario: /api/sessions/:id 接受合法 UUID

- **WHEN** 客户端发送 `GET /api/sessions/550e8400-e29b-41d4-a716-446655440000`
- **THEN** security.ts 中间件通过通用 UUID 格式校验
- **AND** 请求继续进入 `[id]/index.ts` 的 GET handler
- **AND** 返回该会话的消息列表

#### Scenario: /api/sessions/:id 拒绝非 UUID 字符串

- **WHEN** 客户端发送 `DELETE /api/sessions/not-a-uuid`
- **THEN** security.ts 中间件检测到 `not-a-uuid` 不匹配通用 UUID 正则
- **AND** 抛出 `createError({ statusCode: 400, statusMessage: '会话ID格式无效' })`
- **AND** 请求不进入 `[id]/index.ts` 的 DELETE handler

#### Scenario: archive-memory 接口拒绝非 v4 的 UUID

- **WHEN** 客户端发送 `POST /api/sessions/550e8400-e29b-31d4-a716-446655440000/archive-memory`（第 3 段以 `3` 开头，是 UUID v3 而非 v4）
- **THEN** 该路径不匹配 security.ts 的 `/^\/api\/sessions\/[^/]+$/` 正则（因为有 `/archive-memory` 子路径），security.ts 不校验
- **AND** `archive-memory.post.ts` 路由内 `UUID_V4_REGEX` 检测到第 3 段不以 `4` 开头
- **AND** 抛出 `createError({ statusCode: 400, statusMessage: '会话ID格式无效（要求标准 UUID v4）' })`

#### Scenario: archive-memory 接口接受合法 UUID v4

- **WHEN** 客户端发送 `POST /api/sessions/550e8400-e29b-41d4-a716-446655440000/archive-memory`（合法 UUID v4）
- **THEN** `archive-memory.post.ts` 路由内 `UUID_V4_REGEX` 校验通过（第 3 段以 `4` 开头、第 4 段以 `a` 开头）
- **AND** 请求继续执行后续会话存在性校验和归档逻辑
