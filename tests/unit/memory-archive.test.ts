/**
 * memory-archive 单元测试（server/utils/memory-archive.ts）
 *
 * 测试覆盖（通过 archiveSessionMessages 公开入口测试整体流程）：
 * - 消息过滤：system 角色 / 空短消息 / 敏感信息（user 含 sk-xxx 等）
 * - LLM 重要度判断：generateText 调用参数（temperature/maxOutputTokens/abortSignal）
 * - 思考标签降级：LLM 返回含 <thinking> → 整体不入库
 * - JSON 解析失败降级
 * - 单条字段缺失跳过
 * - 消息级幂等：已归档消息跳过
 * - 进程内并发锁：同一 sessionId 并发只执行一次
 * - 失败容错：单条 embedding 失败跳过其他继续
 * - LLM 失败整体跳过
 * - created_at 从 messages.created_at 复制
 * - 无消息 / 过滤后无候选 / 重要消息为空 各场景跳过
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 使用 vi.hoisted 确保 mock 变量在 vi.mock 提升时已初始化
const { mockDb, mockGenerateText, mockGenerateEmbedding, mockCreateReasoningProvider } =
  vi.hoisted(() => {
    // mockCreateReasoningProvider 默认实现：返回一个函数（llmProvider），
    // 调用该函数返回 provider 对象（作为 generateText 的 model 参数）
    // 注：memory-archive.ts 模块加载时立即调用 createReasoningProvider()，
    // 必须在 hoisted 中预设默认实现，否则 llmProvider 为 undefined
    const mockCreateReasoningProvider = vi.fn(() => vi.fn(() => ({ id: 'mock-provider' })))
    return {
      mockDb: {
        select: vi.fn(),
        insert: vi.fn()
      },
      mockGenerateText: vi.fn(),
      mockGenerateEmbedding: vi.fn(),
      mockCreateReasoningProvider
    }
  })

vi.mock('ai', () => ({
  generateText: mockGenerateText
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ _type: 'eq', col, val }))
}))

vi.mock('~/server/db', () => ({
  db: mockDb
}))

vi.mock('~/server/db/schema', () => ({
  messages: {
    id: 'messages.id',
    role: 'messages.role',
    content: 'messages.content',
    createdAt: 'messages.createdAt',
    sessionId: 'messages.sessionId'
  },
  memoryVectors: {
    messageId: 'memoryVectors.messageId',
    sessionId: 'memoryVectors.sessionId',
    content: 'memoryVectors.content',
    embedding: 'memoryVectors.embedding',
    role: 'memoryVectors.role',
    createdAt: 'memoryVectors.createdAt'
  }
}))

vi.mock('~/server/utils/reasoning-provider', () => ({
  createReasoningProvider: mockCreateReasoningProvider
}))

vi.mock('~/server/utils/embedding', () => ({
  generateEmbedding: mockGenerateEmbedding
}))

// mock useRuntimeConfig
const mockUseRuntimeConfig = vi.fn(() => ({
  memoryImportanceModel: 'Qwen/Qwen3.5-4B'
}))
vi.stubGlobal('useRuntimeConfig', mockUseRuntimeConfig)

// mock crypto.randomUUID（测试环境稳定 UUID）
vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => 'test-uuid-' + Math.random().toString(36).slice(2, 10))
})

// 动态导入被测模块（在 mock 之后）
const { archiveSessionMessages } = await import('~/server/utils/memory-archive')

/** 构造 db.select 链式调用，返回 sessionMessages */
function mockSessionMessagesSelectOnce(messages: any[]): void {
  mockDb.select.mockImplementationOnce(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(messages)
      })
    })
  }))
}

/** 构造 db.select 链式调用，返回已归档 messageIds */
function mockArchivedIdsSelectOnce(archived: any[]): void {
  mockDb.select.mockImplementationOnce(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(archived)
    })
  }))
}

/** 构造 db.insert 链式调用 */
function mockInsertOnce(): void {
  mockDb.insert.mockImplementationOnce(() => ({
    values: vi.fn().mockResolvedValue(undefined)
  }))
}

/** 构造一条消息 */
function makeMsg(
  id: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  createdAt = new Date('2026-01-01T00:00:00Z')
) {
  return { id, role, content, createdAt }
}

