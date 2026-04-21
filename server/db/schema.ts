/**
 * @file 数据库表结构定义（Schema）
 *
 * 本文件使用 Drizzle ORM 定义了 PostgreSQL 数据库中的三张表：
 *   - sessions：聊天会话表
 *   - messages：聊天消息表
 *   - feedbacks：消息反馈表（点赞/点踩等）
 *
 * 表之间的关联关系：
 *   sessions ←(1:N)→ messages ←(1:N)→ feedbacks
 *   删除会话时，关联的消息和反馈会级联删除（onDelete: 'cascade'）
 *
 * Drizzle ORM 的 pgTable 用法：
 *   pgTable('数据库表名', { 列定义 })
 *   每个列的第一个参数是数据库中的列名，第二个参数是类型和约束。
 *   TypeScript 中的属性名可以和数据库列名不同（如 createdAt ↔ created_at）。
 */

import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core'

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
