/**
 * recall-memory 工具 E2E 测试
 *
 * 覆盖场景：
 * - recall-memory 工具调用流式渲染（loading → result 4 种状态）
 *   * 成功有结果：已检索 N 条相关记忆 + 记忆预览
 *   * 空结果：未找到相关历史记忆
 *   * 错误状态：error 文案展示
 *   * 降级模式：warning 标签 + 降级模式提示
 * - 纯文本对话不应出现 recall-memory 工具调用
 *
 * 使用 mock API 消除 LLM 不确定性。recall-memory 默认启用（caps.toolCalling=true），
 * 无前端 toggle 开关，无需像 OCR 测试那样点击启用按钮。
 *
 * LLM 自主调用 case 作为可选冒烟测试，核心链路通过 mock 工具调用流覆盖。
 */
import { test, expect } from '@playwright/test'
import {
  sseChunk,
  buildTextStream,
  mockChatAPI,
  typeAndSubmit,
  waitForResponse,
  waitForAssistantMessage
} from './helpers/mock-chat'

test.setTimeout(120000)

test.describe.configure({ mode: 'serial', retries: 1 })

// ==================== 本地 stream 构建函数 ====================
// 仅在本测试文件使用，不放入 helpers/mock-chat.ts（遵循"不为一次性操作创建全局辅助"原则）

/** 构造 recall-memory 工具调用的 SSE 流 */
function buildRecallMemoryStream(options: {
  toolCallId: string
  query: string
  output: Record<string, unknown>
  answerText: string
}): string {
  const { toolCallId, query, output, answerText } = options
  const chunks: string[] = []
  chunks.push(sseChunk({ type: 'start' }))
  chunks.push(sseChunk({ type: 'start-step' }))

  chunks.push(sseChunk({ type: 'tool-input-start', toolCallId, toolName: 'recallMemory' }))
  const inputJson = JSON.stringify({ query })
  chunks.push(sseChunk({ type: 'tool-input-delta', toolCallId, inputTextDelta: inputJson.slice(0, 5) }))
  chunks.push(sseChunk({ type: 'tool-input-delta', toolCallId, inputTextDelta: inputJson.slice(5) }))
  chunks.push(
    sseChunk({
      type: 'tool-input-available',
      toolCallId,
      toolName: 'recallMemory',
      input: { query }
    })
  )
  chunks.push(sseChunk({ type: 'tool-output-available', toolCallId, output }))

  // 工具调用后的文本回复（按 5 字符切片模拟真实流式）
  const textId = 'txt-1'
  chunks.push(sseChunk({ type: 'text-start', id: textId }))
  for (let i = 0; i < answerText.length; i += 5) {
    chunks.push(sseChunk({ type: 'text-delta', id: textId, delta: answerText.slice(i, i + 5) }))
  }
  chunks.push(sseChunk({ type: 'text-end', id: textId }))

  chunks.push(sseChunk({ type: 'finish-step' }))
  chunks.push(sseChunk({ type: 'finish', finishReason: 'stop' }))
  chunks.push('data: [DONE]\n\n')
  return chunks.join('')
}

/** 成功有结果 */
function buildRecallMemoryToolStream(): string {
  return buildRecallMemoryStream({
    toolCallId: 'call-recall-1',
    query: '之前讨论的技术方案',
    output: {
      memories: [
        {
          message_id: 'm1',
          session_id: 's1',
          content: '我们上次讨论了使用 pgvector 做向量检索的技术方案',
          role: 'user',
          score: 0.92
        },
        {
          message_id: 'm2',
          session_id: 's1',
          content: '是的，pgvector 配合 HNSW 索引性能不错，reranker 精排可以进一步提升准确性',
          role: 'assistant',
          score: 0.85
        }
      ],
      message: '已检索到 2 条相关记忆'
    },
    answerText: '根据你之前提到的内容，我们讨论过使用 pgvector 做向量检索的方案。'
  })
}

/** 空结果 */
function buildRecallMemoryEmptyStream(): string {
  return buildRecallMemoryStream({
    toolCallId: 'call-recall-empty',
    query: '昨天聊了什么',
    output: {
      memories: [],
      message: '未找到相关历史记忆'
    },
    answerText: '没有找到相关的历史记忆，请问你想了解什么？'
  })
}

/** 错误状态 */
function buildRecallMemoryErrorStream(): string {
  return buildRecallMemoryStream({
    toolCallId: 'call-recall-err',
    query: '以前说过的项目',
    output: {
      error: '记忆检索失败',
      detail: 'embedding 服务不可用'
    },
    answerText: '抱歉，历史记忆检索暂时不可用，请稍后重试。'
  })
}

