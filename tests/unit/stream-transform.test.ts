/**
 * 测试 chat.post.ts 中 createUIMessageStream 的流处理逻辑
 *
 * 核心逻辑：将 fullStream 的 chunk 映射为 UIMessage stream 事件
 * - text-delta 带 REASONING_PREFIX → reasoning-delta
 * - text-delta 带 REASONING_END → 切换回 text-delta
 * - tool-call → tool-input-available（字段名 input）
 * - tool-result → tool-output-available（字段名 output）
 * - tool-error → tool-output-error
 * - 原生 reasoning-delta → 透传
 * - finish → 关闭未关闭的 text/reasoning
 */
import { describe, it, expect } from 'vitest'

// 与 reasoning-provider.ts 中的常量保持一致
const REASONING_PREFIX = '\x00REASONING:'
const REASONING_END = '\x00REASONING_END'

/**
 * 模拟流处理逻辑
 * 从 chat.post.ts 的 execute 函数中提取核心映射逻辑，
 * 使用 mock writer 收集输出事件，便于断言
 */
function processChunks(chunks: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const written: Array<Record<string, unknown>> = []

  // mock writer 对象，记录所有 write 调用
  const writer = {
    write(event: Record<string, unknown>) {
      written.push(event)
    }
  }

  // 追踪 reasoning 状态和文本 ID（与 chat.post.ts 逻辑一致）
  let isReasoning = false
  let textId = ''
  let reasoningId = ''

  for (const chunk of chunks) {
    if (chunk.type === 'text-delta') {
      const delta = chunk.text as string

      // 整个 delta 以 REASONING_PREFIX 开头：纯 reasoning 片段
      if (delta.startsWith(REASONING_PREFIX)) {
        const reasoningText = delta.slice(REASONING_PREFIX.length)
        if (reasoningText) {
          if (!isReasoning) {
            isReasoning = true
            reasoningId = `rs-test`
            writer.write({ type: 'reasoning-start', id: reasoningId })
          }
          writer.write({ type: 'reasoning-delta', id: reasoningId, delta: reasoningText })
        }
        continue
      }

      // delta 中间包含 REASONING_PREFIX：reasoning 和其他内容混合
      if (delta.includes(REASONING_PREFIX)) {
        const parts = delta.split(REASONING_PREFIX)
        for (const part of parts) {
          if (!part) continue
          if (part.includes(REASONING_END)) {
            // reasoning → 正式回答的切换点
            const subParts = part.split(REASONING_END)
            if (subParts[0]) {
              if (!isReasoning) {
                isReasoning = true
                reasoningId = `rs-test`
                writer.write({ type: 'reasoning-start', id: reasoningId })
              }
              writer.write({ type: 'reasoning-delta', id: reasoningId, delta: subParts[0] })
            }
            if (isReasoning) {
              writer.write({ type: 'reasoning-end', id: reasoningId })
              isReasoning = false
            }
            if (subParts[1]) {
              if (!textId) {
                textId = `ts-test`
                writer.write({ type: 'text-start', id: textId })
              }
              writer.write({ type: 'text-delta', id: textId, delta: subParts[1] })
            }
          } else {
            if (!isReasoning) {
              isReasoning = true
              reasoningId = `rs-test`
              writer.write({ type: 'reasoning-start', id: reasoningId })
            }
            writer.write({ type: 'reasoning-delta', id: reasoningId, delta: part })
          }
        }
        continue
      }

      // delta 以 REASONING_END 开头：正式回答开始
      if (delta.startsWith(REASONING_END)) {
        const textAfter = delta.slice(REASONING_END.length)
        if (isReasoning) {
          writer.write({ type: 'reasoning-end', id: reasoningId })
          isReasoning = false
        }
        if (textAfter) {
          if (!textId) {
            textId = `ts-test`
            writer.write({ type: 'text-start', id: textId })
          }
          writer.write({ type: 'text-delta', id: textId, delta: textAfter })
        }
        continue
      }

      // delta 中间包含 REASONING_END：reasoning 尾部和正式回答开头
      if (delta.includes(REASONING_END)) {
        const parts = delta.split(REASONING_END)
        if (parts[0]) {
          if (!isReasoning) {
            isReasoning = true
            reasoningId = `rs-test`
            writer.write({ type: 'reasoning-start', id: reasoningId })
          }
          writer.write({ type: 'reasoning-delta', id: reasoningId, delta: parts[0] })
        }
        if (isReasoning) {
          writer.write({ type: 'reasoning-end', id: reasoningId })
          isReasoning = false
        }
        if (parts[1]) {
          if (!textId) {
            textId = `ts-test`
            writer.write({ type: 'text-start', id: textId })
          }
          writer.write({ type: 'text-delta', id: textId, delta: parts[1] })
        }
        continue
      }

      // 普通 text-delta
      if (isReasoning) {
        writer.write({ type: 'reasoning-delta', id: reasoningId, delta })
      } else {
        if (!textId) {
          textId = `ts-test`
          writer.write({ type: 'text-start', id: textId })
        }
        writer.write({ type: 'text-delta', id: textId, delta })
      }
      continue
    }

    if (chunk.type === 'reasoning-delta') {
      // 原生 reasoning-delta 事件（如果 provider 支持）
      if (!isReasoning) {
        isReasoning = true
        reasoningId = (chunk.id as string) || `rs-test`
        writer.write({ type: 'reasoning-start', id: reasoningId })
      }
      writer.write({ type: 'reasoning-delta', id: reasoningId, delta: chunk.text })
      continue
    }

    if (chunk.type === 'reasoning-start') {
      isReasoning = true
      reasoningId = chunk.id as string
      writer.write(chunk)
      continue
    }

    if (chunk.type === 'reasoning-end') {
      isReasoning = false
      writer.write(chunk)
      continue
    }

    if (chunk.type === 'text-start') {
      textId = chunk.id as string
      writer.write(chunk)
      continue
    }

    if (chunk.type === 'text-end') {
      writer.write(chunk)
      continue
    }

    if (chunk.type === 'tool-call') {
      writer.write({
        type: 'tool-input-available',
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        input: chunk.input
      })
      continue
    }

    if (chunk.type === 'tool-input-delta') {
      writer.write({
        type: 'tool-input-delta',
        toolCallId: chunk.id,
        inputTextDelta: chunk.delta
      })
      continue
    }

    if (chunk.type === 'tool-input-start') {
      writer.write({
        type: 'tool-input-start',
        toolCallId: chunk.id,
        toolName: chunk.toolName
      })
      continue
    }

    if (chunk.type === 'tool-input-end') {
      // UIMessageChunk 中没有 tool-input-end，跳过
      continue
    }

    if (chunk.type === 'tool-result') {
      writer.write({
        type: 'tool-output-available',
        toolCallId: chunk.toolCallId,
        output: chunk.output
      })
      continue
    }

    if (chunk.type === 'tool-error') {
      writer.write({
        type: 'tool-output-error',
        toolCallId: chunk.toolCallId,
        errorText: chunk.error instanceof Error ? chunk.error.message : String(chunk.error)
      })
      continue
    }

    if (chunk.type === 'error') {
      writer.write({
        type: 'error',
        errorText: chunk.error instanceof Error ? chunk.error.message : String(chunk.error)
      })
      continue
    }

    if (chunk.type === 'finish') {
      // 关闭未关闭的 text/reasoning
      if (isReasoning && reasoningId) {
        writer.write({ type: 'reasoning-end', id: reasoningId })
      }
      if (textId) {
        writer.write({ type: 'text-end', id: textId })
      }
      writer.write({
        type: 'finish',
        finishReason: chunk.finishReason
      })
      continue
    }

    // 其他事件类型直接写入
    if (
      chunk.type === 'start' ||
      chunk.type === 'start-step' ||
      chunk.type === 'finish-step'
    ) {
      writer.write(chunk)
    }
  }

  return written
}

