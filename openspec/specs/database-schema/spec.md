## Requirements

### Requirement: sessions 表结构定义

`server/db/schema.ts` SHALL 通过 Drizzle ORM 的 `pgTable` 定义名为 `sessions` 的数据表，作为聊天会话的根聚合。表 MUST 包含以下列：
- `id`（数据库列名 `id`）：text 类型，主键，存储 UUID v4 字符串（由 `crypto.randomUUID()` 生成）
- `title`（数据库列名 `title`）：text 类型，可空，存储会话标题（如「新对话 2026/4/8 10:30:00」）
- `createdAt`（数据库列名 `created_at`）：timestamp 类型，非空，默认 `now()`
- `updatedAt`（数据库列名 `updated_at`）：timestamp 类型，非空，默认 `now()`，在每次保存消息时由代码手动更新

TypeScript 属性名采用 camelCase，数据库列名采用 snake_case，二者通过 `pgTable` 第二参数映射。

#### Scenario: 新建会话时插入 sessions 记录

- **WHEN** 用户点击「新建会话」按钮触发后端创建会话
- **THEN** 系统向 `sessions` 表插入一条记录，`id` 为 `crypto.randomUUID()` 生成的 UUID v4 字符串
- **AND** `created_at` 和 `updated_at` 均自动填充为数据库当前时间
- **AND** `title` 字段可为 NULL 或填入生成的默认标题

#### Scenario: 消息保存时 updatedAt 被手动更新

- **WHEN** `saveMessagesToDb` 完成消息插入后
- **THEN** 执行 `db.update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, sessionId))`
- **AND** `updated_at` 列更新为当前时间戳，用于会话列表按最近活跃时间排序

### Requirement: messages 表结构定义

`server/db/schema.ts` SHALL 通过 `pgTable` 定义名为 `messages` 的数据表，存储每条聊天消息。表 MUST 包含以下列：
- `id`：text 类型，主键，UUID v4
- `sessionId`（数据库列名 `session_id`）：text 类型，外键关联 `sessions.id`，`onDelete: 'cascade'`
- `role`：text 类型，非空，取值 `'user'` | `'assistant'` | `'system'`
- `content`：text 类型，非空，消息文本内容
- `metadata`：jsonb 类型，可空，存储附加元数据
- `createdAt`（数据库列名 `created_at`）：timestamp 类型，非空，默认 `now()`

#### Scenario: 用户消息和 AI 消息分别落库

- **WHEN** `streamText` 的 `onFinish` 回调触发 `saveMessagesToDb`
- **THEN** 向 `messages` 表插入一条 `role='user'` 的用户消息记录
- **AND** 向 `messages` 表插入一条 `role='assistant'` 的 AI 回复记录
- **AND** 两条记录的 `session_id` 均指向当前会话

#### Scenario: role 字段支持 system 取值

- **WHEN** 数据库中存在 `role='system'` 的记录
- **THEN** schema 不对 role 取值做枚举约束（text 类型自由存储）
- **AND** 业务代码在送入 LLM 前会过滤掉 system 消息

### Requirement: feedbacks 表结构定义

`server/db/schema.ts` SHALL 通过 `pgTable` 定义名为 `feedbacks` 的数据表，存储用户对 AI 回复的反馈。表 MUST 包含以下列：
- `id`：text 类型，主键，UUID v4
- `messageId`（数据库列名 `message_id`）：text 类型，外键关联 `messages.id`，`onDelete: 'cascade'`
- `type`：text 类型，非空，取值 `'like'` 或 `'dislike'`（标识反馈类型）
- `createdAt`（数据库列名 `created_at`）：timestamp 类型，非空，默认 `now()`

#### Scenario: 用户对 AI 回复点赞

- **WHEN** 用户点击 AI 消息上的点赞按钮
- **THEN** 向 `feedbacks` 表插入一条记录，`type='like'`，`message_id` 指向被点赞的 AI 消息 id

#### Scenario: 删除消息时反馈级联清除

