# 数据库表结构

基于 PostgreSQL + Drizzle ORM，开发端口 **5434**，测试端口 **5433**。Docker 镜像使用 `pgvector/pgvector:pg18`（含 pgvector 扩展）。

## ER 关系图

```
users (1) ──── (N) sessions (1) ──── (N) messages (1) ──── (N) feedbacks
                        │                    │
                        │                    └── memory_vectors (1:1 关联 messages，冗余存储 content 快照)
                        ├── (N) agent_tasks (1) ──── (N) agent_task_steps (1) ──── (N) artifacts
                        └──
```

所有外键均设置 `onDelete: 'cascade'`，删除父记录时子记录级联删除。
用户隔离的单点外键：`sessions.user_id`（messages/feedbacks/memory_vectors/agent_* 均经 session 归属）。

---

## 表结构

### sessions — 聊天会话表

每次用户点击"新建会话"时创建一条记录。

| 列名         | 类型        | 约束                    | 说明                                |
| ------------ | ----------- | ----------------------- | ----------------------------------- |
| `id`         | `text`      | PK                      | 会话唯一标识，`crypto.randomUUID()` |
| `title`      | `text`      | —                       | 会话标题                            |
| `created_at` | `timestamp` | NOT NULL, DEFAULT NOW() | 创建时间                            |
| `updated_at` | `timestamp` | NOT NULL, DEFAULT NOW() | 最后更新时间，每次新消息时更新      |

---

### messages — 聊天消息表

每条消息属于一个会话，`role` 区分消息来源。

| 列名         | 类型        | 约束                                  | 说明                                          |
| ------------ | ----------- | ------------------------------------- | --------------------------------------------- |
| `id`         | `text`      | PK                                    | 消息唯一标识，`crypto.randomUUID()`           |
| `session_id` | `text`      | FK → `sessions.id`, ON DELETE CASCADE | 所属会话 ID                                   |
| `role`       | `text`      | NOT NULL                              | 消息角色：`user` / `assistant` / `system`     |
| `content`    | `text`      | NOT NULL                              | 消息文本内容                                  |
| `metadata`   | `jsonb`     | —                                     | 额外元数据，结构见下文                          |
| `created_at` | `timestamp` | NOT NULL, DEFAULT NOW()               | 创建时间                                      |

#### `messages.metadata` JSONB 结构

`metadata` 为可空 JSONB 字段，按需写入以下子键（未设置的字段不出现）：

| 子键      | 类型     | 写入时机                          | 说明                                                                                  |
| --------- | -------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| `model`   | `string` | `onFinish` 落库 assistant 消息时  | AI 回复使用的模型标识，如 `"Qwen/Qwen3-8B"`、`"Kwai-Kolors/Kolors"`                   |
| `images`  | `array`  | 用户消息含图片时                  | `[{ index: number, url: string }]`，ImgBB 持久化后的公网 URL                          |
| `audio`   | `object` | 用户消息为语音消息时              | 语音消息音频元信息，结构见下表                                                        |

**`metadata.audio` 子结构**

| 字段        | 类型              | 说明                                                                                              |
| ----------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `url`       | `string`          | 持久化音频 URL（`/api/audio/<filename>`，TTL 7 天过期）                                           |
| `emotion`   | `string \| null`  | 情感标签，经 `ALLOWED_EMOTIONS` 白名单校验（`happy`/`sad`/`angry`/`neutral`），未通过校验落库为 `null` |
| `duration`  | `number`          | 音频时长（秒，服务端 ffprobe 实测，不信任前端上报）                                               |
| `createdAt` | `string` (ISO 时间) | 音频落库时间戳，用于 TTL 清理插件判定过期（虽文件名已含时间戳，此处冗余存储便于排查）             |

**示例**

