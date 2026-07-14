/**
 * Reranker 服务单元测试（server/utils/reranker.ts）
 *
 * 测试覆盖：
 * - 成功精排：返回按 relevance_score 降序的结果
 * - return_documents: true 参数注入
 * - relevance_score 字段解析（不是 score）
 * - top_n 自动截断为 min(topN, documents.length)
 * - 失败降级返回 null
 *   * 未配置 OPENAI_API_KEY
 *   * API 响应非 200
 *   * API 响应格式异常（results 字段缺失/非数组）
 *   * AbortError 超时
 *   * 其他异常
 * - 输入校验（query 为空、documents 为空数组）
 * - runtimeConfig 读取（baseUrl / apiKey / model）
 * - Authorization 头
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock useRuntimeConfig
// 注：用 any 类型避免 mockReturnValue 时字段缺失报 TS 错误
const mockUseRuntimeConfig = vi.fn<() => any>()

vi.stubGlobal('useRuntimeConfig', mockUseRuntimeConfig)

// 动态导入以应用 stubs
const { rerankDocuments } = await import('~/server/utils/reranker')

describe('reranker.ts', () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    mockUseRuntimeConfig.mockReset()
    mockUseRuntimeConfig.mockReturnValue({
      openAiBaseUrl: 'https://api.siliconflow.cn/v1',
      openAiApiKey: 'test-api-key',
      rerankerModel: 'BAAI/bge-reranker-v2-m3'
    })
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  describe('输入校验', () => {
    it('query 为空应返回 null', async () => {
      const result = await rerankDocuments('', ['doc1', 'doc2'])
      expect(result).toBeNull()
    })

    it('documents 为空数组应返回 null', async () => {
      const result = await rerankDocuments('query', [])
      expect(result).toBeNull()
    })

    it('documents 非数组应返回 null', async () => {
      const result = await rerankDocuments('query', null as unknown as string[])
      expect(result).toBeNull()
    })
  })

  describe('成功路径', () => {
    it('应返回按 relevance_score 降序的精排结果', async () => {
      // 故意乱序返回，验证排序
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            { index: 0, relevance_score: 0.5, document: { text: 'doc0' } },
            { index: 1, relevance_score: 0.9, document: { text: 'doc1' } },
            { index: 2, relevance_score: 0.3, document: { text: 'doc2' } }
          ]
        })
      }) as any

      const result = await rerankDocuments('query', ['doc0', 'doc1', 'doc2'])

      expect(result).not.toBeNull()
      expect(result).toHaveLength(3)
      // 降序排列
      expect(result![0].relevanceScore).toBe(0.9)
      expect(result![0].index).toBe(1)
      expect(result![1].relevanceScore).toBe(0.5)
      expect(result![1].index).toBe(0)
      expect(result![2].relevanceScore).toBe(0.3)
      expect(result![2].index).toBe(2)
    })

    it('应使用 relevance_score 字段（不是 score）', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            { index: 0, relevance_score: 0.7, score: 0.99 /* 干扰字段 */ }
          ]
        })
      }) as any

      const result = await rerankDocuments('query', ['doc0'])

      expect(result).not.toBeNull()
      // 应使用 relevance_score（0.7），而非 score（0.99）
      expect(result![0].relevanceScore).toBe(0.7)
    })

    it('请求体应包含 return_documents: true', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] })
      }) as any

      await rerankDocuments('query', ['doc0', 'doc1'])

      const opts = (globalThis.fetch as any).mock.calls[0][1]
      const body = JSON.parse(opts.body)
      expect(body.return_documents).toBe(true)
      expect(body.query).toBe('query')
      expect(body.documents).toEqual(['doc0', 'doc1'])
      expect(body.model).toBe('BAAI/bge-reranker-v2-m3')
    })

    it('top_n 应自动截断为 min(topN, documents.length)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] })
      }) as any

      // documents.length=2，topN=5，预期 top_n=2
      await rerankDocuments('query', ['doc0', 'doc1'], 5)

      const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body)
      expect(body.top_n).toBe(2)
    })

    it('top_n 默认值应为 5', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] })
      }) as any

      // documents.length=10，topN=默认值
      await rerankDocuments('query', Array.from({ length: 10 }, (_, i) => `doc${i}`))

      const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body)
      expect(body.top_n).toBe(5)
    })

    it('Authorization 头应为 Bearer + apiKey', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] })
      }) as any

      await rerankDocuments('query', ['doc0'])

      const opts = (globalThis.fetch as any).mock.calls[0][1]
      expect(opts.headers.Authorization).toBe('Bearer test-api-key')
      expect(opts.headers['Content-Type']).toBe('application/json')
    })

    it('endpoint 应为 /rerank', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] })
      }) as any

      await rerankDocuments('query', ['doc0'])

      const url = (globalThis.fetch as any).mock.calls[0][0]
      expect(url).toBe('https://api.siliconflow.cn/v1/rerank')
    })

    it('应从 runtimeConfig 读取 baseUrl/apiKey/model', async () => {
      mockUseRuntimeConfig.mockReturnValue({
        openAiBaseUrl: 'https://custom.example.com/v1',
        openAiApiKey: 'custom-key',
        rerankerModel: 'custom-reranker'
      })

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] })
      }) as any

      await rerankDocuments('query', ['doc0'])

      const [url, opts] = (globalThis.fetch as any).mock.calls[0]
      expect(url).toBe('https://custom.example.com/v1/rerank')
      expect(opts.headers.Authorization).toBe('Bearer custom-key')
      expect(JSON.parse(opts.body).model).toBe('custom-reranker')
    })

    it('baseUrl 缺失应使用默认值', async () => {
      mockUseRuntimeConfig.mockReturnValue({ openAiApiKey: 'k' })

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] })
      }) as any

      await rerankDocuments('query', ['doc0'])

      const url = (globalThis.fetch as any).mock.calls[0][0]
      expect(url).toBe('https://api.siliconflow.cn/v1/rerank')
    })

    it('model 缺失应使用默认值 BAAI/bge-reranker-v2-m3', async () => {
      mockUseRuntimeConfig.mockReturnValue({ openAiApiKey: 'k' })

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] })
      }) as any

      await rerankDocuments('query', ['doc0'])

      const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body)
      expect(body.model).toBe('BAAI/bge-reranker-v2-m3')
    })

    it('document 字段应透传到返回结果', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            { index: 0, relevance_score: 0.9, document: { text: 'doc text 0' } }
          ]
        })
      }) as any

      const result = await rerankDocuments('query', ['doc0'])

      expect(result![0].document).toEqual({ text: 'doc text 0' })
    })

    it('document 字段缺失时应为 undefined', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          results: [{ index: 0, relevance_score: 0.9 }]
        })
      }) as any

      const result = await rerankDocuments('query', ['doc0'])

      expect(result![0].document).toBeUndefined()
    })

    it('单条字段缺失应跳过该条', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            { index: 0, relevance_score: 0.9 }, // 有效
            { relevance_score: 0.5 }, // index 缺失
            { index: 2 }, // relevance_score 缺失
            { index: 3, relevance_score: 'not-number' } // 类型错误
          ]
        })
      }) as any

      const result = await rerankDocuments('query', ['doc0', 'doc1', 'doc2', 'doc3'])

      expect(result).toHaveLength(1)
      expect(result![0].index).toBe(0)
    })

    it('返回空 results 数组应返回空数组（非 null）', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] })
      }) as any

      const result = await rerankDocuments('query', ['doc0'])

      expect(result).toEqual([])
    })
  })

  describe('失败降级', () => {
    it('未配置 OPENAI_API_KEY 应返回 null', async () => {
      // 先 mock fetch 为 spy，以便验证 not.toHaveBeenCalled
      globalThis.fetch = vi.fn()
      mockUseRuntimeConfig.mockReturnValue({
        openAiBaseUrl: 'https://api.siliconflow.cn/v1',
        openAiApiKey: undefined,
        rerankerModel: 'BAAI/bge-reranker-v2-m3'
      })

      const result = await rerankDocuments('query', ['doc0'])

      expect(result).toBeNull()
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })

    it('API 返回非 200 应返回 null', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error'
      }) as any

      const result = await rerankDocuments('query', ['doc0'])

      expect(result).toBeNull()
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('API 请求失败 (500)')
      )
    })

    it('API 返回 results 字段缺失应返回 null', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ /* 无 results */ })
      }) as any

      const result = await rerankDocuments('query', ['doc0'])

      expect(result).toBeNull()
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('格式异常'))
    })

    it('API 返回 results 非数组应返回 null', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: 'not-array' })
      }) as any

      const result = await rerankDocuments('query', ['doc0'])

      expect(result).toBeNull()
    })

    it('AbortError 应返回 null 并记录超时日志', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const abortError = new Error('aborted')
      abortError.name = 'AbortError'
      globalThis.fetch = vi.fn().mockRejectedValueOnce(abortError) as any

      const result = await rerankDocuments('query', ['doc0'])

      expect(result).toBeNull()
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('API 请求超时（30秒）')
      )
    })

    it('其他异常应返回 null', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('network')) as any

      const result = await rerankDocuments('query', ['doc0'])

      expect(result).toBeNull()
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('调用失败'),
        expect.any(Error)
      )
    })

    it('response.text() 失败时应降级', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => {
          throw new Error('read failed')
        }
      }) as any

      const result = await rerankDocuments('query', ['doc0'])

      expect(result).toBeNull()
    })
  })
})
