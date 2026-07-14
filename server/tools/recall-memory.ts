/**
 * @file recall-memory 工具 — 检索跨会话长期记忆
 *
 * 设计要点（详见 openspec/changes/add-long-term-memory/design.md 决策 4/8/12）：
 *   - Agentic RAG 路径 A：作为 Agent 工具，由 LLM 自主决定调用时机
 *   - 两阶段检索：embedding 召回 top-20 → reranker 精排 top-5
 *   - reranker 失败降级为仅 embedding 检索（score 用 1 - distance/2 映射到 0-1）
 *   - reranker 阈值 0.3，低于阈值视为无相关记忆
 *   - 错误返回不抛异常，遵循项目工具错误返回模式
 */

import { tool } from 'ai'
import { z } from 'zod'
import { cosineDistance, desc, sql } from 'drizzle-orm'
import { db } from '~/server/db'
import { memoryVectors } from '~/server/db/schema'
import { generateEmbedding } from '~/server/utils/embedding'
import { rerankDocuments } from '~/server/utils/reranker'

/** 召回阶段：embedding 余弦距离检索的 top-K（全部传给 reranker 精排，召回阶段不做阈值过滤） */
const RECALL_TOP_K = 20

/** 精排阶段：reranker 返回的 top-N */
const RERANK_TOP_N = 5

/** reranker 相关度阈值，低于此值视为无相关记忆（design.md 决策 12，可根据实测调整） */
const RERANK_THRESHOLD = 0.3

/**
 * recall-memory 工具：检索跨会话的长期历史记忆
 *
 * 调用场景（何时调用）：
 *   - 用户问题涉及过去会话中讨论过的内容、历史偏好、之前的技术决策
 *   - 典型触发词：「之前」「上次」「历史」「过去」「以前说过」「之前讨论的」「我记得」
 *
 * 禁止场景（何时不调用）：
 *   - 当前会话内已讨论的内容（已在上下文中，无需检索）
 *   - 纯知识问答（如「什么是 React」）
 *   - 简单计算或事实查询（如「1+1」「中国首都」）
 */
export const recallMemoryTool = tool({
  description: `检索跨会话的长期历史记忆。当用户问题涉及过去会话中讨论过的内容、历史偏好、之前的技术决策、以前提过的项目背景时调用此工具。典型触发关键词：「之前」「上次」「历史」「过去」「以前说过」「之前讨论的」「我记得」等。调用后基于检索结果回答，可引用来源（如「根据你之前提到的…」）。

不要在以下场景调用：
- 当前会话内已经讨论过的内容（当前会话的消息已在上下文中，无需检索）
- 纯知识问答（如「什么是 React」「解释 SSRF」）
- 简单计算或事实查询（如「1+1」「中国的首都」）
- 用户未提及任何历史相关线索的常规问题`,
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        '检索查询文本，应提炼用户问题中需要回忆历史记忆的核心部分。例如：用户问「我上次问的 SSRF 防护方案是什么」时，query 可为「SSRF 防护方案」'
      )
  }),
  execute: async ({ query }) => {
    try {
      // 1. query 转 embedding 向量
      //    EmbeddingResult 是判别联合：成功分支有 embedding，失败分支有 detail
      //    用 'detail' in embedResult 作为类型守卫收窄到失败分支
      const embedResult = await generateEmbedding(query)
      if ('detail' in embedResult) {
        return {
          error: '记忆检索失败：embedding 服务不可用',
          detail: embedResult.detail,
          memories: [],
          query
        }
      }

      const queryVector = embedResult.embedding

      // 2. embedding 召回：cosineDistance 检索 top-20
      //    cosineDistance 返回余弦距离（0=最相似，2=最不相似）
      //    similarity = 1 - distance（范围 -1 到 1，1=最相似）用于排序
      //    召回阶段不做阈值过滤，top-20 全部传给 reranker 精排
      const similarity = sql<number>`1 - (${cosineDistance(
        memoryVectors.embedding,
        queryVector
      )})`

      const recallResults = await db
        .select({
          content: memoryVectors.content,
          messageId: memoryVectors.messageId,
          sessionId: memoryVectors.sessionId,
          role: memoryVectors.role,
          createdAt: memoryVectors.createdAt,
          // 原始余弦距离，降级时用于映射 score（1 - distance/2）
          distance: sql<number>`${cosineDistance(memoryVectors.embedding, queryVector)}`
        })
        .from(memoryVectors)
        .orderBy(desc(similarity))
        .limit(RECALL_TOP_K)

      // 3. 空结果处理
      if (recallResults.length === 0) {
        return {
          memories: [],
          message: '未找到相关历史记忆',
          query
        }
      }

      // 4. reranker 精排：top-20 → top-5
      const documents = recallResults.map((r) => r.content)
      const rerankResult = await rerankDocuments(query, documents, RERANK_TOP_N)

      if (rerankResult && rerankResult.length > 0) {
        // reranker 成功：按 relevance_score 过滤阈值 + 映射结果
        const memories = []
        for (const item of rerankResult) {
          if (item.relevanceScore < RERANK_THRESHOLD) continue
          // 防御性边界检查：index 应在 recallResults 范围内
          const original = recallResults[item.index]
          if (!original) continue
          memories.push({
            content: original.content,
            message_id: original.messageId,
            session_id: original.sessionId,
            role: original.role,
            score: item.relevanceScore
          })
        }

        if (memories.length === 0) {
          // reranker 有返回但全部低于阈值，视为无相关记忆
          return {
            memories: [],
            message: '未找到相关历史记忆',
            query
          }
        }

        return {
          memories,
          totalResults: memories.length,
          query
        }
      }

      // 5. reranker 失败降级：取 embedding 召回的 top-5
      //    score 用 1 - distance/2 映射到 0-1 区间（1=最相似，0=最不相似）
      //    降级时不设阈值过滤，仅做数量截断（design.md 决策 12）
      const fallbackMemories = recallResults.slice(0, RERANK_TOP_N).map((r) => ({
        content: r.content,
        message_id: r.messageId,
        session_id: r.sessionId,
        role: r.role,
        score: 1 - r.distance / 2
      }))

      return {
        memories: fallbackMemories,
        totalResults: fallbackMemories.length,
        query,
        warning: 'reranker 服务不可用，降级为仅 embedding 检索'
      }
    } catch (error) {
      // 与项目其他工具一致：不抛异常，返回结构化错误对象让 LLM 处理
      const detail = error instanceof Error ? error.message : String(error)
      return {
        error: '记忆检索失败',
        detail,
        memories: [],
        query
      }
    }
  }
})