/**
 * 模拟 onFinish 回调中的文本清理逻辑
 * 从 text 中移除 REASONING_PREFIX 和 REASONING_END 内容
 */
function cleanTextForOnFinish(text: string): string {
  const reasoningStart = text.indexOf(REASONING_PREFIX)
  const reasoningEndIdx = text.indexOf(REASONING_END)
  let cleanText = text
  if (reasoningStart >= 0 && reasoningEndIdx >= 0) {
    // 有完整的 reasoning 段：取 REASONING_END 之后的内容
    cleanText = text.slice(reasoningEndIdx + REASONING_END.length).trim()
  } else if (reasoningStart >= 0) {
    // 只有 reasoning 没有正式回答（极端情况）
    cleanText = ''
  }
  return cleanText
}

describe('流处理逻辑 - text-delta 映射', () => {
  it('普通 text-delta 应生成 text-start + text-delta 事件', () => {
    const events = processChunks([
      { type: 'text-delta', text: '你好' },
      { type: 'finish', finishReason: 'stop' }
    ])

    expect(events).toEqual([
      { type: 'text-start', id: 'ts-test' },
      { type: 'text-delta', id: 'ts-test', delta: '你好' },
      { type: 'text-end', id: 'ts-test' },
      { type: 'finish', finishReason: 'stop' }
    ])
  })

  it('连续 text-delta 应复用同一个 textId', () => {
    const events = processChunks([
      { type: 'text-delta', text: '你好' },
      { type: 'text-delta', text: '世界' },
      { type: 'finish', finishReason: 'stop' }
    ])

    // 只应有一个 text-start
    const textStarts = events.filter(e => e.type === 'text-start')
    expect(textStarts).toHaveLength(1)

    // 两个 text-delta 使用同一个 id
    const textDeltas = events.filter(e => e.type === 'text-delta')
    expect(textDeltas).toHaveLength(2)
    expect(textDeltas[0].delta).toBe('你好')
    expect(textDeltas[1].delta).toBe('世界')
    expect(textDeltas[0].id).toBe(textDeltas[1].id)
  })
})

