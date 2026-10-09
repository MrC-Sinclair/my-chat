/**
 * @file MCP 工具结果解包
 *
 * 为什么需要：`@ai-sdk/mcp` 的 `MCPClient.tools()` 返回 `Tool<INPUT, CallToolResult>`，
 * 其 `execute` 把 MCP 协议结果 `{ content: [{ type: 'text', text }], isError }` 原样透出；
 * 而项目内非 MCP 工具（webSearch / OCR / recallMemory 等）返回的就是领域对象，
 * `components/chat/ToolInvocation.vue` 也按对象读取 `output.city`、`output.error`。
 * 不统一形态会让工具卡片「数据对、展示错」：`getCityByIp` 落到兜底文案「IP 定位失败」，
 * `weather` 卡片渲染成空白，而模型侧其实已拿到正确 JSON。
 *
 * 选择在服务端出流前解包（而非改前端模板）：UI 消息 part 里持久化的也是同一份 output，
 * 解包后历史会话重开与实时流展示才能一致。
 */

/** MCP 文本内容块的最小结构描述（不引 SDK 类型，避免与 @ai-sdk/mcp 版本耦合） */
interface McpContentBlock {
  type?: string
  text?: string
}

/** MCP CallToolResult 的最小结构描述 */
interface McpCallToolResult {
  content?: McpContentBlock[]
  isError?: boolean
}

/** 是否为 MCP 协议结果形态（其余形态一律原样返回） */
function isMcpCallToolResult(value: unknown): value is McpCallToolResult {
  if (typeof value !== 'object' || value === null) return false
  return Array.isArray((value as { content?: unknown }).content)
}

/**
 * 把 MCP 结果解包成领域对象
 *
 * - 文本是 JSON 对象：返回该对象；`isError` 为真且对象无 `error` 字段时补上文本，供 UI 展示
 * - 文本非 JSON 且 `isError` 为真：返回 `{ error: text }`，避免 UI 退回与原因无关的兜底文案
 * - 其他情况（无文本块、纯 image 块、成功但非 JSON 文本）：原样返回，不做猜测
 */
export function unwrapMcpToolResult(result: unknown): unknown {
  if (!isMcpCallToolResult(result)) return result

  const text = result.content?.find((b) => b && b.type === 'text' && typeof b.text === 'string')
    ?.text

  if (!text) return result

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return result.isError ? { error: text } : result
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return result

  if (result.isError && !('error' in parsed)) {
    return { ...parsed, error: text }
  }

  return parsed
}

/**
 * 包装 MCP 工具集，使每个工具的 `execute` 返回解包后的领域对象
 *
 * 无 `execute` 的工具（如仅声明 schema 的客户端工具）原样保留。
 */
export function withUnwrappedMcpResults(tools: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      if (typeof tool?.execute !== 'function') return [name, tool]

      const execute = tool.execute as (input: unknown, options: unknown) => unknown
      return [
        name,
        {
          ...tool,
          execute: async (input: unknown, options: unknown) =>
            unwrapMcpToolResult(await execute(input, options))
        }
      ]
    })
  )
}
