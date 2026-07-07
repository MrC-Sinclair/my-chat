/**
 * E2E 测试共享的 Mock Chat API 辅助函数
 *
 * 使用 page.evaluate 覆盖 window.fetch，创建真正的 ReadableStream
 * 逐事件延迟发送，模拟真实的 SSE 流式传输行为。
 * 这样 Chat 类的 status 会经历 submitted → streaming → ready 完整生命周期，
 * stop 按钮和打字机效果都能被正确测试。
 */
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

// ==================== SSE 流构建函数 ====================

/** 构建 UIMessage SSE 流的 data 行 */
export function sseChunk(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

/** 模拟流式文本响应 */
export function buildTextStream(text: string, chunkSize = 3): string {
  const chunks: string[] = []
  chunks.push(sseChunk({ type: 'start' }))
  chunks.push(sseChunk({ type: 'start-step' }))

  const textId = 'txt-1'
  chunks.push(sseChunk({ type: 'text-start', id: textId }))

  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(sseChunk({ type: 'text-delta', id: textId, delta: text.slice(i, i + chunkSize) }))
  }

  chunks.push(sseChunk({ type: 'text-end', id: textId }))
  chunks.push(sseChunk({ type: 'finish-step' }))
  chunks.push(sseChunk({ type: 'finish', finishReason: 'stop' }))
  chunks.push('data: [DONE]\n\n')
  return chunks.join('')
}

/** 模拟带推理过程的流式响应 */
export function buildReasoningStream(
  reasoningText: string,
  answerText: string,
  chunkSize = 3
): string {
  const chunks: string[] = []
  chunks.push(sseChunk({ type: 'start' }))
  chunks.push(sseChunk({ type: 'start-step' }))

  const reasoningId = 'rsn-1'
  chunks.push(sseChunk({ type: 'reasoning-start', id: reasoningId }))
  // 按 chunkSize 切片，模拟真实流式 reasoning 逐 chunk 到达
  for (let i = 0; i < reasoningText.length; i += chunkSize) {
    chunks.push(
      sseChunk({
        type: 'reasoning-delta',
        id: reasoningId,
        delta: reasoningText.slice(i, i + chunkSize)
      })
    )
  }
  chunks.push(sseChunk({ type: 'reasoning-end', id: reasoningId }))

  const textId = 'txt-1'
  chunks.push(sseChunk({ type: 'text-start', id: textId }))
  for (let i = 0; i < answerText.length; i += chunkSize) {
    chunks.push(
      sseChunk({ type: 'text-delta', id: textId, delta: answerText.slice(i, i + chunkSize) })
    )
  }
  chunks.push(sseChunk({ type: 'text-end', id: textId }))

  chunks.push(sseChunk({ type: 'finish-step' }))
  chunks.push(sseChunk({ type: 'finish', finishReason: 'stop' }))
  chunks.push('data: [DONE]\n\n')
  return chunks.join('')
}

/** 模拟 MCP 天气工具调用响应 */
export function buildWeatherToolStream(): string {
  const chunks: string[] = []
  chunks.push(sseChunk({ type: 'start' }))
  chunks.push(sseChunk({ type: 'start-step' }))

  const toolCallId = 'call-1'
  chunks.push(sseChunk({ type: 'tool-input-start', toolCallId, toolName: 'get_weather' }))
  chunks.push(sseChunk({ type: 'tool-input-delta', toolCallId, inputTextDelta: '{"city":"' }))
  chunks.push(sseChunk({ type: 'tool-input-delta', toolCallId, inputTextDelta: '深圳"}' }))
  chunks.push(
    sseChunk({
      type: 'tool-input-available',
      toolCallId,
      toolName: 'get_weather',
      input: { city: '深圳' }
    })
  )
  chunks.push(
    sseChunk({
      type: 'tool-output-available',
      toolCallId,
      output: '深圳今天天气：晴，温度 28°C，湿度 65%，风速 12km/h'
    })
  )

  // 工具调用后的文本回复
  const textId = 'txt-1'
  chunks.push(sseChunk({ type: 'text-start', id: textId }))
  chunks.push(
    sseChunk({
      type: 'text-delta',
      id: textId,
      delta: '根据查询结果，深圳今天天气晴朗，温度28°C，湿度65%，风速12km/h。'
    })
  )
  chunks.push(sseChunk({ type: 'text-end', id: textId }))

  chunks.push(sseChunk({ type: 'finish-step' }))
  chunks.push(sseChunk({ type: 'finish', finishReason: 'stop' }))
  chunks.push('data: [DONE]\n\n')
  return chunks.join('')
}

