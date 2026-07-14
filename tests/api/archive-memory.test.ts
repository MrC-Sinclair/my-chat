/**
 * 归档 API 测试（/api/sessions/:id/archive-memory）
 *
 * 测试覆盖：
 * - 参数校验：缺少 id / 非法 UUID v4 格式
 * - 会话不存在 → 404
 * - 成功触发归档 → 202 + fire-and-forget
 * - archiveSessionMessages 被调用（不 await 完成）
 * - 错误处理：archiveSessionMessages 抛异常时不影响 202 响应
 *
 * 策略：mock ~/server/db 和 ~/server/utils/memory-archive，避免真实 DB 和归档逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 使用 vi.hoisted 确保 mock 变量在 vi.mock 提升时已初始化
const { mockDb, mockSessions, mockArchiveSessionMessages } = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn()
  },
  mockSessions: {
    id: 'id'
  },
  mockArchiveSessionMessages: vi.fn()
}))

vi.mock('~/server/db', () => ({
  db: mockDb
}))

vi.mock('~/server/db/schema', () => ({
  sessions: mockSessions
}))

vi.mock('~/server/utils/memory-archive', () => ({
  archiveSessionMessages: mockArchiveSessionMessages
}))

// mock setResponseStatus（Nitro auto-import，setup.ts 未定义）
vi.stubGlobal('setResponseStatus', vi.fn())

// 动态导入被测模块（在 mock 之后）
const archiveMemoryHandler = (await import('~/server/api/sessions/[id]/archive-memory.post')).default

/** 构造模拟的 H3Event */
function createEvent(params: Record<string, string> = {}): any {
  return {
    node: { req: { method: 'POST' }, res: {} },
    context: { params },
    _method: 'POST',
    _params: params
  }
}

/** 标准 UUID v4（用于测试） */
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

describe('归档 API /api/sessions/:id/archive-memory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 默认 mock：archiveSessionMessages 返回已解决的 Promise（模拟 fire-and-forget 成功）
    mockArchiveSessionMessages.mockResolvedValue(undefined)
  })

  describe('参数校验', () => {
    it('缺少 id 参数应抛出 400 错误', async () => {
      const event = createEvent({})
      await expect(archiveMemoryHandler(event)).rejects.toMatchObject({
        statusCode: 400,
        statusMessage: '缺少会话ID'
      })
      // 不应查库
      expect(mockDb.select).not.toHaveBeenCalled()
    })

    it('非 UUID 格式应抛出 400 错误', async () => {
      const event = createEvent({ id: 'not-a-uuid' })
      await expect(archiveMemoryHandler(event)).rejects.toMatchObject({
        statusCode: 400
      })
      expect(mockDb.select).not.toHaveBeenCalled()
    })

    it('UUID v1 应被拒绝（要求 v4）', async () => {
      // UUID v1 格式：第三段以 1 开头
      const event = createEvent({ id: '550e8400-e29b-11d4-a716-446655440000' })
      await expect(archiveMemoryHandler(event)).rejects.toMatchObject({
        statusCode: 400
      })
    })

    it('UUID v5 应被拒绝', async () => {
      // UUID v5 格式：第三段以 5 开头
      const event = createEvent({ id: '550e8400-e29b-51d4-a716-446655440000' })
      await expect(archiveMemoryHandler(event)).rejects.toMatchObject({
        statusCode: 400
      })
    })

    it(' UUID 大写应通过格式校验（正则带 i 标志）', async () => {
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: VALID_UUID.toUpperCase() }])
        })
      })

      const event = createEvent({ id: VALID_UUID.toUpperCase() })
      const result = await archiveMemoryHandler(event)

      expect(result).toHaveProperty('sessionId', VALID_UUID.toUpperCase())
    })

    it('UUID 缺少一段应被拒绝', async () => {
      const event = createEvent({ id: '550e8400-e29b-41d4-a716' })
      await expect(archiveMemoryHandler(event)).rejects.toMatchObject({
        statusCode: 400
      })
    })

    it('含特殊字符的 id 应被拒绝', async () => {
      const event = createEvent({ id: '550e8400-e29b-41d4-a716-446655440000/../..' })
      await expect(archiveMemoryHandler(event)).rejects.toMatchObject({
        statusCode: 400
      })
    })
  })

  describe('会话存在性校验', () => {
    it('会话不存在应抛出 404 错误', async () => {
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]) // 空数组 = 会话不存在
        })
      })

      const event = createEvent({ id: VALID_UUID })
      await expect(archiveMemoryHandler(event)).rejects.toMatchObject({
        statusCode: 404,
        statusMessage: '会话不存在'
      })
      // 不应触发归档
      expect(mockArchiveSessionMessages).not.toHaveBeenCalled()
    })
  })

  describe('成功触发归档', () => {
    it('有效会话应返回 202 并触发归档', async () => {
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: VALID_UUID }])
        })
      })

      const event = createEvent({ id: VALID_UUID })
      const result = await archiveMemoryHandler(event)

      // 返回 202 状态码
      expect(setResponseStatus).toHaveBeenCalledWith(event, 202)
      // 返回结构
      expect(result).toHaveProperty('message', '归档已触发，后台异步执行中')
      expect(result).toHaveProperty('sessionId', VALID_UUID)
      // 应调用 archiveSessionMessages（fire-and-forget）
      expect(mockArchiveSessionMessages).toHaveBeenCalledWith(VALID_UUID)
    })

    it('archiveSessionMessages 抛异常时不影响 202 响应', async () => {
      mockDb.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: VALID_UUID }])
        })
      })
      // archiveSessionMessages 返回 rejected promise（模拟归档内部异常）
      mockArchiveSessionMessages.mockResolvedValueOnce(
        Promise.reject(new Error('archive internal error'))
      )
      // 抑制 console.error 输出
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const event = createEvent({ id: VALID_UUID })
      const result = await archiveMemoryHandler(event)

      // 即使归档失败，API 仍应返回 202（fire-and-forget 不阻塞响应）
      expect(setResponseStatus).toHaveBeenCalledWith(event, 202)
      expect(result).toHaveProperty('sessionId', VALID_UUID)
      expect(mockArchiveSessionMessages).toHaveBeenCalledWith(VALID_UUID)
    })
  })

  describe('并发与幂等', () => {
    it('API 层不负责并发锁（由 memory-archive.ts 内部处理）', async () => {
      // 两次连续调用同一 sessionId，API 都应返回 202
      // 并发锁在 archiveSessionMessages 内部实现，API 层只负责触发
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: VALID_UUID }])
        })
      })

      const event1 = createEvent({ id: VALID_UUID })
      const event2 = createEvent({ id: VALID_UUID })

      const [r1, r2] = await Promise.all([
        archiveMemoryHandler(event1),
        archiveMemoryHandler(event2)
      ])

      // 两次都应返回 202
      expect(setResponseStatus).toHaveBeenCalledWith(event1, 202)
      expect(setResponseStatus).toHaveBeenCalledWith(event2, 202)
      // 两次都应触发归档（去重由 memory-archive.ts 处理）
      expect(mockArchiveSessionMessages).toHaveBeenCalledTimes(2)
    })
  })
})
