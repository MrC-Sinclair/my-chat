/**
 * 图片生成 API 测试（/api/generate-image）
 *
 * 测试覆盖：
 * - 参数校验：prompt 缺失/空/超长、seed 越界/非整数、imageSize 非法
 * - 成功响应：200 + 结构化结果
 * - 成功响应 + warning 字段透传
 * - 服务端错误：generateImageWithPersistence 返回 error → 500
 * - 路径不暴露内部 detail
 *
 * Mock 策略：mock ~/server/utils/image-generation 模块，提供可控返回值，
 * 不 mock fetch（参考 tests/api/archive-memory.test.ts 模式）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 使用 vi.hoisted 确保 mock 变量在 vi.mock 提升时已初始化
const { mockGenerateImageWithPersistence } = vi.hoisted(() => ({
  mockGenerateImageWithPersistence: vi.fn()
}))

vi.mock('~/server/utils/image-generation', () => ({
  generateImageWithPersistence: mockGenerateImageWithPersistence,
  IMAGE_SIZES: ['1024x1024', '960x1280', '768x1024', '720x1440', '720x1280']
}))

// 动态导入被测模块（在 mock 之后）
const generateImageHandler = (await import('~/server/api/generate-image.post')).default

/** 构造模拟的 H3Event（含 body） */
function createEvent(body: unknown): any {
  return {
    node: { req: { method: 'POST' }, res: {} },
    context: {},
    _method: 'POST',
    _body: body
  }
}

