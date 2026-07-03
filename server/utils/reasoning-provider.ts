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
export const REASONING_PREFIX = '\x00REASONING:'
/** reasoning 结束的分隔标记，用于区分思考过程和正式回答的边界 */
export const REASONING_END = '\x00REASONING_END'

/**
 * 自定义 fetch：拦截请求和响应，处理 reasoning_content 和 developer 角色
 *
 * 1. 请求拦截：将请求体中的 role: 'developer' 替换为 role: 'system'
 * 2. 响应拦截：将 SSE 流中的 reasoning_content 映射为带 REASONING_PREFIX 前缀的 content
 */
export async function customFetch(
  url: RequestInfo | URL,
  options?: RequestInit
): Promise<Response> {
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
  // 行缓冲区：处理 SSE 行跨 TCP 包边界的情况
  let lineBuffer = ''

  // 拦截 SSE 响应流，将 reasoning_content 映射为带前缀的 content
  const transformedBody = response.body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk, { stream: true })
        // 将新数据拼接到缓冲区，按 \n 分割
        lineBuffer += text
        const lines = lineBuffer.split('\n')
        // 只有最后一个元素非空时才是不完整的行，保留在缓冲区
        // 如果最后一个元素为空，说明输入以 \n 结尾，所有行都是完整的
        if (lines[lines.length - 1] !== '') {
          lineBuffer = lines.pop()!
        } else {
          lineBuffer = ''
        }

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

            // 过滤无效的 tool_calls 首帧
            // 部分模型（如 GLM-4-9B-0414）会发送 id=null、function.name="" 的空 tool_calls，
            // AI SDK v5 解析后生成 toolCallId=null 的 tool-input-start 事件，触发 schema 校验失败
            if (Array.isArray(delta.tool_calls)) {
              const validToolCalls = delta.tool_calls.filter(
                (tc: { id?: unknown; function?: { name?: string } }) =>
                  tc.id != null && tc.function && tc.function.name !== ''
              )
              if (validToolCalls.length === 0) {
                delete delta.tool_calls
                // content 为 null 时整个 delta 无有效内容，跳过该帧避免触发空 tool 事件
                if (delta.content == null) {
                  continue
                }
              } else {
                delta.tool_calls = validToolCalls
              }
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

        controller.enqueue(new TextEncoder().encode(modifiedLines.join('\n') + '\n'))
      },
      flush(controller) {
        // 流结束时，将缓冲区中残留的不完整行输出
        if (lineBuffer) {
          controller.enqueue(new TextEncoder().encode(lineBuffer))
          lineBuffer = ''
        }
      }
    })
  )

  return new Response(transformedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
}

const baseConfig = {
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.siliconflow.cn/v1',
  apiKey: process.env.OPENAI_API_KEY
}

/**
 * 创建带 enable_thinking 注入的 fetch 包装器
 *
 * 硅基流动的 enable_thinking 是请求体顶层字段（boolean），但 @ai-sdk/openai v2 的
 * providerOptions 使用严格 zod schema 校验，不支持透传自定义字段（会被静默剥离）。
 * 因此必须在 fetch 层拦截请求体，手动注入 enable_thinking。
 *
 * @see https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions
 */
function createThinkingFetch(enableThinking: boolean) {
  return async (url: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
    if (options?.body && typeof options.body === 'string') {
      try {
        const body = JSON.parse(options.body)
        body.enable_thinking = enableThinking
        options = { ...options, body: JSON.stringify(body) }
      } catch {
        // JSON 解析失败，透传原始请求
      }
    }
    return customFetch(url, options)
  }
}

/** 创建支持 reasoning_content 的 provider 实例 */
export function createReasoningProvider() {
  // @ai-sdk/openai v2 默认使用 Responses API，硅基流动不支持
  // 需要显式使用 .chat() 方法走 Chat Completions API
  return (modelId: string, options?: { enableThinking?: boolean }): LanguageModel => {
    // 仅当需要传 enable_thinking 时创建带注入的 fetch，否则用原生 customFetch
    // createOpenAI 仅创建配置对象（无连接池），per-request 创建无性能问题
    const fetchFn =
      options?.enableThinking !== undefined ? createThinkingFetch(options.enableThinking) : customFetch
    const provider = createOpenAI({ ...baseConfig, fetch: fetchFn })
    return provider.chat(modelId) as unknown as LanguageModel
  }
}