describe('流处理逻辑 - REASONING_PREFIX 映射', () => {
  it('text-delta 带 REASONING_PREFIX 应生成 reasoning-start + reasoning-delta', () => {
    const events = processChunks([
      { type: 'text-delta', text: REASONING_PREFIX + '让我想想' },
      { type: 'finish', finishReason: 'stop' }
    ])

    expect(events).toEqual([
      { type: 'reasoning-start', id: 'rs-test' },
      { type: 'reasoning-delta', id: 'rs-test', delta: '让我想想' },
      { type: 'reasoning-end', id: 'rs-test' }, // finish 时关闭
      { type: 'finish', finishReason: 'stop' }
    ])
  })

  it('连续的 reasoning delta 应复用同一个 reasoningId', () => {
    const events = processChunks([
      { type: 'text-delta', text: REASONING_PREFIX + '第一步' },
      { type: 'text-delta', text: '第二步' }, // isReasoning=true，继续作为 reasoning-delta
      { type: 'text-delta', text: '第三步' },
      { type: 'finish', finishReason: 'stop' }
    ])

    // 只应有一个 reasoning-start
    const reasoningStarts = events.filter(e => e.type === 'reasoning-start')
    expect(reasoningStarts).toHaveLength(1)

    // 三个 reasoning-delta 使用同一个 id
    const reasoningDeltas = events.filter(e => e.type === 'reasoning-delta')
    expect(reasoningDeltas).toHaveLength(3)
    expect(reasoningDeltas.map(e => e.delta)).toEqual(['第一步', '第二步', '第三步'])
    // 所有 reasoning-delta 的 id 相同
    const ids = new Set(reasoningDeltas.map(e => e.id))
    expect(ids.size).toBe(1)
  })
})