/** 模拟含代码块的流式响应 */
export function buildCodeBlockStream(): string {
  const codeContent = 'const greeting = "hello world";\nconsole.log(greeting);'
  const text = `下面是一个 JavaScript 代码示例：\n\n\`\`\`js\n${codeContent}\n\`\`\`\n\n这段代码会输出 hello world。`
  return buildTextStream(text, 5)
}

/**
 * 模拟 OCR 工具调用的流式响应
 *
 * 事件序列：tool-input-start → tool-input-delta (imageUrl JSON) → tool-input-available
 *          → tool-output-available (Markdown 文本) → text-delta (基于 OCR 结果的回答)
 *
 * 与 buildWeatherToolStream 结构一致，区别：
 * - toolName 为 'extractTextFromImage'（静态工具，非 MCP dynamic-tool）
 * - input 包含 imageUrl 字段
 * - output 包含 text + imageUrl + model 字段
 */
export function buildOcrToolStream(options?: {
  imageUrl?: string
  ocrText?: string
  answerText?: string
}): string {
  const imageUrl = options?.imageUrl || 'https://i.ibb.co/abc/test.png'
  const ocrText = options?.ocrText || '## 提取结果\n\n这是图片中的文字内容'
  const answerText = options?.answerText || '根据 OCR 识别结果，图片中的文字为：这是图片中的文字内容'

  const chunks: string[] = []
  chunks.push(sseChunk({ type: 'start' }))
  chunks.push(sseChunk({ type: 'start-step' }))

  const toolCallId = 'call-ocr-1'
  chunks.push(sseChunk({ type: 'tool-input-start', toolCallId, toolName: 'extractTextFromImage' }))
  // 模拟 input JSON 逐 chunk 传输
  chunks.push(
    sseChunk({ type: 'tool-input-delta', toolCallId, inputTextDelta: '{"imageUrl":"' })
  )
  chunks.push(
    sseChunk({ type: 'tool-input-delta', toolCallId, inputTextDelta: `${imageUrl}"}` })
  )
  chunks.push(
    sseChunk({
      type: 'tool-input-available',
      toolCallId,
      toolName: 'extractTextFromImage',
      input: { imageUrl }
    })
  )
  chunks.push(
    sseChunk({
      type: 'tool-output-available',
      toolCallId,
      output: {
        text: ocrText,
        imageUrl,
        model: 'PaddlePaddle/PaddleOCR-VL-1.5'
      }
    })
  )

  // 工具调用后的文本回复
  const textId = 'txt-1'
  chunks.push(sseChunk({ type: 'text-start', id: textId }))
  for (let i = 0; i < answerText.length; i += 5) {
    chunks.push(
      sseChunk({ type: 'text-delta', id: textId, delta: answerText.slice(i, i + 5) })
    )
  }
  chunks.push(sseChunk({ type: 'text-end', id: textId }))

  chunks.push(sseChunk({ type: 'finish-step' }))
  chunks.push(sseChunk({ type: 'finish', finishReason: 'stop' }))
  chunks.push('data: [DONE]\n\n')
  return chunks.join('')
}

/**
 * 模拟 OCR 工具调用失败的流式响应（output 包含 error 字段）
 */
export function buildOcrToolErrorStream(options?: {
  imageUrl?: string
  error?: string
  detail?: string
}): string {
  const imageUrl = options?.imageUrl || 'https://i.ibb.co/abc/test.png'
  const error = options?.error || 'OCR 处理失败'
  const detail = options?.detail || 'URL 安全检查失败: 协议 http: 不被允许'

  const chunks: string[] = []
  chunks.push(sseChunk({ type: 'start' }))
  chunks.push(sseChunk({ type: 'start-step' }))

  const toolCallId = 'call-ocr-err'
  chunks.push(sseChunk({ type: 'tool-input-start', toolCallId, toolName: 'extractTextFromImage' }))
  chunks.push(
    sseChunk({ type: 'tool-input-delta', toolCallId, inputTextDelta: '{"imageUrl":"' })
  )
  chunks.push(
    sseChunk({ type: 'tool-input-delta', toolCallId, inputTextDelta: `${imageUrl}"}` })
  )
  chunks.push(
    sseChunk({
      type: 'tool-input-available',
      toolCallId,
      toolName: 'extractTextFromImage',
      input: { imageUrl }
    })
  )
  chunks.push(
    sseChunk({
      type: 'tool-output-available',
      toolCallId,
      output: { error, detail, imageUrl }
    })
  )

  // 工具失败后的文本回复（LLM 基于错误信息回复用户）
  const textId = 'txt-1'
  const answerText = '抱歉，OCR 识别失败，请检查图片链接是否有效后重试。'
  chunks.push(sseChunk({ type: 'text-start', id: textId }))
  for (let i = 0; i < answerText.length; i += 5) {
    chunks.push(
      sseChunk({ type: 'text-delta', id: textId, delta: answerText.slice(i, i + 5) })
    )
  }
  chunks.push(sseChunk({ type: 'text-end', id: textId }))

  chunks.push(sseChunk({ type: 'finish-step' }))
  chunks.push(sseChunk({ type: 'finish', finishReason: 'stop' }))
  chunks.push('data: [DONE]\n\n')
  return chunks.join('')
}

