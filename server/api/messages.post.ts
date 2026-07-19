/**
 * @file 消息保存 API — POST /api/messages
 *
 * 用于 Workflow 路径（如生图）保存单条消息到数据库。
 * 与 chat.post.ts 的 onFinish 持久化逻辑不同，此路由用于独立 API 调用后的消息落库。
 *
 * 使用场景：
 *   - 生图 Workflow：前端调用 /api/generate-image 后，将返回的 markdown 图片消息保存到数据库
 *   - 其他 Workflow 路径需要保存 assistant 消息时
 *
 * 请求体：
 *   { sessionId: string, role: 'user' | 'assistant', content: string, metadata?: object }
 *
 * 返回：
 *   { success: true, messageId: string }
 */

import { db } from '~/server/db'
import { messages, sessions } from '~/server/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

const messageSchema = z.object({
  sessionId: z.string().uuid('sessionId 必须是有效的 UUID'),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1, 'content 不能为空'),
  metadata: z.record(z.unknown()).optional()
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  // 参数校验
  const validation = messageSchema.safeParse(body)
  if (!validation.success) {
    throw createError({
      statusCode: 400,
      statusMessage: `参数校验失败: ${validation.error.issues.map((i) => i.message).join(', ')}`
    })
  }

  const { sessionId, role, content, metadata } = validation.data

  // 验证会话是否存在
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId)
  })

  if (!session) {
    throw createError({
      statusCode: 404,
      statusMessage: '会话不存在'
    })
  }

  try {
    const messageId = crypto.randomUUID()

    // 插入消息
    await db.insert(messages).values({
      id: messageId,
      sessionId,
      role,
      content,
      metadata: metadata || undefined,
      createdAt: new Date()
    })

    // 更新会话的 updatedAt
    await db.update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, sessionId))

    return {
      success: true,
      messageId
    }
  } catch (err) {
    console.error('[messages.post] 保存消息失败:', err)
    throw createError({
      statusCode: 500,
      statusMessage: '保存消息失败'
    })
  }
})