```jsonc
// 纯文本 AI 回复
{ "model": "Qwen/Qwen3-8B" }

// 用户图片消息
{ "images": [{ "index": 0, "url": "https://i.ibb.co/xxx/img.png" }] }

// 用户语音消息
{
  "audio": {
    "url": "/api/audio/1722300000000-a1b2c3d4-e5f6-7890-abcd-ef1234567890.webm",
    "emotion": "happy",
    "duration": 5.32,
    "createdAt": "2026-07-30T10:00:00.000Z"
  }
}

// 语音 + 图片组合（理论可共存，当前前端未触发该组合）
{
  "images": [{ "index": 0, "url": "https://i.ibb.co/xxx/img.png" }],
  "audio": {
    "url": "/api/audio/1722300000000-xxx.webm",
    "emotion": "neutral",
    "duration": 3.10,
    "createdAt": "2026-07-30T10:00:00.000Z"
  }
}
```

> 注：`audio.emotion` 在前端 `ai-chat.vue` 和服务端 `chat.post.ts` 两处均经白名单校验，防止 prompt 注入。`url` 字段用于前端 `VoiceMessageBubble` 渲染音频播放控件，TTL 过期后接口返回 404，前端降级为「音频已过期」提示并保留转文字内容。

---

### feedbacks — 消息反馈表

用户对 AI 回复的点赞/点踩反馈，可用于分析回答质量。

| 列名         | 类型        | 约束                                  | 说明                         |
| ------------ | ----------- | ------------------------------------- | ---------------------------- |
| `id`         | `text`      | PK                                    | 反馈唯一标识                 |
| `message_id` | `text`      | FK → `messages.id`, ON DELETE CASCADE | 关联的消息 ID                |
| `type`       | `text`      | NOT NULL                              | 反馈类型：`like` / `dislike` |
| `created_at` | `timestamp` | NOT NULL, DEFAULT NOW()               | 创建时间                     |

---

### memory_vectors — 长期记忆向量表

跨会话长期记忆存储，使用 pgvector 扩展。会话切换时由 LLM 判断重要度，仅对重要消息做 embedding 入库。`recall-memory` 工具通过余弦距离检索跨会话历史。

| 列名          | 类型           | 约束                                                      | 说明                                                          |
| ------------- | -------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| `id`          | `text`         | PK                                                        | 记忆唯一标识，`crypto.randomUUID()`                           |
| `message_id`  | `text`         | FK → `messages.id`, ON DELETE CASCADE                     | 关联消息 ID                                                   |
| `session_id`  | `text`         | FK → `sessions.id`, ON DELETE CASCADE                     | 关联会话 ID                                                   |
| `content`     | `text`         | NOT NULL                                                  | 消息文本快照（冗余存储，避免检索时 JOIN）                     |
| `embedding`   | `vector(1024)` | NOT NULL                                                  | 1024 维 embedding 向量（BAAI/bge-m3 输出维度）                |
| `role`        | `text`         | NOT NULL                                                  | 消息角色：`user` / `assistant`（归档时已过滤 system）         |
| `created_at`  | `timestamp`    | NOT NULL                                                  | **从 `messages.created_at` 复制**（消息原始创建时间，非 defaultNow） |
| `archived_at` | `timestamp`    | NOT NULL, DEFAULT NOW()                                   | 归档执行时间                                                  |

**索引**

| 索引名                | 类型  | 列/算子                       | 参数                                            |
| --------------------- | ----- | ----------------------------- | ----------------------------------------------- |
| `memory_embedding_idx` | HNSW | `embedding vector_cosine_ops` | pgvector 默认 `m=16, ef_construction=64`        |

> Drizzle ORM 的 `index().using('hnsw', ...)` API 不支持 `WITH` 子句，使用 pgvector 默认参数。如需调优，可在 `server/db/index.ts` 启动时用原始 SQL `DROP INDEX` + `CREATE INDEX ... WITH (...)` 重建索引。

---

### users（用户表）

承载认证身份与游客身份（openspec/changes/add-user-auth）。游客也是一行 users（`is_guest=true`），保证「不登录也能用」且数据隔离逻辑对所有身份统一。

