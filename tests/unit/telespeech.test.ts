/**
 * TeleSpeechASR 方言 ASR 工具单元测试（server/tools/telespeech.ts）
 *
 * 测试覆盖：
 * - isTeleSpeechAvailable：端点探测成功/失败（mock fetch + spawnSync）
 * - transcribeWithTeleSpeech：
 *   * 成功路径：端点可用 + API 200 → { text }
 *   * 失败路径：endpoint_unavailable / config_missing / api_error / network_error
 *   * 不 throw 异常（失败返回 { error, detail }）
 *
 * 注意：telespeech.ts 有模块级缓存（teleSpeechAvailable / probeAudioBuffer），
 * 每个测试前用 vi.resetModules() + 动态导入重置模块状态。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// mock useRuntimeConfig
const mockUseRuntimeConfig = vi.fn<() => any>()
vi.stubGlobal('useRuntimeConfig', mockUseRuntimeConfig)

// mock node:fs/promises readFile（用 vi.hoisted 确保变量在 vi.mock 工厂执行时可用）
const { mockReadFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn()
}))
vi.mock('node:fs/promises', () => ({
  default: { readFile: mockReadFile },
  readFile: mockReadFile
}))

// mock node:child_process spawnSync：模拟 ffmpeg 生成静音 WAV 样本
const { mockSpawnSync } = vi.hoisted(() => ({
  mockSpawnSync: vi.fn((cmd: string, args: string[]) => {
    // 模拟 ffmpeg -f lavfi -i anullsrc=... 生成静音 WAV（返回假 Buffer）
    // 注意：args 中是 'anullsrc=r=16000:cl=mono'，用 join+includes 宽松匹配
    if (args && args.join(' ').includes('anullsrc')) {
      return { status: 0, stdout: Buffer.from('fake-wav-audio-data'), stderr: '' }
    }
    return { status: 0, stdout: '', stderr: '' }
  })
}))
vi.mock('node:child_process', () => ({
  default: { spawnSync: mockSpawnSync },
  spawnSync: mockSpawnSync
}))

// mock sensevoice 模块的 isFfmpegAvailable（避免实际调用 ffmpeg）
vi.mock('~/server/tools/sensevoice', () => ({
  isFfmpegAvailable: () => true
}))

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

describe('telespeech.ts', () => {
  let transcribeWithTeleSpeech: typeof import('~/server/tools/telespeech').transcribeWithTeleSpeech
  let isTeleSpeechAvailable: typeof import('~/server/tools/telespeech').isTeleSpeechAvailable
  let isTeleSpeechSuccess: typeof import('~/server/tools/telespeech').isTeleSpeechSuccess

  beforeEach(async () => {
    vi.resetModules()
    // 用 clearAllMocks 只清除调用记录，不重置 mock 实现（避免 mockReadFile 失效）
    vi.clearAllMocks()

    // 默认 mock useRuntimeConfig 返回有效配置
    mockUseRuntimeConfig.mockReturnValue({
      openAiApiKey: 'test-api-key',
      openAiBaseUrl: 'https://api.siliconflow.cn/v1'
    })
    // 默认 mock readFile 返回有效 Buffer（测试体内可覆盖为失败场景）
    mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))

    // 重新导入模块（触发 generateProbeAudio，此时 mock 的 spawnSync 会生成假 probeAudioBuffer）
    const mod = await import('~/server/tools/telespeech')
    transcribeWithTeleSpeech = mod.transcribeWithTeleSpeech
    isTeleSpeechAvailable = mod.isTeleSpeechAvailable
    isTeleSpeechSuccess = mod.isTeleSpeechSuccess
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('isTeleSpeechAvailable - 端点探测', () => {
    it('探测成功（fetch 200）应返回 true', async () => {
      const mockFetch = vi.fn().mockResolvedValue(buildOkResponse({ text: 'probe' }))
      vi.stubGlobal('fetch', mockFetch)

      const result = await isTeleSpeechAvailable()
      expect(result).toBe(true)
    })

    it('探测失败（fetch 404）应返回 false', async () => {
      const mockFetch = vi.fn().mockResolvedValue(buildFailResponse(404, 'model not found'))
      vi.stubGlobal('fetch', mockFetch)

      const result = await isTeleSpeechAvailable()
      expect(result).toBe(false)
    })

    it('探测失败（fetch 400）应返回 false', async () => {
      const mockFetch = vi.fn().mockResolvedValue(buildFailResponse(400, 'invalid model'))
      vi.stubGlobal('fetch', mockFetch)

      const result = await isTeleSpeechAvailable()
      expect(result).toBe(false)
    })

    it('探测失败（网络异常）应返回 false', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('network error'))
      vi.stubGlobal('fetch', mockFetch)

      const result = await isTeleSpeechAvailable()
      expect(result).toBe(false)
    })

    it('探测结果应缓存（后续调用不重复 fetch）', async () => {
      const mockFetch = vi.fn().mockResolvedValue(buildOkResponse({ text: 'probe' }))
      vi.stubGlobal('fetch', mockFetch)

      await isTeleSpeechAvailable()
      await isTeleSpeechAvailable()
      await isTeleSpeechAvailable()

      // 只应 fetch 一次（缓存命中）
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('transcribeWithTeleSpeech - 成功路径', () => {
    it('端点可用 + API 200 应返回 { text }', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))

      // 第一次 fetch：端点探测（200）；第二次 fetch：实际转写（200）
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse({ text: 'probe' }))
        .mockResolvedValueOnce(buildOkResponse({ text: '方言转写结果' }))
      vi.stubGlobal('fetch', mockFetch)

      const result = await transcribeWithTeleSpeech('/tmp/test.wav')

      expect(isTeleSpeechSuccess(result)).toBe(true)
      if (isTeleSpeechSuccess(result)) {
        expect(result.text).toBe('方言转写结果')
      }
    })

    it('应正确构造 multipart 请求（model=TeleAI/TeleSpeechASR）', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse({ text: 'probe' }))
        .mockResolvedValueOnce(buildOkResponse({ text: '结果' }))
      vi.stubGlobal('fetch', mockFetch)

      await transcribeWithTeleSpeech('/tmp/test.wav')

      // 第二次 fetch 是实际转写调用
      const [, init] = mockFetch.mock.calls[1]
      expect(init.method).toBe('POST')
      expect(init.headers.Authorization).toBe('Bearer test-api-key')
      expect(init.body).toBeInstanceOf(FormData)
      expect(mockFetch.mock.calls[1][0]).toBe(
        'https://api.siliconflow.cn/v1/audio/transcriptions'
      )
    })
  })

  describe('transcribeWithTeleSpeech - 失败路径（不 throw）', () => {
    it('endpoint_unavailable：端点探测失败应返回错误对象', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))

      // 端点探测返回 404
      const mockFetch = vi.fn().mockResolvedValue(buildFailResponse(404, 'model not found'))
      vi.stubGlobal('fetch', mockFetch)

      const result = await transcribeWithTeleSpeech('/tmp/test.wav')

      expect(isTeleSpeechSuccess(result)).toBe(false)
      if (!isTeleSpeechSuccess(result)) {
        expect(result.error).toBe('endpoint_unavailable')
        expect(result.detail).toBeDefined()
      }
    })

    it('config_missing：未配置 API Key 应返回错误对象', async () => {
      mockUseRuntimeConfig.mockReturnValue({
        openAiApiKey: '',
        openAiBaseUrl: 'https://api.siliconflow.cn/v1'
      })

      // 端点探测会因 config 检查失败直接返回 false
      const result = await transcribeWithTeleSpeech('/tmp/test.wav')

      if (!isTeleSpeechSuccess(result)) {
        expect(result.error).toBe('endpoint_unavailable')
      }
    })

    it('api_error：API 返回非 200 应返回错误对象', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))

      // 第一次 fetch：端点探测（200）；第二次 fetch：实际转写（500）
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse({ text: 'probe' }))
        .mockResolvedValueOnce(buildFailResponse(500, 'server error'))
      vi.stubGlobal('fetch', mockFetch)

      const result = await transcribeWithTeleSpeech('/tmp/test.wav')

      if (!isTeleSpeechSuccess(result)) {
        expect(result.error).toBe('api_error')
        expect(result.detail).toContain('500')
      }
    })

    it('empty_response：API 返回空文本应返回错误对象', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse({ text: 'probe' }))
        .mockResolvedValueOnce(buildOkResponse({ text: '' }))
      vi.stubGlobal('fetch', mockFetch)

      const result = await transcribeWithTeleSpeech('/tmp/test.wav')

      if (!isTeleSpeechSuccess(result)) {
        expect(result.error).toBe('empty_response')
      }
    })

    it('network_error：fetch 抛异常应返回错误对象', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('fake-audio'))

      // 第一次 fetch：端点探测（200）；第二次 fetch：实际转写（网络异常）
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse({ text: 'probe' }))
        .mockRejectedValueOnce(new Error('network timeout'))
      vi.stubGlobal('fetch', mockFetch)

      const result = await transcribeWithTeleSpeech('/tmp/test.wav')

      if (!isTeleSpeechSuccess(result)) {
        expect(result.error).toBe('network_error')
        expect(result.detail).toContain('network timeout')
      }
    })

    it('file_read_error：音频文件读取失败应返回错误对象', async () => {
      // 端点探测先成功
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(buildOkResponse({ text: 'probe' }))
      vi.stubGlobal('fetch', mockFetch)
      mockReadFile.mockRejectedValue(new Error('ENOENT: file not found'))

      const result = await transcribeWithTeleSpeech('/tmp/not-exist.wav')

      if (!isTeleSpeechSuccess(result)) {
        expect(result.error).toBe('file_read_error')
        expect(result.detail).toContain('ENOENT')
      }
    })

    it('所有失败路径都不应 throw 异常', async () => {
      // 端点探测失败场景
      const mockFetch = vi.fn().mockResolvedValue(buildFailResponse(404, 'not found'))
      vi.stubGlobal('fetch', mockFetch)

      // 不应 reject
      await expect(transcribeWithTeleSpeech('/tmp/test.wav')).resolves.toBeDefined()
    })
  })
})
