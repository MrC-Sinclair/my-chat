/**
 * 消息辅助函数测试
 *
 * AI SDK v5 中消息结构从 content: string 变为 parts: Array<{type, text, ...}>
 * 测试从 parts 中提取内容的辅助函数：
 * - getMessageText：提取所有 text part 拼接
 * - getToolInvocations：提取所有 tool-* 和 dynamic-tool part，并归一化 toolName
 *   （v5 中静态工具 part 无 toolName 字段，需从 type=tool-xxx 提取）
 * - getReasoningContent：提取所有 reasoning part 的文本
 * - getVisibleToolInvocations：过滤出需要显示的工具调用
 */

// 直接从 ai-chat.vue 中提取函数逻辑进行测试，
// 因为这些函数定义在 <script setup> 中无法直接 import，
// 所以在测试中复制核心逻辑进行独立测试。

interface TextPart {
  type: 'text'
  text: string
}

interface ToolInvocationPart {
  type: string
  toolCallId: string
  // v5 中静态工具 part 没有 toolName 字段（工具名编码在 type 中：tool-xxx），
  // 动态工具（dynamic-tool）才有 toolName 字段
  toolName?: string
  input: Record<string, unknown>
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'
  output?: unknown
  errorText?: string
}

interface ReasoningPart {
  type: 'reasoning'
  text?: string
  reasoning?: string
}

type MessagePart = TextPart | ToolInvocationPart | ReasoningPart

interface UIMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  parts: MessagePart[]
}

/** 从 UIMessage 的 parts 数组中提取文本内容 */
function getMessageText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

/** 从消息中提取所有工具调用 part，并归一化 toolName 字段 */
function getToolInvocations(msg: UIMessage): ToolInvocationPart[] {
  if (!msg.parts || !Array.isArray(msg.parts)) return []
  return msg.parts
    .filter((p): p is ToolInvocationPart => p.type.startsWith('tool-') || p.type === 'dynamic-tool')
    .map((p) => {
      if (p.toolName) return p
      // 静态工具：从 type 中提取工具名（tool-webSearch → webSearch）
      const name = p.type.startsWith('tool-') ? p.type.slice(5) : ''
      return { ...p, toolName: name }
    })
}

/** 从消息中提取推理内容 */
function getReasoningContent(msg: UIMessage): string {
  if (msg.parts && Array.isArray(msg.parts)) {
    const reasoningParts = msg.parts.filter((p): p is ReasoningPart => p.type === 'reasoning')
    return reasoningParts.map((p) => p.text || p.reasoning || '').join('')
  }
  return ''
}

/** 过滤出需要显示的工具调用（排除不需要显示的） */
function getVisibleToolInvocations(msg: UIMessage, enableWebSearch: boolean): ToolInvocationPart[] {
  const all = getToolInvocations(msg)
  if (enableWebSearch) return all
  // 归一化后 toolName 一定存在
  return all.filter((inv) => inv.toolName !== 'webSearch')
}

import { describe, it, expect } from 'vitest'

