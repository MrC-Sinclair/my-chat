import { streamText } from 'ai'
import { db } from '~/server/db'
import { messages as messagesTable, sessions } from '~/server/db/schema'
import { eq } from 'drizzle-orm'
import { weatherTool } from '~/server/tools/weather'
import { webSearchTool } from '~/server/tools/web-search'
import { ALLOWED_MODEL_VALUES, getModelCapabilities } from '~/server/config/models'
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { uploadToImgBb } from '~/server/utils/imgbb'
import {
  createReasoningProvider,
  REASONING_PREFIX,
  REASONING_END
} from '~/server/utils/reasoning-provider'

const llmProvider = createReasoningProvider()

const DEFAULT_LLM_MODEL = process.env.LLM_MODEL || 'Qwen/Qwen3-8B'
const DEFAULT_ENABLE_THINKING = process.env.ENABLE_THINKING !== 'false'

const DEFAULT_SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  `你是一个友好的AI助手。请用简洁清晰的方式回答问题。

【重要规则】当用户问题涉及以下内容时，你【必须】调用网页搜索工具，禁止凭记忆回答：
- 任何包含"最新"、"今天"、"近期"、"当前"、"现在"、"最近"等时间词的问题
- 新闻、事件、政策、数据、价格等可能随时间变化的信息
- 你不确定的事实或数据

搜索后请综合搜索结果给出准确回答，并注明信息来源。
如果你没有调用搜索工具就回答了时效性问题，你的回答很可能是过时的。`

const TIME_KEYWORDS = [
  '最新',
  '今天',
  '近期',
  '当前',
  '现在',
  '最近',
  '新闻',
  '实时',
  '最新消息',
  '热点',
  '动态'
]

const MAX_MESSAGE_LENGTH = 10_00
const MAX_CONTEXT_MESSAGES = 50
const MAX_IMAGE_SIZE = 4 * 1024 * 1024
const MAX_IMAGES_PER_MESSAGE = 5
const UPLOAD_DIR = join(process.cwd(), 'public', 'uploads')

function saveBase64Image(base64: string): string {
  const match = base64.match(/^data:image\/(\w+);base64,(.+)$/)
  if (!match) throw new Error('Invalid image format')
  const ext = match[1]
  const data = match[2]
  const buffer = Buffer.from(data, 'base64')
  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true })
  }
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  writeFileSync(join(UPLOAD_DIR, filename), buffer)
  return `/uploads/${filename}`
}

