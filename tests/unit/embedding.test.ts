/**
 * Embedding 服务单元测试（server/utils/embedding.ts）
 *
 * 测试覆盖：
 * - 成功返回 1024 维向量
 * - 超长文本不截断，仅记录警告日志（mock console.warn）
 * - 失败降级返回 { error, detail }
 *   * 未配置 OPENAI_API_KEY
 *   * API 响应非 200
 *   * API 响应格式异常（embedding 字段缺失/非数组/空数组）
 *   * AbortError 超时
 *   * 其他异常
 * - runtimeConfig 读取（baseUrl / apiKey / model）
 * - 输入校验（空字符串、非字符串）
 * - 请求体格式（model / input / encoding_format）
 * - Authorization 头（Bearer + apiKey）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock useRuntimeConfig：返回服务端配置
// 注：用 any 类型避免 mockReturnValue 时字段缺失报 TS 错误
const mockUseRuntimeConfig = vi.fn<() => any>()

vi.stubGlobal('useRuntimeConfig', mockUseRuntimeConfig)

// 动态导入以应用 stubs
const { generateEmbedding, EMBEDDING_DIMENSIONS } = await import('~/server/utils/embedding')

/** 构造长度为 n 的 1024 维向量 */
function makeVector(n = EMBEDDING_DIMENSIONS): number[] {
  return Array.from({ length: n }, (_, i) => i * 0.001)
}