describe('getMessageText', () => {
  it('纯文本消息 → 返回完整文本', () => {
    const msg: UIMessage = {
      id: '1',
      role: 'user',
      parts: [{ type: 'text', text: '你好世界' }]
    }
    expect(getMessageText(msg)).toBe('你好世界')
  })

  it('多个 text part → 拼接所有文本', () => {
    const msg: UIMessage = {
      id: '2',
      role: 'assistant',
      parts: [
        { type: 'text', text: '第一段' },
        { type: 'text', text: '第二段' }
      ]
    }
    expect(getMessageText(msg)).toBe('第一段第二段')
  })

  it('包含 text + tool part 的消息 → 只提取文本', () => {
    const msg: UIMessage = {
      id: '3',
      role: 'assistant',
      parts: [
        { type: 'text', text: '让我查一下天气' },
        {
          type: 'tool-weather',
          toolCallId: 'call-1',
          input: { city: '北京' },
          state: 'output-available'
        },
        { type: 'text', text: '北京今天晴' }
      ]
    }
    expect(getMessageText(msg)).toBe('让我查一下天气北京今天晴')
  })

  it('空消息 → 返回空字符串', () => {
    const msg: UIMessage = {
      id: '4',
      role: 'user',
      parts: []
    }
    expect(getMessageText(msg)).toBe('')
  })

  it('只有 tool part 的消息 → 返回空字符串', () => {
    const msg: UIMessage = {
      id: '5',
      role: 'assistant',
      parts: [
        {
          type: 'tool-webSearch',
          toolCallId: 'call-2',
          input: { query: 'test' },
          state: 'input-streaming'
        }
      ]
    }
    expect(getMessageText(msg)).toBe('')
  })

  it('只有 reasoning part 的消息 → 返回空字符串', () => {
    const msg: UIMessage = {
      id: '6',
      role: 'assistant',
      parts: [{ type: 'reasoning', text: '思考中...' }]
    }
    expect(getMessageText(msg)).toBe('')
  })
})

describe('getToolInvocations', () => {
  it('静态工具 part（tool-weather，无 toolName 字段）→ 归一化后 toolName 从 type 提取', () => {
    const msg: UIMessage = {
      id: '1',
      role: 'assistant',
      parts: [
        { type: 'text', text: '查询中' },
        {
          type: 'tool-weather',
          toolCallId: 'call-1',
          input: { city: '北京' },
          state: 'output-available'
        }
      ]
    }
    const tools = getToolInvocations(msg)
    expect(tools).toHaveLength(1)
    // 归一化：从 type='tool-weather' 提取出 toolName='weather'
    expect(tools[0].toolName).toBe('weather')
  })

  it('包含 dynamic-tool part → 正确提取（toolName 已存在，不覆盖）', () => {
    const msg: UIMessage = {
      id: '2',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'call-d1',
          toolName: 'customTool',
          input: {},
          state: 'input-available'
        }
      ]
    }
    const tools = getToolInvocations(msg)
    expect(tools).toHaveLength(1)
    expect(tools[0].toolName).toBe('customTool')
  })

  it('纯文本消息 → 返回空数组', () => {
    const msg: UIMessage = {
      id: '3',
      role: 'user',
      parts: [{ type: 'text', text: '你好' }]
    }
    expect(getToolInvocations(msg)).toHaveLength(0)
  })

  it('多个静态工具调用 → 全部提取并归一化 toolName', () => {
    const msg: UIMessage = {
      id: '4',
      role: 'assistant',
      parts: [
        {
          type: 'tool-weather',
          toolCallId: 'call-a',
          input: { city: '上海' },
          state: 'output-available'
        },
        { type: 'text', text: '中间文本' },
        {
          type: 'tool-webSearch',
          toolCallId: 'call-b',
          input: { query: 'test' },
          state: 'output-available'
        }
      ]
    }
    const tools = getToolInvocations(msg)
    expect(tools).toHaveLength(2)
    expect(tools[0].toolName).toBe('weather')
    expect(tools[1].toolName).toBe('webSearch')
  })

  it('空消息 → 返回空数组', () => {
    const msg: UIMessage = {
      id: '5',
      role: 'user',
      parts: []
    }
    expect(getToolInvocations(msg)).toHaveLength(0)
  })

  it('静态工具 part 保留原始字段（input/state/output 不丢失）', () => {
    const msg: UIMessage = {
      id: '6',
      role: 'assistant',
      parts: [
        {
          type: 'tool-weather',
          toolCallId: 'call-c',
          input: { city: '深圳' },
          state: 'output-available',
          output: { city: '深圳', current: { temperature: '30°C' } }
        }
      ]
    }
    const tools = getToolInvocations(msg)
    expect(tools).toHaveLength(1)
    expect(tools[0].toolName).toBe('weather')
    expect(tools[0].input).toEqual({ city: '深圳' })
    expect(tools[0].state).toBe('output-available')
    expect(tools[0].output).toEqual({ city: '深圳', current: { temperature: '30°C' } })
  })
})

