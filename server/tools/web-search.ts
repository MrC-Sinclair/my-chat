import { tool } from 'ai'
import { z } from 'zod'

const BING_SEARCH_URL = 'https://cn.bing.com/search'

interface SearchResultItem {
  title: string
  url: string
  snippet: string
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ensp;/g, ' ')
    .replace(/&#\d+;/g, '')
}

export async function searchWithBing(query: string): Promise<SearchResultItem[]> {
  const url = `${BING_SEARCH_URL}?q=${encodeURIComponent(query)}`

  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  })

  if (!response.ok) {
    throw new Error(`Bing 请求失败 (${response.status})`)
  }

  const html = await response.text()
  const results: SearchResultItem[] = []

  const resultBlocks = html.split('<li class="b_algo"').slice(1)

  for (const block of resultBlocks) {
    try {
      const hrefMatch = block.match(/<a[^>]*href="([^"]*)"/)
      const titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)
      const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/)

      if (hrefMatch && titleMatch) {
        const title = decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, '')).trim()
        const rawUrl = hrefMatch[1]
        const snippet = snippetMatch
          ? decodeHtmlEntities(snippetMatch[1].replace(/<[^>]+>/g, ''))
              .trim()
              .slice(0, 300)
          : ''

        if (title && rawUrl.startsWith('http')) {
          results.push({ title, url: rawUrl, snippet })
        }
      }
    } catch {
      // skip
    }
  }

  return results
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
      const rawResults = await searchWithBing(query)

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
