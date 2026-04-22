/**
 * @file Nuxt 应用配置
 *
 * 本文件是 Nuxt 应用的核心配置文件，定义了：
 *   - 兼容性日期（决定 Nuxt 的行为版本）
 *   - 开发者工具开关
 *   - 使用的 Nuxt 模块
 *   - 运行时配置（环境变量、公开配置等）
 *
 * Nuxt 配置的基本结构：
 *   defineNuxtConfig() 接收一个配置对象，Nuxt 会根据这些配置
 *   自动构建前端和后端（Nitro 服务器）。
 */

import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * 项目根路径（用于修复 Windows 非 ASCII 路径问题）
 *
 * Vite 在 Windows 上处理含中文字符的项目路径时，会在生成的 HTML 中
 * 嵌入完整的文件系统绝对路径，导致浏览器无法加载模块资源。
 * 这个中间件会在 HTML 响应发送前修复这些路径。
 */
const projectRoot = resolve(__dirname).replace(/\\/g, '/')
const brokenPrefix = `/_nuxt/${projectRoot}/`
const fixedPrefix = '/_nuxt/'

/**
 * 修复 HTML 中的错误路径
 * @param html - 原始 HTML 内容
 * @returns 修复后的 HTML
 */
function fixHtml(html: string): string {
  return html.replaceAll(brokenPrefix, fixedPrefix)
}

export default defineNuxtConfig({
  /**
   * 兼容性日期
   *
   * Nuxt 使用这个日期来决定某些特性的默认行为。
   * 设置为项目创建时的日期即可，确保升级 Nuxt 后行为一致。
   */
  compatibilityDate: '2026-01-01',

  /**
   * 开发者工具
   *
   * enabled: true 表示在开发模式下启用 Nuxt DevTools，
   * 可以在浏览器中查看组件树、路由、状态管理等调试信息。
   * 生产构建时会自动移除，不影响性能。
   */
  devtools: { enabled: true },

  /**
   * Nuxt 模块
   *
   * 模块是 Nuxt 的扩展机制，每个模块会自动注册相关功能：
   *   - @nuxtjs/tailwindcss：集成 Tailwind CSS，自动扫描组件中的类名并生成样式
   *   - @pinia/nuxt：集成 Pinia 状态管理库，提供全局状态存储
   */
  modules: ['@nuxtjs/tailwindcss', '@pinia/nuxt'],

  css: ['~/assets/css/tooltip.css'],

  /**
   * Vite 配置
   *
   * 包含修复 Windows 非 ASCII 路径问题的中间件插件。
   * 该插件拦截 HTML 响应，将错误的绝对路径替换为正确的相对路径。
   */
  vite: {
    plugins: [
      {
        name: 'fix-windows-path-urls',
        configureServer(server) {
          return () => {
            server.middlewares.use(
              (req: IncomingMessage, res: ServerResponse, next: () => void) => {
                const originalSetHeader = res.setHeader.bind(res)
                let body = ''

                const _originalWrite = res.write
                res.write = function (chunk: any, ..._rest: any[]) {
                  if (typeof chunk === 'string') {
                    body += chunk
                  } else if (Buffer.isBuffer(chunk)) {
                    body += chunk.toString('utf-8')
                  }
                  return true
                } as any

                const originalEnd = res.end
                res.end = function (chunk: any, ...rest: any[]) {
                  if (typeof chunk === 'string') {
                    body += chunk
                  } else if (Buffer.isBuffer(chunk)) {
                    body += chunk.toString('utf-8')
                  }

                  const contentType = res.getHeader('content-type') as string
                  if (contentType?.includes('text/html') && body.includes(brokenPrefix)) {
                    const fixed = fixHtml(body)
                    originalSetHeader('content-length', Buffer.byteLength(fixed))
                    originalEnd.call(res, fixed)
                  } else {
                    if (body) {
                      originalEnd.call(res, body)
                    } else {
                      originalEnd.call(res, chunk, ...rest)
                    }
                  }
                } as any

                next()
              }
            )
          }
        }
      }
    ]
  },

  /**
   * 运行时配置（Runtime Config）
   *
   * Nuxt 区分"公开"和"私密"配置：
   *
   * public：会暴露给前端（浏览器端），任何用户都能看到
   *   - appTitle：应用标题，在页面标题栏中显示
   *
   * 非 public：仅在服务端可用，不会发送到浏览器
   *   - openAiApiKey：LLM API 密钥，仅服务端调用 AI 时使用
   *   - databaseUrl：数据库连接字符串，仅服务端连接数据库时使用
   *
   * 环境变量优先级：
   *   NUXT_PUBLIC_APP_TITLE > runtimeConfig.public.appTitle
   *   NUXT_OPEN_AI_API_KEY  > runtimeConfig.openAiApiKey
   */
  runtimeConfig: {
    public: {
      appTitle: process.env.APP_TITLE || 'AI 对话助手'
    },
    openAiApiKey: process.env.OPENAI_API_KEY,
    openAiBaseUrl: process.env.OPENAI_BASE_URL,
    systemPrompt: process.env.SYSTEM_PROMPT || '',
    databaseUrl: process.env.DATABASE_URL
  }
})