describe('getReasoningContent', () => {
  it('包含 reasoning part → 返回推理文本', () => {
    const msg: UIMessage = {
      id: '1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: '首先分析问题...' },
        { type: 'text', text: '最终答案' }
      ]
    }
    expect(getReasoningContent(msg)).toBe('首先分析问题...')
  })

  it('多个 reasoning part → 拼接所有推理文本', () => {
    const msg: UIMessage = {
      id: '2',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: '第一步...' },
        { type: 'reasoning', text: '第二步...' },
        { type: 'text', text: '结论' }
      ]
    }
    expect(getReasoningContent(msg)).toBe('第一步...第二步...')
  })

  it('reasoning part 使用旧版 reasoning 字段 → 也能提取', () => {
    const msg: UIMessage = {
      id: '3',
      role: 'assistant',
      parts: [{ type: 'reasoning', reasoning: '旧版推理内容' } as ReasoningPart]
    }
    expect(getReasoningContent(msg)).toBe('旧版推理内容')
  })

  it('纯文本消息 → 返回空字符串', () => {
    const msg: UIMessage = {
      id: '4',
      role: 'user',
      parts: [{ type: 'text', text: '你好' }]
    }
    expect(getReasoningContent(msg)).toBe('')
  })

  it('空消息 → 返回空字符串', () => {
    const msg: UIMessage = {
      id: '5',
      role: 'assistant',
      parts: []
    }
    expect(getReasoningContent(msg)).toBe('')
  })
})

describe('getVisibleToolInvocations', () => {
  it('enableWebSearch 开启时 → 显示所有工具调用（含静态工具归一化）', () => {
    const msg: UIMessage = {
      id: '1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-weather',
          toolCallId: 'call-1',
          input: { city: '北京' },
          state: 'output-available'
        },
        {
          type: 'tool-webSearch',
          toolCallId: 'call-2',
          input: { query: 'test' },
          state: 'output-available'
        }
      ]
    }
    const visible = getVisibleToolInvocations(msg, true)
    expect(visible).toHaveLength(2)
  })

  it('enableWebSearch 关闭时 → 隐藏 webSearch 工具（静态工具无 toolName 也能正确过滤）', () => {
    const msg: UIMessage = {
      id: '2',
      role: 'assistant',
      parts: [
        {
          type: 'tool-weather',
          toolCallId: 'call-1',
          input: { city: '北京' },
          state: 'output-available'
        },
        {
          type: 'tool-webSearch',
          toolCallId: 'call-2',
          input: { query: 'test' },
          state: 'output-available'
        }
      ]
    }
    const visible = getVisibleToolInvocations(msg, false)
    expect(visible).toHaveLength(1)
    expect(visible[0].toolName).toBe('weather')
  })

  it('只有 webSearch 工具且开关关闭 → 返回空数组', () => {
    const msg: UIMessage = {
      id: '3',
      role: 'assistant',
      parts: [
        {
          type: 'tool-webSearch',
          toolCallId: 'call-1',
          input: { query: 'test' },
          state: 'output-available'
        }
      ]
    }
    const visible = getVisibleToolInvocations(msg, false)
    expect(visible).toHaveLength(0)
  })

  it('dynamic-tool 类型且 toolName 为 webSearch → 也被过滤', () => {
    const msg: UIMessage = {
      id: '4',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'call-d1',
          toolName: 'webSearch',
          input: {},
          state: 'input-available'
        }
      ]
    }
    const visible = getVisibleToolInvocations(msg, false)
    expect(visible).toHaveLength(0)
  })

  it('没有工具调用 → 返回空数组', () => {
    const msg: UIMessage = {
      id: '5',
      role: 'user',
      parts: [{ type: 'text', text: '你好' }]
    }
    const visible = getVisibleToolInvocations(msg, true)
    expect(visible).toHaveLength(0)
  })
})
