/**
 * @file 注册 — POST /api/auth/register
 *
 * 双模式（design.md 决策 3）：
 *   - 游客态注册：就地升级当前游客行（email/password_hash/is_guest），数据无感保留
 *   - 邮箱被占用：409（部分唯一索引兜底并发）
 *   - 已登录正式用户：409（防覆盖）
 *
 * 校验：zod（email 格式、密码 ≥8 位）；成功后 Cookie 无需重发（userId 未变）
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/db'
import { users } from '~/server/db/schema'
import { getAuthUser, hashPassword } from '~/server/utils/auth'

const bodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128)
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: '邮箱格式不正确或密码少于 8 位' })
  }
  const { email, password } = parsed.data
  const user = getAuthUser(event)

  if (user && !user.isGuest) {
    throw createError({ statusCode: 409, statusMessage: '已登录正式账号，请先退出再注册' })
  }

  const passwordHash = hashPassword(password)

  try {
    if (user?.isGuest) {
      // 游客就地升级：原子 UPDATE 带条件（并发下身份被并发改动则条件不命中）
      const updated = await db
        .update(users)
        .set({ email, passwordHash, isGuest: false })
        .where(and(eq(users.id, user.id), eq(users.isGuest, true)))
        .returning({ id: users.id })
      if (updated.length === 0) {
        throw createError({ statusCode: 409, statusMessage: '身份状态已变化，请刷新页面重试' })
      }
      return { id: user.id, email, isGuest: false }
    }

    // 无游客身份（如 DB 异常降级过）：创建全新正式用户
    await db
      .insert(users)
      .values({ id: crypto.randomUUID(), email, passwordHash, isGuest: false })
    return { isGuest: false, email }
  } catch (err) {
    // 部分唯一索引 users_email_unique_idx 冲突 → 邮箱已注册
    if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
      throw createError({ statusCode: 409, statusMessage: '该邮箱已被注册' })
    }
    throw err
  }
})
