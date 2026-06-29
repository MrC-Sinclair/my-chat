# 数据库表结构

基于 PostgreSQL + Drizzle ORM，开发端口 **5434**，测试端口 **5433**。

## ER 关系图

```
sessions (1) ──── (N) messages (1) ──── (N) feedbacks
```

所有外键均设置 `onDelete: 'cascade'`，删除父记录时子记录级联删除。

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
| `metadata`   | `jsonb`     | —                                     | 额外元数据，如 `{ "model": "Qwen/Qwen3-8B" }` |
| `created_at` | `timestamp` | NOT NULL, DEFAULT NOW()               | 创建时间                                      |

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

## 索引建议

当前表结构未定义显式索引。以下场景建议添加：

| 表       | 建议索引                   | 原因                   |
| -------- | -------------------------- | ---------------------- |
| messages | `(session_id, created_at)` | 按会话查询消息列表排序 |
| sessions | `(updated_at DESC)`        | 会话列表按活跃时间排序 |

## 同步命令

修改 `server/db/schema.ts` 后执行：

```bash
pnpm db:push
```
