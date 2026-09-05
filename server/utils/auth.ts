/**
 * @file 认证工具层（openspec/changes/add-user-auth/design.md 决策 1、2）
 *
 * - 密码哈希：node:crypto scrypt（零依赖），格式 `scrypt$N$r$p$salt$hash`
 * - 会话 Cookie：`<userId>.<expiresAtMs>.<hmacSHA256>`，HttpOnly + SameSite=Lax
 * - 游客与正式用户同一套身份机制（users 行 is_guest 区分）
 *
 * 安全约定：
 *   - 密码校验用 timingSafeEqual 防时序攻击
 *   - Cookie 校验失败/过期一律返回 null，由上层走游客创建流程
 */
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto'
import type { H3Event } from 'h3'

/** scrypt 参数（固化，升级需配套迁移存量哈希） */
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 64

/** 会话 Cookie 有效期：30 天 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** Cookie 名称 */
export const AUTH_COOKIE = 'mychat_session'

/** 当前用户上下文（挂在 event.context.authUser） */
export interface AuthUser {
  id: string
  isGuest: boolean
  email: string | null
}

/**
 * 哈希密码（scrypt）
 *
 * @returns `scrypt$N$r$p$salt$hash` 格式字符串（hex 编码）
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${hash.toString('hex')}`
}

/**
 * 校验密码（timingSafeEqual 防时序攻击）
 *
 * 格式不合法一律返回 false（不抛异常），避免畸形存量数据打崩登录
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts
  try {
    const expected = Buffer.from(hashHex, 'hex')
    const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr)
    })
    return timingSafeEqual(actual, expected)
  } catch {
    // 参数越界（N/r/p 非法）或 hex 解码失败：视为哈希损坏，校验不通过
    return false
  }
}

/**
 * 生成签名会话 token：`<userId>.<expiresAtMs>.<hmac>`
 */
export function signSession(userId: string, secret: string, ttlMs = SESSION_TTL_MS): string {
  const expiresAt = Date.now() + ttlMs
  const payload = `${userId}.${expiresAt}`
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

/**
 * 校验签名会话 token，通过返回 userId，失败/过期返回 null
 */
export function verifySession(token: string, secret: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [userId, expiresAtStr, sig] = parts
  const payload = `${userId}.${expiresAtStr}`
  const expected = createHmac('sha256', secret).update(payload).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  // 长度不同直接 false：timingSafeEqual 要求等长
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  const expiresAt = Number(expiresAtStr)
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null
  return userId
}

/**
 * 从事件取当前身份（由 server/middleware/auth.ts 注入）
 *
 * 数据路由统一走此函数；中间件保证游客身份必然存在，
 * 返回 null 仅发生在中间件被跳过的路由（如 /api/models），此时该路由不应消费身份。
 */
export function getAuthUser(event: H3Event): AuthUser | null {
  return (event.context.authUser as AuthUser | undefined) ?? null
}

/**
 * 生成游客用户 id（与正式用户同构，均为随机 UUID）
 */
export function newUserId(): string {
  return crypto.randomUUID()
}
