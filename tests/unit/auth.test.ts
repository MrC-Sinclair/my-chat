/**
 * 认证工具层单元测试（server/utils/auth.ts）
 *
 * 覆盖：
 * - hashPassword / verifyPassword 往返
 * - 畸形存储哈希校验返回 false（不抛异常）
 * - signSession / verifySession 往返
 * - 篡改 payload/签名、过期 token 一律拒绝
 */
import { describe, it, expect } from 'vitest'
import {
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  SESSION_TTL_MS
} from '~/server/utils/auth'

describe('auth.ts 密码哈希（scrypt）', () => {
  it('哈希后校验通过', () => {
    const hash = hashPassword('s3cret-password')
    expect(hash.startsWith('scrypt$')).toBe(true)
    expect(verifyPassword('s3cret-password', hash)).toBe(true)
  })

  it('错误密码校验失败', () => {
    const hash = hashPassword('correct-password')
    expect(verifyPassword('wrong-password', hash)).toBe(false)
  })

  it('相同密码两次哈希产生不同盐（salt 随机）', () => {
    const a = hashPassword('same-password')
    const b = hashPassword('same-password')
    expect(a).not.toBe(b)
    expect(verifyPassword('same-password', a)).toBe(true)
    expect(verifyPassword('same-password', b)).toBe(true)
  })

  it.each([
    ['空字符串', ''],
    ['字段数不对', 'scrypt$16384$8$1$abcd'],
    ['算法段错误', 'bcrypt$16384$8$1$abcd$ef01'],
    ['hex 非法', 'scrypt$16384$8$1$zzzz$ef01'],
    ['参数越界', 'scrypt$0$0$0$abcd$ef01']
  ])('畸形存储哈希「%s」校验应返回 false（不抛异常）', (_name, stored) => {
    expect(verifyPassword('any-password', stored)).toBe(false)
  })
})

describe('auth.ts 会话 token 签名（HMAC）', () => {
  const SECRET = 'test-secret'

  it('签发后校验通过并返回 userId', () => {
    const token = signSession('user-123', SECRET)
    expect(verifySession(token, SECRET)).toBe('user-123')
  })

  it('密钥不匹配校验失败', () => {
    const token = signSession('user-123', SECRET)
    expect(verifySession(token, 'other-secret')).toBeNull()
  })

  it('篡改 userId 校验失败', () => {
    const token = signSession('user-123', SECRET)
    const forged = token.replace('user-123', 'user-999')
    expect(verifySession(forged, SECRET)).toBeNull()
  })

  it('过期 token 校验失败', () => {
    // 负 TTL：签发即过期
    const token = signSession('user-123', SECRET, -1000)
    expect(verifySession(token, SECRET)).toBeNull()
  })

  it('默认 TTL 为 30 天', () => {
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000)
  })
})