describe('图片生成 API /api/generate-image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 抑制 console.error 输出（API 失败路径会记录日志）
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  describe('参数校验', () => {
    it('prompt 缺失应抛 400', async () => {
      const event = createEvent({ seed: 100 })
      await expect(generateImageHandler(event)).rejects.toMatchObject({
        statusCode: 400
      })
      expect(mockGenerateImageWithPersistence).not.toHaveBeenCalled()
    })

    it('prompt 为空字符串应抛 400', async () => {
      const event = createEvent({ prompt: '' })
      await expect(generateImageHandler(event)).rejects.toMatchObject({
        statusCode: 400
      })
      expect(mockGenerateImageWithPersistence).not.toHaveBeenCalled()
    })

    it('prompt 超过 2000 字符应抛 400', async () => {
      const event = createEvent({ prompt: 'a'.repeat(2001) })
      await expect(generateImageHandler(event)).rejects.toMatchObject({
        statusCode: 400
      })
      expect(mockGenerateImageWithPersistence).not.toHaveBeenCalled()
    })

    it('seed 小于 0 应抛 400', async () => {
      const event = createEvent({ prompt: 'test', seed: -1 })
      await expect(generateImageHandler(event)).rejects.toMatchObject({
        statusCode: 400
      })
      expect(mockGenerateImageWithPersistence).not.toHaveBeenCalled()
    })

    it('seed 大于 9999999999 应抛 400', async () => {
      const event = createEvent({ prompt: 'test', seed: 10000000000 })
      await expect(generateImageHandler(event)).rejects.toMatchObject({
        statusCode: 400
      })
      expect(mockGenerateImageWithPersistence).not.toHaveBeenCalled()
    })

    it('seed 非整数应抛 400', async () => {
      const event = createEvent({ prompt: 'test', seed: 1.5 })
      await expect(generateImageHandler(event)).rejects.toMatchObject({
        statusCode: 400
      })
      expect(mockGenerateImageWithPersistence).not.toHaveBeenCalled()
    })

    it('imageSize 非法值应抛 400', async () => {
      const event = createEvent({ prompt: 'test', imageSize: 'invalid-size' })
      await expect(generateImageHandler(event)).rejects.toMatchObject({
        statusCode: 400
      })
      expect(mockGenerateImageWithPersistence).not.toHaveBeenCalled()
    })

    it('imageSize 合法值（960x1280）应通过校验', async () => {
      mockGenerateImageWithPersistence.mockResolvedValueOnce({
        imageUrl: 'https://i.ibb.co/test.png',
        markdown: '![test](https://i.ibb.co/test.png)',
        seed: 0,
        inferenceTime: 1.0
      })
      const event = createEvent({ prompt: 'test', imageSize: '960x1280' })
      const result = await generateImageHandler(event)
      expect(result).toHaveProperty('imageUrl')
      // 校验调用 generateImageWithPersistence 时 imageSize 透传
      expect(mockGenerateImageWithPersistence).toHaveBeenCalledWith({
        prompt: 'test',
        imageSize: '960x1280'
      })
    })

    it('body 缺失（undefined）应抛 400', async () => {
      const event = createEvent(undefined)
      await expect(generateImageHandler(event)).rejects.toMatchObject({
        statusCode: 400
      })
    })

    it('seed 边界 0 应通过校验', async () => {
      mockGenerateImageWithPersistence.mockResolvedValueOnce({
        imageUrl: 'url',
        markdown: '![test](url)',
        seed: 0,
        inferenceTime: 1
      })
      const event = createEvent({ prompt: 'test', seed: 0 })
      const result = await generateImageHandler(event)
      expect(result).toHaveProperty('imageUrl')
    })

    it('seed 边界 9999999999 应通过校验', async () => {
      mockGenerateImageWithPersistence.mockResolvedValueOnce({
        imageUrl: 'url',
        markdown: '![test](url)',
        seed: 9999999999,
        inferenceTime: 1
      })
      const event = createEvent({ prompt: 'test', seed: 9999999999 })
      const result = await generateImageHandler(event)
      expect(result).toHaveProperty('imageUrl')
    })
  })

  describe('成功响应', () => {
    it('应返回 200 + 结构化结果', async () => {
      mockGenerateImageWithPersistence.mockResolvedValueOnce({
        imageUrl: 'https://i.ibb.co/test/image.png',
        markdown: '![a cat](https://i.ibb.co/test/image.png)',
        seed: 12345,
        inferenceTime: 1.5
      })

      const event = createEvent({ prompt: 'a cat' })
      const result = await generateImageHandler(event)

      expect(result).toEqual({
        imageUrl: 'https://i.ibb.co/test/image.png',
        markdown: '![a cat](https://i.ibb.co/test/image.png)',
        seed: 12345,
        inferenceTime: 1.5
      })
      // 不应有 warning 字段
      expect(result.warning).toBeUndefined()
    })

    it('应透传 warning 字段', async () => {
      mockGenerateImageWithPersistence.mockResolvedValueOnce({
        imageUrl: 'https://sf-cdn.example.com/temp/img.png',
        markdown: '![test](https://sf-cdn.example.com/temp/img.png)',
        seed: 999,
        inferenceTime: 2.0,
        warning: '图片链接 1 小时后失效，请及时保存'
      })

      const event = createEvent({ prompt: 'test' })
      const result = await generateImageHandler(event)

      expect(result.warning).toBe('图片链接 1 小时后失效，请及时保存')
      expect(result.imageUrl).toBe('https://sf-cdn.example.com/temp/img.png')
    })

    it('应仅传已定义字段给 generateImageWithPersistence', async () => {
      mockGenerateImageWithPersistence.mockResolvedValueOnce({
        imageUrl: 'url',
        markdown: '![test](url)',
        seed: 0,
        inferenceTime: 0
      })

      const event = createEvent({ prompt: 'test' })
      await generateImageHandler(event)

      expect(mockGenerateImageWithPersistence).toHaveBeenCalledWith({
        prompt: 'test'
      })
    })

    it('全部参数时应正确传递', async () => {
      mockGenerateImageWithPersistence.mockResolvedValueOnce({
        imageUrl: 'url',
        markdown: '![test](url)',
        seed: 42,
        inferenceTime: 1
      })

      const event = createEvent({
        prompt: 'test',
        seed: 42,
        imageSize: '768x1024'
      })
      await generateImageHandler(event)

      expect(mockGenerateImageWithPersistence).toHaveBeenCalledWith({
        prompt: 'test',
        seed: 42,
        imageSize: '768x1024'
      })
    })
  })

  describe('服务端错误', () => {
    it('generateImageWithPersistence 返回 error 应抛 500', async () => {
      mockGenerateImageWithPersistence.mockResolvedValueOnce({
        error: '图片生成服务不可用',
        detail: 'API 请求失败 (500): Internal Server Error',
        query: { prompt: 'test', seed: undefined, imageSize: undefined }
      })

      const event = createEvent({ prompt: 'test' })
      await expect(generateImageHandler(event)).rejects.toMatchObject({
        statusCode: 500,
        statusMessage: '图片生成服务不可用'
      })
    })

    it('500 错误应记录日志（含 detail 供排查）', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockGenerateImageWithPersistence.mockResolvedValueOnce({
        error: '图片生成服务不可用',
        detail: 'API 请求超时（60秒）',
        query: { prompt: 'test' }
      })

      const event = createEvent({ prompt: 'test' })
      try {
        await generateImageHandler(event)
      } catch {
        // 预期抛错
      }

      expect(errorSpy).toHaveBeenCalledWith(
        '[generate-image API] 生成失败:',
        expect.objectContaining({
          error: '图片生成服务不可用',
          detail: 'API 请求超时（60秒）'
        })
      )
    })

    it('参数校验失败的 error message 不应包含 detail', async () => {
      // 校验失败时不应调用 generateImageWithPersistence，也不会暴露 detail
      const event = createEvent({ prompt: '' })
      try {
        await generateImageHandler(event)
        expect.fail('应抛出错误')
      } catch (err: any) {
        expect(err.statusCode).toBe(400)
        // statusMessage 应是校验错误信息，不含服务端 detail
        expect(err.statusMessage).not.toContain('API 请求')
      }
    })
  })
})
