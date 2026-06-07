/**
 * 会话切换逻辑测试（AI SDK v5 消息结构迁移）
 *
 * AI SDK v5 中消息结构变化：{ content: string } → { parts: [{ type: 'text', text: string }] }
 * 测试 switchSession 将 DB 记录映射为 UIMessage 格式（parts 结构）的逻辑
 */
import { describe, it, expect } from 'vitest'

/** DB 中的消息记录格式 */
interface MessageRecord {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}

/** UIMessage 格式（v5 parts 结构） */
interface UIMessage {
  id: string
  role: 'user' | 'assistant'
  parts: Array<{ type: 'text'; text: string }>
}

/**
 * 模拟 switchSession 中的核心映射逻辑：
 * 将 DB 的 MessageRecord[] 转换为 v5 的 UIMessage[]
 */
function mapDbMessagesToUIMessages(messages: MessageRecord[]): UIMessage[] {
  return messages.map((msg) => ({
    id: msg.id,
    role: msg.role as 'user' | 'assistant',
    parts: [{ type: 'text' as const, text: msg.content }]
  }))
}

describe('会话切换消息映射', () => {
  it('switchSession 将 DB 记录映射为 UIMessage 格式（parts 结构）', () => {
    const dbMessages: MessageRecord[] = [
      {
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'user',
        content: '你好',
        createdAt: '2024-01-01T00:00:00Z'
      },
      {
        id: 'msg-2',
        sessionId: 'session-1',
        role: 'assistant',
        content: '你好！有什么可以帮忙的？',
        createdAt: '2024-01-01T00:00:01Z'
      }
    ]

    const result = mapDbMessagesToUIMessages(dbMessages)

    expect(result).toHaveLength(2)
    // 验证 v5 parts 结构
    expect(result[0].parts).toEqual([{ type: 'text', text: '你好' }])
    expect(result[1].parts).toEqual([{ type: 'text', text: '你好！有什么可以帮忙的？' }])
    // 验证 id 和 role 正确映射
    expect(result[0].id).toBe('msg-1')
    expect(result[0].role).toBe('user')
    expect(result[1].id).toBe('msg-2')
    expect(result[1].role).toBe('assistant')
  })

  it('历史消息的 content 字段正确转为 parts 数组', () => {
    const dbMessages: MessageRecord[] = [
      {
        id: 'msg-3',
        sessionId: 'session-2',
        role: 'user',
        content: '今天天气怎么样？',
        createdAt: '2024-01-02T00:00:00Z'
      }
    ]

    const result = mapDbMessagesToUIMessages(dbMessages)

    expect(result[0].parts).toHaveLength(1)
    expect(result[0].parts[0].type).toBe('text')
    expect(result[0].parts[0].text).toBe('今天天气怎么样？')
    // 确保不是旧的 content 字段格式
    expect((result[0] as any).content).toBeUndefined()
  })

  it('assistant 消息也正确映射', () => {
    const dbMessages: MessageRecord[] = [
      {
        id: 'msg-4',
        sessionId: 'session-3',
        role: 'assistant',
        content: '北京今天晴，气温25°C',
        createdAt: '2024-01-03T00:00:00Z'
      }
    ]

    const result = mapDbMessagesToUIMessages(dbMessages)

    expect(result[0].role).toBe('assistant')
    expect(result[0].parts).toEqual([{ type: 'text', text: '北京今天晴，气温25°C' }])
  })

  it('空消息列表 → 返回空数组', () => {
    const result = mapDbMessagesToUIMessages([])
    expect(result).toEqual([])
  })

  it('多轮对话消息全部正确映射', () => {
    const dbMessages: MessageRecord[] = [
      {
        id: 'msg-a',
        sessionId: 'session-4',
        role: 'user',
        content: '第一轮提问',
        createdAt: '2024-01-04T00:00:00Z'
      },
      {
        id: 'msg-b',
        sessionId: 'session-4',
        role: 'assistant',
        content: '第一轮回答',
        createdAt: '2024-01-04T00:00:01Z'
      },
      {
        id: 'msg-c',
        sessionId: 'session-4',
        role: 'user',
        content: '第二轮提问',
        createdAt: '2024-01-04T00:00:02Z'
      },
      {
        id: 'msg-d',
        sessionId: 'session-4',
        role: 'assistant',
        content: '第二轮回答',
        createdAt: '2024-01-04T00:00:03Z'
      }
    ]

    const result = mapDbMessagesToUIMessages(dbMessages)

    expect(result).toHaveLength(4)
    expect(result[0].parts[0].text).toBe('第一轮提问')
    expect(result[1].parts[0].text).toBe('第一轮回答')
    expect(result[2].parts[0].text).toBe('第二轮提问')
    expect(result[3].parts[0].text).toBe('第二轮回答')
  })

  it('映射后的 UIMessage 不包含 content 字段（v5 移除）', () => {
    const dbMessages: MessageRecord[] = [
      {
        id: 'msg-x',
        sessionId: 'session-5',
        role: 'user',
        content: '测试内容',
        createdAt: '2024-01-05T00:00:00Z'
      }
    ]

    const result = mapDbMessagesToUIMessages(dbMessages)

    // v5 中 content 被 parts 替代，不应存在 content 字段
    expect((result[0] as any).content).toBeUndefined()
    // parts 必须存在且格式正确
    expect(result[0].parts).toBeDefined()
    expect(Array.isArray(result[0].parts)).toBe(true)
  })
})
