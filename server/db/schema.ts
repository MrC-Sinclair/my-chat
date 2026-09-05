/**
 * @file 数据库表结构定义（Schema）
 *
 * 本文件使用 Drizzle ORM 定义了 PostgreSQL 数据库中的四张表：
 *   - sessions：聊天会话表
 *   - messages：聊天消息表
 *   - feedbacks：消息反馈表（点赞/点踩等）
 *   - memory_vectors：长期记忆向量存储表（pgvector）
 *
 * 表之间的关联关系：
 *   sessions ←(1:N)→ messages ←(1:N)→ feedbacks
 *   sessions ←(1:N)→ memory_vectors ←(N:1)→ messages
 *   删除会话时，关联的消息、反馈、记忆向量会级联删除（onDelete: 'cascade'）
 *
 * Drizzle ORM 的 pgTable 用法：
 *   pgTable('数据库表名', { 列定义 })
 *   每个列的第一个参数是数据库中的列名，第二个参数是类型和约束。
 *   TypeScript 中的属性名可以和数据库列名不同（如 createdAt ↔ created_at）。
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  vector,
  index,
  boolean,
  uniqueIndex,
  integer
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/**
 * 用户表 — 承载认证身份与游客身份
 *
 * 设计要点（详见 openspec/changes/add-user-auth/design.md 决策 1、3）：
 *   - 游客也是一行 users（is_guest=true，email/password_hash 为空），保证「不登录也能用」
 *     且数据隔离逻辑对所有身份统一
 *   - 游客注册 = 就地升级本行（写入 email/password_hash + is_guest=false），数据无感保留
 *   - email 唯一约束只对正式用户有意义（游客行为 NULL，PostgreSQL 唯一索引不约束 NULL）
 */
export const users = pgTable(
  'users',
  {
    /** 用户唯一标识，crypto.randomUUID() 生成 */
    id: text('id').primaryKey(),
    /** 邮箱（正式用户唯一标识；游客为 NULL） */
    email: text('email'),
    /** scrypt 密码哈希（格式 scrypt$N$r$p$salt$hash；游客为 NULL） */
    passwordHash: text('password_hash'),
    /** 是否游客（未注册的免登录身份） */
    isGuest: boolean('is_guest').notNull().default(true),
    /** 创建时间 */
    createdAt: timestamp('created_at').notNull().defaultNow()
  },
  (table) => [
    // 部分唯一索引：仅约束非空 email（游客行 email 为 NULL 不参与唯一性）
    // where 子句必须用 sql 模板（drizzle-kit 序列化不支持原始字符串）
    uniqueIndex('users_email_unique_idx')
      .on(table.email)
      .where(sql`email IS NOT NULL`)
  ]
)

/**
 * 会话表 — 存储每个聊天会话的基本信息
 *
 * 每次用户点击"新建会话"时创建一条记录。
 * updatedAt 字段在每次新消息保存时更新，用于按最近活跃时间排序会话列表。
 * userId 关联所属用户（含游客），数据隔离的单点外键（messages/feedbacks/memory_vectors
 * 均经 session_id 级联归属，无需各自冗余 user_id）。
 */
export const sessions = pgTable(
  'sessions',
  {
    /** 会话唯一标识，使用 crypto.randomUUID() 生成 */
    id: text('id').primaryKey(),
    /** 会话标题，如"新对话 2026/4/8 10:30:00" */
    title: text('title'),
    /** 所属用户（含游客）；存量数据迁移后不为 NULL */
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** 创建时间，自动填充当前时间 */
    createdAt: timestamp('created_at').notNull().defaultNow(),
    /** 最后更新时间，每次保存消息时手动更新 */
    updatedAt: timestamp('updated_at').notNull().defaultNow()
  },
  (table) => [
    // 会话列表按用户过滤 + 按 updatedAt 排序的高频查询路径
    index('sessions_user_id_idx').on(table.userId)
  ]
)

/**
 * 消息表 — 存储每条聊天消息
 *
 * 每条消息属于一个会话（通过 sessionId 关联）。
 * role 字段区分消息角色：'user'（用户）、'assistant'（AI）、'system'（系统）。
 * metadata 字段使用 JSONB 类型，存储额外信息（如使用的模型名称）。
 */
export const messages = pgTable('messages', {
  /** 消息唯一标识，使用 crypto.randomUUID() 生成 */
  id: text('id').primaryKey(),
  /** 所属会话 ID，外键关联 sessions.id，删除会话时级联删除消息 */
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
  /** 消息角色：'user' | 'assistant' | 'system' */
  role: text('role').notNull(),
  /** 消息文本内容 */
  content: text('content').notNull(),
  /** 额外元数据（JSON 格式），如 { model: "Qwen/Qwen3-8B" } */
  metadata: jsonb('metadata'),
  /** 创建时间，自动填充当前时间 */
  createdAt: timestamp('created_at').notNull().defaultNow()
})

/**
 * 反馈表 — 存储用户对 AI 回复的反馈
 *
 * 用户可以对 AI 的回复进行点赞/点踩等操作，
 * 这些反馈数据可用于后续优化模型或分析回答质量。
 * type 字段标识反馈类型，如 'like'、'dislike' 等。
 */
export const feedbacks = pgTable('feedbacks', {
  /** 反馈唯一标识 */
  id: text('id').primaryKey(),
  /** 关联的消息 ID，外键关联 messages.id，删除消息时级联删除反馈 */
  messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  /** 反馈类型，如 'like'、'dislike' */
  type: text('type').notNull(),
  /** 创建时间，自动填充当前时间 */
  createdAt: timestamp('created_at').notNull().defaultNow()
})

