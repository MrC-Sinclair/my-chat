/**
 * @file 重排序服务 — 调用硅基流动 BAAI/bge-reranker-v2-m3 对 query-document 对做交叉编码精排
 *
 * 设计要点（详见 openspec/changes/add-long-term-memory/design.md 决策 3/10）：
 *   - 请求体必须包含 return_documents: true（否则响应不含文档文本）
 *   - 解析响应时使用 results[i].relevance_score（不是 score）
 *   - API 失败降级返回 null，调用方降级为仅 embedding 检索结果
 *   - base URL、API Key、模型名从 useRuntimeConfig() 读取，不硬编码
 */

/** Reranker API 调用超时：30 秒 */
const RERANKER_TIMEOUT_MS = 30_000

/** Reranker 单条精排结果 */
export interface RerankerItem {
  /** 在原始 documents 数组中的索引（0-based） */
  index: number
  /** 相关度分数（0-1，越高越相关） */
  relevanceScore: number
  /** 文档文本（return_documents=true 时返回，可能为 undefined） */
  document?: { text?: string }
}

/** Reranker 服务返回类型：成功返回精排结果数组，失败返回 null */
export type RerankerResult = RerankerItem[] | null

/** 硅基流动 reranker API 单条原始结果 */
interface RawRerankerItem {
  index?: number
  relevance_score?: number
  document?: { text?: string }
}

/**
 * 调用硅基流动 reranker API 对 query-document 对做精排
 *
 * @param query 查询文本
 * @param documents 待精排的文档数组
 * @param topN 返回前 N 条（默认 5）
 * @returns RerankerResult：成功返回按 relevance_score 降序的精排结果，失败返回 null（由调用方降级）
 */
export async function rerankDocuments(
  query: string,
  documents: string[],
  topN = 5
): Promise<RerankerResult> {
  if (!query || !Array.isArray(documents) || documents.length === 0) {
    return null
  }

  const config = useRuntimeConfig()
  const baseUrl = config.openAiBaseUrl || 'https://api.siliconflow.cn/v1'
  const apiKey = config.openAiApiKey
  const model = config.rerankerModel || 'BAAI/bge-reranker-v2-m3'

  if (!apiKey) {
    console.error('[reranker] 未配置 OPENAI_API_KEY，降级为仅 embedding 检索')
    return null
  }

  const endpoint = `${baseUrl}/rerank`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RERANKER_TIMEOUT_MS)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        query,
        documents,
        top_n: Math.min(topN, documents.length),
        // 必须传 return_documents: true，否则响应不含文档文本
        return_documents: true
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      console.error(
        `[reranker] API 请求失败 (${response.status}): ${errorText.slice(0, 200)}，降级为仅 embedding 检索`
      )
      return null
    }

    const data = await response.json()
    const results: RawRerankerItem[] = data?.results
    if (!Array.isArray(results)) {
      console.error(`[reranker] 返回数据格式异常: ${JSON.stringify(data).slice(0, 200)}`)
      return null
    }

    // 解析 results[i].relevance_score（不是 score），按分数降序排列
    const items: RerankerItem[] = []
    for (const item of results) {
      if (typeof item.index !== 'number' || typeof item.relevance_score !== 'number') {
        continue
      }
      items.push({
        index: item.index,
        relevanceScore: item.relevance_score,
        document: item.document
      })
    }
    items.sort((a, b) => b.relevanceScore - a.relevanceScore)

    return items
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[reranker] API 请求超时（30秒），降级为仅 embedding 检索')
    } else {
      console.error('[reranker] 调用失败，降级为仅 embedding 检索:', err)
    }
    return null
  } finally {
    clearTimeout(timeout)
  }
}
