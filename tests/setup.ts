import { config } from '@vue/test-utils'
import { tooltipDirective } from '~/composables/useTooltip'

config.global.stubs = {
  NuxtLink: { template: '<a><slot /></a>' },
  NuxtLayout: { template: '<div><slot /></div>' },
  NuxtPage: { template: '<div />' }
}

// 全局注册 v-tooltip 指令，与 plugins/tooltip.ts 保持一致，消除测试环境警告
config.global.directives = {
  tooltip: tooltipDirective
}

// 全局 provide mock toast，让 ChatInput.vue setup 顶层调用 useToast() 时
// inject('toast') 能拿到 mock，避免抛出 "useToast must be used within ToastProvider"
config.global.provide = {
  toast: {
    show: () => {},
    success: () => {},
    error: () => {},
    info: () => {},
    warning: () => {}
  }
}

// Nuxt auto-import 模拟（用于 API 路由测试 + 组件测试）
// 这些函数在 Nuxt 运行时自动注入，但 vitest 环境需要手动定义为全局变量
const g = globalThis as any
// useToast 在 ChatInput.vue setup 顶层调用，vitest 没有 Nuxt auto-import 必须手动注册
// 返回空操作 mock（实际 toast 通过 config.global.provide 注入，但 useToast 函数本身也需要存在）
g.useToast = () => ({
  show: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
  warning: () => {}
})
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
