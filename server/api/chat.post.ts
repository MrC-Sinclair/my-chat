/**
 * @file 聊天 API 接口 — POST /api/chat
 *
 * 本文件是 AI 聊天功能的核心后端接口，负责：
 *   1. 接收前端发送的聊天消息
 *   2. 调用大语言模型（LLM）进行流式生成回复
 *   3. 在回复完成后，将用户消息和 AI 回复保存到数据库
 *
 * 技术栈：
 *   - Vercel AI SDK（`ai` 包）：提供 streamText 流式文本生成能力
 *   - @ai-sdk/openai：OpenAI 兼容的模型适配器（可对接硅基流动等国内平台）
 *   - Drizzle ORM：操作 PostgreSQL 数据库
 *
 * 请求体格式（JSON）：
 *   {
 *     messages: [{ role: "user"|"assistant"|"system", content: "..." }],
 *     sessionId?: string,
 *     enable_thinking?: boolean,
 *     thinking_budget?: number,
 *     model?: string
 *   }
 *
 * 响应格式：AI SDK 的 DataStream 流式响应，前端可通过 useChat 逐字读取
 */

import { createOpenAI } from '@ai-sdk/openai'
import { streamText } from 'ai'
import { db } from '~/server/db'
import { messages as messagesTable, sessions } from '~/server/db/schema'
import { eq } from 'drizzle-orm'
import { weatherTool } from '~/server/tools/weather'
import { webSearchTool } from '~/server/tools/web-search'
import { ALLOWED_MODEL_VALUES } from '~/server/config/models'

/**
 * 创建 LLM 提供者实例
 *
 * createOpenAI 会返回一个工厂函数，调用 llmProvider("模型名") 即可创建模型实例。
 * 通过环境变量配置，默认使用硅基流动（SiliconFlow）的 API 地址，
 * 兼容所有 OpenAI 格式的模型服务（如 DeepSeek、通义千问等）。
 */
const llmProvider = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.siliconflow.cn/v1',
  apiKey: process.env.OPENAI_API_KEY
})

/** 默认模型名称，可通过环境变量 LLM_MODEL 切换 */
const DEFAULT_LLM_MODEL = process.env.LLM_MODEL || 'Qwen/Qwen3-8B'

/** 是否默认开启"深度思考"模式，环境变量 ENABLE_THINKING 设为 'false' 可关闭 */
const DEFAULT_ENABLE_THINKING = process.env.ENABLE_THINKING !== 'false'

/**
 * 系统提示词，优先从环境变量 SYSTEM_PROMPT 读取，为空则使用内置默认值
 *
 * 环境变量方式的好处：
 *   - 无需改代码即可定制 AI 角色和行为
 *   - 不同部署环境可使用不同的系统提示词
 *   - 敏感指令不暴露在前端代码中
 */
const DEFAULT_SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  `你是一个友好的AI助手。请用简洁清晰的方式回答问题。

你拥有以下工具：
- 天气查询：当用户询问天气、气温、是否下雨等问题时，使用天气工具查询实时数据
- 网页搜索：当需要查找最新信息（新闻、政策、动态）、验证不确定知识、或查找资料时，使用搜索工具

搜索后请综合搜索结果给出准确回答，并注明信息来源。`

/**
 * POST /api/chat 的事件处理器
 *
 * 整体流程：
 *   前端发送消息 → 解析请求体 → 获取系统提示词 → 调用 LLM 流式生成 → 回复完毕后保存到数据库
 */
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { messages, sessionId, enable_thinking, thinking_budget, model } = body ?? {}

  if (!messages || !Array.isArray(messages)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'messages 参数缺失或格式错误'
    })
  }

  const thinkingEnabled = enable_thinking ?? DEFAULT_ENABLE_THINKING
  const useModel = ALLOWED_MODEL_VALUES.has(model) ? model : DEFAULT_LLM_MODEL

  return streamText({
    model: llmProvider(useModel),
    system: DEFAULT_SYSTEM_PROMPT,
    messages,
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
  }).toDataStreamResponse()
})

/**
 * 将对话消息保存到数据库
 *
 * @param sessionId - 会话 ID，关联 sessions 表
 * @param chatMessages - 本次对话的所有消息（包含历史）
 * @param assistantText - AI 助手生成的完整回复文本
 */
async function saveMessagesToDb(
  sessionId: string,
  chatMessages: Array<{ role: string; content: string }>,
  assistantText: string
) {
  if (chatMessages.length === 0) return

  const lastUserMessage = [...chatMessages].reverse().find((msg) => msg.role === 'user')

  if (lastUserMessage) {
    await db.insert(messagesTable).values({
      id: crypto.randomUUID(),
      sessionId,
      role: 'user',
      content: lastUserMessage.content,
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
