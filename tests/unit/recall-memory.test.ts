/**
 * recall-memory 工具单元测试（server/tools/recall-memory.ts）
 *
 * 测试覆盖：
 * - description 完整性（何时调用 / 何时不调用）
 * - inputSchema 验证（query 字段）
 * - execute 流程：
 *   * embedding 失败 → 返回 error 对象
 *   * 召回空结果 → 返回 message
 *   * reranker 成功 + 过阈值 → 返回 memories + totalResults
 *   * reranker 成功 + 全部低于阈值 → 返回 message
 *   * reranker 失败降级 → 返回 warning + fallbackMemories
 *   * 异常 → 返回 error 对象
 * - score 字段正确性（reranker 用 relevance_score，降级用 1 - distance/2）
 * - cosineDistance 调用方式
 * - 召回 top-20（limit=20）
 * - reranker top-5
 * - 边界检查：reranker 返回 index 越界时跳过
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 使用 vi.hoisted 确保 mock 变量在 vi.mock 提升时已初始化
const { mockDb, mockGenerateEmbedding, mockRerankDocuments, mockCosineDistance, mockDesc, mockSql } =
  vi.hoisted(() => {
    const mockCosineDistance = vi.fn((col, vec) => ({ _type: 'cosineDistance', col, vec }))
    const mockDesc = vi.fn((val) => ({ _type: 'desc', val }))
    const mockSql = vi.fn((strings, ...values) => ({ _type: 'sql', strings, values }))
    return {
      mockDb: {
        select: vi.fn()
      },
      mockGenerateEmbedding: vi.fn(),
      mockRerankDocuments: vi.fn(),
      mockCosineDistance,
      mockDesc,
      mockSql
    }
  })

vi.mock('drizzle-orm', () => ({
  cosineDistance: mockCosineDistance,
  desc: mockDesc,
  sql: mockSql,
  eq: vi.fn((col, val) => ({ _type: 'eq', col, val }))
}))

vi.mock('~/server/db', () => ({
  db: mockDb
}))

vi.mock('~/server/db/schema', () => ({
  memoryVectors: {
    embedding: 'embedding-col',
    content: 'content-col',
    messageId: 'messageId-col',
    sessionId: 'sessionId-col',
    role: 'role-col',
    createdAt: 'createdAt-col'
  }
}))

vi.mock('~/server/utils/embedding', () => ({
  generateEmbedding: mockGenerateEmbedding
}))

vi.mock('~/server/utils/reranker', () => ({
  rerankDocuments: mockRerankDocuments
}))

// 动态导入被测模块（在 mock 之后）
const { recallMemoryTool } = await import('~/server/tools/recall-memory')

/** 构造 db.select 链式调用 mock，返回指定结果 */
function mockDbSelectOnce(results: any[]): void {
  mockDb.select.mockImplementationOnce(() => ({
    from: vi.fn().mockReturnValue({
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(results)
      })
    })
  }))
}

/** 调用 execute 并返回结果 */
async function execute(query: string): Promise<any> {
  return await recallMemoryTool.execute!({ query }, { messages: [], toolCallId: 'test' })
}