- **WHEN** 一条 `messages` 记录被删除
- **THEN** 关联的所有 `feedbacks` 记录由数据库自动级联删除（`onDelete: 'cascade'`）
- **AND** 应用层无需显式删除反馈

### Requirement: sessions → messages → feedbacks 级联删除链

`server/db/schema.ts` SHALL 通过外键 `onDelete: 'cascade'` 约束建立三级级联删除链：`sessions (1:N) → messages (1:N) → feedbacks`。删除 `sessions` 记录时，数据库 MUST 自动删除该会话下所有 `messages` 记录，并连带删除这些消息关联的所有 `feedbacks` 记录。应用层无需手动遍历删除子记录。

#### Scenario: 删除会话级联清理全部子记录

- **WHEN** 用户删除一个会话（如调用 `DELETE /api/sessions/:id`）
- **THEN** 该 `sessions` 记录被删除
- **AND** 所有 `session_id` 指向该会话的 `messages` 记录被数据库自动删除
- **AND** 所有 `message_id` 指向上述 messages 的 `feedbacks` 记录被数据库自动删除
- **AND** 应用层不发出针对 `messages` 或 `feedbacks` 的 DELETE 语句

#### Scenario: 单独删除消息时仅清理该消息的反馈

- **WHEN** 删除一条 `messages` 记录（不删除会话）
- **THEN** 仅该消息关联的 `feedbacks` 记录被级联删除
- **AND** 同会话下其他消息不受影响

### Requirement: PostgreSQL 连接配置（非默认端口）

`server/db/index.ts` SHALL 通过 `postgres`（postgres.js）客户端连接 PostgreSQL，连接字符串从 `process.env.DATABASE_URL` 读取。开发环境数据库端口 MUST 为 **5434**（非 PostgreSQL 默认 5432），测试环境端口 MUST 为 **5433**，由 `.env` / `.env.example` 配置：
- `DATABASE_URL=postgresql://sw_pad:sw_pad_2026@localhost:5434/sw_pad`
- `DATABASE_TEST_URL=postgresql://sw_pad_test:sw_pad_test@localhost:5433/sw_pad_test`

`db` Drizzle 实例 MUST 通过 `drizzle(sql, { schema })` 构造，传入完整 schema 对象以支持关联查询。模块加载时 MUST 幂等执行 `CREATE EXTENSION IF NOT EXISTS vector`（用于 pgvector 扩展，支撑 `memory_vectors` 表），不阻塞模块导出。

#### Scenario: 开发环境连接 5434 端口

- **WHEN** 开发者执行 `pnpm dev` 启动服务
- **THEN** `server/db/index.ts` 读取 `DATABASE_URL`，连接 `localhost:5434` 的 `sw_pad` 数据库
- **AND** 不连接默认端口 5432

#### Scenario: 测试环境连接 5433 端口

- **WHEN** 测试套件初始化数据库连接
- **THEN** 使用 `DATABASE_TEST_URL`，连接 `localhost:5433` 的 `sw_pad_test` 数据库
- **AND** 与开发数据库隔离，互不污染

#### Scenario: DATABASE_URL 缺失时降级为空字符串

- **WHEN** `process.env.DATABASE_URL` 未设置
- **THEN** `postgres(process.env.DATABASE_URL || '')` 以空字符串兜底
- **AND** 后续数据库操作会抛出连接错误，由调用方处理

#### Scenario: pgvector 扩展幂等启用

- **WHEN** 服务启动加载 `server/db/index.ts`
- **THEN** 异步执行 `CREATE EXTENSION IF NOT EXISTS vector`
- **AND** 不 `await` 阻塞模块导出，失败时仅记录日志不中断启动

### Requirement: Drizzle ORM 工具链配置

项目 MUST 使用 Drizzle ORM（`drizzle-orm ^0.36.0`）配合 postgres.js 客户端（`postgres ^3.4.5`）操作 PostgreSQL，并通过 Drizzle Kit（`drizzle-kit ^0.29.0`）管理 Schema 同步。`drizzle.config.ts` MUST 配置：
- `schema: './server/db/schema.ts'`（Schema 来源文件）
- `out: './drizzle'`（迁移文件输出目录）
- `dialect: 'postgresql'`
- `dbCredentials.url: process.env.DATABASE_URL!`

