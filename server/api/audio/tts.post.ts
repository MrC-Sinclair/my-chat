/**
 * @file TTS 语音合成 API — POST /api/audio/tts
 *
 * Workflow 路径入口：前端「朗读」按钮点击后，把指定文本合成为语音音频直接返回播放
 *
 * 为什么走 Workflow 而非 Agent tool：朗读是用户显式触发的确定性操作（点击按钮才合成），
 * 不涉及 LLM 自主决策工具组合，符合 AGENTS.md「Agent 架构设计规范」中 Workflow 的适用场景
 *
 * 流程：
 *   1. JSON body 接收 { text }，校验非空且 ≤ MAX_TTS_CHARS（防滥用，控制合成耗时与流量）
 *   2. 调用硅基流动 CosyVoice2-0.5B（复用 OPENAI_API_KEY），response_format=mp3
 *   3. 成功 → 200 + audio/mpeg 二进制流（前端 Blob + URL.createObjectURL 播放，不落库不落盘）
 *   4. 失败 → 4xx/5xx + createError（不暴露内部 detail）
 *
 * 安全设计：
 *   - 文本长度硬上限，防止恶意超长文本拖垮上游或产生高额费用
 *   - 音色固定为服务端常量，不接受客户端指定（避免注入任意模型/音色值）
 *   - AbortController 30 秒超时，防止上游挂起占用连接
 *
 * 注：createError / readBody / setHeader / defineEventHandler 由 Nuxt 服务端自动导入
 * （h3 非 package.json 直接依赖，显式 import 会在 vitest 下解析失败）
 */

// ============================================================================
// 常量与配置
// ============================================================================

/** 硅基流动 TTS 端点（与 OCR 共用 OPENAI_BASE_URL） */
const TTS_API_ENDPOINT =
  (process.env.OPENAI_BASE_URL || 'https://api.siliconflow.cn/v1') + '/audio/speech'

/** TTS 模型：CosyVoice2-0.5B（中文自然度好，支持中英混与方言口音） */
const TTS_MODEL = 'FunAudioLLM/CosyVoice2-0.5B'

/** 固定音色：anna（女声），服务端常量不接受客户端指定 */
const TTS_VOICE = 'FunAudioLLM/CosyVoice2-0.5B:anna'

/** 单次合成文本长度上限：1000 字（CosyVoice2 单次合成约 5 分钟音频上限内，兼顾耗时与流量） */
const MAX_TTS_CHARS = 1000

/** 上游合成超时：30 秒（短文本合成通常 1-5 秒） */
const TTS_TIMEOUT_MS = 30_000

// ============================================================================
// 路由处理
// ============================================================================

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.trim() : ''

  if (!text) {
    throw createError({ statusCode: 400, statusMessage: '缺少合成文本' })
  }
  if (text.length > MAX_TTS_CHARS) {
    throw createError({
      statusCode: 400,
      statusMessage: `合成文本过长（${text.length} 字），最多 ${MAX_TTS_CHARS} 字`
    })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw createError({ statusCode: 500, statusMessage: '服务端未配置 API Key，无法合成语音' })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS)

  try {
    const response = await fetch(TTS_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        input: text,
        voice: TTS_VOICE,
        response_format: 'mp3',
        sample_rate: 44100
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      console.error(`[audio/tts] 上游合成失败 (${response.status}): ${errorText.slice(0, 300)}`)
      throw createError({ statusCode: 500, statusMessage: '语音合成失败，请重试' })
    }

    const audio = Buffer.from(await response.arrayBuffer())
    if (audio.length === 0) {
      throw createError({ statusCode: 500, statusMessage: '语音合成失败，请重试' })
    }

    setHeader(event, 'Content-Type', 'audio/mpeg')
    // h3 对 Content-Length 的类型重载要求 number
    setHeader(event, 'Content-Length', audio.length)
    return audio
  } catch (err) {
    // createError 抛出的 H3Error 直接透传（保留 400/500 语义），其余按超时/未知错误归类
    if (err && typeof err === 'object' && 'statusCode' in err) {
      throw err
    }
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw createError({ statusCode: 504, statusMessage: '语音合成超时，请重试' })
    }
    console.error('[audio/tts] 合成异常:', err)
    throw createError({ statusCode: 500, statusMessage: '语音合成失败，请重试' })
  } finally {
    clearTimeout(timer)
  }
})
