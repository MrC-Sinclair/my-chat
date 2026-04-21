/**
 * @file 单个会话 API — /api/sessions/:id
 *
 * 本文件处理对指定会话的 GET 和 DELETE 请求：
 *   - GET    /api/sessions/:id  → 获取该会话的所有历史消息
 *   - DELETE /api/sessions/:id  → 删除该会话（关联消息会级联删除）
 *
 * Nuxt Server Route 的动态路由规则：
 *   文件名 [id].ts 中的 [id] 是动态参数，对应 URL 中的 :id 部分。
 *   例如 /api/sessions/abc-123 中，id 的值为 "abc-123"。
 *   通过 getRouterParam(event, 'id') 获取该参数值。
 */

import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { sessions, messages } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  /** 从 URL 中提取动态参数 id */
  const sessionId = getRouterParam(event, 'id')

  if (!sessionId) {
    throw createError({ statusCode: 400, statusMessage: '缺少会话ID' })
  }

  const method = getMethod(event)

  /**
   * GET /api/sessions/:id — 获取会话的历史消息
   *
   * 查询 messages 表中属于该会话的所有消息，
   * 按创建时间升序排列（最早的在前，符合聊天阅读顺序）。
   *
   * 返回格式：
   *   [{ id, sessionId, role, content, metadata, createdAt }, ...]
   */
  if (method === 'GET') {
    const sessionMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt)

    return sessionMessages
  }

  /**
   * DELETE /api/sessions/:id — 删除会话
   *
   * 删除 sessions 表中的记录。
   * 由于 schema 中定义了 onDelete: 'cascade'，
   * 数据库会自动删除该会话关联的所有消息和反馈记录。
   */
  if (method === 'DELETE') {
    await db.delete(sessions).where(eq(sessions.id, sessionId))

    return { success: true }
  }

  /** 其他 HTTP 方法返回 405 错误 */
  throw createError({ statusCode: 405, statusMessage: '方法不允许' })
})