`package.json` MUST 提供以下脚本：
- `pnpm db:push` → `drizzle-kit push`（推送 Schema 变更到数据库，开发环境推荐）
- `pnpm db:studio` → `drizzle-kit studio`（打开 Drizzle Studio 可视化界面）
- `pnpm db:generate` → `drizzle-kit generate`（生成 SQL 迁移文件）

#### Scenario: 修改 schema.ts 后推送变更

- **WHEN** 开发者修改 `server/db/schema.ts`（如新增列或表）
- **THEN** 必须运行 `pnpm db:push` 将变更同步到数据库
- **AND** 必须同步更新 `docs/db-schema.md`（表结构唯一文档来源）
- **AND** 不允许仅修改 schema.ts 而不推送

#### Scenario: 可视化查看数据库

- **WHEN** 开发者运行 `pnpm db:studio`
- **THEN** 启动 Drizzle Studio，浏览器打开数据库可视化管理界面
- **AND** 可查看 sessions / messages / feedbacks / memory_vectors 表数据

### Requirement: messages.metadata JSONB 字段

`messages` 表的 `metadata` 列 MUST 为 JSONB 类型，可空，用于存储消息的附加元数据。`saveMessagesToDb` SHALL 按以下规则写入 metadata：
- **用户消息**：若携带图片，写入 `{ images: [{ index: number, url: string }, ...] }`；无图片时 metadata 为 `undefined`（不写入该列）
- **AI 消息**：写入 `{ model: "<模型名称>" }`，如 `{ model: "Qwen/Qwen3-8B" }`

#### Scenario: 用户消息附带图片时写入 images 数组

- **WHEN** 用户上传图片并发送消息，`saveMessagesToDb` 收到 `imageUrls` 参数非空
- **THEN** 用户消息记录的 `metadata` 写入 `{ images: [{ index: 0, url: "..." }, { index: 1, url: "..." }] }`
- **AND** 图片 URL 为 ImgBB 上传后的公网 URL

#### Scenario: AI 消息写入使用的模型名

- **WHEN** `saveMessagesToDb` 插入 AI 回复记录
- **THEN** `metadata` 写入 `{ model: modelName }`
- **AND** modelName 来自请求参数，用于后续追溯每条 AI 回复使用的模型

#### Scenario: 纯文本用户消息不写 metadata

- **WHEN** 用户消息无图片附件
- **THEN** 用户消息记录的 `metadata` 为 `undefined`（数据库存储 NULL）
- **AND** 不写入空对象 `{}`

### Requirement: saveMessagesToDb 仅保存最后一条用户消息

`server/api/chat.post.ts` 中的 `saveMessagesToDb` 函数 SHALL 反向查找传入的 `chatMessages` 数组中最后一条 `role='user'` 的消息（实现：`[...chatMessages].reverse().find((msg) => msg.role === 'user')`），仅将该条用户消息插入 `messages` 表，避免重复插入历史用户消息。同时插入一条 `role='assistant'` 的 AI 回复记录，最后通过 `db.update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, sessionId))` 更新会话最近活跃时间。该函数 MUST 在 `streamText` 的 `onFinish` 回调中调用，禁止在 `onChunk` 中写库（避免阻塞流式输出）。

#### Scenario: 历史会话追加新消息时只插入最新一条 user

- **WHEN** `saveMessagesToDb` 接收的 `chatMessages` 包含多条历史 user 消息（如 5 条）
- **THEN** 仅反向查找最后一条 user 消息插入 `messages` 表
- **AND** 不重复插入历史 user 消息
- **AND** 同时插入一条 assistant 消息

#### Scenario: 空 chatMessages 提前返回

- **WHEN** `chatMessages.length === 0`
- **THEN** 函数直接 return，不执行任何数据库写入

#### Scenario: 持久化时机限定在 onFinish

