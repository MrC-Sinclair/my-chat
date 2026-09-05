/**
 * @file 当前身份 — GET /api/auth/me
 *
 * 返回中间件注入的身份。user 为 null 仅在 DB 异常导致游客创建失败时出现，
 * 前端按游客占位处理（不产生水合不匹配：SSR 与客户端首帧一致渲染游客态）。
 */
import { getAuthUser } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  const user = getAuthUser(event)
  return { user }
})
