/**
 * 图片生成服务单元测试（server/utils/image-generation.ts）
 *
 * 测试覆盖：
 * - 输入校验：prompt 空/超长、seed 越界、imageSize 非法
 * - 未配置 OPENAI_API_KEY
 * - 成功路径：API 200 + ImgBB 转存成功
 * - 默认值：不传 seed/imageSize 时的请求体
 * - ImgBB 转存失败降级（返回原始 URL + warning）
 * - API 失败：非 200、images 字段缺失、images[0].url 非字符串
 * - 超时：TimeoutError / AbortError
 * - runtimeConfig 读取：baseUrl / apiKey / model
 * - markdown 格式：alt 文本截断、URL 嵌入
 * - 响应字段提取：seed / inferenceTime
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock useRuntimeConfig：返回服务端配置
const mockUseRuntimeConfig = vi.fn<() => any>()
vi.stubGlobal('useRuntimeConfig', mockUseRuntimeConfig)

// mock uploadUrlToImgBb：用 vi.hoisted 提升变量以兼容 vi.mock 的提升机制
const { mockUploadUrlToImgBb } = vi.hoisted(() => ({
  mockUploadUrlToImgBb: vi.fn()
}))

vi.mock('~/server/utils/imgbb', () => ({
  uploadUrlToImgBb: mockUploadUrlToImgBb
}))

// 动态导入以应用 stubs / mocks
const { generateImageWithPersistence, IMAGE_SIZES } = await import(
  '~/server/utils/image-generation'
)

/** 构造硅基流动 API 成功响应 */
function buildSuccessResponse(
  imageUrl = 'https://sf-cdn.example.com/temp/image.png',
  seed = 12345,
  inference = 1.5
) {
  return {
    images: [{ url: imageUrl }],
    timings: { inference },
    seed
  }
}

/** 构造 fetch 成功 Response */
function buildOkResponse(json: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => json
  }
}

/** 构造 fetch 失败 Response */
function buildFailResponse(status: number, text: string) {
  return {
    ok: false,
    status,
    text: async () => text
  }
}

