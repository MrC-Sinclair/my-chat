/**
 * @file 对话错误文案整理
 *
 * 服务端错误（`createError()`）经 AI SDK 透到前端时，`err.message` 常是整段错误 JSON
 * （形如 `{"statusCode":429,"message":"请求过于频繁，请稍后再试"}`），直接拼进 toast 会让用户
 * 读到协议细节。这里只取其中的可读字段，取不到时退回原文，不猜内容。
 */

/** 从服务端错误体候选字段中取第一条可读文案 */
function pickMessage(parsed: Record<string, unknown>): string | null {
  for (const key of ['message', 'statusMessage', 'error']) {
    const value = parsed[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/**
 * 把错误原文整理成适合展示的短句
 *
 * - JSON 对象且含可读字段：返回该字段
 * - 其他（纯文本、JSON 数组、无可读字段）：返回 trim 后的原文
 */
export function formatChatError(raw: string | null | undefined): string {
  const text = (raw || '').trim()
  if (!text) return '未知错误'
  if (!text.startsWith('{')) return text

  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return pickMessage(parsed as Record<string, unknown>) ?? text
    }
  } catch {
    // 不是合法 JSON：按原文展示
  }

  return text
}