/**
 * 长期记忆向量表 — 存储跨会话长期记忆的向量数据
 *
 * 设计要点（详见 openspec/changes/add-long-term-memory/design.md 决策 1）：
 *   - 使用 Drizzle ORM 原生 vector({ dimensions: 1024 }) 类型（drizzle-orm ^0.36.0 支持 pgvector）
 *   - content 字段冗余存储消息文本快照，避免检索时 JOIN messages 表
 *   - created_at 从 messages.created_at 复制（消息原始创建时间），便于按时间检索历史记忆
 *   - archived_at 是归档执行时间（defaultNow），与 created_at 区分
 *   - HNSW 索引使用 pgvector 默认参数（m=16, ef_construction=64）
 *     Drizzle ORM 的 index().using('hnsw', ...) API 不支持 WITH 子句，无法通过环境变量覆盖
 *
 * 删除会话或消息时，关联的记忆向量会级联删除（onDelete: 'cascade'）。
 */
export const memoryVectors = pgTable(
  'memory_vectors',
  {
    /** 记忆唯一标识，使用 crypto.randomUUID() 生成 */
    id: text('id').primaryKey(),
    /** 关联消息 ID，外键关联 messages.id，删除消息时级联删除记忆向量 */
    messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    /** 关联会话 ID，外键关联 sessions.id，删除会话时级联删除记忆向量 */
    sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
    /** 消息文本快照（冗余存储，避免检索时 JOIN） */
    content: text('content').notNull(),
    /** 1024 维 embedding 向量（BAAI/bge-m3 输出维度） */
    embedding: vector('embedding', { dimensions: 1024 }).notNull(),
    /** 消息角色：'user' | 'assistant'（归档时已过滤 system） */
    role: text('role').notNull(),
    /**
     * 消息原始创建时间（从 messages.created_at 复制，非 defaultNow）
     * 便于按时间检索历史记忆，区分消息产生时间和入库时间
     */
    createdAt: timestamp('created_at').notNull(),
    /** 归档执行时间，自动填充当前时间 */
    archivedAt: timestamp('archived_at').notNull().defaultNow()
  },
  (table) => [
    // HNSW 索引加速余弦距离检索，使用 pgvector 默认参数 m=16, ef_construction=64
    // Drizzle ORM 不支持 WITH 子句，如需调优需在 db/index.ts 启动时用原始 SQL 重建索引
    index('memory_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops'))
  ]
)

/**
 * Agent 任务表 — LLM 显式规划的长程任务（openspec/changes/add-agent-task-system）
 *
 * 任务状态独立于 messages 表（不混入对话历史）。归属 = session 归属（用户已在
 * chat.post.ts 校验），不冗余 user_id。status 语义：
 *   - in_progress：进行中（检查点恢复的注入对象）
 *   - completed / failed：终态
 */
export const agentTasks = pgTable(
  'agent_tasks',
  {
    id: text('id').primaryKey(),
    /** 所属会话，级联删除 */
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    /** 任务标题（LLM 规划产出） */
    title: text('title').notNull(),
    /** 任务状态：in_progress | completed | failed */
    status: text('status').notNull().default('in_progress'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow()
  },
  (table) => [
    // 检查点注入高频查询：按会话取进行中任务
    index('agent_tasks_session_status_idx').on(table.sessionId, table.status)
  ]
)

/**
 * Agent 任务步骤表 — 任务的执行步骤（检查点的最小粒度）
 *
 * status 状态机：pending → in_progress → completed | failed（failed → in_progress 允许重试），
 * 非法迁移由工具层返回 error 交 LLM 纠正。
 * result 存结果摘要；超长完整内容落 artifacts 表（大对象按引用传递）。
 */
export const agentTaskSteps = pgTable(
  'agent_task_steps',
  {
    id: text('id').primaryKey(),
    /** 所属任务，级联删除 */
    taskId: text('task_id')
      .notNull()
      .references(() => agentTasks.id, { onDelete: 'cascade' }),
    /** 步骤顺序（从 1 开始，LLM 规划产出） */
    idx: integer('idx').notNull(),
    /** 步骤内容描述 */
    content: text('content').notNull(),
    /** 步骤状态：pending | in_progress | completed | failed */
    status: text('status').notNull().default('pending'),
    /** 执行结果摘要（超 200 字符截断，完整内容见 artifacts） */
    result: text('result'),
    updatedAt: timestamp('updated_at').notNull().defaultNow()
  },
  (table) => [index('agent_task_steps_task_id_idx').on(table.taskId)]
)

/**
 * 工件表 — 步骤执行产出的超长内容（工件持久化）
 *
 * 大对象按引用传递：步骤 result 只存摘要 + artifactId，完整内容单独存储，
 * 避免 LLM 上下文与对话历史被大文本撑爆。
 */
export const artifacts = pgTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    /** 所属任务，级联删除 */
    taskId: text('task_id')
      .notNull()
      .references(() => agentTasks.id, { onDelete: 'cascade' }),
    /** 产出该工件的步骤 */
    stepId: text('step_id')
      .notNull()
      .references(() => agentTaskSteps.id, { onDelete: 'cascade' }),
    /** 完整内容 */
    content: text('content').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow()
  },
  (table) => [index('artifacts_task_id_idx').on(table.taskId)]
)
