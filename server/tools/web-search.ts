import { tool } from 'ai'
import { z } from 'zod'

const TAVILY_API_URL = 'https://api.tavily.com/search'

interface SearchResultItem {
  title: string
  url: string
  snippet: string
}

export async function searchWithTavily(query: string): Promise<SearchResultItem[]> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) {
    throw new Error('未配置 TAVILY_API_KEY')
  }

  const response = await fetch(TAVILY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      include_answer: false,
      max_results: 8
    })
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Tavily 请求失败 (${response.status}): ${errorText}`)
  }

  const data = await response.json()

  return (data.results || []).map((item: { title?: string; url?: string; content?: string }) => ({
    title: item.title || '',
    url: item.url || '',
    snippet: (item.content || '').slice(0, 300)
  }))
}

export const webSearchTool = tool({
  description:
    '搜索互联网获取实时信息。当用户问题涉及新闻、最新数据、当前事件、或任何可能随时间变化的信息时，必须调用此工具。即使你认为自己知道答案，也必须搜索以确认信息的时效性。不确定时，优先使用搜索工具。',
  parameters: z.object({
    query: z
      .string()
      .describe('搜索关键词，应简洁精准。例如："2025年高考政策变化" 或 "React 19 新特性"')
  }),
  execute: async ({ query }) => {
    try {
      const rawResults = await searchWithTavily(query)

      const maxResults = 8
      const results = rawResults.slice(0, maxResults).map((item, index) => ({
        index: index + 1,
        title: item.title,
        url: item.url,
        snippet: item.snippet.slice(0, 200)
      }))

      return {
        results,
        totalResults: results.length,
        query
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误'
      return {
        error: `搜索失败: ${errorMessage}`,
        results: [],
        totalResults: 0,
        query
      }
    }
  }
})
