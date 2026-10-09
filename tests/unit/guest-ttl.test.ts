/**
 * 游客 TTL 判定单测
 *
 * 只钉住会「删错人」的那一个常量：天数写小会把还在用的匿名身份删掉。
 * 删除语句的行为正确性由真库验证（见 tests 之外的手工探针），因为这里没有真实数据库测试框架。
 */

import { describe, it, expect } from 'vitest'
import { GUEST_TTL_DAYS, staleGuestCutoff } from '~/server/utils/guest-ttl'

describe('staleGuestCutoff', () => {
  it('cutoff 为 now 减 7 天', () => {
    const now = new Date('2026-10-09T12:00:00.000Z')

    expect(staleGuestCutoff(now)).toEqual(new Date('2026-10-02T12:00:00.000Z'))
  })

  it('TTL 天数与音频文件保持一致（7 天）', () => {
    expect(GUEST_TTL_DAYS).toBe(7)
  })

  it('不传参时基于当前时间计算', () => {
    const before = Date.now()
    const cutoff = staleGuestCutoff().getTime()
    const expected = before - GUEST_TTL_DAYS * 24 * 60 * 60 * 1000

    expect(cutoff).toBeGreaterThanOrEqual(expected - 1000)
    expect(cutoff).toBeLessThanOrEqual(expected + 1000)
  })
})
