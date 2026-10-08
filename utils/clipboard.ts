/**
 * @file 剪贴板复制兜底
 *
 * `navigator.clipboard` 同样只在安全上下文存在，HTTP 直连的线上环境取到的是 undefined，
 * 所有「复制」按钮都会抛错。兜底用隐藏 textarea + `document.execCommand('copy')`
 * （已废弃但各浏览器仍支持，且非安全上下文可用）。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // writeText 在用户拒绝权限时 reject；此处降级到 execCommand，其他复制失败由返回值交给调用方提示
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
  document.body.appendChild(textarea)
  textarea.select()

  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    // execCommand 在个别 WebView 中直接抛异常，按复制失败返回 false
  }
  document.body.removeChild(textarea)

  return copied
}
