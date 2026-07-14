/**
 * @file 会话归档 API — POST /api/sessions/:id/archive-memory
 *
 * 触发指定会话的重要度筛选入库（长期记忆归档）：
 *   1. 路由内校验 id 为标准 UUID v4 格式（不扩展 security.ts，详见 design.md 决策 6）
 *   2. 校验会话存在（不存在返回 404）
 *   3. fire-and-forget 调用 archiveSessionMessages()，不 await 完成
 *   4. 立即返回 202 Accepted，归档在后台异步执行
 *
 * 并发与幂等：
 *   - 进程内并发锁：memory-archive.ts 内置 Map<sessionId, Promise>，
 *     同一会话归档进行中时重复请求直接返回不重复执行
 *   - 消息级幂等：memory-archive.ts 内置 getArchivedMessageIds 查询，
 *     已入库的 message_id 自动跳过
 *
 * 错误处理：
 *   - UUID 格式无效 → 400
 *   - 会话不存在 → 404
 *   - 归档内部错误（LLM 失败、embedding 失败等）→ 不抛异常，记录日志，
 *     API 仍返回 202（归档是异步增强操作，失败不影响对话主流程）
 */

import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { sessions } from '~/server/db/schema'
import { archiveSessionMessages } from '~/server/utils/memory-archive'

/**
 * 标准 UUID v4 严格校验正则
 *
 * 与 security.ts 的通用 UUID 正则不同，此正则限定 v4 版本：
 *   - 第 3 段以 '4' 开头
 *   - 第 4 段以 '8'/'9'/'a'/'b' 开头
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default defineEventHandler(async (event) => {
  // 1. 从 URL 提取动态参数 id
  const sessionId = getRouterParam(event, 'id')

  if (!sessionId) {
    throw createError({ statusCode: 400, statusMessage: '缺少会话ID' })
  }

  // 2. UUID v4 格式校验（路由内自行校验，不扩展 security.ts）
  if (!UUID_V4_REGEX.test(sessionId)) {
    throw createError({ statusCode: 400, statusMessage: '会话ID格式无效（要求标准 UUID v4）' })
  }

  // 3. 会话存在性校验
  const [session] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, sessionId))

  if (!session) {
    throw createError({ statusCode: 404, statusMessage: '会话不存在' })
  }

  // 4. fire-and-forget 触发归档（不 await 完成）
  //
  // archiveSessionMessages 内置进程内并发锁（Map<sessionId, Promise>）：
  //   - 同一会话已有归档进行中 → 立即返回不重复执行
  //   - 无归档进行中 → 启动新归档 Promise
  //
  // memory-archive.ts 内部已 catch 所有错误并记录日志，
  // 此处再加 .catch 兜底防止未预期错误导致 unhandled rejection
  archiveSessionMessages(sessionId).catch((err) => {
    console.error(`[archive-memory API] 会话 ${sessionId} 归档异常:`, err)
  })

  // 5. 立即返回 202 Accepted，归档在后台异步执行
  setResponseStatus(event, 202)
  return {
    message: '归档已触发，后台异步执行中',
    sessionId,
    // 归档是异步操作，实际结果通过日志观察，不通过 API 返回
    // 消息级幂等：已归档的 message_id 会在 memory-archive.ts 内部自动跳过
  }
})