| 列名            | 类型        | 约束                                   | 说明                                       |
| --------------- | ----------- | -------------------------------------- | ------------------------------------------ |
| `id`            | `text`      | PK                                     | UUID                                       |
| `email`         | `text`      | 可空；部分唯一索引（仅非空值参与唯一） | 邮箱（正式用户）；游客为 NULL              |
| `password_hash` | `text`      | 可空                                   | scrypt 哈希（`scrypt$N$r$p$salt$hash`）    |
| `is_guest`      | `boolean`   | NOT NULL, DEFAULT TRUE                 | 是否游客                                   |
| `created_at`    | `timestamp` | NOT NULL, DEFAULT NOW()                | 创建时间                                   |

`sessions.user_id` → users.id（CASCADE）。存量数据由 `scripts/migrate-legacy-sessions.sql` 归入 legacy 游客用户。

### agent_tasks / agent_task_steps / artifacts（Agent 任务系统）

LLM 显式规划的长程任务（openspec/changes/add-agent-task-system）。任务状态独立于 messages，经 session 级联归属。

**agent_tasks**

| 列名         | 类型        | 约束                | 说明                                          |
| ------------ | ----------- | ------------------- | --------------------------------------------- |
| `id`         | `text`      | PK                  | UUID                                          |
| `session_id` | `text`      | NOT NULL, FK→CASCADE| 所属会话                                      |
| `title`      | `text`      | NOT NULL            | 任务标题（LLM 规划产出）                      |
| `status`     | `text`      | NOT NULL            | `in_progress` \| `completed` \| `failed`      |
| `created_at` / `updated_at` | `timestamp` | NOT NULL | 时间戳                                       |

**agent_task_steps**

| 列名         | 类型        | 约束                 | 说明                                                        |
| ------------ | ----------- | -------------------- | ----------------------------------------------------------- |
| `id`         | `text`      | PK                   | UUID                                                        |
| `task_id`    | `text`      | NOT NULL, FK→CASCADE | 所属任务                                                    |
| `idx`        | `integer`   | NOT NULL             | 步骤顺序（从 1 开始）                                       |
| `content`    | `text`      | NOT NULL             | 步骤描述                                                    |
| `status`     | `text`      | NOT NULL             | `pending` \| `in_progress` \| `completed` \| `failed`       |
| `result`     | `text`      | 可空                 | 结果摘要（超 200 字符截断，完整内容见 artifacts）           |
| `updated_at` | `timestamp` | NOT NULL             | 更新时间                                                    |

状态机：`pending → in_progress → completed | failed`（`failed → in_progress` 允许重试）。

**artifacts**

| 列名         | 类型        | 约束                 | 说明                 |
| ------------ | ----------- | -------------------- | -------------------- |
| `id`         | `text`      | PK                   | UUID                 |
| `task_id`    | `text`      | NOT NULL, FK→CASCADE | 所属任务             |
| `step_id`    | `text`      | NOT NULL, FK→CASCADE | 产出该工件的步骤     |
| `content`    | `text`      | NOT NULL             | 完整内容             |
| `created_at` | `timestamp` | NOT NULL, DEFAULT NOW() | 创建时间          |

**索引**：`sessions_user_id_idx (user_id)`、`agent_tasks_session_status_idx (session_id, status)`、`agent_task_steps_task_id_idx (task_id)`、`artifacts_task_id_idx (task_id)`。

---

## 扩展依赖

| 扩展名    | 启用方式                                                  | 说明                                       |
| --------- | --------------------------------------------------------- | ------------------------------------------ |
| `vector`  | `server/db/index.ts` 启动时执行 `CREATE EXTENSION IF NOT EXISTS vector` | pgvector 向量类型与距离算子，幂等执行      |

---

## 索引建议

当前表结构中除 `memory_vectors.embedding` 的 HNSW 索引外，未定义其他显式索引。以下场景建议添加：

| 表       | 建议索引                   | 原因                   |
| -------- | -------------------------- | ---------------------- |
| messages | `(session_id, created_at)` | 按会话查询消息列表排序 |
| sessions | `(updated_at DESC)`        | 会话列表按活跃时间排序 |

## 同步命令

修改 `server/db/schema.ts` 后执行：

```bash
pnpm db:push
```
