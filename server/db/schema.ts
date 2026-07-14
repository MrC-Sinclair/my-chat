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

import { pgTable, text, timestamp, jsonb, vector, index } from 'drizzle-orm/pg-core'

/**
 * 会话表 — 存储每个聊天会话的基本信息
 *
 * 每次用户点击"新建会话"时创建一条记录。
 * updatedAt 字段在每次新消息保存时更新，用于按最近活跃时间排序会话列表。
 */
export const sessions = pgTable('sessions', {
  /** 会话唯一标识，使用 crypto.randomUUID() 生成 */
  id: text('id').primaryKey(),
  /** 会话标题，如"新对话 2026/4/8 10:30:00" */
  title: text('title'),
  /** 创建时间，自动填充当前时间 */
  createdAt: timestamp('created_at').notNull().defaultNow(),
  /** 最后更新时间，每次保存消息时手动更新 */
  updatedAt: timestamp('updated_at').notNull().defaultNow()
})

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
