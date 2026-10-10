/**
 * /api 限流阈值可配性测试
 *
 * 钉住两件事：阈值确实从 runtimeConfig.rateLimitMax 读取（e2e 靠它才不被自己的限流打挂），
 * 以及超限仍按 429 + Retry-After 拒绝、响应头反映的是配置值而非硬编码 30。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const g = globalThis as any

/** 每个用例用独立 IP，避免模块级 rateLimitMap 跨用例串扰 */
let ipSeq = 0
function nextIp(): string {
  ipSeq += 1
  return `10.77.${ipSeq}.1`
}

function makeEvent(ip: string) {
  const headers: Record<string, string> = {}
  return {
    node: {
      req: { headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: ip } },
      res: {
        setHeader: (name: string, value: string) => {
          headers[name] = value
        },
        statusCode: 200
      }
    },
    context: {},
    url: 'http://localhost/api/models',
    headers
  }
}

function useRateLimit(max: number | undefined) {
  g.getRequestURL = (event: any) => new URL(event.url)
  g.getRequestHeader = () => ''
  g.useRuntimeConfig = () => ({ rateLimitMax: max })
}

async function handler() {
  const mod = await import('~/server/middleware/security')
  return mod.default as (event: any) => Promise<unknown>
}

describe('security 中间件限流', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('按 runtimeConfig.rateLimitMax 生效并在超限时返回 429', async () => {
    useRateLimit(3)
    const run = await handler()
    const ip = nextIp()

    for (let i = 0; i < 3; i++) {
      await expect(run(makeEvent(ip))).resolves.not.toThrow()
    }

    const err = await run(makeEvent(ip))
      .then(() => null)
      .catch((e: unknown) => e as Error & { statusCode?: number })
    expect(err?.statusCode).toBe(429)
  })

  it('X-RateLimit-Limit 反映配置值而非硬编码', async () => {
    useRateLimit(1234)
    const run = await handler()
    const event = makeEvent(nextIp())

    await run(event)

    expect(event.headers['X-RateLimit-Limit']).toBe('1234')
    expect(event.headers['X-RateLimit-Remaining']).toBe('1233')
  })

  it('未配置 rateLimitMax 时回落到默认 30', async () => {
    useRateLimit(undefined)
    const run = await handler()
    const event = makeEvent(nextIp())

    await run(event)

    expect(event.headers['X-RateLimit-Limit']).toBe('30')
  })
})
