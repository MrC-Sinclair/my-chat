/**
 * @file 登录 — POST /api/auth/login
 *
 * 失败统一 401「邮箱或密码错误」：不区分邮箱不存在与密码错误，防账号枚举。
 * 成功：下发目标用户签名 Cookie（此前游客数据留在游客行，不做合并——design.md 决策 3）。
 */
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/db'
import { users } from '~/server/db/schema'
import { AUTH_COOKIE, SESSION_TTL_MS, signSession, verifyPassword } from '~/server/utils/auth'

const bodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128)
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: '请输入邮箱和密码' })
  }
  const { email, password } = parsed.data

  let row: { id: string; email: string | null; isGuest: boolean; passwordHash: string | null }
  try {
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
    row = rows[0]
  } catch {
    throw createError({ statusCode: 500, statusMessage: '服务暂时不可用，请稍后重试' })
  }

  if (!row || !row.passwordHash || !verifyPassword(password, row.passwordHash)) {
    throw createError({ statusCode: 401, statusMessage: '邮箱或密码错误' })
  }

  setCookie(event, AUTH_COOKIE, signSession(row.id, useRuntimeConfig(event).authSecret, SESSION_TTL_MS), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000
  })

  return { id: row.id, email: row.email, isGuest: row.isGuest }
})