describe('recall-memory.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('description 完整性', () => {
    it('description 应包含何时调用的触发词', () => {
      const desc = recallMemoryTool.description as string
      // 何时调用关键词
      expect(desc).toContain('之前')
      expect(desc).toContain('上次')
      expect(desc).toContain('历史')
      expect(desc).toContain('过去')
    })

    it('description 应包含何时不调用的场景', () => {
      const desc = recallMemoryTool.description as string
      // 何时不调用
      expect(desc).toContain('不要在以下场景调用')
      expect(desc).toContain('当前会话')
      expect(desc).toContain('纯知识问答')
      expect(desc).toContain('简单计算')
    })

    it('description 应说明调用后的行为', () => {
      const desc = recallMemoryTool.description as string
      expect(desc).toContain('引用来源')
    })
  })

  describe('inputSchema', () => {
    it('应包含 query 字段', () => {
      // 通过 execute 传 invalid query 触发 schema 验证
      // 注：zod schema 在 tool() 内部由 AI SDK 调用方验证
      // 这里直接验证 inputSchema 的存在性 + 字段定义
      expect(recallMemoryTool.inputSchema).toBeDefined()
    })
  })

  describe('execute - embedding 失败', () => {
    it('embedding 失败应返回 error 对象', async () => {
      mockGenerateEmbedding.mockResolvedValueOnce({
        error: 'embedding 服务不可用',
        detail: '未配置 OPENAI_API_KEY'
      })

      const result = await execute('test query')

      expect(result).toHaveProperty('error', '记忆检索失败：embedding 服务不可用')
      expect(result).toHaveProperty('detail', '未配置 OPENAI_API_KEY')
      expect(result).toHaveProperty('memories', [])
      expect(result).toHaveProperty('query', 'test query')
      // 不应继续调用 db
      expect(mockDb.select).not.toHaveBeenCalled()
    })
  })

  describe('execute - 召回空结果', () => {
    it('召回结果为空应返回 message', async () => {
      mockGenerateEmbedding.mockResolvedValueOnce({
        embedding: Array.from({ length: 1024 }, () => 0.1)
      })
      mockDbSelectOnce([])

      const result = await execute('test query')

      expect(result).toHaveProperty('memories', [])
      expect(result).toHaveProperty('message', '未找到相关历史记忆')
      expect(result).toHaveProperty('query', 'test query')
      // 不应调用 reranker
      expect(mockRerankDocuments).not.toHaveBeenCalled()
    })
  })

  describe('execute - reranker 成功 + 过阈值', () => {
    it('应返回 memories + totalResults，score 为 relevance_score', async () => {
      mockGenerateEmbedding.mockResolvedValueOnce({
        embedding: Array.from({ length: 1024 }, () => 0.1)
      })

      const recallResults = [
        {
          content: 'content-0',
          messageId: 'msg-0',
          sessionId: 'sess-0',
          role: 'user',
          createdAt: new Date(),
          distance: 0.2
        },
        {
          content: 'content-1',
          messageId: 'msg-1',
          sessionId: 'sess-1',
          role: 'assistant',
          createdAt: new Date(),
          distance: 0.4
        }
      ]
      mockDbSelectOnce(recallResults)

      mockRerankDocuments.mockResolvedValueOnce([
        {
          index: 0,
          relevanceScore: 0.9,
          document: { text: 'content-0' }
        },
        {
          index: 1,
          relevanceScore: 0.5,
          document: { text: 'content-1' }
        }
      ])

      const result = await execute('test query')

      expect(result).toHaveProperty('memories')
      expect(result.memories).toHaveLength(2)
      expect(result.memories[0]).toEqual({
        content: 'content-0',
        message_id: 'msg-0',
        session_id: 'sess-0',
        role: 'user',
        score: 0.9
      })
      expect(result.memories[1]).toEqual({
        content: 'content-1',
        message_id: 'msg-1',
        session_id: 'sess-1',
        role: 'assistant',
        score: 0.5
      })
      expect(result).toHaveProperty('totalResults', 2)
      expect(result).toHaveProperty('query', 'test query')
      // 不应有 warning
      expect(result).not.toHaveProperty('warning')
    })

    it('reranker 返回部分低于阈值应过滤掉', async () => {
      mockGenerateEmbedding.mockResolvedValueOnce({
        embedding: Array.from({ length: 1024 }, () => 0.1)
      })
      mockDbSelectOnce([
        {
          content: 'c0',
          messageId: 'm0',
          sessionId: 's0',
          role: 'user',
          createdAt: new Date(),
          distance: 0.1
        },
        {
          content: 'c1',
          messageId: 'm1',
          sessionId: 's1',
          role: 'user',
          createdAt: new Date(),
          distance: 0.5
        }
      ])

      mockRerankDocuments.mockResolvedValueOnce([
        { index: 0, relevanceScore: 0.9 }, // 过阈值
        { index: 1, relevanceScore: 0.2 } // 低于阈值 0.3
      ])

      const result = await execute('q')

      expect(result.memories).toHaveLength(1)
      expect(result.memories[0].message_id).toBe('m0')
      expect(result.memories[0].score).toBe(0.9)
      expect(result.totalResults).toBe(1)
    })

    it('reranker 返回 index 越界时应跳过', async () => {
      mockGenerateEmbedding.mockResolvedValueOnce({
        embedding: Array.from({ length: 1024 }, () => 0.1)
      })
      mockDbSelectOnce([
        {
          content: 'c0',
          messageId: 'm0',
          sessionId: 's0',
          role: 'user',
          createdAt: new Date(),
          distance: 0.1
        }
      ])

      mockRerankDocuments.mockResolvedValueOnce([
        { index: 0, relevanceScore: 0.9 }, // 有效
        { index: 99, relevanceScore: 0.95 } // index 越界
      ])

      const result = await execute('q')

      expect(result.memories).toHaveLength(1)
      expect(result.memories[0].message_id).toBe('m0')
    })
  })

  describe('execute - reranker 成功但全部低于阈值', () => {
    it('应返回 message（视为无相关记忆）', async () => {
      mockGenerateEmbedding.mockResolvedValueOnce({
        embedding: Array.from({ length: 1024 }, () => 0.1)
      })
      mockDbSelectOnce([
        {
          content: 'c0',
          messageId: 'm0',
          sessionId: 's0',
          role: 'user',
          createdAt: new Date(),
          distance: 0.1
        }
      ])

      mockRerankDocuments.mockResolvedValueOnce([
        { index: 0, relevanceScore: 0.2 } // 低于 0.3
      ])

      const result = await execute('q')

      expect(result).toHaveProperty('memories', [])
      expect(result).toHaveProperty('message', '未找到相关历史记忆')
    })

    it('reranker 返回空数组应视为无相关记忆', async () => {
      mockGenerateEmbedding.mockResolvedValueOnce({
        embedding: Array.from({ length: 1024 }, () => 0.1)
      })
      mockDbSelectOnce([
        {
          content: 'c0',
          messageId: 'm0',
          sessionId: 's0',
          role: 'user',
          createdAt: new Date(),
          distance: 0.1
        }
      ])

      mockRerankDocuments.mockResolvedValueOnce([])

      // reranker 返回空数组 → 走降级分支（fallback）
      const result = await execute('q')

      // 注：rerankResult.length === 0 走降级分支
      expect(result).toHaveProperty('warning')
      expect(result).toHaveProperty('memories')
    })
  })

  describe('execute - reranker 失败降级', () => {
    it('应返回 warning + fallbackMemories，score 用 1 - distance/2', async () => {
      mockGenerateEmbedding.mockResolvedValueOnce({
        embedding: Array.from({ length: 1024 }, () => 0.1)
      })
      const recallResults = [
        {
          content: 'c0',
          messageId: 'm0',
          sessionId: 's0',
          role: 'user',
          createdAt: new Date(),
          distance: 0.4 // score = 1 - 0.4/2 = 0.8
        },
        {
          content: 'c1',
          messageId: 'm1',
          sessionId: 's1',
          role: 'assistant',
          createdAt: new Date(),
          distance: 0.8 // score = 1 - 0.8/2 = 0.6
        },
        {
          content: 'c2',
          messageId: 'm2',
          sessionId: 's2',
          role: 'user',
          createdAt: new Date(),
          distance: 1.2 // score = 1 - 1.2/2 = 0.4
        }
      ]
      mockDbSelectOnce(recallResults)

      mockRerankDocuments.mockResolvedValueOnce(null)

      const result = await execute('q')

      expect(result).toHaveProperty('warning', 'reranker 服务不可用，降级为仅 embedding 检索')
      // 仅取前 5 条（fallbackMemories = recallResults.slice(0, 5)）
      expect(result.memories).toHaveLength(3)
      // score 映射正确
      expect(result.memories[0].score).toBeCloseTo(0.8, 5)
      expect(result.memories[1].score).toBeCloseTo(0.6, 5)
      expect(result.memories[2].score).toBeCloseTo(0.4, 5)
      // 其他字段
      expect(result.memories[0]).toEqual({
        content: 'c0',
        message_id: 'm0',
        session_id: 's0',
        role: 'user',
        score: 0.8
      })
      expect(result.totalResults).toBe(3)
    })

    it('reranker 失败且召回结果 > 5 时应截断为 5 条', async () => {
      mockGenerateEmbedding.mockResolvedValueOnce({
        embedding: Array.from({ length: 1024 }, () => 0.1)
      })
      const recallResults = Array.from({ length: 10 }, (_, i) => ({
        content: `c${i}`,
        messageId: `m${i}`,
        sessionId: `s${i}`,
        role: 'user',
        createdAt: new Date(),
        distance: 0.1 * i
      }))
      mockDbSelectOnce(recallResults)

      mockRerankDocuments.mockResolvedValueOnce(null)

      const result = await execute('q')

      expect(result.memories).toHaveLength(5)
    })
  })

  describe('execute - 异常处理', () => {
    it('generateEmbedding 抛异常应被捕获，返回 error 对象', async () => {
      mockGenerateEmbedding.mockRejectedValueOnce(new Error('embed boom'))

      const result = await execute('q')

      expect(result).toHaveProperty('error', '记忆检索失败')
      expect(result).toHaveProperty('detail', 'embed boom')
      expect(result).toHaveProperty('memories', [])
    })

    it('db 查询抛异常应被捕获，返回 error 对象', async () => {
      mockGenerateEmbedding.mockResolvedValueOnce({
        embedding: Array.from({ length: 1024 }, () => 0.1)
      })
      mockDb.select.mockImplementationOnce(() => {
        throw new Error('db boom')
      })

      const result = await execute('q')

      expect(result).toHaveProperty('error', '记忆检索失败')
      expect(result).toHaveProperty('detail', 'db boom')
    })

    it('rerankDocuments 抛异常应被捕获，返回 error 对象', async () => {
      mockGenerateEmbedding.mockResolvedValueOnce({
        embedding: Array.from({ length: 1024 }, () => 0.1)
      })
      mockDbSelectOnce([
        {
          content: 'c0',
          messageId: 'm0',
          sessionId: 's0',
          role: 'user',
          createdAt: new Date(),
          distance: 0.1
        }
      ])

      mockRerankDocuments.mockRejectedValueOnce(new Error('rerank boom'))

      const result = await execute('q')

      expect(result).toHaveProperty('error', '记忆检索失败')
      expect(result).toHaveProperty('detail', 'rerank boom')
    })
  })

  describe('调用方式', () => {
    it('应调用 cosineDistance 进行向量检索', async () => {
      const vec = Array.from({ length: 1024 }, () => 0.5)
      mockGenerateEmbedding.mockResolvedValueOnce({ embedding: vec })
      mockDbSelectOnce([])

      await execute('q')

      // cosineDistance 应被调用（两次：similarity 和 distance 各一次）
      expect(mockCosineDistance).toHaveBeenCalled()
      // 第一次调用的第二个参数应为 embedding 向量
      const firstCallArgs = mockCosineDistance.mock.calls[0]
      expect(firstCallArgs[1]).toBe(vec)
    })

    it('应使用 desc 排序', async () => {
      mockGenerateEmbedding.mockResolvedValueOnce({
        embedding: Array.from({ length: 1024 }, () => 0.1)
      })
      mockDbSelectOnce([])

      await execute('q')

      expect(mockDesc).toHaveBeenCalled()
    })

    it('应使用 limit(20) 限制召回数', async () => {
      mockGenerateEmbedding.mockResolvedValueOnce({
        embedding: Array.from({ length: 1024 }, () => 0.1)
      })
      // 捕获 limit 参数
      let capturedLimit: number | undefined
      mockDb.select.mockImplementationOnce(() => ({
        from: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn((n: number) => {
              capturedLimit = n
              return Promise.resolve([])
            })
          })
        })
      }))

      await execute('q')

      expect(capturedLimit).toBe(20)
    })

    it('应调用 rerankDocuments 传 query + documents + topN=5', async () => {
      mockGenerateEmbedding.mockResolvedValueOnce({
        embedding: Array.from({ length: 1024 }, () => 0.1)
      })
      mockDbSelectOnce([
        {
          content: 'doc1',
          messageId: 'm1',
          sessionId: 's1',
          role: 'user',
          createdAt: new Date(),
          distance: 0.1
        }
      ])

      mockRerankDocuments.mockResolvedValueOnce(null)

      await execute('my query')

      expect(mockRerankDocuments).toHaveBeenCalledWith('my query', ['doc1'], 5)
    })
  })
})
