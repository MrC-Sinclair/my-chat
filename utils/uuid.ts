/**
 * @file 客户端 UUID 兜底
 *
 * `crypto.randomUUID` 只在安全上下文（HTTPS / localhost）暴露；线上以 `http://IP` 直连时
 * 它是 undefined，`ChatInput` 图片附件与文生图消息插入会直接抛
 * `TypeError: crypto.randomUUID is not a function`，图片预览再也不渲染。
 * `crypto.getRandomValues` 不受安全上下文限制，用它手拼 v4 兜底。
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
