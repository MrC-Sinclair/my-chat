/**
 * 自定义 OpenAI-compatible Provider
 *
 * 解决 @ai-sdk/openai 不处理 reasoning_content 字段的问题。
 * SiliconFlow 等兼容 API 会在 SSE 流的 delta 中返回 reasoning_content，
 * 但 @ai-sdk/openai v1.3.24 的流式解析器只处理 delta.content 和 delta.tool_calls，
 * 直接忽略了 reasoning_content，导致思考过程数据在 provider 层被静默丢弃。
 *
 * 方案：通过自定义 fetch 拦截原始 SSE 响应流，将 reasoning_content 映射为
 * 带特殊前缀的 content，让 provider 能正常解析，后续在 chat.post.ts 中
 * 再将带前缀的 text-delta 转换为 reasoning 事件。
 */
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV1 } from 'ai'

/** reasoning 内容的前缀标记，用于在 text-delta 中标识思考过程片段 */
const REASONING_PREFIX = '\x00REASONING:'
/** reasoning 结束的分隔标记，用于区分思考过程和正式回答的边界 */
const REASONING_END = '\x00REASONING_END'

const baseProvider = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.siliconflow.cn/v1',
  apiKey: process.env.OPENAI_API_KEY,
  fetch: async (url, options) => {
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
  return (modelId: string): LanguageModelV1 => baseProvider(modelId)
}

export { REASONING_PREFIX, REASONING_END }