- **WHEN** `streamText` 流式输出过程中触发 `onChunk`
- **THEN** `onChunk` 内不调用 `saveMessagesToDb`，不执行数据库写入
- **AND** 仅在 `onFinish` 回调（流式结束）时调用 `saveMessagesToDb` 落库

### Requirement: createdAt / updatedAt 时间戳约定

所有数据表的 `created_at` 列 MUST 使用 `timestamp().notNull().defaultNow()`，由数据库在 INSERT 时自动填充当前时间。`sessions.updated_at` 列 MUST 同样使用 `timestamp().notNull().defaultNow()` 作为默认值，但在 `saveMessagesToDb` 末尾通过 `db.update(sessions).set({ updatedAt: new Date() })` 手动更新。`messages` 和 `feedbacks` 表仅有 `created_at`，无 `updated_at`（消息和反馈不可变）。

#### Scenario: 插入记录时 created_at 自动填充

- **WHEN** 向 `messages` 表插入记录且未显式指定 `createdAt`
- **THEN** 数据库自动填充 `created_at` 为当前时间戳

#### Scenario: saveMessagesToDb 显式传入 createdAt

- **WHEN** `saveMessagesToDb` 插入 user / assistant 消息
- **THEN** 代码显式传入 `createdAt: new Date()`
- **AND** 该时间戳由应用层生成（与数据库 defaultNow 等价，但显式传入便于测试控制）

#### Scenario: 消息记录不可变无 updated_at

- **WHEN** 查询 `messages` 或 `feedbacks` 表结构
- **THEN** 不存在 `updated_at` 列
- **AND** 消息和反馈创建后不可修改（业务上仅支持新增和级联删除）

### Requirement: UUID v4 主键生成策略

所有数据表（sessions / messages / feedbacks）的 `id` 列 MUST 为 text 类型主键，存储 UUID v4 字符串，由应用层通过 `crypto.randomUUID()` 生成。不使用数据库原生 UUID 类型或自增整数主键。`saveMessagesToDb` 在插入 user / assistant 消息时 MUST 显式传入 `id: crypto.randomUUID()`。

#### Scenario: 插入消息时生成 UUID v4

- **WHEN** `saveMessagesToDb` 插入 user 或 assistant 消息
- **THEN** `id` 字段为 `crypto.randomUUID()` 生成的 UUID v4 字符串
- **AND** 不依赖数据库的 UUID 生成函数

#### Scenario: 所有表 id 类型一致

- **WHEN** 检查 schema.ts 中 sessions / messages / feedbacks 三张表的 id 列定义
- **THEN** 三者均为 `text('id').primaryKey()`
- **AND** 不存在 uuid 类型或 serial 自增类型

### Requirement: schema 变更同步约束

修改 `server/db/schema.ts` 后，开发者 MUST 执行以下同步操作，缺一不可：
1. 运行 `pnpm db:push` 将 schema 变更同步到数据库（修改后必须执行，否则代码与数据库结构不一致）
2. 同步更新 `docs/db-schema.md`（表结构的唯一文档来源，禁止代码与文档脱节）
3. 涉及类型定义变更时运行 `pnpm typecheck`
4. 涉及核心逻辑变更时运行 `pnpm test:unit`

`docs/db-schema.md` 是表结构的唯一文档来源，`schema.ts` 与 `db-schema.md` MUST 始终保持一致。

#### Scenario: 仅修改 schema.ts 未推送数据库

- **WHEN** 开发者修改了 schema.ts 但未运行 `pnpm db:push`
- **THEN** 运行时报「relation does not exist」或「column does not exist」错误
- **AND** 必须补执行 `pnpm db:push` 后才能正常工作

#### Scenario: 修改 schema.ts 未更新文档

- **WHEN** 开发者修改了 schema.ts 但未同步更新 `docs/db-schema.md`
- **THEN** 视为违规（文档与代码脱节）
- **AND** 代码审查应拒绝合入

#### Scenario: 端口配置误写为 5432

- **WHEN** 开发者误将 `DATABASE_URL` 端口配置为 PostgreSQL 默认 5432
- **THEN** 连接失败或连到错误的数据库实例
- **AND** 必须改回 5434（开发）或 5433（测试）
