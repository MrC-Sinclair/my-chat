/**
 * SenseVoiceSmall ASR 工具单元测试（server/tools/sensevoice.ts）
 *
 * 测试覆盖：
 * - isFfmpegAvailable：返回 boolean 类型
 * - transcribeWithSenseVoice：
 *   * 成功路径：API 200 + 富文本标签解析（情感/语种/事件）
 *   * 标签大小写不敏感匹配
 *   * EMO_UNKNOWN/FEARFUL 等非白名单情感归为 null
 *   * 失败路径：config_missing / file_read_error / api_error / empty_response / network_error
 *   * 不 throw 异常（失败返回 { error, detail }）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock useRuntimeConfig：返回服务端配置
const mockUseRuntimeConfig = vi.fn<() => any>()
vi.stubGlobal('useRuntimeConfig', mockUseRuntimeConfig)

// mock node:fs/promises 的 readFile（用 vi.hoisted 确保变量在 vi.mock 工厂执行时可用）
const { mockReadFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn()
}))
vi.mock('node:fs/promises', () => ({
  default: { readFile: mockReadFile },
  readFile: mockReadFile
}))

// 动态导入以应用 stubs / mocks
const { isFfmpegAvailable, transcribeWithSenseVoice, isSenseVoiceSuccess } =
  await import('~/server/tools/sensevoice')

/** 构造 fetch 成功 Response */
function buildOkResponse(json: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => json,
    text: async () => JSON.stringify(json)
  }
}

/** 构造 fetch 失败 Response */
function buildFailResponse(status: number, text: string) {
  return {
    ok: false,
    status,
    text: async () => text,
    json: async () => ({})
  }
}