describe('embedding.ts', () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    mockUseRuntimeConfig.mockReset()
    mockUseRuntimeConfig.mockReturnValue({
      openAiBaseUrl: 'https://api.siliconflow.cn/v1',
      openAiApiKey: 'test-api-key',
      embeddingModel: 'BAAI/bge-m3'
    })
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  describe('输入校验', () => {
    it('空字符串应返回 error 对象', async () => {
      const result = await generateEmbedding('')
      expect(result).toHaveProperty('error', 'embedding 输入无效')
      expect(result).toHaveProperty('detail', 'text 为空或非字符串')
    })

    it('非字符串输入应返回 error 对象', async () => {
      const result = await generateEmbedding(null as unknown as string)
      expect(result).toHaveProperty('error', 'embedding 输入无效')
    })
  })

  describe('成功路径', () => {
    it('应返回 1024 维向量', async () => {
      const vector = makeVector()
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: vector }] })
      }) as any

      const result = await generateEmbedding('hello world')

      expect(result).toHaveProperty('embedding')
      expect((result as any).embedding).toHaveLength(EMBEDDING_DIMENSIONS)
    })

    it('应使用正确的 endpoint', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: makeVector() }] })
      }) as any

      await generateEmbedding('test')

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.siliconflow.cn/v1/embeddings',
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('请求体应包含 model / input / encoding_format', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: makeVector() }] })
      }) as any

      await generateEmbedding('test input')

      const callArgs = (globalThis.fetch as any).mock.calls[0][1]
      const body = JSON.parse(callArgs.body)
      expect(body.model).toBe('BAAI/bge-m3')
      expect(body.input).toBe('test input')
      expect(body.encoding_format).toBe('float')
    })

    it('Authorization 头应为 Bearer + apiKey', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: makeVector() }] })
      }) as any

      await generateEmbedding('test')

      const callArgs = (globalThis.fetch as any).mock.calls[0][1]
      expect(callArgs.headers.Authorization).toBe('Bearer test-api-key')
      expect(callArgs.headers['Content-Type']).toBe('application/json')
    })

    it('应从 runtimeConfig 读取 baseUrl/apiKey/model', async () => {
      mockUseRuntimeConfig.mockReturnValue({
        openAiBaseUrl: 'https://custom.example.com/v1',
        openAiApiKey: 'custom-key',
        embeddingModel: 'custom-embedding-model'
      })

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: makeVector() }] })
      }) as any

      await generateEmbedding('test')

      const [url, opts] = (globalThis.fetch as any).mock.calls[0]
      expect(url).toBe('https://custom.example.com/v1/embeddings')
      expect(opts.headers.Authorization).toBe('Bearer custom-key')
      expect(JSON.parse(opts.body).model).toBe('custom-embedding-model')
    })

    it('baseUrl 缺失时应使用默认值 https://api.siliconflow.cn/v1', async () => {
      mockUseRuntimeConfig.mockReturnValue({
        openAiApiKey: 'test-key'
        // openAiBaseUrl 缺失
      })

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: makeVector() }] })
      }) as any

      await generateEmbedding('test')

      const [url] = (globalThis.fetch as any).mock.calls[0]
      expect(url).toBe('https://api.siliconflow.cn/v1/embeddings')
    })

    it('model 缺失时应使用默认值 BAAI/bge-m3', async () => {
      mockUseRuntimeConfig.mockReturnValue({
        openAiApiKey: 'test-key'
      })

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: makeVector() }] })
      }) as any

      await generateEmbedding('test')

      const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body)
      expect(body.model).toBe('BAAI/bge-m3')
    })
  })

  describe('超长文本不截断', () => {
    it('文本长度 > 6000 字符应仅记录警告，不截断', async () => {
      const longText = 'a'.repeat(6001)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      let capturedInput: string | undefined
      globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
        capturedInput = JSON.parse((opts as any).body).input
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ embedding: makeVector() }] })
        }
      }) as any

      const result = await generateEmbedding(longText)

      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0][0]).toContain('6001')
      // 验证未截断：传给 API 的 input 长度 = 原文长度
      expect(capturedInput).toHaveLength(6001)
      expect(capturedInput).toBe(longText)
      expect(result).toHaveProperty('embedding')
    })

    it('文本长度 = 6000 字符不应触发警告', async () => {
      const text = 'a'.repeat(6000)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: makeVector() }] })
      }) as any

      await generateEmbedding(text)

      // 不应触发超长文本警告
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })

  describe('失败降级', () => {
    it('未配置 OPENAI_API_KEY 应返回 error 对象', async () => {
      // 先 mock fetch 为 spy，以便验证 not.toHaveBeenCalled
      globalThis.fetch = vi.fn()
      mockUseRuntimeConfig.mockReturnValue({
        openAiBaseUrl: 'https://api.siliconflow.cn/v1',
        openAiApiKey: undefined,
        embeddingModel: 'BAAI/bge-m3'
      })

      const result = await generateEmbedding('test')

      expect(result).toHaveProperty('error', 'embedding 服务不可用')
      expect(result).toHaveProperty('detail', '未配置 OPENAI_API_KEY')
      // 不应调用 fetch
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })

    it('API 返回非 200 应返回 error 对象', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error'
      }) as any

      const result = await generateEmbedding('test')

      expect(result).toHaveProperty('error', 'embedding 服务不可用')
      expect(result).toHaveProperty('detail')
      expect((result as any).detail).toContain('500')
      expect((result as any).detail).toContain('Internal Server Error')
    })

    it('API 返回 embedding 字段缺失应返回 error 对象', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{}] })
      }) as any

      const result = await generateEmbedding('test')

      expect(result).toHaveProperty('error', 'embedding 服务不可用')
      expect((result as any).detail).toContain('格式异常')
    })

    it('API 返回 embedding 为空数组应返回 error 对象', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [] }] })
      }) as any

      const result = await generateEmbedding('test')

      expect(result).toHaveProperty('error', 'embedding 服务不可用')
      expect((result as any).detail).toContain('格式异常')
    })

    it('API 返回 embedding 非数组应返回 error 对象', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: 'not-array' }] })
      }) as any

      const result = await generateEmbedding('test')

      expect(result).toHaveProperty('error', 'embedding 服务不可用')
      expect((result as any).detail).toContain('格式异常')
    })

    it('返回维度不一致应记录警告但仍返回向量', async () => {
      const wrongDimVector = makeVector(512) // 错误维度
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: wrongDimVector }] })
      }) as any

      const result = await generateEmbedding('test')

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('返回维度 512 与预期 1024 不一致')
      )
      expect(result).toHaveProperty('embedding')
      expect((result as any).embedding).toHaveLength(512)
    })

    it('AbortError 应返回超时错误描述', async () => {
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      globalThis.fetch = vi.fn().mockRejectedValueOnce(abortError) as any

      const result = await generateEmbedding('test')

      expect(result).toHaveProperty('error', 'embedding 服务不可用')
      expect(result).toHaveProperty('detail', 'API 请求超时（30秒）')
    })

    it('其他异常应返回 error 对象', async () => {
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('network error')) as any

      const result = await generateEmbedding('test')

      expect(result).toHaveProperty('error', 'embedding 服务不可用')
      expect(result).toHaveProperty('detail', 'network error')
    })

    it('response.text() 失败时应降级为空错误描述', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => {
          throw new Error('read failed')
        }
      }) as any

      const result = await generateEmbedding('test')

      expect(result).toHaveProperty('error', 'embedding 服务不可用')
      expect((result as any).detail).toContain('500')
    })
  })
})
