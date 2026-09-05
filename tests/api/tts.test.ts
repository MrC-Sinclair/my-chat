/**
 * TTS 语音合成 API 测试（/api/audio/tts）
 *
 * 测试覆盖：
 * - 参数校验：body 缺失、text 空/超长
 * - 未配置 OPENAI_API_KEY → 500
 * - 成功：返回音频 Buffer + Content-Type audio/mpeg + 上游请求体结构
 * - 上游失败（非 200）→ 500，不暴露内部 detail
 * - 上游返回空音频 → 500
 * - 上游超时（AbortError）→ 504
 * - 网络异常 → 500
 *
 * Mock 策略：路由直接调用全局 fetch，替换 globalThis.fetch 提供可控上游响应
 * （参考 tests/unit/ocr-document.test.ts 模式）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 动态导入被测路由（模块加载时读取 process.env 的常量，mock env 需在导入前设置）
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-api-key-for-vitest'
const ttsHandler = (await import('~/server/api/audio/tts.post')).default

/** 构造模拟的 H3Event（含 body 与 res.setHeader 捕获） */
function createEvent(body: unknown): any {
  return {
    node: { req: { method: 'POST' }, res: { setHeader: vi.fn() } },
    context: {},
    _method: 'POST',
    _body: body
  }
}

describe('TTS API /api/audio/tts', () => {
  const realFetch = globalThis.fetch
  const prevApiKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
    if (prevApiKey) {
      process.env.OPENAI_API_KEY = prevApiKey
    } else {
      delete process.env.OPENAI_API_KEY
    }
  })

  describe('参数校验', () => {
    it('body 缺失应抛 400', async () => {
      await expect(ttsHandler(createEvent(null))).rejects.toMatchObject({ statusCode: 400 })
    })

    it('text 为空字符串应抛 400', async () => {
      await expect(ttsHandler(createEvent({ text: '   ' }))).rejects.toMatchObject({
        statusCode: 400
      })
    })

    it('text 非字符串应抛 400', async () => {
      await expect(ttsHandler(createEvent({ text: 123 }))).rejects.toMatchObject({
        statusCode: 400
      })
    })

    it('text 超过 1000 字应抛 400', async () => {
      await expect(ttsHandler(createEvent({ text: 'a'.repeat(1001) }))).rejects.toMatchObject({
        statusCode: 400
      })
    })
  })

  it('未配置 OPENAI_API_KEY 应抛 500', async () => {
    delete process.env.OPENAI_API_KEY
    await expect(ttsHandler(createEvent({ text: '你好' }))).rejects.toMatchObject({
      statusCode: 500
    })
  })

  describe('成功路径', () => {
    it('应返回音频 Buffer 并设置 Content-Type audio/mpeg', async () => {
      const fakeAudio = Buffer.from('fake-mp3-data')
      let capturedUrl = ''
      let capturedInit: any = null
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
        capturedUrl = url
        capturedInit = init
        return {
          ok: true,
          status: 200,
          // Buffer 可能指向共享内存池（byteOffset 非零），必须按偏移切片
          arrayBuffer: () =>
            Promise.resolve(
              fakeAudio.buffer.slice(
                fakeAudio.byteOffset,
                fakeAudio.byteOffset + fakeAudio.byteLength
              )
            )
        }
      }) as any

      const event = createEvent({ text: '你好，世界' })
      const result = await ttsHandler(event)

      expect(Buffer.isBuffer(result)).toBe(true)
      expect((result as Buffer).toString()).toBe('fake-mp3-data')
      expect(event.node.res.setHeader).toHaveBeenCalledWith('Content-Type', 'audio/mpeg')
      // h3 的 Content-Length 重载要求 number 类型
      expect(event.node.res.setHeader).toHaveBeenCalledWith('Content-Length', fakeAudio.length)
      // 上游请求体结构：固定模型/音色，不接受客户端指定
      expect(capturedUrl).toContain('/audio/speech')
      const upstreamBody = JSON.parse(capturedInit.body)
      expect(upstreamBody.model).toBe('FunAudioLLM/CosyVoice2-0.5B')
      expect(upstreamBody.voice).toBe('FunAudioLLM/CosyVoice2-0.5B:anna')
      expect(upstreamBody.input).toBe('你好，世界')
      expect(upstreamBody.response_format).toBe('mp3')
    })
  })

  describe('失败路径（不抛原始异常，归类为结构化 createError）', () => {
    it('上游返回非 200 应抛 500 且不暴露内部 detail', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error with secret stack')
      }) as any

      const err = await ttsHandler(createEvent({ text: '你好' })).catch((e) => e)
      expect(err.statusCode).toBe(500)
      expect(err.statusMessage).toBe('语音合成失败，请重试')
      expect(JSON.stringify(err)).not.toContain('secret stack')
    })

    it('上游返回空音频应抛 500', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0))
      }) as any

      await expect(ttsHandler(createEvent({ text: '你好' }))).rejects.toMatchObject({
        statusCode: 500
      })
    })

    it('上游超时（AbortError）应抛 504', async () => {
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      globalThis.fetch = vi.fn().mockRejectedValue(abortError) as any

      await expect(ttsHandler(createEvent({ text: '你好' }))).rejects.toMatchObject({
        statusCode: 504
      })
    })

    it('网络异常应抛 500', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any

      await expect(ttsHandler(createEvent({ text: '你好' }))).rejects.toMatchObject({
        statusCode: 500
      })
    })
  })
})
