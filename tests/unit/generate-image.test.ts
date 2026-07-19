/**
 * generate-image 工具单元测试（server/tools/generate-image.ts）
 *
 * 测试覆盖：
 * - description 完整性（何时调用 / 何时不调用 / prompt 撰写建议）
 * - inputSchema 验证（prompt 必填、seed/imageSize 可选）
 * - execute 流程：
 *   * 成功路径：透传 imageUrl/markdown/seed/inferenceTime
 *   * 成功 + warning：透传 warning 字段
 *   * 失败路径：透传 error/detail/query，不抛异常
 * - 参数透传：prompt/seed/imageSize 正确传递给 generateImageWithPersistence
 * - 边界：仅传 prompt、传全部参数
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
const { generateImageTool } = await import('~/server/tools/generate-image')

/** 调用 execute 并返回结果 */
async function execute(args: {
  prompt: string
  seed?: number
  imageSize?: string
}): Promise<any> {
  return await generateImageTool.execute!(args as any, {
    messages: [],
    toolCallId: 'test'
  })
}

describe('generate-image.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('description 完整性', () => {
    const desc = generateImageTool.description as string

    it('应包含何时调用的触发词', () => {
      expect(desc).toContain('画')
      expect(desc).toContain('生成图片')
      expect(desc).toContain('绘制')
    })

    it('应包含何时不调用的场景说明', () => {
      expect(desc).toContain('不要在以下场景')
      expect(desc).toContain('OCR')
    })

    it('应包含 prompt 撰写建议', () => {
      expect(desc).toContain('英文 prompt')
      expect(desc).toContain('主体')
      expect(desc).toContain('风格')
    })

    it('应包含 markdown 图片语法说明', () => {
      expect(desc).toContain('![描述](imageUrl)')
    })

    it('应包含示例 prompt', () => {
      expect(desc).toContain('A white cat under the moonlight')
    })
  })

  describe('inputSchema 验证', () => {
    const schema = generateImageTool.inputSchema as any

    it('prompt 字段应为必填 string', () => {
      const promptField = schema.shape.prompt
      expect(promptField).toBeDefined()
      // min(1) + max(2000)
      expect(promptField.safeParse('').success).toBe(false)
      expect(promptField.safeParse('a').success).toBe(true)
    })

    it('prompt 长度上限应为 2000 字符', () => {
      const promptField = schema.shape.prompt
      const longPrompt = 'a'.repeat(2001)
      expect(promptField.safeParse(longPrompt).success).toBe(false)
      const validPrompt = 'a'.repeat(2000)
      expect(promptField.safeParse(validPrompt).success).toBe(true)
    })

    it('seed 应为可选 number 类型', () => {
      const seedField = schema.shape.seed
      expect(seedField.safeParse(undefined).success).toBe(true)
      expect(seedField.safeParse(0).success).toBe(true)
      expect(seedField.safeParse(9999999999).success).toBe(true)
      expect(seedField.safeParse(-1).success).toBe(false)
      expect(seedField.safeParse(10000000000).success).toBe(false)
    })

    it('imageSize 应为可选枚举', () => {
      const imageSizeField = schema.shape.imageSize
      expect(imageSizeField.safeParse(undefined).success).toBe(true)
      expect(imageSizeField.safeParse('1024x1024').success).toBe(true)
      expect(imageSizeField.safeParse('960x1280').success).toBe(true)
      expect(imageSizeField.safeParse('768x1024').success).toBe(true)
      expect(imageSizeField.safeParse('720x1440').success).toBe(true)
      expect(imageSizeField.safeParse('720x1280').success).toBe(true)
      expect(imageSizeField.safeParse('invalid').success).toBe(false)
    })
  })

  describe('execute 成功路径', () => {
    it('应透传 imageUrl/markdown/seed/inferenceTime', async () => {
      mockGenerateImageWithPersistence.mockResolvedValueOnce({
        imageUrl: 'https://i.ibb.co/test/image.png',
        markdown: '![a cat](https://i.ibb.co/test/image.png)',
        seed: 12345,
        inferenceTime: 1.5
      })

      const result = await execute({ prompt: 'a cat' })

      expect(result).toEqual({
        imageUrl: 'https://i.ibb.co/test/image.png',
        markdown: '![a cat](https://i.ibb.co/test/image.png)',
        seed: 12345,
        inferenceTime: 1.5
      })
      // 不应有 error / warning 字段
      expect(result.error).toBeUndefined()
      expect(result.warning).toBeUndefined()
    })

    it('成功 + warning 时应透传 warning 字段', async () => {
      mockGenerateImageWithPersistence.mockResolvedValueOnce({
        imageUrl: 'https://sf-cdn.example.com/temp/img.png',
        markdown: '![test](https://sf-cdn.example.com/temp/img.png)',
        seed: 999,
        inferenceTime: 2.0,
        warning: '图片链接 1 小时后失效，请及时保存'
      })

      const result = await execute({ prompt: 'test' })

      expect(result.imageUrl).toBe('https://sf-cdn.example.com/temp/img.png')
      expect(result.warning).toBe('图片链接 1 小时后失效，请及时保存')
    })
  })

  describe('execute 失败路径', () => {
    it('应透传 error/detail/query，不抛异常', async () => {
      mockGenerateImageWithPersistence.mockResolvedValueOnce({
        error: '图片生成服务不可用',
        detail: 'API 请求失败 (500)',
        query: {
          prompt: 'test',
          seed: undefined,
          imageSize: undefined
        }
      })

      const result = await execute({ prompt: 'test' })

      expect(result).toEqual({
        error: '图片生成服务不可用',
        detail: 'API 请求失败 (500)',
        query: {
          prompt: 'test',
          seed: undefined,
          imageSize: undefined
        }
      })
      // 不应有成功分支字段
      expect(result.imageUrl).toBeUndefined()
    })

    it('参数校验失败时 query 应记录入参', async () => {
      mockGenerateImageWithPersistence.mockResolvedValueOnce({
        error: '图片生成参数无效',
        detail: 'seed 越界',
        query: {
          prompt: 'test',
          seed: -1,
          imageSize: '1024x1024'
        }
      })

      const result = await execute({ prompt: 'test', seed: -1, imageSize: '1024x1024' })

      expect(result.error).toBe('图片生成参数无效')
      expect(result.query).toEqual({
        prompt: 'test',
        seed: -1,
        imageSize: '1024x1024'
      })
    })
  })

  describe('参数透传', () => {
    it('仅传 prompt 时 generateImageWithPersistence 应收到 { prompt }', async () => {
      mockGenerateImageWithPersistence.mockResolvedValueOnce({
        imageUrl: 'url',
        markdown: '![test](url)',
        seed: 0,
        inferenceTime: 0
      })

      await execute({ prompt: 'test' })

      expect(mockGenerateImageWithPersistence).toHaveBeenCalledWith({
        prompt: 'test'
      })
    })

    it('传 prompt + seed 时应正确透传', async () => {
      mockGenerateImageWithPersistence.mockResolvedValueOnce({
        imageUrl: 'url',
        markdown: '![test](url)',
        seed: 42,
        inferenceTime: 1
      })

      await execute({ prompt: 'test', seed: 42 })

      expect(mockGenerateImageWithPersistence).toHaveBeenCalledWith({
        prompt: 'test',
        seed: 42
      })
    })

    it('传 prompt + seed + imageSize 时应正确透传', async () => {
      mockGenerateImageWithPersistence.mockResolvedValueOnce({
        imageUrl: 'url',
        markdown: '![test](url)',
        seed: 42,
        inferenceTime: 1
      })

      await execute({ prompt: 'test', seed: 42, imageSize: '960x1280' })

      expect(mockGenerateImageWithPersistence).toHaveBeenCalledWith({
        prompt: 'test',
        seed: 42,
        imageSize: '960x1280'
      })
    })
  })
})
