import type { IncomingMessage } from 'node:http'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "font-src 'self' https://cdn.jsdelivr.net",
  "img-src 'self' data: blob: https:",
  // media-src 允许 blob:：TTS 朗读用 URL.createObjectURL 生成的 blob 音频，
  // 仅 default-src 'self' 会被 CSP 拦截导致「音频播放失败」
  "media-src 'self' blob:",
  "connect-src 'self' https://api.siliconflow.cn",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ')

const rateLimitMap = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT_WINDOW = 60_000
const RATE_LIMIT_MAX = 30

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW })
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 }
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 }
  }

  entry.count++
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count }
}

export default defineEventHandler(async (event) => {
  const res = event.node.res

  res.setHeader('Content-Security-Policy', CSP_DIRECTIVES)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '0')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  // 麦克风对同源放行：语音消息录音（MediaRecorder）与 Web Speech 语音输入依赖 getUserMedia，
  // 设为 () 会导致 Permissions policy violation、录音在任何浏览器中都无法启动
  // camera / geolocation 项目未使用，保持禁用
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()')

  const origin = getRequestHeader(event, 'origin') || ''
  const allowedOrigins = ['http://localhost:3000']
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Max-Age', '86400')
  }

  if (event.node.req.method === 'OPTIONS') {
    event.node.res.statusCode = 204
    return ''
  }

  const url = getRequestURL(event)
  if (url.pathname.startsWith('/api/')) {
    const ip = getClientIp(event.node.req)
    const { allowed, remaining } = checkRateLimit(ip)
    res.setHeader('X-RateLimit-Remaining', String(remaining))
    res.setHeader('X-RateLimit-Limit', String(RATE_LIMIT_MAX))

    if (!allowed) {
      res.setHeader('Retry-After', '60')
      throw createError({
        statusCode: 429,
        statusMessage: '请求过于频繁，请稍后再试'
      })
    }
  }

  if (url.pathname.match(/^\/api\/sessions\/[^/]+$/)) {
    const segments = url.pathname.split('/')
    const sessionId = segments[segments.length - 1]
    if (sessionId && !UUID_REGEX.test(sessionId)) {
      throw createError({
        statusCode: 400,
        statusMessage: '会话ID格式无效'
      })
    }
  }
})
