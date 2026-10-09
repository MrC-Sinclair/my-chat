/**
 * MCP 工具结果解包测试
 *
 * 覆盖两类语义：
 *   - CallToolResult → 领域对象（天气工具走 MCP，UI 卡片按对象字段取值）
 *   - 错误路径不得丢失原因（isError 时必须带上可读的 error 文本）
 */

import { describe, it, expect, vi } from 'vitest'
import { unwrapMcpToolResult, withUnwrappedMcpResults } from '~/server/utils/mcp-tool-output'

/** 构造 MCP 协议返回体 */
function mcpJson(payload: unknown, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError }
}

describe('unwrapMcpToolResult', () => {
  it('文本为 JSON 对象时返回解析后的对象', () => {
    const result = unwrapMcpToolResult(
      mcpJson({ city: 'Guangzhou', region: 'Guangdong', isLocal: false, error: null })
    )

    expect(result).toEqual({ city: 'Guangzhou', region: 'Guangdong', isLocal: false, error: null })
  })

  it('isError 且 JSON 内无 error 字段时补上原始文本', () => {
    const result = unwrapMcpToolResult(mcpJson({ city: null }, true)) as Record<string, unknown>

    expect(result.city).toBeNull()
    expect(typeof result.error).toBe('string')
  })

  it('isError 且文本不是 JSON 时返回带 error 的对象', () => {
    const result = unwrapMcpToolResult({
      content: [{ type: 'text', text: 'MCP server crashed' }],
      isError: true
    }) as Record<string, unknown>

    expect(result.error).toBe('MCP server crashed')
  })

  it('成功但文本不是 JSON 时原样返回，不猜测内容', () => {
    const raw = { content: [{ type: 'text', text: 'plain summary' }], isError: false }

    expect(unwrapMcpToolResult(raw)).toBe(raw)
  })

  it('无文本内容块（如仅 image）时原样返回', () => {
    const raw = { content: [{ type: 'image', data: 'AAA', mimeType: 'image/png' }] }

    expect(unwrapMcpToolResult(raw)).toBe(raw)
  })

  it('JSON 数组或标量不作为领域对象透出', () => {
    const arr = mcpJson([1, 2, 3])

    expect(unwrapMcpToolResult(arr)).toBe(arr)
  })

  it('非 MCP 形态的 output（领域对象/字符串/null）原样返回', () => {
    const domain = { city: '北京', current: { temperature: '16.9°C' } }

    expect(unwrapMcpToolResult(domain)).toBe(domain)
    expect(unwrapMcpToolResult('text')).toBe('text')
    expect(unwrapMcpToolResult(null)).toBeNull()
  })
})

describe('withUnwrappedMcpResults', () => {
  it('包装 execute 使返回值为解包后的对象，并保留其余字段', async () => {
    const execute = vi.fn(async () => mcpJson({ city: '广州' }))
    const tools = { weather: { execute, description: '查询天气', inputSchema: {} } }

    const wrapped = withUnwrappedMcpResults(tools)
    const output = await wrapped.weather.execute({ city: '广州' }, {})

    expect(output).toEqual({ city: '广州' })
    expect(execute).toHaveBeenCalledWith({ city: '广州' }, {})
    expect(wrapped.weather.description).toBe('查询天气')
  })

  it('没有 execute 的工具原样保留', () => {
    const declarationOnly = { description: 'no execute', inputSchema: {} }
    const tools = { weather: declarationOnly }

    expect(withUnwrappedMcpResults(tools)).toEqual({ weather: declarationOnly })
  })

  it('多个工具各自独立包装', async () => {
    const tools = {
      weather: { execute: async () => mcpJson({ city: '广州' }) },
      getCityByIp: { execute: async () => mcpJson({ city: null, isLocal: true, error: '本地/内网 IP，无法定位' }) }
    }

    const wrapped = withUnwrappedMcpResults(tools)

    await expect(wrapped.weather.execute({}, {})).resolves.toEqual({ city: '广州' })
    await expect(wrapped.getCityByIp.execute({ ip: '127.0.0.1' }, {})).resolves.toMatchObject({
      isLocal: true
    })
  })
})
