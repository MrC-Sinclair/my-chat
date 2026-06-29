import { describe, it, expect, vi, beforeEach } from 'vitest'
import { customFetch, REASONING_PREFIX, REASONING_END } from '~/server/utils/reasoning-provider'

/** 辅助函数：构造 SSE 格式的 ReadableStream */
function createSSEStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const sseText = lines.join('\n')
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseText))
      controller.close()
    }
  })
}

/** 辅助函数：读取 Response 的完整文本 */
async function readResponseBody(response: Response): Promise<string> {
  return await response.text()
}

/** 辅助函数：构造 SSE delta 行 */
function sseDelta(delta: Record<string, unknown>, index = 0): string {
  return `data: ${JSON.stringify({ choices: [{ index, delta }] })}`
}

/** 辅助函数：构造模拟的 SSE Response */
function createSSEResponse(lines: string[], status = 200): Response {
  return new Response(createSSEStream(lines), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'content-type': 'text/event-stream' }
  })
}

/** 记录 globalThis.fetch 的调用参数，用于验证请求拦截 */
let fetchCalls: { url: RequestInfo | URL; options?: RequestInit }[] = []

beforeEach(() => {
  fetchCalls = []
})

describe('customFetch - 请求拦截（developer → system）', () => {
  it('应将 role: developer 替换为 role: system', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, options) => {
      fetchCalls.push({ url, options })
      return new Response('ok')
    })

    const body = JSON.stringify({
      messages: [{ role: 'developer', content: '你是一个助手' }]
    })

    await customFetch('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      body
    })

    // 验证传给 globalThis.fetch 的请求体中 developer 已被替换
    const sentBody = JSON.parse(fetchCalls[0].options!.body as string)
    expect(sentBody.messages[0].role).toBe('system')
    expect(sentBody.messages[0].content).toBe('你是一个助手')

    globalThis.fetch = originalFetch
  })

  it('不应修改 role: system 和 role: user 的消息', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, options) => {
      fetchCalls.push({ url, options })
      return new Response('ok')
    })

    const body = JSON.stringify({
      messages: [
        { role: 'system', content: '系统指令' },
        { role: 'user', content: '用户消息' }
      ]
    })

    await customFetch('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      body
    })

    const sentBody = JSON.parse(fetchCalls[0].options!.body as string)
    expect(sentBody.messages[0].role).toBe('system')
    expect(sentBody.messages[1].role).toBe('user')

    globalThis.fetch = originalFetch
  })

  it('应只替换 developer 角色，保留其他角色不变', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, options) => {
      fetchCalls.push({ url, options })
      return new Response('ok')
    })

    const body = JSON.stringify({
      messages: [
        { role: 'developer', content: '开发者指令' },
        { role: 'user', content: '用户消息' },
        { role: 'developer', content: '另一条开发者指令' },
        { role: 'assistant', content: '助手回复' }
      ]
    })

    await customFetch('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      body
    })

    const sentBody = JSON.parse(fetchCalls[0].options!.body as string)
    expect(sentBody.messages[0].role).toBe('system')
    expect(sentBody.messages[1].role).toBe('user')
    expect(sentBody.messages[2].role).toBe('system')
    expect(sentBody.messages[3].role).toBe('assistant')

    globalThis.fetch = originalFetch
  })

  it('请求体不是有效 JSON 时应透传不报错', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, options) => {
      fetchCalls.push({ url, options })
      return new Response('ok')
    })

    const invalidBody = '{not valid json!!!'

    await customFetch('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      body: invalidBody
    })

    // 透传原始请求体，不报错
    expect(fetchCalls[0].options!.body).toBe(invalidBody)

    globalThis.fetch = originalFetch
  })

  it('请求体没有 messages 字段时应透传', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, options) => {
      fetchCalls.push({ url, options })
      return new Response('ok')
    })

    const body = JSON.stringify({ model: 'gpt-4', temperature: 0.7 })

    await customFetch('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      body
    })

    const sentBody = JSON.parse(fetchCalls[0].options!.body as string)
    expect(sentBody.model).toBe('gpt-4')
    expect(sentBody.temperature).toBe(0.7)
    expect(sentBody.messages).toBeUndefined()

    globalThis.fetch = originalFetch
  })
})

