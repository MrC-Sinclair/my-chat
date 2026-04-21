/**
 * @file 会话列表 API — /api/sessions
 *
 * 本文件处理对会话列表的 GET 和 POST 请求：
 *   - GET  /api/sessions  → 获取所有会话列表（按最近更新排序，附带消息数量）
 *   - POST /api/sessions  → 创建新会话
 *
 * Nuxt Server Route 的文件名规则：
 *   文件名即路由路径，sessions.ts 对应 /api/sessions。
 *   同一个文件中通过 getMethod(event) 判断请求方法来分别处理。
 */

import { eq, desc, count } from 'drizzle-orm'
import { db } from '~/server/db'
import { sessions, messages } from '~/server/db/schema'

export default defineEventHandler(async (event) => {
  const method = getMethod(event)

  /**
   * GET /api/sessions — 获取会话列表
   *
   * 查询逻辑：
   *   1. 从 sessions 表查询所有会话
   *   2. LEFT JOIN messages 表，统计每个会话的消息数量
   *   3. 按 updatedAt 降序排列（最近活跃的会话排在前面）
   *
   * 返回格式：
   *   [{ id, title, createdAt, updatedAt, messageCount }, ...]
   */
  if (method === 'GET') {
    const sessionList = await db
      .select({
        id: sessions.id,
        title: sessions.title,
        createdAt: sessions.createdAt,
        updatedAt: sessions.updatedAt,
        messageCount: count(messages.id)
      })
      .from(sessions)
      .leftJoin(messages, eq(sessions.id, messages.sessionId))
      .groupBy(sessions.id)
      .orderBy(desc(sessions.updatedAt))

    return sessionList
  }

  /**
   * POST /api/sessions — 创建新会话
   *
   * 请求体（可选）：
   *   { title?: string }  — 会话标题，不传则自动生成
   *
   * 创建流程：
   *   1. 生成 UUID 作为会话 ID
   *   2. 使用请求中的标题或自动生成默认标题
   *   3. 插入数据库并返回新创建的会话记录
   */
  if (method === 'POST') {
    const body = await readBody(event)
    const id = crypto.randomUUID()
    const title = (body?.title as string) || `新对话 ${new Date().toLocaleString('zh-CN')}`

    const [session] = await db
      .insert(sessions)
      .values({ id, title })
      .returning()

    return session
  }

  /** 其他 HTTP 方法返回 405 错误 */
  throw createError({ statusCode: 405, statusMessage: '方法不允许' })
})