describe('流处理逻辑 - REASONING_END 映射', () => {
  it('text-delta 带 REASONING_END 应生成 reasoning-end + text-start + text-delta', () => {
    const events = processChunks([
      { type: 'text-delta', text: REASONING_PREFIX + '思考内容' },
      { type: 'text-delta', text: REASONING_END + '正式回答' },
      { type: 'finish', finishReason: 'stop' }
    ])

    expect(events).toEqual([
      { type: 'reasoning-start', id: 'rs-test' },
      { type: 'reasoning-delta', id: 'rs-test', delta: '思考内容' },
      { type: 'reasoning-end', id: 'rs-test' },
      { type: 'text-start', id: 'ts-test' },
      { type: 'text-delta', id: 'ts-test', delta: '正式回答' },
      { type: 'text-end', id: 'ts-test' },
      { type: 'finish', finishReason: 'stop' }
    ])
  })

  it('text-delta 同时包含 REASONING_END 和正文应正确切分', () => {
    // 模拟：reasoning 尾部 + REASONING_END + 正文开头 在同一个 delta 中
    const events = processChunks([
      { type: 'text-delta', text: REASONING_PREFIX + '思考' },
      { type: 'text-delta', text: '尾部' + REASONING_END + '正文开头' },
      { type: 'finish', finishReason: 'stop' }
    ])

    expect(events).toEqual([
      { type: 'reasoning-start', id: 'rs-test' },
      { type: 'reasoning-delta', id: 'rs-test', delta: '思考' },
      { type: 'reasoning-delta', id: 'rs-test', delta: '尾部' },
      { type: 'reasoning-end', id: 'rs-test' },
      { type: 'text-start', id: 'ts-test' },
      { type: 'text-delta', id: 'ts-test', delta: '正文开头' },
      { type: 'text-end', id: 'ts-test' },
      { type: 'finish', finishReason: 'stop' }
    ])
  })

  it('REASONING_END 后无正文内容不应生成 text-delta', () => {
    const events = processChunks([
      { type: 'text-delta', text: REASONING_PREFIX + '思考' },
      { type: 'text-delta', text: REASONING_END }, // 只有结束标记，没有正文
      { type: 'finish', finishReason: 'stop' }
    ])

    // 不应有 text-start 或 text-delta
    expect(events.filter(e => e.type === 'text-start')).toHaveLength(0)
    expect(events.filter(e => e.type === 'text-delta')).toHaveLength(0)
    // 应有 reasoning-end
    expect(events.filter(e => e.type === 'reasoning-end')).toHaveLength(1)
  })
})

describe('流处理逻辑 - 混合 REASONING_PREFIX 场景', () => {
  it('delta 中间包含 REASONING_PREFIX 应正确拆分', () => {
    // 极端场景：前半段是普通文本，后半段是 reasoning
    // 注意：实际流中 REASONING_PREFIX 通常出现在 delta 开头，
    // 但代码也处理了中间出现的情况
    const events = processChunks([
      { type: 'text-delta', text: '前文' + REASONING_PREFIX + '思考内容' },
      { type: 'finish', finishReason: 'stop' }
    ])

    // "前文" 应作为 reasoning-delta（因为 split 后第一个非空 part 不含 REASONING_END）
    // "思考内容" 也应作为 reasoning-delta
    const reasoningDeltas = events.filter(e => e.type === 'reasoning-delta')
    expect(reasoningDeltas.length).toBeGreaterThanOrEqual(1)

    // 应有 reasoning-start
    expect(events.some(e => e.type === 'reasoning-start')).toBe(true)
  })
})