// ==================== Mock API 函数 ====================

/**
 * 拦截 /api/chat 请求并返回模拟的流式 SSE 响应
 *
 * 核心原理：覆盖 window.fetch，对 /api/chat 请求返回一个 ReadableStream，
 * 逐事件延迟发送 SSE 数据，模拟真实的流式传输。
 * 其他请求透传给原始 fetch。
 *
 * @param page Playwright Page 对象
 * @param streamBody 完整的 SSE 流 body（由 build*Stream 函数生成）
 * @param chunkDelay 每个 SSE 事件之间的延迟（毫秒），默认 50ms
 */
export async function mockChatAPI(page: Page, streamBody: string, chunkDelay = 50) {
  await page.evaluate(
    ({ body, delay }) => {
      const originalFetch = window.fetch.bind(window)
      const events = body.split('\n\n').filter((e: string) => e.trim())
      const encoder = new TextEncoder()

      ;(window as any).__originalFetch = originalFetch
      ;(window as any).fetch = async function (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : (input as Request).url

        // 只拦截 /api/chat POST 请求
        if (url?.includes('/api/chat')) {
          const signal = init?.signal
          let eventIndex = 0
          let cancelled = false

          // 如果请求已被 abort，直接抛出 AbortError
          if (signal?.aborted) {
            const error = new DOMException('The operation was aborted.', 'AbortError')
            return Promise.reject(error)
          }

          // 监听 abort 信号，取消流
          if (signal) {
            signal.addEventListener('abort', () => {
              cancelled = true
            })
          }

          const stream = new ReadableStream({
            async pull(controller) {
              // 检查 abort 状态
              if (cancelled || signal?.aborted) {
                controller.error(new DOMException('The operation was aborted.', 'AbortError'))
                return
              }
              if (eventIndex >= events.length) {
                controller.close()
                return
              }
              // 第一个事件立即发送，后续事件加延迟
              if (eventIndex > 0) {
                await new Promise((resolve) => setTimeout(resolve, delay))
              }
              // 延迟后再次检查 abort 状态
              if (cancelled || signal?.aborted) {
                controller.error(new DOMException('The operation was aborted.', 'AbortError'))
                return
              }
              controller.enqueue(encoder.encode(events[eventIndex] + '\n\n'))
              eventIndex++
            },
            cancel() {
              cancelled = true
            }
          })

          return new Response(stream, {
            status: 200,
            headers: new Headers({
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'X-Accel-Buffering': 'no'
            })
          })
        }

        return originalFetch(input, init)
      }
    },
    { body: streamBody, delay: chunkDelay }
  )
}

// ==================== 通用测试辅助函数 ====================

/** 在输入框输入文字并点击发送 */
export async function typeAndSubmit(page: Page, text: string) {
  const textarea = page.getByTestId('chat-input')
  await textarea.click()
  await page.waitForTimeout(200)
  await textarea.pressSequentially(text, { delay: 20 })
  await page.waitForTimeout(300)
  await expect(page.getByTestId('send-btn')).toBeEnabled({ timeout: 5000 })
  await page.getByTestId('send-btn').click()
}

/** 等待 AI 回复完成（stop 按钮消失） */
export async function waitForResponse(page: Page, timeout = 60000) {
  await page.waitForFunction(() => !document.querySelector('button[data-testid="stop-btn"]'), {
    timeout
  })
  await page.waitForTimeout(1000)
}

/** 等待助手消息内容出现 */
export async function waitForAssistantMessage(page: Page, timeout = 30000) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="message-assistant"]')
      return el && (el.textContent || '').trim().length > 0
    },
    { timeout }
  )
}
