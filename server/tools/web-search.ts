/**
 * @file 网页搜索工具 — DuckDuckGo HTML 搜索集成
 *
 * 本文件定义了 AI SDK 的网页搜索工具，供 streamText 调用。
 * 当 AI 判断需要获取最新信息时，会自动调用此工具搜索互联网。
 *
 * 使用场景：
 *   - 学生询问时效性问题（新闻、考试政策、最新科研进展）
 *   - 需要验证或补充课外知识
 *   - 查找学习资料和参考链接
 *
 * 技术方案：
 *   - 使用 DuckDuckGo HTML 搜索页面（https://html.duckduckgo.com/html/）
 *   - 通过原生 fetch + 正则解析搜索结果，无需任何 API Key
 *   - 完全免费、无需注册、无调用次数限制
 *
 * 为什么选择 DuckDuckGo：
 *   - 不需要 API Key（Tavily 需要，免费仅 1000 次/月）
 *   - 不需要额外注册账号
 *   - HTML 搜索页面稳定，解析简单
 *   - 支持中文搜索
 *
 * 注意事项：
 *   - DuckDuckGo HTML 页面并非官方 API，页面结构可能变化
 *   - 搜索结果数量有限（通常 20-30 条）
 *   - 如需更稳定的搜索服务，可替换为 Tavily 或 SearXNG
 */

import { tool } from 'ai'
import { z } from 'zod'

/** DuckDuckGo HTML 搜索端点 */
const DUCKDUCKGO_HTML_URL = 'https://html.duckduckgo.com/html/'

/**
 * 搜索结果条目的类型定义
 */
interface SearchResultItem {
  title: string
  url: string
  snippet: string
}

/**
 * 调用 DuckDuckGo HTML 搜索页面执行网页搜索
 *
 * DuckDuckGo 提供了一个纯 HTML 版本的搜索页面，
 * 我们通过 POST 请求获取搜索结果页面，然后用正则解析出标题、链接和摘要。
 *
 * @param query - 搜索关键词
 * @returns 搜索结果列表
 *
 * 解析策略：
 *   DuckDuckGo HTML 页面的搜索结果结构为：
 *   <div class="result__body">
 *     <a class="result__a" href="//duckduckgo.com/l/?uddg=编码URL">标题</a>
 *     <a class="result__snippet" href="...">摘要文本</a>
 *   </div>
 *
 *   我们通过正则匹配这些 class 来提取信息。
 */
async function searchWithDuckDuckGo(query: string): Promise<SearchResultItem[]> {
  const params = new URLSearchParams({
    q: query,
    kl: 'cn-zh'
  })

  const response = await fetch(DUCKDUCKGO_HTML_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    body: params.toString()
  })

  if (!response.ok) {
    throw new Error(`DuckDuckGo 请求失败 (${response.status})`)
  }

  const html = await response.text()

  /**
   * 解析搜索结果
   *
   * 使用正则从 HTML 中提取搜索结果。
   * 每个 result__body 块包含一个标题链接和一个摘要。
   *
   * 正则说明：
   *   - result__a 匹配标题链接，uddg 参数包含真实的跳转 URL
   *   - result__snippet 匹配摘要文本
   *   - URL 经过 decodeURIComponent 还原为可读地址
   */
  const results: SearchResultItem[] = []

  // 匹配所有搜索结果块
  const resultBlocks = html.split('class="result__body"').slice(1)

  for (const block of resultBlocks) {
    try {
      // 提取标题
      const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/)
      // 提取真实 URL（DuckDuckGo 使用跳转链接，uddg 参数包含原始 URL）
      const urlMatch = block.match(/uddg=([^&"]+)/)
      // 提取摘要
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)

      if (titleMatch && urlMatch) {
        const title = titleMatch[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .trim()

        const url = decodeURIComponent(urlMatch[1])

        const snippet = snippetMatch
          ? snippetMatch[1]
              .replace(/<[^>]+>/g, '')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .trim()
          : ''

        // 过滤无效结果（空标题或非 http 链接）
        if (title && url.startsWith('http')) {
          results.push({ title, url, snippet })
        }
      }
    } catch {
      // 单条结果解析失败不影响整体，跳过即可
    }
  }

  return results
}

/**
 * 网页搜索工具定义
 *
 * 使用 AI SDK 的 tool() 函数创建，供 streamText 的 tools 参数使用。
 * 当 LLM 判断需要搜索互联网时，会自动生成工具调用请求，
 * AI SDK 框架会执行 execute 函数并将结果返回给模型。
 *
 * 工作流程：
 *   1. 用户提问 → LLM 判断需要搜索
 *   2. LLM 生成工具调用：{ query: "搜索关键词" }
 *   3. AI SDK 执行 execute 函数，调用 DuckDuckGo 搜索
 *   4. 搜索结果返回给 LLM
 *   5. LLM 基于搜索结果生成最终回答
 *
 * 无需任何 API Key，完全免费使用。
 */
export const webSearchTool = tool({
  /**
   * description — 工具描述，告诉 LLM 这个工具是干什么的
   *
   * LLM 会根据这段描述判断是否需要调用此工具。
   * 描述越清晰，LLM 越能准确判断何时该调用。
   * 这段文字不会展示给用户，只给 LLM 看。
   */
  description:
    '搜索互联网获取最新信息。当需要查找时事新闻、最新数据、课外资料、或验证不确定的知识时使用此工具。',

  /**
   * parameters — 工具参数定义，告诉 LLM 调用此工具需要传什么参数
   *
   * 使用 Zod schema 定义参数的结构和类型。
   * LLM 会根据 schema 生成符合格式的参数值。
   *
   * z.string().describe(...) 中的 describe 很重要：
   *   它告诉 LLM 这个参数应该填什么内容，帮助 LLM 生成更准确的参数值。
   *
   * 例如：当用户问"高考政策变化"时，LLM 会根据 describe 的提示，
   *   生成 { query: "2024年高考政策变化" } 而不是过于宽泛或狭窄的关键词。
   */
  parameters: z.object({
    query: z
      .string()
      .describe(
        '搜索关键词，应简洁精准。例如："2024年高考数学压轴题" 或 "量子纠缠 基本原理"'
      )
  }),

  /**
   * execute — 工具的执行函数，当 LLM 决定调用此工具时，AI SDK 会执行这个函数
   *
   * 参数来自 LLM 生成的工具调用请求（即 parameters 中定义的 query）
   * 返回值会作为工具结果返回给 LLM，LLM 据此生成最终回答
   *
   * 执行流程：
   *   1. LLM 生成 { query: "2024年高考政策变化" }
   *   2. AI SDK 调用 execute({ query: "2024年高考政策变化" })
   *   3. execute 调用 DuckDuckGo 搜索，返回搜索结果
   *   4. LLM 拿到搜索结果，生成自然语言回答
   */
  execute: async ({ query }) => {
    try {
      const rawResults = await searchWithDuckDuckGo(query)

      // 限制返回结果数量，避免信息过多影响 LLM 判断
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
