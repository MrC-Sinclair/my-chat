/**
 * @file Embedding 服务 — 调用硅基流动 BAAI/bge-m3 把文本转为 1024 维向量
 *
 * 设计要点（详见 openspec/changes/add-long-term-memory/design.md 决策 2/10）：
 *   - base URL、API Key、模型名均从 useRuntimeConfig() 读取，不硬编码
 *   - 复用 OPENAI_API_KEY 鉴权（硅基流动 API 兼容 OpenAI 格式）
 *   - 不做客户端截断：直接传给 API，由硅基流动 API 自行处理超长输入
 *   - 超长文本（> 6000 字符，近似 8K token）仅记录警告日志
 *   - API 失败降级返回 { error, detail }，不抛异常（遵循项目工具错误返回模式）
 */

/** 超长文本警告阈值（近似 8K token，bge-m3 上下文 8K） */
const LONG_TEXT_WARN_THRESHOLD = 6000

/** bge-m3 输出维度（与 schema.ts memoryVectors.embedding dimensions 对齐） */
export const EMBEDDING_DIMENSIONS = 1024

/** Embedding 服务返回类型：成功返回向量，失败返回错误对象 */
export type EmbeddingResult =
  | { embedding: number[]; error?: never }
  | { embedding?: never; error: string; detail: string }

/**
 * 调用硅基流动 embedding API 把文本转为向量
 *
 * @param text 待转向量的文本（不做客户端截断）
 * @returns EmbeddingResult：成功返回 { embedding }，失败返回 { error, detail }
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  if (!text || typeof text !== 'string') {
    return { error: 'embedding 输入无效', detail: 'text 为空或非字符串' }
  }

  // 超长文本仅记录警告，不截断（由 API 自行处理）
  if (text.length > LONG_TEXT_WARN_THRESHOLD) {
    console.warn(
      `[embedding] 输入文本较长（${text.length} 字符），未截断直接传给 API，可能被 API 截断`
    )
  }

  // 从 runtimeConfig 读取配置（ Nitro 服务端 auto-import）
  const config = useRuntimeConfig()
  const baseUrl = config.openAiBaseUrl || 'https://api.siliconflow.cn/v1'
  const apiKey = config.openAiApiKey
  const model = config.embeddingModel || 'BAAI/bge-m3'

  if (!apiKey) {
    return { error: 'embedding 服务不可用', detail: '未配置 OPENAI_API_KEY' }
  }

  const endpoint = `${baseUrl}/embeddings`
  const controller = new AbortController()
  // 30 秒超时（与 OCR 工具一致）
  const timeout = setTimeout(() => controller.abort(), 30_000)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        input: text,
        encoding_format: 'float'
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      return {
        error: 'embedding 服务不可用',
        detail: `API 请求失败 (${response.status}): ${errorText.slice(0, 200)}`
      }
    }

    const data = await response.json()
    // OpenAI 兼容格式：data.data[0].embedding
    const embedding = data?.data?.[0]?.embedding
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return {
        error: 'embedding 服务不可用',
        detail: `返回数据格式异常: ${JSON.stringify(data).slice(0, 200)}`
      }
    }

    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      console.warn(
        `[embedding] 返回维度 ${embedding.length} 与预期 ${EMBEDDING_DIMENSIONS} 不一致`
      )
    }

    return { embedding }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    // AbortError 转为超时错误描述
    if (err instanceof Error && err.name === 'AbortError') {
      return { error: 'embedding 服务不可用', detail: 'API 请求超时（30秒）' }
    }
    return { error: 'embedding 服务不可用', detail }
  } finally {
    clearTimeout(timeout)
  }
}