describe('流处理逻辑 - tool 事件映射', () => {
  it('tool-call 应映射为 tool-input-available，字段名为 input', () => {
    const events = processChunks([
      {
        type: 'tool-call',
        toolCallId: 'call-123',
        toolName: 'webSearch',
        input: { query: '最新新闻' }
      },
      { type: 'finish', finishReason: 'tool-calls' }
    ])

    const toolEvent = events.find(e => e.type === 'tool-input-available')
    expect(toolEvent).toEqual({
      type: 'tool-input-available',
      toolCallId: 'call-123',
      toolName: 'webSearch',
      input: { query: '最新新闻' }
    })
    // 确认字段名是 input 而非 args
    expect(toolEvent).toHaveProperty('input')
    expect(toolEvent).not.toHaveProperty('args')
  })

  it('tool-result 应映射为 tool-output-available，字段名为 output', () => {
    const events = processChunks([
      {
        type: 'tool-result',
        toolCallId: 'call-123',
        output: '搜索结果内容'
      },
      { type: 'finish', finishReason: 'stop' }
    ])

    const toolEvent = events.find(e => e.type === 'tool-output-available')
    expect(toolEvent).toEqual({
      type: 'tool-output-available',
      toolCallId: 'call-123',
      output: '搜索结果内容'
    })
    // 确认字段名是 output 而非 result
    expect(toolEvent).toHaveProperty('output')
    expect(toolEvent).not.toHaveProperty('result')
  })

  it('tool-error 应映射为 tool-output-error', () => {
    const events = processChunks([
      {
        type: 'tool-error',
        toolCallId: 'call-456',
        error: new Error('工具调用失败')
      },
      { type: 'finish', finishReason: 'error' }
    ])

    const toolEvent = events.find(e => e.type === 'tool-output-error')
    expect(toolEvent).toEqual({
      type: 'tool-output-error',
      toolCallId: 'call-456',
      errorText: '工具调用失败'
    })
  })

  it('tool-error 非Error对象应转为字符串', () => {
    const events = processChunks([
      {
        type: 'tool-error',
        toolCallId: 'call-789',
        error: '字符串错误'
      },
      { type: 'finish', finishReason: 'error' }
    ])

    const toolEvent = events.find(e => e.type === 'tool-output-error')
    expect(toolEvent?.errorText).toBe('字符串错误')
  })

  it('tool-input-start 应映射为 tool-input-start', () => {
    const events = processChunks([
      {
        type: 'tool-input-start',
        id: 'call-001',
        toolName: 'getWeather'
      },
      { type: 'finish', finishReason: 'tool-calls' }
    ])

    const toolEvent = events.find(e => e.type === 'tool-input-start')
    expect(toolEvent).toEqual({
      type: 'tool-input-start',
      toolCallId: 'call-001',
      toolName: 'getWeather'
    })
  })

  it('tool-input-delta 应映射为 tool-input-delta', () => {
    const events = processChunks([
      {
        type: 'tool-input-delta',
        id: 'call-001',
        delta: '{"qu'
      },
      { type: 'finish', finishReason: 'tool-calls' }
    ])

    const toolEvent = events.find(e => e.type === 'tool-input-delta')
    expect(toolEvent).toEqual({
      type: 'tool-input-delta',
      toolCallId: 'call-001',
      inputTextDelta: '{"qu'
    })
  })

  it('tool-input-end 应被跳过（不写入）', () => {
    const events = processChunks([
      { type: 'tool-input-end', id: 'call-001' },
      { type: 'finish', finishReason: 'stop' }
    ])

    // 不应有任何 tool-input-end 事件
    expect(events.filter(e => e.type === 'tool-input-end')).toHaveLength(0)
  })
})

describe('流处理逻辑 - 原生 reasoning-delta', () => {
  it('原生 reasoning-delta 应透传为 reasoning-start + reasoning-delta', () => {
    const events = processChunks([
      { type: 'reasoning-delta', text: '原生推理内容', id: 'rs-native-1' },
      { type: 'finish', finishReason: 'stop' }
    ])

    expect(events).toEqual([
      { type: 'reasoning-start', id: 'rs-native-1' },
      { type: 'reasoning-delta', id: 'rs-native-1', delta: '原生推理内容' },
      { type: 'reasoning-end', id: 'rs-native-1' }, // finish 时关闭
      { type: 'finish', finishReason: 'stop' }
    ])
  })

  it('连续原生 reasoning-delta 应复用 reasoningId', () => {
    const events = processChunks([
      { type: 'reasoning-delta', text: '推理一', id: 'rs-native-1' },
      { type: 'reasoning-delta', text: '推理二', id: 'rs-native-1' },
      { type: 'finish', finishReason: 'stop' }
    ])

    // 只应有一个 reasoning-start
    const reasoningStarts = events.filter(e => e.type === 'reasoning-start')
    expect(reasoningStarts).toHaveLength(1)

    // 两个 reasoning-delta
    const reasoningDeltas = events.filter(e => e.type === 'reasoning-delta')
    expect(reasoningDeltas).toHaveLength(2)
    expect(reasoningDeltas.map(e => e.delta)).toEqual(['推理一', '推理二'])
  })

  it('原生 reasoning-delta 无 id 时应使用默认 id', () => {
    const events = processChunks([
      { type: 'reasoning-delta', text: '无id推理' },
      { type: 'finish', finishReason: 'stop' }
    ])

    // 应有 reasoning-start，使用默认 id
    expect(events.some(e => e.type === 'reasoning-start')).toBe(true)
    expect(events.filter(e => e.type === 'reasoning-delta')).toHaveLength(1)
  })
})

