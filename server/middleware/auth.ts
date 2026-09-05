/**
 * @file 全局身份注入中间件（openspec/changes/add-user-auth/design.md 决策 5）
 *
 * 职责：
 *   1. 解析会话 Cookie → 校验签名 → 加载 users 行 → 挂 event.context.authUser
 *   2. Cookie 缺失/失效 → 自动创建游客行 + 下发新 Cookie（「不登录也能用」的落点）
 *
 * 注意：
 *   - 必须 async：后续数据路由同步消费 event.context.authUser，注入必须先于路由完成
 *   - 只做身份解析与游客创建，不做归属校验（各数据路由自行校验，404 不泄露存在性）
 *   - DB 异常时 authUser 置空并放行：模型列表等公开接口仍可用，数据路由按「无身份」降级
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { users } from '~/server/db/schema'
import {
  AUTH_COOKIE,
  SESSION_TTL_MS,
  signSession,
  verifySession,
  newUserId
} from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const secret = useRuntimeConfig(event).authSecret
  const token = getCookie(event, AUTH_COOKIE)
  const userId = token ? verifySession(token, secret) : null

  if (userId) {
    try {
      const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1)
      const row = rows[0]
      if (row) {
        // 签名有效且用户存在：注入身份后直接放行（Cookie 未过期无需续签）
        event.context.authUser = { id: row.id, isGuest: row.isGuest, email: row.email }
        return
      }
      // 签名有效但用户行不存在（被删）→ 落到下方游客创建
    } catch {
      // DB 不可用：无身份降级，不阻塞公开接口
      return
    }
  }

  // 无有效身份 → 创建游客行 + 下发 Cookie
  try {
    const guestId = newUserId()
    await db.insert(users).values({ id: guestId, isGuest: true })
    setCookie(event, AUTH_COOKIE, signSession(guestId, secret, SESSION_TTL_MS), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000
    })
    event.context.authUser = { id: guestId, isGuest: true, email: null }
  } catch {
    // DB 不可用：无身份降级
  }
})
