import { config } from '@vue/test-utils'

config.global.stubs = {
  NuxtLink: { template: '<a><slot /></a>' },
  NuxtLayout: { template: '<div><slot /></div>' },
  NuxtPage: { template: '<div />' }
}

// Nuxt auto-import 模拟（用于 API 路由测试）
// 这些函数在 Nuxt 运行时自动注入，但 vitest 环境需要手动定义
const g = globalThis as any
g.defineEventHandler = (handler: any) => handler
g.getMethod = (event: any) => event.node?.req?.method || event._method
g.getRouterParam = (event: any, name: string) =>
  event.context?.params?.[name] ?? event._params?.[name]
g.readBody = async (event: any) => event._body
g.createError = (opts: { statusCode: number; statusMessage: string }) => {
  const err = new Error(opts.statusMessage) as any
  err.statusCode = opts.statusCode
  err.statusMessage = opts.statusMessage
  return err
}