function parseBase64Meta(dataUrl: string): { base64: string; mimeType: string } | null {
  const match = dataUrl.match(/^data:([\w/+-]+);base64,(.+)$/)
  if (!match) return null
  return { mimeType: match[1], base64: match[2] }
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const {
    messages,
    sessionId,
    enable_thinking,
    thinking_budget,
    model,
    images,
    enable_web_search
  } = body ?? {}

  if (!messages || !Array.isArray(messages)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'messages 参数缺失或格式错误'
    })
  }

  let contextMessages = messages
  if (messages.length > MAX_CONTEXT_MESSAGES) {
    contextMessages = messages.slice(-MAX_CONTEXT_MESSAGES)
  }

  for (const msg of messages) {
    if (typeof msg.content === 'string' && msg.content.length > MAX_MESSAGE_LENGTH) {
      throw createError({
        statusCode: 400,
        statusMessage: `单条消息长度超过限制（最多 ${MAX_MESSAGE_LENGTH} 字符）`
      })
    }
  }

  if (images && Array.isArray(images)) {
    if (images.length > MAX_IMAGES_PER_MESSAGE) {
      throw createError({
        statusCode: 400,
        statusMessage: `图片数量超过限制（最多 ${MAX_IMAGES_PER_MESSAGE} 张）`
      })
    }
    for (const img of images) {
      if (typeof img === 'string' && img.length > MAX_IMAGE_SIZE * 1.37) {
        throw createError({
          statusCode: 400,
          statusMessage: `图片大小超过限制（最多 4MB）`
        })
      }
    }
  }

  const useModel = ALLOWED_MODEL_VALUES.has(model) ? model : DEFAULT_LLM_MODEL
  const caps = getModelCapabilities(useModel)

  let imageUrls: string[] = []
  if (images && Array.isArray(images) && images.length > 0) {
    const uploadPromises = images.map(async (img: string) => {
      if (img.startsWith('data:')) {
        if (process.env.IMGBB_API_KEY) {
          const localPath = saveBase64Image(img)
          const fullPath = join(process.cwd(), 'public', localPath)
          try {
            const publicUrl = await uploadToImgBb(fullPath)
            return publicUrl
          } catch (err) {
            console.error('ImgBB 上传失败，降级使用 base64:', (err as Error).message)
            try {
              if (existsSync(fullPath)) unlinkSync(fullPath)
            } catch {
              // 忽略清理错误
            }
          }
        }
        return img
      }
      return img
    })
    imageUrls = await Promise.all(uploadPromises)
  }

  const hasImages = imageUrls.length > 0
  const lastUserIdx = contextMessages.map((m: { role: string }) => m.role).lastIndexOf('user')

  const llmMessages = contextMessages
    .filter((msg: { role: string }) => msg.role !== 'system')
    .map((msg: { role: string; content: unknown }) => {
      const textContent = typeof msg.content === 'string' ? msg.content : String(msg.content || '')

      if (msg.role === 'assistant') return { role: 'assistant' as const, content: textContent }

      if (contextMessages.indexOf(msg) === lastUserIdx && hasImages) {
        const parts: Array<
          { type: 'text'; text: string } | { type: 'image'; image: string | URL; mimeType?: string }
        > = [{ type: 'text', text: textContent }]

        for (const url of imageUrls) {
          if (url.startsWith('data:')) {
            const meta = parseBase64Meta(url)
            parts.push({
              type: 'image',
              image: meta ? meta.base64 : url,
              mimeType: meta?.mimeType
            })
          } else {
            parts.push({ type: 'image', image: new URL(url) })
          }
        }
        return { role: 'user' as const, content: parts }
      }

      return { role: 'user' as const, content: textContent }
    })

  const thinkingEnabled = enable_thinking ?? DEFAULT_ENABLE_THINKING
  const modelSupportsThinking = !caps.vision && !caps.reasoning
  const thinkingOptions =
    thinkingEnabled && modelSupportsThinking
      ? { enableThinking: true, thinkingBudget: thinking_budget || 4096 }
      : {}

  const maxSteps = caps.vision || caps.reasoning ? 1 : 5
  const webSearchEnabled = enable_web_search !== false

  let finalSystemPrompt = DEFAULT_SYSTEM_PROMPT

  if (webSearchEnabled && !caps.vision && caps.toolCalling) {
    const lastUserMsg =
      contextMessages
        .filter((m: { role: string }) => m.role === 'user')
        .map((m: { content: unknown }) => (typeof m.content === 'string' ? m.content : ''))
        .pop() || ''

    if (TIME_KEYWORDS.some((kw) => lastUserMsg.includes(kw))) {
      finalSystemPrompt +=
        '\n\n【系统提示】用户的问题涉及时效性信息，你【必须】调用网页搜索工具（webSearch）来获取最新信息，禁止凭记忆回答。'
    }
  }

  try {
    const result = streamText({
      model: llmProvider(useModel),
      system: finalSystemPrompt,
      messages: llmMessages as Parameters<typeof streamText>[0]['messages'],
      maxSteps,
      temperature: caps.vision ? 0.7 : void 0,
      ...(caps.toolCalling && {
        tools: {
          weather: weatherTool,
          ...(webSearchEnabled && { webSearch: webSearchTool })
        }
      }),
      ...thinkingOptions,
      onFinish: async ({ text }) => {
        if (!sessionId) return
        try {
          // 从 text 中移除 reasoning 标记内容，只保留正式回答
          // text 格式：REASONING_PREFIX + 思考内容... + REASONING_END + 正式回答
          const reasoningStart = text.indexOf(REASONING_PREFIX)
          const reasoningEndIdx = text.indexOf(REASONING_END)
          let cleanText = text
          if (reasoningStart >= 0 && reasoningEndIdx >= 0) {
            // 有完整的 reasoning 段：取 REASONING_END 之后的内容
            cleanText = text.slice(reasoningEndIdx + REASONING_END.length).trim()
          } else if (reasoningStart >= 0) {
            // 只有 reasoning 没有正式回答（极端情况）
            cleanText = ''
          }
          await saveMessagesToDb(sessionId, messages, cleanText, hasImages ? imageUrls : undefined)
        } catch (err) {
          console.error('保存消息到数据库失败:', err)
        }
      }
    })

    // 将 fullStream 中的 text-delta 按 REASONING 标记分类：
    // - 带 REASONING_PREFIX 的 → 转为 reasoning 事件（思考过程）
    // - 带 REASONING_END 的 → 切换回 text-delta（正式回答开始）
    // - 其他 → 原样传递
    const dataStream = result.fullStream.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          if (chunk.type === 'text-delta') {
            const delta = chunk.textDelta

            // 整个 delta 以 REASONING_PREFIX 开头：纯 reasoning 片段
            if (delta.startsWith(REASONING_PREFIX)) {
              const reasoningText = delta.slice(REASONING_PREFIX.length)
              if (reasoningText) {
                controller.enqueue({ type: 'reasoning', textDelta: reasoningText })
              }
              return
            }

            // delta 中间包含 REASONING_PREFIX：reasoning 和其他内容混合
            if (delta.includes(REASONING_PREFIX)) {
              const parts = delta.split(REASONING_PREFIX)
              for (const part of parts) {
                if (!part) continue
                if (part.includes(REASONING_END)) {
                  // reasoning → 正式回答的切换点
                  const subParts = part.split(REASONING_END)
                  if (subParts[0]) {
                    controller.enqueue({ type: 'reasoning', textDelta: subParts[0] })
                  }
                  if (subParts[1]) {
                    controller.enqueue({ type: 'text-delta', textDelta: subParts[1] })
                  }
                } else {
                  controller.enqueue({ type: 'reasoning', textDelta: part })
                }
              }
              return
            }

            // delta 以 REASONING_END 开头：正式回答开始
            if (delta.startsWith(REASONING_END)) {
              const textAfter = delta.slice(REASONING_END.length)
              if (textAfter) {
                controller.enqueue({ type: 'text-delta', textDelta: textAfter })
              }
              return
            }

            // delta 中间包含 REASONING_END：reasoning 尾部和正式回答开头
            if (delta.includes(REASONING_END)) {
              const parts = delta.split(REASONING_END)
              if (parts[0]) {
                controller.enqueue({ type: 'reasoning', textDelta: parts[0] })
              }
              if (parts[1]) {
                controller.enqueue({ type: 'text-delta', textDelta: parts[1] })
              }
              return
            }

            // 普通 text-delta，直接传递
            controller.enqueue(chunk)
            return
          }

          // 非 text-delta 事件（tool-call、error、finish 等）直接传递
          controller.enqueue(chunk)
        }
      })
    )

    // 手动序列化为 AI SDK 数据流格式
    // 格式说明：0=文本, g=推理, 9=工具调用, c=工具调用增量, a=工具结果, 3=错误, d=完成
    const encoder = new TextEncoder()
    const readableStream = dataStream.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          switch (chunk.type) {
            case 'text-delta':
              controller.enqueue(encoder.encode(`0:${JSON.stringify(chunk.textDelta)}\n`))
              break
            case 'reasoning':
              controller.enqueue(encoder.encode(`g:${JSON.stringify(chunk.textDelta)}\n`))
              break
            case 'tool-call':
              controller.enqueue(
                encoder.encode(
                  `9:${JSON.stringify({
                    toolCallId: chunk.toolCallId,
                    toolName: chunk.toolName,
                    args: chunk.args
                  })}\n`
                )
              )
              break
            case 'tool-call-delta':
              controller.enqueue(
                encoder.encode(
                  `c:${JSON.stringify({
                    toolCallId: chunk.toolCallId,
                    argsTextDelta: chunk.argsTextDelta
                  })}\n`
                )
              )
              break
            case 'tool-result':
              controller.enqueue(
                encoder.encode(
                  `a:${JSON.stringify({
                    toolCallId: chunk.toolCallId,
                    result: chunk.result
                  })}\n`
                )
              )
              break
            case 'error':
              controller.enqueue(
                encoder.encode(
                  `3:${JSON.stringify(chunk.error instanceof Error ? chunk.error.message : String(chunk.error))}\n`
                )
              )
              break
            case 'finish':
              controller.enqueue(
                encoder.encode(
                  `d:${JSON.stringify({
                    finishReason: chunk.finishReason,
                    usage: chunk.usage
                  })}\n`
                )
              )
              break
            default:
              break
          }
        }
      })
    )

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Vercel-AI-Data-Stream': 'v1'
      }
    })
  } catch (err) {
    console.error('streamText 调用失败:', err)
    throw createError({
      statusCode: 500,
      statusMessage: `AI 调用失败: ${err instanceof Error ? err.message : String(err)}`
    })
  }
})

async function saveMessagesToDb(
  sessionId: string,
  chatMessages: Array<{ role: string; content: unknown }>,
  assistantText: string,
  imageUrls?: string[]
) {
  if (chatMessages.length === 0) return
  const lastUserMessage = [...chatMessages].reverse().find((msg) => msg.role === 'user')
  if (lastUserMessage) {
    const meta: Record<string, unknown> = {}
    if (imageUrls && imageUrls.length > 0) {
      meta.images = imageUrls.map((url, i) => ({ index: i, url }))
    }
    await db.insert(messagesTable).values({
      id: crypto.randomUUID(),
      sessionId,
      role: 'user',
      content:
        typeof lastUserMessage.content === 'string'
          ? lastUserMessage.content
          : JSON.stringify(lastUserMessage.content),
      metadata: Object.keys(meta).length > 0 ? meta : undefined,
      createdAt: new Date()
    })
  }
  await db.insert(messagesTable).values({
    id: crypto.randomUUID(),
    sessionId,
    role: 'assistant',
    content: assistantText,
    metadata: { model: DEFAULT_LLM_MODEL },
    createdAt: new Date()
  })
  await db.update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, sessionId))
}