/** 降级模式（warning 字段） */
function buildRecallMemoryFallbackStream(): string {
  return buildRecallMemoryStream({
    toolCallId: 'call-recall-fb',
    query: '上次提到的方案',
    output: {
      memories: [
        {
          message_id: 'm1',
          session_id: 's1',
          content: '之前讨论过用 reranker 做精排',
          role: 'user',
          score: 0.6
        }
      ],
      message: '已检索到 1 条相关记忆',
      warning: 'reranker 服务不可用，已降级为仅 embedding 检索'
    },
    answerText: '根据历史记忆，你之前提到过用 reranker 做精排。'
  })
}

test.describe('recall-memory 工具', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ai-chat', { waitUntil: 'networkidle' })
  })

  // ================================================================
  // 工具调用流式渲染：4 种状态
  // ================================================================
  test.describe('工具调用流', () => {
    test('应显示 loading → 成功结果完整流程', async ({ page }) => {
      await mockChatAPI(page, buildRecallMemoryToolStream(), 80)

      await typeAndSubmit(page, '之前讨论的技术方案')

      // 等待 loading 出现（"正在回忆历史记忆..."）
      await expect(page.locator('text=正在回忆历史记忆')).toBeVisible({ timeout: 15000 })

      // 等待结果出现（"已检索 2 条相关记忆"）
      await expect(page.locator('text=已检索 2 条相关记忆')).toBeVisible({ timeout: 30000 })

      // 验证记忆预览内容
      await expect(page.locator('text=pgvector 做向量检索的技术方案').first()).toBeVisible({
        timeout: 5000
      })

      // 验证相关度百分比显示（92%）
      await expect(page.locator('text=相关度 92%').first()).toBeVisible({ timeout: 5000 })

      // 等待 AI 回复完成
      await waitForResponse(page, 60000)
    })

    test('应显示空结果状态', async ({ page }) => {
      await mockChatAPI(page, buildRecallMemoryEmptyStream(), 80)

      await typeAndSubmit(page, '昨天聊了什么')

      // 等待 loading
      await expect(page.locator('text=正在回忆历史记忆')).toBeVisible({ timeout: 15000 })

      // 等待空结果文案
      await expect(page.locator('text=未找到相关历史记忆')).toBeVisible({ timeout: 30000 })

      await waitForResponse(page, 60000)
    })

    test('应显示错误状态', async ({ page }) => {
      await mockChatAPI(page, buildRecallMemoryErrorStream(), 80)

      await typeAndSubmit(page, '以前说过的项目')

      // 等待 loading
      await expect(page.locator('text=正在回忆历史记忆')).toBeVisible({ timeout: 15000 })

      // 等待错误文案出现
      await expect(page.locator('text=记忆检索失败')).toBeVisible({ timeout: 30000 })

      // 验证错误详情显示
      await expect(page.locator('text=embedding 服务不可用').first()).toBeVisible({
        timeout: 5000
      })

      await waitForResponse(page, 60000)
    })

    test('应显示降级模式标签', async ({ page }) => {
      await mockChatAPI(page, buildRecallMemoryFallbackStream(), 80)

      await typeAndSubmit(page, '上次提到的方案')

      // 等待 loading
      await expect(page.locator('text=正在回忆历史记忆')).toBeVisible({ timeout: 15000 })

      // 等待结果出现
      await expect(page.locator('text=已检索 1 条相关记忆')).toBeVisible({ timeout: 30000 })

      // 验证降级模式标签显示
      await expect(page.locator('text=降级模式')).toBeVisible({ timeout: 5000 })

      await waitForResponse(page, 60000)
    })
  })

  // ================================================================
  // 纯文本对话不应触发 recall-memory
  // ================================================================
  test.describe('纯文本对话', () => {
    test('不应出现 recall-memory 工具调用', async ({ page }) => {
      // mock 返回纯文本流（无工具调用事件）
      await mockChatAPI(page, buildTextStream('这是纯文本回复'), 80)

      await typeAndSubmit(page, '你好')

      // 等待 AI 回复
      await waitForAssistantMessage(page, 30000)
      await waitForResponse(page, 60000)

      // 不应出现 recall-memory 工具相关 UI
      await expect(page.locator('text=正在回忆历史记忆')).toHaveCount(0)
      await expect(page.locator('text=已检索')).toHaveCount(0)
      await expect(page.locator('text=未找到相关历史记忆')).toHaveCount(0)
    })
  })
})