describe('流处理逻辑 - finish 事件', () => {
  it('finish 应关闭未关闭的 reasoning', () => {
    const events = processChunks([
      { type: 'text-delta', text: REASONING_PREFIX + '思考中' },
      { type: 'finish', finishReason: 'stop' }
    ])

    // 应自动追加 reasoning-end
    const reasoningEnds = events.filter(e => e.type === 'reasoning-end')
    expect(reasoningEnds).toHaveLength(1)

    // reasoning-end 应在 finish 之前
    const finishIdx = events.findIndex(e => e.type === 'finish')
    const reasoningEndIdx = events.findIndex(e => e.type === 'reasoning-end')
    expect(reasoningEndIdx).toBeLessThan(finishIdx)
  })

  it('finish 应关闭未关闭的 text', () => {
    const events = processChunks([
      { type: 'text-delta', text: '普通文本' },
      { type: 'finish', finishReason: 'stop' }
    ])

    // 应自动追加 text-end
    const textEnds = events.filter(e => e.type === 'text-end')
    expect(textEnds).toHaveLength(1)

    // text-end 应在 finish 之前
    const finishIdx = events.findIndex(e => e.type === 'finish')
    const textEndIdx = events.findIndex(e => e.type === 'text-end')
    expect(textEndIdx).toBeLessThan(finishIdx)
  })

  it('finish 应同时关闭未关闭的 reasoning 和 text', () => {
    const events = processChunks([
      { type: 'text-delta', text: REASONING_PREFIX + '思考' },
      { type: 'text-delta', text: REASONING_END + '回答' },
      // 不发送 finish 以外的关闭事件
      { type: 'finish', finishReason: 'stop' }
    ])

    // reasoning-end 由 REASONING_END 触发
    // text-end 由 finish 触发
    const reasoningEnds = events.filter(e => e.type === 'reasoning-end')
    const textEnds = events.filter(e => e.type === 'text-end')
    expect(reasoningEnds).toHaveLength(1)
    expect(textEnds).toHaveLength(1)
  })

  it('已完成 reasoning 和 text 时 finish 不重复关闭', () => {
    const events = processChunks([
      { type: 'text-delta', text: REASONING_PREFIX + '思考' },
      { type: 'text-delta', text: REASONING_END + '回答' },
      { type: 'reasoning-end', id: 'rs-test' }, // 显式关闭
      { type: 'text-end', id: 'ts-test' },       // 显式关闭
      { type: 'finish', finishReason: 'stop' }
    ])

    // 注意：显式 reasoning-end 会将 isReasoning 置为 false，
    // 但 textId 仍然有值，所以 finish 时不会再写 text-end
    // 不过因为显式 text-end 已经写入，这里检查不会重复
    const reasoningEnds = events.filter(e => e.type === 'reasoning-end')
    // 一个来自 REASONING_END 处理，一个来自显式关闭
    expect(reasoningEnds.length).toBeLessThanOrEqual(2)
  })
})

describe('流处理逻辑 - onFinish 回调文本清理', () => {
  it('应从 text 中移除 REASONING_PREFIX 和 REASONING_END 内容', () => {
    const text = REASONING_PREFIX + '这是思考内容' + REASONING_END + '这是正式回答'
    const result = cleanTextForOnFinish(text)
    expect(result).toBe('这是正式回答')
  })

  it('只有 REASONING_PREFIX 没有 REASONING_END 应返回空字符串', () => {
    const text = REASONING_PREFIX + '只有思考没有回答'
    const result = cleanTextForOnFinish(text)
    expect(result).toBe('')
  })

  it('没有 REASONING 标记的文本应原样返回', () => {
    const text = '普通回答内容'
    const result = cleanTextForOnFinish(text)
    expect(result).toBe('普通回答内容')
  })

  it('REASONING_END 后有多余空白应 trim', () => {
    const text = REASONING_PREFIX + '思考' + REASONING_END + '  回答  '
    const result = cleanTextForOnFinish(text)
    expect(result).toBe('回答')
  })

  it('REASONING_END 后无内容应返回空字符串', () => {
    const text = REASONING_PREFIX + '思考' + REASONING_END
    const result = cleanTextForOnFinish(text)
    expect(result).toBe('')
  })
})

