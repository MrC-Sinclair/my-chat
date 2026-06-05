/**
 * 自定义 OpenAI-compatible Provider
 *
 * 解决 @ai-sdk/openai v2 与硅基流动等兼容 API 的兼容性问题：
 *
 * 1. reasoning_content 字段处理：
 *    SiliconFlow 等兼容 API 会在 SSE 流的 delta 中返回 reasoning_content，
 *    但 @ai-sdk/openai 的流式解析器只处理 delta.content 和 delta.tool_calls，
 *    直接忽略了 reasoning_content，导致思考过程数据在 provider 层被静默丢弃。
 *    方案：通过自定义 fetch 拦截原始 SSE 响应流，将 reasoning_content 映射为
 *    带特殊前缀的 content，让 provider 能正常解析。
 *
 * 2. developer 角色修复：
 *    @ai-sdk/openai v2 对非 gpt-3/4/5-chat 的模型 ID 一律判定为 isReasoningModel，
 *    导致 system 消息被转为 developer 角色，但硅基流动不支持 developer 角色。
 *    方案：在自定义 fetch 中将请求体里的 developer 角色替换为 system。
 *
 * 3. structuredOutputs 禁用：
 *    @ai-sdk/openai v2 默认启用 structuredOutputs（strict 模式），
 *    硅基流动不支持 strict 参数，会导致 400 Bad Request。
 *    方案：通过 .chat() 的 providerOptions 禁用。
 */
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'

/** reasoning 内容的前缀标记，用于在 text-delta 中标识思考过程片段 */
const REASONING_PREFIX = '\x00REASONING:'
/** reasoning 结束的分隔标记，用于区分思考过程和正式回答的边界 */
const REASONING_END = '\x00REASONING_END'

const baseProvider = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.siliconflow.cn/v1',
  apiKey: process.env.OPENAI_API_KEY,
  fetch: async (url, options) => {
    // 修复请求体：将 developer 角色替换为 system（硅基流动不支持 developer）
    if (options?.body && typeof options.body === 'string') {
      try {
        const body = JSON.parse(options.body)
        if (body.messages && Array.isArray(body.messages)) {
          let modified = false
          for (const msg of body.messages) {
            if (msg.role === 'developer') {
              msg.role = 'system'
              modified = true
            }
          }
          if (modified) {
            options = { ...options, body: JSON.stringify(body) }
          }
        }
      } catch {
        // JSON 解析失败，透传原始请求
      }
    }

    const response = await globalThis.fetch(url, options)

    // 非 SSE 响应或错误响应直接透传
    if (!response.ok || !response.body) {
      return response
    }

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/event-stream')) {
      return response
    }

    // 追踪是否处于 reasoning 阶段，用于在 reasoning→content 切换时插入分隔标记
    let wasReasoning = false

    // 拦截 SSE 响应流，将 reasoning_content 映射为带前缀的 content
    const transformedBody = response.body.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          const text = new TextDecoder().decode(chunk, { stream: true })
          const lines = text.split('\n')

          const modifiedLines: string[] = []

          for (const line of lines) {
            // 非 SSE data 行直接透传
            if (!line.startsWith('data: ') || line === 'data: [DONE]') {
              modifiedLines.push(line)
              continue
            }

            try {
              const json = JSON.parse(line.slice(6))
              const delta = json?.choices?.[0]?.delta

              if (!delta) {
                modifiedLines.push(line)
                continue
              }

              // 有 reasoning_content 且非空：映射为带前缀的 content
              if (delta.reasoning_content != null && delta.reasoning_content !== '') {
                delta.content = REASONING_PREFIX + delta.reasoning_content
                delete delta.reasoning_content
                wasReasoning = true
                modifiedLines.push('data: ' + JSON.stringify(json))
                continue
              }

              // reasoning_content 为空字符串（首帧标记）：仅删除该字段
              if (delta.reasoning_content === '') {
                delete delta.reasoning_content
                modifiedLines.push('data: ' + JSON.stringify(json))
                continue
              }

              // 从 reasoning 阶段切换到 content 阶段：插入分隔标记
              if (wasReasoning && delta.content != null) {
                delta.content = REASONING_END + delta.content
                wasReasoning = false
                modifiedLines.push('data: ' + JSON.stringify(json))
                continue
              }

              modifiedLines.push(line)
            } catch {
              modifiedLines.push(line)
            }
          }

          controller.enqueue(new TextEncoder().encode(modifiedLines.join('\n')))
        }
      })
    )

    return new Response(transformedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    })
  }
})

/** 创建支持 reasoning_content 的 provider 实例 */
export function createReasoningProvider() {
  // @ai-sdk/openai v2 默认使用 Responses API，硅基流动不支持
  // 需要显式使用 .chat() 方法走 Chat Completions API
  return (modelId: string): LanguageModel => baseProvider.chat(modelId) as unknown as LanguageModel
}

export { REASONING_PREFIX, REASONING_END }