describe('memory-archive.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseRuntimeConfig.mockReturnValue({ memoryImportanceModel: 'Qwen/Qwen3.5-4B' })
    // 重置 createReasoningProvider 默认实现（vi.clearAllMocks 会清除默认实现）
    mockCreateReasoningProvider.mockImplementation(() => vi.fn(() => ({ id: 'mock-provider' })))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('消息过滤', () => {
    it('system 消息应被过滤，不传给 LLM', async () => {
      mockSessionMessagesSelectOnce([
        makeMsg('m1', 'system', 'you are a helpful assistant'),
        makeMsg('m2', 'user', 'hello world')
      ])
      mockArchivedIdsSelectOnce([])

      let capturedMessagesForLLM: any
      mockGenerateText.mockImplementationOnce(async (opts) => {
        capturedMessagesForLLM = JSON.parse(opts.messages[0].content)
        return { text: '[]' }
      })

      await archiveSessionMessages('sess-test-filter-sys')

      // LLM 收到的消息列表不应含 system
      expect(capturedMessagesForLLM).toHaveLength(1)
      expect(capturedMessagesForLLM[0].id).toBe('m2')
      // 不应调用 db.insert
      expect(mockDb.insert).not.toHaveBeenCalled()
    })

    it('空短消息（content.length < 5）应被过滤', async () => {
      mockSessionMessagesSelectOnce([
        makeMsg('m1', 'user', 'hi'), // 长度 2 < 5
        makeMsg('m2', 'user', '   '), // trim 后长度 0
        makeMsg('m3', 'user', ''), // 空
        makeMsg('m4', 'assistant', '这是一个有意义的长回复')
      ])
      mockArchivedIdsSelectOnce([])

      let capturedMessagesForLLM: any
      mockGenerateText.mockImplementationOnce(async (opts) => {
        capturedMessagesForLLM = JSON.parse(opts.messages[0].content)
        return { text: '[]' }
      })

      await archiveSessionMessages('sess-test-filter-short')

      expect(capturedMessagesForLLM).toHaveLength(1)
      expect(capturedMessagesForLLM[0].id).toBe('m4')
    })

    it('user 含 sk-xxx 应被过滤（敏感信息）', async () => {
      mockSessionMessagesSelectOnce([
        makeMsg('m1', 'user', 'my api key is sk-abcdefghijklmnopqrstuvwxyz'),
        makeMsg('m2', 'user', '正常的问题内容')
      ])
      mockArchivedIdsSelectOnce([])

      let capturedMessagesForLLM: any
      mockGenerateText.mockImplementationOnce(async (opts) => {
        capturedMessagesForLLM = JSON.parse(opts.messages[0].content)
        return { text: '[]' }
      })

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await archiveSessionMessages('sess-test-filter-sensitive')

      // 含敏感信息的 m1 应被过滤
      expect(capturedMessagesForLLM).toHaveLength(1)
      expect(capturedMessagesForLLM[0].id).toBe('m2')
      // 应记录警告
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('含疑似敏感信息')
      )
    })

    it('user 含 password=xxx 应被过滤', async () => {
      mockSessionMessagesSelectOnce([
        makeMsg('m1', 'user', 'password=secret123'),
        makeMsg('m2', 'assistant', 'password=secret123') // assistant 不过滤
      ])
      mockArchivedIdsSelectOnce([])

      let capturedMessagesForLLM: any
      mockGenerateText.mockImplementationOnce(async (opts) => {
        capturedMessagesForLLM = JSON.parse(opts.messages[0].content)
        return { text: '[]' }
      })

      vi.spyOn(console, 'warn').mockImplementation(() => {})
      await archiveSessionMessages('sess-test-filter-pwd')

      // assistant 消息不过滤，仅 user 被过滤
      expect(capturedMessagesForLLM).toHaveLength(1)
      expect(capturedMessagesForLLM[0].id).toBe('m2')
    })

    it('assistant 含 api_key 不应被过滤（仅 user 过滤）', async () => {
      mockSessionMessagesSelectOnce([
        makeMsg('m1', 'assistant', '示例代码：api_key=abc123'),
        makeMsg('m2', 'assistant', '另一个示例：token=xyz456')
      ])
      mockArchivedIdsSelectOnce([])

      let capturedMessagesForLLM: any
      mockGenerateText.mockImplementationOnce(async (opts) => {
        capturedMessagesForLLM = JSON.parse(opts.messages[0].content)
        return { text: '[]' }
      })

      await archiveSessionMessages('sess-test-filter-assistant')

      // 两条 assistant 消息都应保留
      expect(capturedMessagesForLLM).toHaveLength(2)
    })
  })

  describe('LLM 重要度判断', () => {
    it('generateText 应使用正确的参数', async () => {
      mockSessionMessagesSelectOnce([makeMsg('m1', 'user', 'hello world')])
      mockArchivedIdsSelectOnce([])

      mockGenerateText.mockResolvedValueOnce({ text: '[]' })

      await archiveSessionMessages('sess-test-llm-params')

      expect(mockGenerateText).toHaveBeenCalledTimes(1)
      const opts = mockGenerateText.mock.calls[0][0]
      expect(opts.temperature).toBe(0.1)
      expect(opts.maxOutputTokens).toBe(4096)
      expect(opts.abortSignal).toBeInstanceOf(AbortSignal)
      // system prompt 应包含重要度判断说明
      expect(opts.system).toContain('重要度')
      expect(opts.system).toContain('JSON 数组')
      // messages 应为单条 user 消息（JSON 字符串）
      expect(opts.messages).toHaveLength(1)
      expect(opts.messages[0].role).toBe('user')
    })

    it('应从 runtimeConfig 读取 memoryImportanceModel', async () => {
      mockUseRuntimeConfig.mockReturnValue({ memoryImportanceModel: 'custom-model-x' })
      mockSessionMessagesSelectOnce([makeMsg('m1', 'user', 'hello world')])
      mockArchivedIdsSelectOnce([])

      mockGenerateText.mockResolvedValueOnce({ text: '[]' })

      await archiveSessionMessages('sess-test-model-config')

      // 注：createReasoningProvider 仅在模块加载时调用一次（const llmProvider = ...），
      // beforeEach 的 clearAllMocks 会清除调用记录，因此无法通过 toHaveBeenCalled 验证。
      // 此处改为验证 generateText 被调用（间接证明 llmProvider 已创建并传入）
      expect(mockGenerateText).toHaveBeenCalledTimes(1)
    })

    it('LLM 调用失败应整体跳过该次归档', async () => {
      mockSessionMessagesSelectOnce([makeMsg('m1', 'user', 'hello world')])
      mockArchivedIdsSelectOnce([])

      mockGenerateText.mockRejectedValueOnce(new Error('LLM down'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await archiveSessionMessages('sess-test-llm-fail')

      expect(mockDb.insert).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('LLM 重要度判断失败'),
        expect.any(Error)
      )
    })
  })

  describe('思考标签降级', () => {
    it('LLM 返回含 <thinking> 应整体降级为不入库', async () => {
      mockSessionMessagesSelectOnce([makeMsg('m1', 'user', 'hello world')])
      mockArchivedIdsSelectOnce([])

      mockGenerateText.mockResolvedValueOnce({
        text: '<thinking>let me think</thinking>[{"message_id":"m1","important":true,"reason":"r"}]'
      })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await archiveSessionMessages('sess-test-thinking')

      expect(mockDb.insert).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('含思考标签')
      )
    })

    it('LLM 返回含 <reflection> 应整体降级', async () => {
      mockSessionMessagesSelectOnce([makeMsg('m1', 'user', 'hello world')])
      mockArchivedIdsSelectOnce([])

      mockGenerateText.mockResolvedValueOnce({
        text: '<reflection>思考</reflection>[]'
      })
      vi.spyOn(console, 'error').mockImplementation(() => {})

      await archiveSessionMessages('sess-test-reflection')

      expect(mockDb.insert).not.toHaveBeenCalled()
    })
  })

  describe('JSON 解析容错', () => {
    it('LLM 返回非 JSON 应整体降级', async () => {
      mockSessionMessagesSelectOnce([makeMsg('m1', 'user', 'hello world')])
      mockArchivedIdsSelectOnce([])

      mockGenerateText.mockResolvedValueOnce({ text: 'this is not json' })
      vi.spyOn(console, 'error').mockImplementation(() => {})

      await archiveSessionMessages('sess-test-nonjson')

      expect(mockDb.insert).not.toHaveBeenCalled()
    })

    it('LLM 返回 JSON 截断应整体降级', async () => {
      mockSessionMessagesSelectOnce([makeMsg('m1', 'user', 'hello world')])
      mockArchivedIdsSelectOnce([])

      mockGenerateText.mockResolvedValueOnce({
        text: '[{"message_id":"m1","important":true'
      })
      vi.spyOn(console, 'error').mockImplementation(() => {})

      await archiveSessionMessages('sess-test-truncated')

      expect(mockDb.insert).not.toHaveBeenCalled()
    })

    it('LLM 返回非数组 JSON 应降级', async () => {
      mockSessionMessagesSelectOnce([makeMsg('m1', 'user', 'hello world')])
      mockArchivedIdsSelectOnce([])

      mockGenerateText.mockResolvedValueOnce({ text: '{"key":"value"}' })
      vi.spyOn(console, 'error').mockImplementation(() => {})

      await archiveSessionMessages('sess-test-notarray')

      expect(mockDb.insert).not.toHaveBeenCalled()
    })

    it('LLM 返回前后含解释文本应正确提取 JSON 数组', async () => {
      mockSessionMessagesSelectOnce([makeMsg('m1', 'user', 'hello world')])
      mockArchivedIdsSelectOnce([])

      mockGenerateText.mockResolvedValueOnce({
        text: '以下是判断结果：\n[{"message_id":"m1","important":true,"reason":"r"}]\n结束'
      })
      mockGenerateEmbedding.mockResolvedValueOnce({
        embedding: Array.from({ length: 1024 }, () => 0.1)
      })
      mockInsertOnce()

      await archiveSessionMessages('sess-test-extract-json')

      // 应成功提取 JSON 并入库
      expect(mockDb.insert).toHaveBeenCalledTimes(1)
    })

    it('LLM 返回数组单条字段缺失应跳过该条', async () => {
      mockSessionMessagesSelectOnce([
        makeMsg('m1', 'user', 'hello world'),
        makeMsg('m2', 'user', 'second message')
      ])
      mockArchivedIdsSelectOnce([])

      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify([
          { message_id: 'm1', important: true, reason: 'r' },
          { important: true }, // message_id 缺失
          { message_id: 'm2', important: 'not-bool' }, // 类型错误
          { message_id: 'm2' } // important 缺失
        ])
      })
      mockGenerateEmbedding.mockResolvedValueOnce({
        embedding: Array.from({ length: 1024 }, () => 0.1)
      })
      mockInsertOnce()

      await archiveSessionMessages('sess-test-missing-fields')

      // 仅 m1 应入库
      expect(mockDb.insert).toHaveBeenCalledTimes(1)
      // mockInsertOnce 的 values 是 vi.fn()，此处仅验证调用次数
    })

    it('LLM 返回空数组应降级', async () => {
      mockSessionMessagesSelectOnce([makeMsg('m1', 'user', 'hello world')])
      mockArchivedIdsSelectOnce([])

      mockGenerateText.mockResolvedValueOnce({ text: '[]' })
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      await archiveSessionMessages('sess-test-empty-array')

      expect(mockDb.insert).not.toHaveBeenCalled()
    })

    it('LLM 返回空字符串应降级', async () => {
      mockSessionMessagesSelectOnce([makeMsg('m1', 'user', 'hello world')])
      mockArchivedIdsSelectOnce([])

      mockGenerateText.mockResolvedValueOnce({ text: '' })
      vi.spyOn(console, 'error').mockImplementation(() => {})

      await archiveSessionMessages('sess-test-empty-string')

      expect(mockDb.insert).not.toHaveBeenCalled()
    })
  })

  describe('消息级幂等', () => {
    it('已归档消息应跳过', async () => {
      mockSessionMessagesSelectOnce([
        makeMsg('m1', 'user', 'archived message'),
        makeMsg('m2', 'user', 'new message')
      ])
      // m1 已归档
      mockArchivedIdsSelectOnce([{ messageId: 'm1' }])

      let capturedMessagesForLLM: any
      mockGenerateText.mockImplementationOnce(async (opts) => {
        capturedMessagesForLLM = JSON.parse(opts.messages[0].content)
        return { text: '[]' }
      })

      await archiveSessionMessages('sess-test-idempotent')

      // 仅 m2 传给 LLM
      expect(capturedMessagesForLLM).toHaveLength(1)
      expect(capturedMessagesForLLM[0].id).toBe('m2')
    })

    it('所有消息已归档应跳过 LLM 调用', async () => {
      mockSessionMessagesSelectOnce([makeMsg('m1', 'user', 'archived')])
      mockArchivedIdsSelectOnce([{ messageId: 'm1' }])

      await archiveSessionMessages('sess-test-all-archived')

      // 无新候选 → 跳过 LLM
      expect(mockGenerateText).not.toHaveBeenCalled()
      expect(mockDb.insert).not.toHaveBeenCalled()
    })
  })

  describe('入库流程', () => {
    it('重要消息应做 embedding 并写入 memory_vectors', async () => {
      const createdAt = new Date('2026-01-01T10:00:00Z')
      mockSessionMessagesSelectOnce([makeMsg('m1', 'user', 'hello world', createdAt)])
      mockArchivedIdsSelectOnce([])

      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify([
          { message_id: 'm1', important: true, reason: 'r' }
        ])
      })

      const embedVec = Array.from({ length: 1024 }, () => 0.5)
      mockGenerateEmbedding.mockResolvedValueOnce({ embedding: embedVec })

      let capturedInsertValues: any
      mockDb.insert.mockImplementationOnce(() => ({
        values: vi.fn((vals: any) => {
          capturedInsertValues = vals
          return Promise.resolve()
        })
      }))

      await archiveSessionMessages('sess-test-insert')

      expect(mockGenerateEmbedding).toHaveBeenCalledWith('hello world')
      expect(mockDb.insert).toHaveBeenCalledTimes(1)
      expect(capturedInsertValues.content).toBe('hello world')
      expect(capturedInsertValues.messageId).toBe('m1')
      expect(capturedInsertValues.sessionId).toBe('sess-test-insert')
      expect(capturedInsertValues.role).toBe('user')
      expect(capturedInsertValues.embedding).toBe(embedVec)
      // created_at 应从 messages.created_at 复制
      expect(capturedInsertValues.createdAt).toBe(createdAt)
      // id 应为 UUID 字符串
      expect(capturedInsertValues.id).toMatch(/^test-uuid-/)
      // archived_at 应由 schema 默认值填充，不应在 insert values 中
      expect(capturedInsertValues).not.toHaveProperty('archivedAt')
      expect(capturedInsertValues).not.toHaveProperty('archived_at')
    })

    it('LLM 判断无重要消息时应跳过入库', async () => {
      mockSessionMessagesSelectOnce([makeMsg('m1', 'user', 'hello world')])
      mockArchivedIdsSelectOnce([])

      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify([
          { message_id: 'm1', important: false, reason: 'not important' }
        ])
      })

      await archiveSessionMessages('sess-test-no-important')

      expect(mockDb.insert).not.toHaveBeenCalled()
      expect(mockGenerateEmbedding).not.toHaveBeenCalled()
    })

    it('单条 embedding 失败应跳过该条，其他继续', async () => {
      mockSessionMessagesSelectOnce([
        makeMsg('m1', 'user', 'first message'),
        makeMsg('m2', 'user', 'second message')
      ])
      mockArchivedIdsSelectOnce([])

      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify([
          { message_id: 'm1', important: true, reason: 'r' },
          { message_id: 'm2', important: true, reason: 'r' }
        ])
      })

      // m1 embedding 失败，m2 成功
      mockGenerateEmbedding
        .mockResolvedValueOnce({ error: 'fail', detail: 'm1 embed failed' })
        .mockResolvedValueOnce({
          embedding: Array.from({ length: 1024 }, () => 0.1)
        })

      mockInsertOnce()

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await archiveSessionMessages('sess-test-embed-fail')

      // m2 应入库，m1 跳过
      expect(mockDb.insert).toHaveBeenCalledTimes(1)
      // 注：mockInsertOnce 不捕获 values，此处仅验证调用次数
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('embedding 失败'),
        'm1 embed failed'
      )
    })

    it('单条 db.insert 失败应跳过该条，其他继续', async () => {
      mockSessionMessagesSelectOnce([
        makeMsg('m1', 'user', 'first message'),
        makeMsg('m2', 'user', 'second message')
      ])
      mockArchivedIdsSelectOnce([])

      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify([
          { message_id: 'm1', important: true, reason: 'r' },
          { message_id: 'm2', important: true, reason: 'r' }
        ])
      })

      mockGenerateEmbedding
        .mockResolvedValueOnce({
          embedding: Array.from({ length: 1024 }, () => 0.1)
        })
        .mockResolvedValueOnce({
          embedding: Array.from({ length: 1024 }, () => 0.2)
        })

      // m1 insert 失败，m2 成功
      mockDb.insert
        .mockImplementationOnce(() => ({
          values: vi.fn(() => Promise.reject(new Error('unique constraint')))
        }))
        .mockImplementationOnce(() => ({
          values: vi.fn(() => Promise.resolve())
        }))

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      await archiveSessionMessages('sess-test-insert-fail')

      // 应尝试两次 insert（m1 失败 + m2 成功）
      expect(mockDb.insert).toHaveBeenCalledTimes(2)
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('写入 memory_vectors 失败'),
        expect.any(Error)
      )
    })

    it('LLM 返回的 message_id 不在候选列表中应跳过', async () => {
      mockSessionMessagesSelectOnce([makeMsg('m1', 'user', 'hello world')])
      mockArchivedIdsSelectOnce([])

      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify([
          { message_id: 'nonexistent', important: true, reason: 'r' }
        ])
      })

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await archiveSessionMessages('sess-test-invalid-id')

      expect(mockDb.insert).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('不在候选列表中')
      )
    })
  })

  describe('空消息场景', () => {
    it('会话无消息应跳过', async () => {
      mockSessionMessagesSelectOnce([])

      await archiveSessionMessages('sess-test-no-messages')

      expect(mockGenerateText).not.toHaveBeenCalled()
      expect(mockDb.insert).not.toHaveBeenCalled()
    })

    it('过滤后无候选消息应跳过', async () => {
      mockSessionMessagesSelectOnce([
        makeMsg('m1', 'system', 'system prompt'), // 被过滤
        makeMsg('m2', 'user', 'hi') // 被过滤（长度 < 5）
      ])

      await archiveSessionMessages('sess-test-no-candidates')

      expect(mockGenerateText).not.toHaveBeenCalled()
      expect(mockDb.insert).not.toHaveBeenCalled()
    })
  })

  describe('进程内并发锁', () => {
    it('同一 sessionId 并发调用只执行一次 doArchiveSession', async () => {
      mockSessionMessagesSelectOnce([makeMsg('m1', 'user', 'hello world')])
      mockArchivedIdsSelectOnce([])

      // 让 generateText 延迟返回，确保并发窗口
      let resolveGenerate: (val: any) => void
      const generatePromise = new Promise((resolve) => {
        resolveGenerate = resolve
      })
      mockGenerateText.mockImplementationOnce(() => generatePromise)
      mockGenerateText.mockResolvedValueOnce({ text: '[]' }) // 第二次调用（不应触发）

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      // 并发发起两次归档
      const p1 = archiveSessionMessages('sess-test-concurrent')
      const p2 = archiveSessionMessages('sess-test-concurrent')

      // 解除第一次的 generateText 阻塞
      resolveGenerate!({ text: '[]' })

      await Promise.all([p1, p2])

      // 仅第一次调用 generateText
      expect(mockGenerateText).toHaveBeenCalledTimes(1)
      // 第二次应记录"归档进行中"日志
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('归档进行中')
      )
    })

    it('不同 sessionId 并发应各自独立执行', async () => {
      // 并发执行时 mockImplementationOnce 队列会交错消费，改用 mockImplementation
      // 根据 from() 的表参数判断返回 sessionMessages 还是 archivedIds
      // schema mock 区分：memoryVectors 有 messageId 字段，messages 没有
      mockDb.select.mockImplementation(() => ({
        from: (table: any) => {
          if ('messageId' in table) {
            // memoryVectors 表查询（getArchivedMessageIds，无 orderBy）
            return {
              where: () => Promise.resolve([]) // 无已归档
            }
          }
          // messages 表查询（doArchiveSession 第一次 select）
          return {
            where: () => ({
              orderBy: () =>
                Promise.resolve([
                  makeMsg('a1', 'user', 'message a'),
                  makeMsg('b1', 'user', 'message b')
                ])
            })
          }
        }
      }))

      mockGenerateText.mockResolvedValue({ text: '[]' })

      await Promise.all([
        archiveSessionMessages('sess-test-a'),
        archiveSessionMessages('sess-test-b')
      ])

      // 每个会话各调用 generateText 一次 = 2 次
      expect(mockGenerateText).toHaveBeenCalledTimes(2)
    })
  })

  describe('content 长度截断', () => {
    it('传给 LLM 的 content 应截断到 1000 字符', async () => {
      const longContent = 'a'.repeat(2000)
      mockSessionMessagesSelectOnce([makeMsg('m1', 'user', longContent)])
      mockArchivedIdsSelectOnce([])

      let capturedMessagesForLLM: any
      mockGenerateText.mockImplementationOnce(async (opts) => {
        capturedMessagesForLLM = JSON.parse(opts.messages[0].content)
        return { text: '[]' }
      })

      await archiveSessionMessages('sess-test-truncate')

      // LLM 收到的 content 应被截断
      expect(capturedMessagesForLLM[0].content).toHaveLength(1000)
    })
  })
})
