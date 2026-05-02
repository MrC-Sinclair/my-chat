import { createOpenAI } from '@ai-sdk/openai'
import { streamText } from 'ai'
import { db } from '~/server/db'
import { messages as messagesTable, sessions } from '~/server/db/schema'
import { eq } from 'drizzle-orm'
import { weatherTool } from '~/server/tools/weather'
import { webSearchTool } from '~/server/tools/web-search'
import { ALLOWED_MODEL_VALUES } from '~/server/config/models'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { uploadToImgBb } from '~/server/utils/imgbb'

const llmProvider = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.siliconflow.cn/v1',
  apiKey: process.env.OPENAI_API_KEY
})

const DEFAULT_LLM_MODEL = process.env.LLM_MODEL || 'Qwen/Qwen3-8B'
const DEFAULT_ENABLE_THINKING = process.env.ENABLE_THINKING !== 'false'

const DEFAULT_SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  `你是一个友好的AI助手。请用简洁清晰的方式回答问题。

你拥有以下工具：
- 天气查询：当用户询问天气、气温、是否下雨等问题时，使用天气工具查询实时数据
- 网页搜索：当需要查找最新信息（新闻、政策、动态）、验证不确定知识、或查找资料时，使用搜索工具

搜索后请综合搜索结果给出准确回答，并注明信息来源。`

const MAX_MESSAGE_LENGTH = 10_00
const MAX_MESSAGES_COUNT = 10
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

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { messages, sessionId, enable_thinking, thinking_budget, model, images } = body ?? {}

  if (!messages || !Array.isArray(messages)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'messages 参数缺失或格式错误'
    })
  }

  if (messages.length > MAX_MESSAGES_COUNT) {
    throw createError({
      statusCode: 400,
      statusMessage: `消息数量超过限制（最多 ${MAX_MESSAGES_COUNT} 条）`
    })
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

  const thinkingEnabled = enable_thinking ?? DEFAULT_ENABLE_THINKING
  const useModel = ALLOWED_MODEL_VALUES.has(model) ? model : DEFAULT_LLM_MODEL

  let imageUrls: string[] = []
  if (images && Array.isArray(images) && images.length > 0) {
    const uploadPromises = images.map(async (img: string) => {
      if (img.startsWith('data:')) {
        const localPath = saveBase64Image(img)
        const publicUrl = await uploadToImgBb(join(process.cwd(), 'public', localPath))
        return publicUrl
      }
      return img
    })
    imageUrls = await Promise.all(uploadPromises)
  }

  const hasImages = imageUrls.length > 0
  const isVisionModel =
    useModel.includes('1V') || useModel.includes('VL') || useModel.includes('Vision')

  if (hasImages || isVisionModel) {
    return handleImageChat(
      event,
      messages,
      imageUrls,
      useModel,
      thinkingEnabled,
      thinking_budget,
      sessionId,
      images
    )
  }

  const llmMessages = messages.map((msg: { role: string; content: unknown }) => ({
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content as string
  }))

  try {
    const result = streamText({
      model: llmProvider(useModel),
      system: DEFAULT_SYSTEM_PROMPT,
      messages: llmMessages,
      tools: {
        weather: weatherTool,
        webSearch: webSearchTool
      },
      maxSteps: 5,
      ...(thinkingEnabled
        ? {
            enableThinking: true,
            thinkingBudget: thinking_budget || 4096
          }
        : {}),
      onFinish: async ({ text }) => {
        if (!sessionId) return
        try {
          await saveMessagesToDb(sessionId, messages, text)
        } catch (err) {
          console.error('保存消息到数据库失败:', err)
        }
      }
    })
    return result.toDataStreamResponse()
  } catch (err: any) {
    console.error('streamText 调用失败:', err)
    throw createError({
      statusCode: 500,
      statusMessage: `AI 调用失败: ${err instanceof Error ? err.message : String(err)}`
    })
  }
})

async function handleImageChat(
  event: any,
  messages: Array<{ role: string; content: string }>,
  imageUrls: string[],
  useModel: string,
  thinkingEnabled: boolean,
  thinking_budget: number | undefined,
  sessionId: string | undefined,
  originalImages?: string[]
) {
  const apiKey = process.env.OPENAI_API_KEY
  const baseURL = process.env.OPENAI_BASE_URL || 'https://api.siliconflow.cn/v1'

  const openaiMessages = messages.map((msg) => {
    if (msg.role === 'user' && msg === messages[messages.length - 1]) {
      if (imageUrls.length > 0) {
        return {
          role: 'user',
          content: [
            { type: 'text', text: msg.content },
            ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } }))
          ]
        }
      }
    }
    return { role: msg.role, content: msg.content }
  })

  const payload: any = {
    model: useModel,
    messages: [{ role: 'system', content: DEFAULT_SYSTEM_PROMPT }, ...openaiMessages],
    stream: true
  }

  if (thinkingEnabled && !useModel.includes('1V')) {
    payload.enable_thinking = true
    payload.thinking_budget = thinking_budget || 4096
  }

  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('[image-chat] API error:', res.status, text)
      throw createError({
        statusCode: res.status,
        statusMessage: `LLM API 错误: ${text}`
      })
    }

    const stream = new ReadableStream({
      async start(controller) {
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let fullText = ''

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value, { stream: true })
            const lines = chunk.split('\n')
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6)
                if (data === '[DONE]') continue
                try {
                  const parsed = JSON.parse(data)
                  const delta = parsed.choices?.[0]?.delta?.content || ''
                  if (delta) {
                    fullText += delta
                    controller.enqueue(new TextEncoder().encode(`0:${JSON.stringify(delta)}\n`))
                  }
                } catch {}
              }
            }
          }
        } catch (err) {
          console.error('[image-chat] stream error:', err)
        } finally {
          controller.close()
          reader.releaseLock()

          if (sessionId && fullText) {
            try {
              await saveMessagesToDb(sessionId, messages, fullText, originalImages)
            } catch (err) {
              console.error('保存消息到数据库失败:', err)
            }
          }
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'x-vercel-ai-data-stream': 'v1'
      }
    })
  } catch (err: any) {
    console.error('[image-chat] error:', err)
    throw createError({
      statusCode: 500,
      statusMessage: `AI 调用失败: ${err instanceof Error ? err.message : String(err)}`
    })
  }
}

async function saveMessagesToDb(
  sessionId: string,
  chatMessages: Array<{ role: string; content: string }>,
  assistantText: string,
  images?: string[]
) {
  if (chatMessages.length === 0) return

  const lastUserMessage = [...chatMessages].reverse().find((msg) => msg.role === 'user')

  if (lastUserMessage) {
    const meta: Record<string, unknown> = {}
    if (images && images.length > 0) {
      meta.images = images.map((img, i) => ({
        index: i,
        size: img.length
      }))
    }

    await db.insert(messagesTable).values({
      id: crypto.randomUUID(),
      sessionId,
      role: 'user',
      content: lastUserMessage.content,
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