describe('image-generation.ts', () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    mockUseRuntimeConfig.mockReset()
    mockUseRuntimeConfig.mockReturnValue({
      openAiBaseUrl: 'https://api.siliconflow.cn/v1',
      openAiApiKey: 'test-api-key',
      imageGenerationModel: 'Kwai-Kolors/Kolors'
    })

    mockUploadUrlToImgBb.mockReset()
    mockUploadUrlToImgBb.mockResolvedValue('https://i.ibb.co/persistent/image.png')
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  describe('输入校验', () => {
    it('prompt 为空字符串应返回 error 对象', async () => {
      const result = await generateImageWithPersistence({ prompt: '' })
      expect(result).toHaveProperty('error', '图片生成参数无效')
      expect(result).toHaveProperty('detail', 'prompt 不能为空')
      expect((result as any).query).toEqual({ prompt: '', seed: undefined, imageSize: undefined })
    })

    it('prompt 仅含空格应返回 error 对象', async () => {
      const result = await generateImageWithPersistence({ prompt: '   ' })
      expect(result).toHaveProperty('error', '图片生成参数无效')
      expect(result).toHaveProperty('detail', 'prompt 不能为空')
    })

    it('prompt 超过 2000 字符应返回 error 对象', async () => {
      const longPrompt = 'a'.repeat(2001)
      const result = await generateImageWithPersistence({ prompt: longPrompt })
      expect(result).toHaveProperty('error', '图片生成参数无效')
      expect((result as any).detail).toContain('2000')
      expect((result as any).detail).toContain('2001')
    })

    it('seed 小于 0 应返回 error 对象', async () => {
      const result = await generateImageWithPersistence({ prompt: 'test', seed: -1 })
      expect(result).toHaveProperty('error', '图片生成参数无效')
      expect((result as any).detail).toContain('seed 越界')
    })

    it('seed 大于 9999999999 应返回 error 对象', async () => {
      const result = await generateImageWithPersistence({ prompt: 'test', seed: 10000000000 })
      expect(result).toHaveProperty('error', '图片生成参数无效')
      expect((result as any).detail).toContain('seed 越界')
    })

    it('seed 等于 0 应通过校验（边界）', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce(buildOkResponse(buildSuccessResponse('url', 0))) as any
      const result = await generateImageWithPersistence({ prompt: 'test', seed: 0 })
      expect(result).toHaveProperty('imageUrl')
    })

    it('seed 等于 9999999999 应通过校验（边界）', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse(buildSuccessResponse('url', 9999999999))) as any
      const result = await generateImageWithPersistence({ prompt: 'test', seed: 9999999999 })
      expect(result).toHaveProperty('imageUrl')
    })

    it('imageSize 非法应返回 error 对象', async () => {
      const result = await generateImageWithPersistence({
        prompt: 'test',
        imageSize: 'invalid-size' as any
      })
      expect(result).toHaveProperty('error', '图片生成参数无效')
      expect((result as any).detail).toContain('imageSize 不在合法枚举中')
    })

    it('IMAGE_SIZES 应包含 5 个合法尺寸', () => {
      expect(IMAGE_SIZES).toEqual([
        '1024x1024',
        '960x1280',
        '768x1024',
        '720x1440',
        '720x1280'
      ])
    })
  })

  describe('未配置 API Key', () => {
    it('openAiApiKey 缺失应返回 error 对象且不调用 fetch', async () => {
      mockUseRuntimeConfig.mockReturnValue({
        openAiBaseUrl: 'https://api.siliconflow.cn/v1',
        openAiApiKey: undefined,
        imageGenerationModel: 'Kwai-Kolors/Kolors'
      })
      globalThis.fetch = vi.fn()

      const result = await generateImageWithPersistence({ prompt: 'test' })

      expect(result).toHaveProperty('error', '图片生成服务不可用')
      expect(result).toHaveProperty('detail', '未配置 OPENAI_API_KEY')
      expect(globalThis.fetch).not.toHaveBeenCalled()
    })
  })

  describe('成功路径', () => {
    it('应返回持久化 URL 和 markdown', async () => {
      const tempUrl = 'https://sf-cdn.example.com/temp/abc.png'
      const persistentUrl = 'https://i.ibb.co/xyz/abc.png'
      mockUploadUrlToImgBb.mockResolvedValueOnce(persistentUrl)

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse(buildSuccessResponse(tempUrl, 12345, 1.5))) as any

      const result = await generateImageWithPersistence({ prompt: 'a cat' })

      expect(result).toHaveProperty('imageUrl', persistentUrl)
      expect(result).toHaveProperty('seed', 12345)
      expect(result).toHaveProperty('inferenceTime', 1.5)
      expect(result).toHaveProperty('markdown')
      expect((result as any).markdown).toBe(`![a cat](${persistentUrl})`)
      // 不应有 warning
      expect((result as any).warning).toBeUndefined()
    })

    it('请求体应包含 model / prompt / image_size / seed', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse(buildSuccessResponse())) as any

      await generateImageWithPersistence({
        prompt: 'a cat',
        seed: 499,
        imageSize: '960x1280'
      })

      const callArgs = (globalThis.fetch as any).mock.calls[0][1]
      const body = JSON.parse(callArgs.body)
      expect(body.model).toBe('Kwai-Kolors/Kolors')
      expect(body.prompt).toBe('a cat')
      expect(body.image_size).toBe('960x1280')
      expect(body.seed).toBe(499)
    })

    it('不传 seed 时请求体应不含 seed', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse(buildSuccessResponse())) as any

      await generateImageWithPersistence({ prompt: 'a cat' })

      const callArgs = (globalThis.fetch as any).mock.calls[0][1]
      const body = JSON.parse(callArgs.body)
      expect(body).not.toHaveProperty('seed')
    })

    it('不传 imageSize 时请求体应使用默认值 1024x1024', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse(buildSuccessResponse())) as any

      await generateImageWithPersistence({ prompt: 'a cat' })

      const callArgs = (globalThis.fetch as any).mock.calls[0][1]
      const body = JSON.parse(callArgs.body)
      expect(body.image_size).toBe('1024x1024')
    })

    it('Authorization 头应为 Bearer + apiKey', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse(buildSuccessResponse())) as any

      await generateImageWithPersistence({ prompt: 'test' })

      const callArgs = (globalThis.fetch as any).mock.calls[0][1]
      expect(callArgs.headers.Authorization).toBe('Bearer test-api-key')
      expect(callArgs.headers['Content-Type']).toBe('application/json')
    })

    it('endpoint 应为 baseUrl + /images/generations', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse(buildSuccessResponse())) as any

      await generateImageWithPersistence({ prompt: 'test' })

      const url = (globalThis.fetch as any).mock.calls[0][0]
      expect(url).toBe('https://api.siliconflow.cn/v1/images/generations')
    })

    it('应使用 AbortSignal.timeout 信号', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse(buildSuccessResponse())) as any

      await generateImageWithPersistence({ prompt: 'test' })

      const callArgs = (globalThis.fetch as any).mock.calls[0][1]
      expect(callArgs.signal).toBeInstanceOf(AbortSignal)
      expect(callArgs.signal.aborted).toBe(false)
    })

    it('应从 runtimeConfig 读取 baseUrl/apiKey/model', async () => {
      mockUseRuntimeConfig.mockReturnValue({
        openAiBaseUrl: 'https://custom.example.com/v1',
        openAiApiKey: 'custom-key',
        imageGenerationModel: 'custom-image-model'
      })

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse(buildSuccessResponse())) as any

      await generateImageWithPersistence({ prompt: 'test' })

      const [url, opts] = (globalThis.fetch as any).mock.calls[0]
      expect(url).toBe('https://custom.example.com/v1/images/generations')
      expect(opts.headers.Authorization).toBe('Bearer custom-key')
      expect(JSON.parse(opts.body).model).toBe('custom-image-model')
    })

    it('baseUrl 缺失时应使用默认值', async () => {
      mockUseRuntimeConfig.mockReturnValue({
        openAiApiKey: 'test-key',
        imageGenerationModel: 'Kwai-Kolors/Kolors'
      })

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse(buildSuccessResponse())) as any

      await generateImageWithPersistence({ prompt: 'test' })

      const [url] = (globalThis.fetch as any).mock.calls[0]
      expect(url).toBe('https://api.siliconflow.cn/v1/images/generations')
    })

    it('imageGenerationModel 缺失时应使用默认值', async () => {
      mockUseRuntimeConfig.mockReturnValue({
        openAiBaseUrl: 'https://api.siliconflow.cn/v1',
        openAiApiKey: 'test-key'
      })

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse(buildSuccessResponse())) as any

      await generateImageWithPersistence({ prompt: 'test' })

      const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body)
      expect(body.model).toBe('Kwai-Kolors/Kolors')
    })

    it('应调用 uploadUrlToImgBb 转存临时 URL', async () => {
      const tempUrl = 'https://sf-cdn.example.com/temp/xyz.png'
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse(buildSuccessResponse(tempUrl))) as any

      await generateImageWithPersistence({ prompt: 'test' })

      expect(mockUploadUrlToImgBb).toHaveBeenCalledWith(tempUrl)
    })
  })

  describe('markdown alt 文本', () => {
    it('prompt 短于 30 字符时 alt 取完整 prompt', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse(buildSuccessResponse())) as any

      const result = await generateImageWithPersistence({ prompt: 'a cute cat' })

      expect((result as any).markdown).toBe('![a cute cat](https://i.ibb.co/persistent/image.png)')
    })

    it('prompt 等于 30 字符时 alt 取完整 prompt', async () => {
      const prompt = 'a'.repeat(30)
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse(buildSuccessResponse())) as any

      const result = await generateImageWithPersistence({ prompt })

      expect((result as any).markdown).toBe(
        `![${prompt}](https://i.ibb.co/persistent/image.png)`
      )
    })

    it('prompt 超过 30 字符时 alt 截断加 ...', async () => {
      const prompt = 'a'.repeat(40)
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse(buildSuccessResponse())) as any

      const result = await generateImageWithPersistence({ prompt })

      const expectedAlt = 'a'.repeat(30) + '...'
      expect((result as any).markdown).toBe(
        `![${expectedAlt}](https://i.ibb.co/persistent/image.png)`
      )
    })
  })

  describe('ImgBB 转存失败降级', () => {
    it('uploadUrlToImgBb 抛异常应返回原始 URL + warning', async () => {
      const tempUrl = 'https://sf-cdn.example.com/temp/fail.png'
      mockUploadUrlToImgBb.mockRejectedValueOnce(new Error('imgbb 503'))

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse(buildSuccessResponse(tempUrl, 999, 2.0))) as any

      // 抑制 console.warn 输出
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = await generateImageWithPersistence({ prompt: 'test' })

      expect(result).toHaveProperty('imageUrl', tempUrl)
      expect(result).toHaveProperty('seed', 999)
      expect(result).toHaveProperty('inferenceTime', 2.0)
      expect(result).toHaveProperty('warning', '图片链接 1 小时后失效，请及时保存')
      // markdown 中 URL 应是原始临时 URL
      expect((result as any).markdown).toBe(`![test](${tempUrl})`)
    })

    it('转存失败时应记录 warning 日志', async () => {
      mockUploadUrlToImgBb.mockRejectedValueOnce(new Error('imgbb error'))
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse(buildSuccessResponse())) as any

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await generateImageWithPersistence({ prompt: 'test' })

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[image-generation] ImgBB 转存失败')
      )
    })
  })

  describe('API 失败', () => {
    it('response.ok=false 应返回 error 对象', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildFailResponse(500, 'Internal Server Error')) as any

      const result = await generateImageWithPersistence({ prompt: 'test' })

      expect(result).toHaveProperty('error', '图片生成服务不可用')
      expect((result as any).detail).toContain('500')
      expect((result as any).detail).toContain('Internal Server Error')
      // 失败时不应调用 ImgBB
      expect(mockUploadUrlToImgBb).not.toHaveBeenCalled()
    })

    it('images 字段缺失应返回 error 对象', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse({ timings: { inference: 1 }, seed: 1 })) as any

      const result = await generateImageWithPersistence({ prompt: 'test' })

      expect(result).toHaveProperty('error', '图片生成服务不可用')
      expect((result as any).detail).toContain('格式异常')
    })

    it('images[0].url 非字符串应返回 error 对象', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse({ images: [{ url: null }], seed: 1 })) as any

      const result = await generateImageWithPersistence({ prompt: 'test' })

      expect(result).toHaveProperty('error', '图片生成服务不可用')
      expect((result as any).detail).toContain('格式异常')
    })

    it('images 为空数组应返回 error 对象', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse({ images: [], seed: 1 })) as any

      const result = await generateImageWithPersistence({ prompt: 'test' })

      expect(result).toHaveProperty('error', '图片生成服务不可用')
      expect((result as any).detail).toContain('格式异常')
    })

    it('response.text() 失败时应降级为空错误描述', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => {
          throw new Error('read failed')
        }
      }) as any

      const result = await generateImageWithPersistence({ prompt: 'test' })

      expect(result).toHaveProperty('error', '图片生成服务不可用')
      expect((result as any).detail).toContain('500')
    })
  })

  describe('超时降级', () => {
    it('TimeoutError 应返回超时错误描述', async () => {
      const err = new Error('The operation timed out')
      err.name = 'TimeoutError'
      globalThis.fetch = vi.fn().mockRejectedValueOnce(err) as any

      const result = await generateImageWithPersistence({ prompt: 'test' })

      expect(result).toHaveProperty('error', '图片生成服务不可用')
      expect(result).toHaveProperty('detail', 'API 请求超时（60秒）')
    })

    it('AbortError 应返回超时错误描述', async () => {
      const err = new Error('The operation was aborted')
      err.name = 'AbortError'
      globalThis.fetch = vi.fn().mockRejectedValueOnce(err) as any

      const result = await generateImageWithPersistence({ prompt: 'test' })

      expect(result).toHaveProperty('error', '图片生成服务不可用')
      expect(result).toHaveProperty('detail', 'API 请求超时（60秒）')
    })
  })

  describe('其他异常', () => {
    it('fetch 网络错误应返回 error 对象', async () => {
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('network error')) as any

      const result = await generateImageWithPersistence({ prompt: 'test' })

      expect(result).toHaveProperty('error', '图片生成服务不可用')
      expect(result).toHaveProperty('detail', 'network error')
    })

    it('非 Error 类型异常应转为字符串 detail', async () => {
      globalThis.fetch = vi.fn().mockRejectedValueOnce('string error') as any

      const result = await generateImageWithPersistence({ prompt: 'test' })

      expect(result).toHaveProperty('error', '图片生成服务不可用')
      expect(result).toHaveProperty('detail', 'string error')
    })
  })

  describe('响应字段提取', () => {
    it('seed 缺失时应回退到 params.seed', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce(
        buildOkResponse({
          images: [{ url: 'url' }],
          timings: { inference: 1.0 }
          // 无 seed 字段
        })
      ) as any

      const result = await generateImageWithPersistence({ prompt: 'test', seed: 777 })

      expect(result).toHaveProperty('seed', 777)
    })

    it('seed 缺失且未传 params.seed 时应回退到 0', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce(
        buildOkResponse({
          images: [{ url: 'url' }],
          timings: { inference: 1.0 }
        })
      ) as any

      const result = await generateImageWithPersistence({ prompt: 'test' })

      expect(result).toHaveProperty('seed', 0)
    })

    it('timings.inference 缺失时 inferenceTime 应为 0', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce(
        buildOkResponse({
          images: [{ url: 'url' }],
          seed: 1
        })
      ) as any

      const result = await generateImageWithPersistence({ prompt: 'test' })

      expect(result).toHaveProperty('inferenceTime', 0)
    })

    it('timings.inference 非数字时 inferenceTime 应为 0', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce(
        buildOkResponse({
          images: [{ url: 'url' }],
          timings: { inference: 'not-number' },
          seed: 1
        })
      ) as any

      const result = await generateImageWithPersistence({ prompt: 'test' })

      expect(result).toHaveProperty('inferenceTime', 0)
    })
  })

  describe('失败时 query 字段', () => {
    it('参数校验失败时 query 应记录原始入参', async () => {
      const result = await generateImageWithPersistence({
        prompt: 'test prompt',
        seed: -1, // 非法值触发参数校验失败
        imageSize: '1024x1024'
      })

      expect((result as any).query).toEqual({
        prompt: 'test prompt',
        seed: -1,
        imageSize: '1024x1024'
      })
    })

    it('API 失败时 query 应记录入参', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce(buildFailResponse(500, 'server error')) as any

      const result = await generateImageWithPersistence({
        prompt: 'test prompt',
        seed: 456,
        imageSize: '960x1280'
      })

      expect((result as any).query).toEqual({
        prompt: 'test prompt',
        seed: 456,
        imageSize: '960x1280'
      })
    })

    it('未配置 API Key 时 query 应记录入参', async () => {
      mockUseRuntimeConfig.mockReturnValue({
        openAiApiKey: undefined
      })

      const result = await generateImageWithPersistence({
        prompt: 'test prompt',
        seed: 789,
        imageSize: '768x1024'
      })

      expect((result as any).query).toEqual({
        prompt: 'test prompt',
        seed: 789,
        imageSize: '768x1024'
      })
    })
  })
})
