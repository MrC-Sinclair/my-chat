/**
 * @file 退出登录 — POST /api/auth/logout
 *
 * 清除会话 Cookie。后续请求由 auth 中间件自动创建新游客身份。
 * 游客数据留在原游客行（浏览器本地 Cookie 丢失即不可达，属预期——design.md 决策 3）。
 */
import { AUTH_COOKIE } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  deleteCookie(event, AUTH_COOKIE, { path: '/' })
  return { ok: true }
})