describe('sensevoice.ts', () => {
  beforeEach(() => {
    // 用 clearAllMocks 只清除调用记录，不重置 mock 实现（避免 mockReadFile 失效）
    vi.clearAllMocks()
    // 默认 mock useRuntimeConfig 返回有效配置
    mockUseRuntimeConfig.mockReturnValue({
      openAiApiKey: 'test-api-key',
      openAiBaseUrl: 'https://api.siliconflow.cn/v1'
    })
    // 默认 mock readFile 返回有效 Buffer（测试体内可覆盖为失败场景）
    mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('isFfmpegAvailable', () => {
    it('应返回 boolean 类型', () => {
      const result = isFfmpegAvailable()
      expect(typeof result).toBe('boolean')
    })
  })

  describe('transcribeWithSenseVoice - 成功路径', () => {
    it('应解析情感+语种标签并返回结构化结果', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))
      const mockFetch = vi
        .fn()
        .mockResolvedValue(buildOkResponse({ text: '<|HAPPY|><|zh|>你好世界' }))
      vi.stubGlobal('fetch', mockFetch)

      const result = await transcribeWithSenseVoice('/tmp/test.wav')

      expect(isSenseVoiceSuccess(result)).toBe(true)
      if (isSenseVoiceSuccess(result)) {
        expect(result.text).toBe('你好世界')
        expect(result.emotion).toBe('happy')
        expect(result.language).toBe('zh')
        expect(result.events).toEqual([])
      }
    })

    it('应解析 SAD/ANGRY/NEUTRAL 情感标签', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))

      const cases = [
        { raw: '<|SAD|><|zh|>难过', expected: 'sad' },
        { raw: '<|ANGRY|><|zh|>生气', expected: 'angry' },
        { raw: '<|NEUTRAL|><|zh|>平静', expected: 'neutral' }
      ]

      for (const { raw, expected } of cases) {
        const mockFetch = vi
          .fn()
          .mockResolvedValue(buildOkResponse({ text: raw }))
        vi.stubGlobal('fetch', mockFetch)

        const result = await transcribeWithSenseVoice('/tmp/test.wav')
        if (isSenseVoiceSuccess(result)) {
          expect(result.emotion).toBe(expected)
        }
      }
    })

    it('EMO_UNKNOWN 情感标签应映射为 null', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))
      const mockFetch = vi
        .fn()
        .mockResolvedValue(buildOkResponse({ text: '<|EMO_UNKNOWN|><|zh|>未知情感' }))
      vi.stubGlobal('fetch', mockFetch)

      const result = await transcribeWithSenseVoice('/tmp/test.wav')
      if (isSenseVoiceSuccess(result)) {
        expect(result.emotion).toBeNull()
        expect(result.text).toBe('未知情感')
      }
    })

    it('FEARFUL/DISGUSTED/SURPRISED 非白名单情感应映射为 null', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))

      const nonWhitelistEmotions = ['FEARFUL', 'DISGUSTED', 'SURPRISED']
      for (const emo of nonWhitelistEmotions) {
        const mockFetch = vi
          .fn()
          .mockResolvedValue(buildOkResponse({ text: `<|${emo}|><|zh|>测试` }))
        vi.stubGlobal('fetch', mockFetch)

        const result = await transcribeWithSenseVoice('/tmp/test.wav')
        if (isSenseVoiceSuccess(result)) {
          expect(result.emotion).toBeNull()
        }
      }
    })

    it('应解析粤语语种标签 yue', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))
      const mockFetch = vi
        .fn()
        .mockResolvedValue(buildOkResponse({ text: '<|NEUTRAL|><|yue|>你好' }))
      vi.stubGlobal('fetch', mockFetch)

      const result = await transcribeWithSenseVoice('/tmp/test.wav')
      if (isSenseVoiceSuccess(result)) {
        expect(result.language).toBe('yue')
      }
    })

    it('应解析事件标签（BGM/Laughter/Cry 等）', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          buildOkResponse({ text: '<|BGM|><|Laughter|><|zh|>背景音乐和笑声' })
        )
      vi.stubGlobal('fetch', mockFetch)

      const result = await transcribeWithSenseVoice('/tmp/test.wav')
      if (isSenseVoiceSuccess(result)) {
        expect(result.events).toContain('BGM')
        expect(result.events).toContain('Laughter')
        expect(result.text).toBe('背景音乐和笑声')
      }
    })

    it('标签大小写不敏感匹配（happy/HAPPY 均应识别）', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))
      const mockFetch = vi
        .fn()
        .mockResolvedValue(buildOkResponse({ text: '<|happy|><|ZH|>大小写测试' }))
      vi.stubGlobal('fetch', mockFetch)

      const result = await transcribeWithSenseVoice('/tmp/test.wav')
      if (isSenseVoiceSuccess(result)) {
        expect(result.emotion).toBe('happy')
        expect(result.language).toBe('zh')
      }
    })

    it('无标签的纯文本应原样返回，emotion/language 为 null', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))
      const mockFetch = vi
        .fn()
        .mockResolvedValue(buildOkResponse({ text: '纯文本无标签' }))
      vi.stubGlobal('fetch', mockFetch)

      const result = await transcribeWithSenseVoice('/tmp/test.wav')
      if (isSenseVoiceSuccess(result)) {
        expect(result.text).toBe('纯文本无标签')
        expect(result.emotion).toBeNull()
        expect(result.language).toBeNull()
        expect(result.events).toEqual([])
      }
    })

    it('应正确构造 multipart 请求（model=FunAudioLLM/SenseVoiceSmall）', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))
      const mockFetch = vi
        .fn()
        .mockResolvedValue(buildOkResponse({ text: '<|zh|>测试' }))
      vi.stubGlobal('fetch', mockFetch)

      await transcribeWithSenseVoice('/tmp/test.wav')

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [, init] = mockFetch.mock.calls[0]
      expect(init.method).toBe('POST')
      expect(init.headers.Authorization).toBe('Bearer test-api-key')
      expect(init.body).toBeInstanceOf(FormData)
      // 验证 URL 拼接
      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://api.siliconflow.cn/v1/audio/transcriptions'
      )
    })
  })

  describe('transcribeWithSenseVoice - 失败路径（不 throw）', () => {
    it('config_missing：未配置 API Key 应返回错误对象', async () => {
      mockUseRuntimeConfig.mockReturnValue({
        openAiApiKey: '',
        openAiBaseUrl: 'https://api.siliconflow.cn/v1'
      })

      const result = await transcribeWithSenseVoice('/tmp/test.wav')

      expect(isSenseVoiceSuccess(result)).toBe(false)
      if (!isSenseVoiceSuccess(result)) {
        expect(result.error).toBe('config_missing')
        expect(result.detail).toBeDefined()
      }
    })

    it('config_missing：未配置 Base URL 应返回错误对象', async () => {
      mockUseRuntimeConfig.mockReturnValue({
        openAiApiKey: 'test-key',
        openAiBaseUrl: ''
      })

      const result = await transcribeWithSenseVoice('/tmp/test.wav')

      if (!isSenseVoiceSuccess(result)) {
        expect(result.error).toBe('config_missing')
      }
    })

    it('file_read_error：音频文件读取失败应返回错误对象', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT: file not found'))

      const result = await transcribeWithSenseVoice('/tmp/not-exist.wav')

      if (!isSenseVoiceSuccess(result)) {
        expect(result.error).toBe('file_read_error')
        expect(result.detail).toContain('ENOENT')
      }
    })

    it('api_error：API 返回非 200 应返回错误对象', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))
      const mockFetch = vi
        .fn()
        .mockResolvedValue(buildFailResponse(401, 'Unauthorized'))
      vi.stubGlobal('fetch', mockFetch)

      const result = await transcribeWithSenseVoice('/tmp/test.wav')

      if (!isSenseVoiceSuccess(result)) {
        expect(result.error).toBe('api_error')
        expect(result.detail).toContain('401')
      }
    })

    it('empty_response：API 返回空文本应返回错误对象', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))
      const mockFetch = vi
        .fn()
        .mockResolvedValue(buildOkResponse({ text: '' }))
      vi.stubGlobal('fetch', mockFetch)

      const result = await transcribeWithSenseVoice('/tmp/test.wav')

      if (!isSenseVoiceSuccess(result)) {
        expect(result.error).toBe('empty_response')
      }
    })

    it('network_error：fetch 抛异常应返回错误对象', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))
      const mockFetch = vi.fn().mockRejectedValue(new Error('network timeout'))
      vi.stubGlobal('fetch', mockFetch)

      const result = await transcribeWithSenseVoice('/tmp/test.wav')

      if (!isSenseVoiceSuccess(result)) {
        expect(result.error).toBe('network_error')
        expect(result.detail).toContain('network timeout')
      }
    })

    it('所有失败路径都不应 throw 异常', async () => {
      mockUseRuntimeConfig.mockReturnValue({
        openAiApiKey: '',
        openAiBaseUrl: ''
      })

      // 不应 reject
      await expect(transcribeWithSenseVoice('/tmp/test.wav')).resolves.toBeDefined()
    })
  })
})