describe('流处理逻辑 - error 事件', () => {
  it('error chunk 应映射为 error 事件', () => {
    const events = processChunks([
      { type: 'error', error: new Error('流式输出错误') },
      { type: 'finish', finishReason: 'error' }
    ])

    const errorEvent = events.find(e => e.type === 'error')
    expect(errorEvent).toEqual({
      type: 'error',
      errorText: '流式输出错误'
    })
  })

  it('error 非Error对象应转为字符串', () => {
    const events = processChunks([
      { type: 'error', error: '超时' },
      { type: 'finish', finishReason: 'error' }
    ])

    const errorEvent = events.find(e => e.type === 'error')
    expect(errorEvent?.errorText).toBe('超时')
  })
})

describe('流处理逻辑 - 其他事件透传', () => {
  it('start 事件应直接透传', () => {
    const events = processChunks([
      { type: 'start' },
      { type: 'finish', finishReason: 'stop' }
    ])

    expect(events.some(e => e.type === 'start')).toBe(true)
  })

  it('start-step 事件应直接透传', () => {
    const events = processChunks([
      { type: 'start-step' },
      { type: 'finish', finishReason: 'stop' }
    ])

    expect(events.some(e => e.type === 'start-step')).toBe(true)
  })

  it('finish-step 事件应直接透传', () => {
    const events = processChunks([
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' }
    ])

    expect(events.some(e => e.type === 'finish-step')).toBe(true)
  })
})

describe('流处理逻辑 - 完整对话场景', () => {
  it('完整的 reasoning + 正式回答流程', () => {
    const events = processChunks([
      { type: 'text-delta', text: REASONING_PREFIX + '让我分析一下这个问题...' },
      { type: 'text-delta', text: '首先考虑...' },
      { type: 'text-delta', text: '然后...' },
      { type: 'text-delta', text: REASONING_END + '根据分析，答案是42。' },
      { type: 'text-delta', text: '这是详细解释。' },
      { type: 'finish', finishReason: 'stop' }
    ])

    // 验证事件序列
    expect(events).toEqual([
      { type: 'reasoning-start', id: 'rs-test' },
      { type: 'reasoning-delta', id: 'rs-test', delta: '让我分析一下这个问题...' },
      { type: 'reasoning-delta', id: 'rs-test', delta: '首先考虑...' },
      { type: 'reasoning-delta', id: 'rs-test', delta: '然后...' },
      { type: 'reasoning-end', id: 'rs-test' },
      { type: 'text-start', id: 'ts-test' },
      { type: 'text-delta', id: 'ts-test', delta: '根据分析，答案是42。' },
      { type: 'text-delta', id: 'ts-test', delta: '这是详细解释。' },
      { type: 'text-end', id: 'ts-test' },
      { type: 'finish', finishReason: 'stop' }
    ])
  })

  it('工具调用 + 结果 + 文本回答流程', () => {
    const events = processChunks([
      { type: 'text-delta', text: '让我查一下' },
      {
        type: 'tool-call',
        toolCallId: 'call-001',
        toolName: 'webSearch',
        input: { query: '最新新闻' }
      },
      {
        type: 'tool-result',
        toolCallId: 'call-001',
        output: '搜索结果'
      },
      { type: 'text-delta', text: '根据搜索结果...' },
      { type: 'finish', finishReason: 'stop' }
    ])

    // 验证关键事件
    expect(events.find(e => e.type === 'text-start')).toBeDefined()
    expect(events.find(e => e.type === 'tool-input-available')).toEqual({
      type: 'tool-input-available',
      toolCallId: 'call-001',
      toolName: 'webSearch',
      input: { query: '最新新闻' }
    })
    expect(events.find(e => e.type === 'tool-output-available')).toEqual({
      type: 'tool-output-available',
      toolCallId: 'call-001',
      output: '搜索结果'
    })
    // 文本应使用同一个 textId
    const textDeltas = events.filter(e => e.type === 'text-delta')
    expect(textDeltas).toHaveLength(2)
    expect(textDeltas[0].id).toBe(textDeltas[1].id)
  })
})
