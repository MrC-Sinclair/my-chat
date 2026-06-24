/**
 * 会话 API 测试
 *
 * 测试 /api/sessions 和 /api/sessions/:id 接口：
 * - GET /api/sessions 获取会话列表
 * - POST /api/sessions 创建新会话
 * - GET /api/sessions/:id 获取会话消息
 * - DELETE /api/sessions/:id 删除会话
 * - PATCH /api/sessions/:id 重命名会话
 * - 参数校验与错误处理
 *
 * 策略：mock ~/server/db 模块，避免真实数据库连接
 * 说明：defineEventHandler/getMethod 等是 Nuxt auto-import，测试中通过 global mock 提供
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// 使用 vi.hoisted 确保 mock 变量在 vi.mock 提升时已初始化
const { mockDb, mockSessions, mockMessages } = vi.hoisted(() => {
  const mockSessions = { id: 'id', title: 'title', createdAt: 'created_at', updatedAt: 'updated_at' }
  const mockMessages = { id: 'id', sessionId: 'session_id', createdAt: 'created_at' }
  return {
    mockDb: {
      select: vi.fn(),
      insert: vi.fn(),
      delete: vi.fn(),
      update: vi.fn()
    },
    mockSessions,
    mockMessages
  }
})

vi.mock('~/server/db', () => ({
  db: mockDb
}))

vi.mock('~/server/db/schema', () => ({
  sessions: mockSessions,
  messages: mockMessages
}))

// 导入被测模块（在 mock 之后）
import sessionsHandler from '~/server/api/sessions'
import sessionByIdHandler from '~/server/api/sessions/[id]'

// 构造模拟的 H3Event
function createEvent(method: string, params: Record<string, string> = {}, body: any = undefined) {
  return {
    node: { req: { method }, res: {} },
    context: { params },
    _method: method,
    _path: '/',
    _params: params,
    _body: body
  } as any
}

describe('会话 API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/sessions - 获取会话列表', () => {
    it('应返回会话列表（按 updatedAt 降序）', async () => {
      const mockList = [
        { id: 's1', title: '会话1', createdAt: new Date(), updatedAt: new Date(), messageCount: 5 },
        { id: 's2', title: '会话2', createdAt: new Date(), updatedAt: new Date(), messageCount: 0 }
      ]
      const query = createChainableQuery(mockList)
      mockDb.select.mockReturnValue(query)

      const event = createEvent('GET')
      const result = await sessionsHandler(event)

      expect(mockDb.select).toHaveBeenCalled()
      expect(query.from).toHaveBeenCalledWith(mockSessions)
      expect(query.leftJoin).toHaveBeenCalled()
      expect(query.orderBy).toHaveBeenCalled()
      expect(result).toEqual(mockList)
    })
  })

  describe('POST /api/sessions - 创建新会话', () => {
    it('应创建新会话并返回记录', async () => {
      const newSession = { id: 'new-id', title: '新对话', createdAt: new Date(), updatedAt: new Date() }
      const query = createChainableQuery([newSession])
      mockDb.insert.mockReturnValue(query)

      const event = createEvent('POST', {}, { title: '新对话' })
      const result = await sessionsHandler(event)

      expect(mockDb.insert).toHaveBeenCalledWith(mockSessions)
      expect(query.values).toHaveBeenCalled()
      expect(result).toEqual(newSession)
    })

    it('未传 title 时应自动生成默认标题', async () => {
      const newSession = { id: 'auto-id', title: '新对话 2026/6/22', createdAt: new Date(), updatedAt: new Date() }
      const query = createChainableQuery([newSession])
      mockDb.insert.mockReturnValue(query)

      const event = createEvent('POST', {}, {})
      const result = await sessionsHandler(event)

      expect(result).toEqual(newSession)
      // 验证 values 被调用时包含自动生成的标题
      expect(query.values).toHaveBeenCalledWith(
        expect.objectContaining({ id: expect.any(String), title: expect.stringContaining('新对话') })
      )
    })
  })

  it('不支持的 HTTP 方法应抛出 405 错误', async () => {
    const event = createEvent('PUT')
    await expect(sessionsHandler(event)).rejects.toMatchObject({
      statusCode: 405
    })
  })
})

describe('单个会话 API /api/sessions/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('参数校验', () => {
    it('缺少 id 参数应抛出 400 错误', async () => {
      const event = createEvent('GET', {})
      await expect(sessionByIdHandler(event)).rejects.toMatchObject({
        statusCode: 400
      })
    })
  })

  describe('GET /api/sessions/:id - 获取会话消息', () => {
    it('应返回指定会话的所有消息（按 createdAt 升序）', async () => {
      const mockMsgs = [
        { id: 'm1', sessionId: 's1', role: 'user', content: '你好', metadata: null, createdAt: new Date() },
        { id: 'm2', sessionId: 's1', role: 'assistant', content: '你好！', metadata: { model: 'qwen' }, createdAt: new Date() }
      ]
      const query = createChainableQuery(mockMsgs)
      mockDb.select.mockReturnValue(query)

      const event = createEvent('GET', { id: 's1' })
      const result = await sessionByIdHandler(event)

      expect(query.from).toHaveBeenCalledWith(mockMessages)
      expect(query.where).toHaveBeenCalled()
      expect(query.orderBy).toHaveBeenCalled()
      expect(result).toEqual(mockMsgs)
    })
  })

  describe('DELETE /api/sessions/:id - 删除会话', () => {
    it('应删除指定会话并返回 success: true', async () => {
      const query = createChainableQuery()
      mockDb.delete.mockReturnValue(query)

      const event = createEvent('DELETE', { id: 's1' })
      const result = await sessionByIdHandler(event)

      expect(mockDb.delete).toHaveBeenCalledWith(mockSessions)
      expect(query.where).toHaveBeenCalled()
      expect(result).toEqual({ success: true })
    })
  })

  describe('PATCH /api/sessions/:id - 重命名会话', () => {
    it('有效标题应更新成功', async () => {
      const query = createChainableQuery()
      mockDb.update.mockReturnValue(query)

      const event = createEvent('PATCH', { id: 's1' }, { title: '新标题' })
      const result = await sessionByIdHandler(event)

      expect(mockDb.update).toHaveBeenCalledWith(mockSessions)
      expect(query.set).toHaveBeenCalledWith(
        expect.objectContaining({ title: '新标题' })
      )
      expect(result).toEqual({ success: true })
    })

    it('空标题应抛出 400 错误', async () => {
      const event = createEvent('PATCH', { id: 's1' }, { title: '' })
      await expect(sessionByIdHandler(event)).rejects.toMatchObject({
        statusCode: 400
      })
    })

    it('非字符串标题应抛出 400 错误', async () => {
      const event = createEvent('PATCH', { id: 's1' }, { title: 123 })
      await expect(sessionByIdHandler(event)).rejects.toMatchObject({
        statusCode: 400
      })
    })

    it('仅含空格的标题应抛出 400 错误', async () => {
      const event = createEvent('PATCH', { id: 's1' }, { title: '   ' })
      await expect(sessionByIdHandler(event)).rejects.toMatchObject({
        statusCode: 400
      })
    })
  })

  it('不支持的 HTTP 方法应抛出 405 错误', async () => {
    const event = createEvent('PUT', { id: 's1' })
    await expect(sessionByIdHandler(event)).rejects.toMatchObject({
      statusCode: 405
    })
  })
})

// 链式调用辅助函数：构建 mock 查询构建器
function createChainableQuery(finalResult: any = undefined) {
  const result = {
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(finalResult || []),
    then: undefined as any
  }
  // 使其可 await
  result.then = (resolve: any) => Promise.resolve(finalResult || []).then(resolve)
  return result
}