describe('customFetch - 响应拦截（reasoning_content → REASONING_PREFIX）', () => {
  it('应将 reasoning_content 映射为带前缀的 content', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => {
      return createSSEResponse([sseDelta({ reasoning_content: '思考内容' }), 'data: [DONE]'])
    })

    const response = await customFetch('https://api.example.com/v1/chat/completions')
    const text = await readResponseBody(response)
    const lines = text.split('\n')

    // 找到 data: 行（非 [DONE]）
    const dataLine = lines.find((l) => l.startsWith('data: ') && l !== 'data: [DONE]')!
    const json = JSON.parse(dataLine.slice(6))
    const delta = json.choices[0].delta

    expect(delta.content).toBe(REASONING_PREFIX + '思考内容')
    expect(delta.reasoning_content).toBeUndefined()

    globalThis.fetch = originalFetch
  })

  it('应删除空字符串的 reasoning_content，不添加 content', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => {
      return createSSEResponse([sseDelta({ reasoning_content: '' }), 'data: [DONE]'])
    })

    const response = await customFetch('https://api.example.com/v1/chat/completions')
    const text = await readResponseBody(response)
    const lines = text.split('\n')

    const dataLine = lines.find((l) => l.startsWith('data: ') && l !== 'data: [DONE]')!
    const json = JSON.parse(dataLine.slice(6))
    const delta = json.choices[0].delta

    // 空字符串首帧：仅删除 reasoning_content，不添加 content
    expect(delta.reasoning_content).toBeUndefined()
    expect(delta.content).toBeUndefined()

    globalThis.fetch = originalFetch
  })

  it('从 reasoning 阶段切换到 content 阶段时应插入 REASONING_END', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => {
      return createSSEResponse([
        sseDelta({ reasoning_content: '思考中' }),
        sseDelta({ content: '正式回答' }),
        'data: [DONE]'
      ])
    })

    const response = await customFetch('https://api.example.com/v1/chat/completions')
    const text = await readResponseBody(response)
    const lines = text.split('\n').filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]')

    // 第一行：reasoning_content 映射
    const json1 = JSON.parse(lines[0].slice(6))
    expect(json1.choices[0].delta.content).toBe(REASONING_PREFIX + '思考中')
    expect(json1.choices[0].delta.reasoning_content).toBeUndefined()

    // 第二行：content 前插入 REASONING_END
    const json2 = JSON.parse(lines[1].slice(6))
    expect(json2.choices[0].delta.content).toBe(REASONING_END + '正式回答')

    globalThis.fetch = originalFetch
  })

  it('非 SSE 响应应直接透传', async () => {
    const originalFetch = globalThis.fetch
    const jsonBody = JSON.stringify({ id: 'chatcmpl-123', choices: [] })
    globalThis.fetch = vi.fn(async () => {
      return new Response(jsonBody, {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })

    const response = await customFetch('https://api.example.com/v1/chat/completions')
    const text = await readResponseBody(response)

    expect(text).toBe(jsonBody)

    globalThis.fetch = originalFetch
  })

  it('错误响应应直接透传', async () => {
    const originalFetch = globalThis.fetch
    const errorBody = JSON.stringify({ error: { message: 'Rate limit exceeded' } })
    globalThis.fetch = vi.fn(async () => {
      return new Response(errorBody, {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'content-type': 'application/json' }
      })
    })

    const response = await customFetch('https://api.example.com/v1/chat/completions')
    expect(response.status).toBe(429)
    expect(response.statusText).toBe('Too Many Requests')

    const text = await readResponseBody(response)
    expect(text).toBe(errorBody)

    globalThis.fetch = originalFetch
  })

  it('连续的 reasoning_content delta 应每个都正确映射', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => {
      return createSSEResponse([
        sseDelta({ reasoning_content: '第一步' }),
        sseDelta({ reasoning_content: '第二步' }),
        sseDelta({ reasoning_content: '第三步' }),
        'data: [DONE]'
      ])
    })

    const response = await customFetch('https://api.example.com/v1/chat/completions')
    const text = await readResponseBody(response)
    const lines = text.split('\n').filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]')

    expect(lines).toHaveLength(3)

    const json1 = JSON.parse(lines[0].slice(6))
    expect(json1.choices[0].delta.content).toBe(REASONING_PREFIX + '第一步')

    const json2 = JSON.parse(lines[1].slice(6))
    expect(json2.choices[0].delta.content).toBe(REASONING_PREFIX + '第二步')

    const json3 = JSON.parse(lines[2].slice(6))
    expect(json3.choices[0].delta.content).toBe(REASONING_PREFIX + '第三步')

    globalThis.fetch = originalFetch
  })

  it('reasoning_content 后跟普通 content 应插入 REASONING_END 分隔', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => {
      return createSSEResponse([
        sseDelta({ reasoning_content: '' }), // 首帧：空字符串
        sseDelta({ reasoning_content: '思考' }), // reasoning 内容
        sseDelta({ reasoning_content: '过程' }), // reasoning 内容续
        sseDelta({ content: '你好' }), // 切换到 content 阶段
        sseDelta({ content: '世界' }), // 后续 content
        'data: [DONE]'
      ])
    })

    const response = await customFetch('https://api.example.com/v1/chat/completions')
    const text = await readResponseBody(response)
    const lines = text.split('\n').filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]')

    expect(lines).toHaveLength(5)

    // 第1行：空字符串首帧 → 删除 reasoning_content，不添加 content
    const json1 = JSON.parse(lines[0].slice(6))
    expect(json1.choices[0].delta.reasoning_content).toBeUndefined()
    expect(json1.choices[0].delta.content).toBeUndefined()

    // 第2行：reasoning_content → 带前缀 content
    const json2 = JSON.parse(lines[1].slice(6))
    expect(json2.choices[0].delta.content).toBe(REASONING_PREFIX + '思考')
    expect(json2.choices[0].delta.reasoning_content).toBeUndefined()

    // 第3行：reasoning_content → 带前缀 content
    const json3 = JSON.parse(lines[2].slice(6))
    expect(json3.choices[0].delta.content).toBe(REASONING_PREFIX + '过程')

    // 第4行：切换到 content 阶段，插入 REASONING_END
    const json4 = JSON.parse(lines[3].slice(6))
    expect(json4.choices[0].delta.content).toBe(REASONING_END + '你好')

    // 第5行：后续 content，不再插入 REASONING_END
    const json5 = JSON.parse(lines[4].slice(6))
    expect(json5.choices[0].delta.content).toBe('世界')

    globalThis.fetch = originalFetch
  })
})

describe('customFetch - SSE 透传场景', () => {
  it('非 data 开头的行应直接透传', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => {
      return createSSEResponse([
        ': comment line',
        sseDelta({ content: 'hello' }),
        '',
        'data: [DONE]'
      ])
    })

    const response = await customFetch('https://api.example.com/v1/chat/completions')
    const text = await readResponseBody(response)
    const lines = text.split('\n')

    // 注释行应透传
    expect(lines).toContain(': comment line')
    // 空行应透传
    expect(lines).toContain('')

    globalThis.fetch = originalFetch
  })

  it('没有 delta 的 SSE data 行应直接透传', async () => {
    const originalFetch = globalThis.fetch
    const originalLine = 'data: {"id":"chatcmpl-123","choices":[{"index":0}]}'
    globalThis.fetch = vi.fn(async () => {
      return createSSEResponse([originalLine, 'data: [DONE]'])
    })

    const response = await customFetch('https://api.example.com/v1/chat/completions')
    const text = await readResponseBody(response)
    const lines = text.split('\n').filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]')

    // 没有 delta 的行应原样透传
    expect(lines[0]).toBe(originalLine)

    globalThis.fetch = originalFetch
  })

  it('data: [DONE] 应直接透传', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => {
      return createSSEResponse([sseDelta({ content: 'hello' }), 'data: [DONE]'])
    })

    const response = await customFetch('https://api.example.com/v1/chat/completions')
    const text = await readResponseBody(response)
    const lines = text.split('\n')

    expect(lines).toContain('data: [DONE]')

    globalThis.fetch = originalFetch
  })

  it('无法解析的 JSON data 行应直接透传', async () => {
    const originalFetch = globalThis.fetch
    const badLine = 'data: {invalid json}'
    globalThis.fetch = vi.fn(async () => {
      return createSSEResponse([badLine, 'data: [DONE]'])
    })

    const response = await customFetch('https://api.example.com/v1/chat/completions')
    const text = await readResponseBody(response)
    const lines = text.split('\n')

    expect(lines).toContain(badLine)

    globalThis.fetch = originalFetch
  })
})

describe('customFetch - 导出常量', () => {
  it('REASONING_PREFIX 应为 \\x00REASONING:', () => {
    expect(REASONING_PREFIX).toBe('\x00REASONING:')
  })

  it('REASONING_END 应为 \\x00REASONING_END', () => {
    expect(REASONING_END).toBe('\x00REASONING_END')
  })
})
