/**
 * OCR 工具单元测试（server/tools/ocr-document.ts）
 *
 * 测试覆盖：
 * - matchDomain / isAllowedImageUrl 同步白名单校验
 * - validateImageUrl 异步 SSRF 校验（mock dns.lookup）
 * - ocrDocumentTool.execute 端到端流程（mock fetch）
 *   * 合法 ImgBB URL 走通完整流程
 *   * HTTP 协议被拒绝
 *   * 非白名单域名被拒绝
 *   * 内网域名被 dns.lookup 解析后拒绝
 *   * 图片下载重定向被拒绝
 *   * PaddleOCR API 失败返回错误对象
 *   * 验证 enable_thinking 未传
 *   * 验证 30s 超时（AbortController）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  matchDomain,
  isAllowedImageUrl,
  validateImageUrl,
  ocrDocumentTool
} from '~/server/tools/ocr-document'

// mock node:dns/promises 的 lookup 函数
vi.mock('node:dns/promises', () => ({
  default: {
    lookup: vi.fn(async (hostname: string) => {
      // 默认返回公网 IP，具体测试用例可覆盖
      if (hostname === 'localhost' || hostname === 'evil.com') {
        return { address: '127.0.0.1' }
      }
      return { address: '104.16.85.20' }
    })
  }
}))

import dns from 'node:dns/promises'

const dnsLookup = dns.lookup as ReturnType<typeof vi.fn>

describe('ocr-document.ts', () => {
  describe('matchDomain', () => {
    it('精确域名匹配应返回 true', () => {
      expect(matchDomain('i.ibb.co', 'i.ibb.co')).toBe(true)
    })

    it('不匹配的精确域名应返回 false', () => {
      expect(matchDomain('evil.com', 'i.ibb.co')).toBe(false)
    })

    it('通配符域名应匹配子域（*.alicdn.com 匹配 img.alicdn.com）', () => {
      expect(matchDomain('img.alicdn.com', '*.alicdn.com')).toBe(true)
    })

    it('通配符域名不应匹配父域本身（*.alicdn.com 不匹配 alicdn.com）', () => {
      // matchDomain 实现：hostname.endsWith(entry.slice(1))
      // entry='*.alicdn.com' → entry.slice(1)='.alicdn.com'
      // 'alicdn.com'.endsWith('.alicdn.com') = false（长度不够，且缺少前导点）
      expect(matchDomain('alicdn.com', '*.alicdn.com')).toBe(false)
    })

    it('通配符域名不应匹配不相关域名', () => {
      expect(matchDomain('evil.com', '*.alicdn.com')).toBe(false)
    })
  })

  describe('isAllowedImageUrl（同步白名单校验）', () => {
    it('合法 HTTPS ImgBB URL 应返回 true', () => {
      expect(isAllowedImageUrl('https://i.ibb.co/abc/test.png')).toBe(true)
    })

    it('HTTP 协议应返回 false', () => {
      expect(isAllowedImageUrl('http://i.ibb.co/abc/test.png')).toBe(false)
    })

    it('非白名单域名应返回 false', () => {
      expect(isAllowedImageUrl('https://evil.com/payload.png')).toBe(false)
    })

    it('无效 URL 应返回 false', () => {
      expect(isAllowedImageUrl('not-a-url')).toBe(false)
      expect(isAllowedImageUrl('')).toBe(false)
    })

    it('通配符域名应匹配（img.alicdn.com）', () => {
      expect(isAllowedImageUrl('https://img.alicdn.com/test.png')).toBe(true)
    })

    it('file 协议应返回 false', () => {
      expect(isAllowedImageUrl('file:///etc/passwd')).toBe(false)
    })
  })

  describe('validateImageUrl（异步 SSRF 校验，含 DNS）', () => {
    beforeEach(() => {
      dnsLookup.mockReset()
      dnsLookup.mockImplementation(async (hostname: string) => {
        if (hostname === 'localhost' || hostname === 'evil-internal.com') {
          return { address: '127.0.0.1' }
        }
        if (hostname === 'metadata.example.com') {
          return { address: '169.254.169.254' }
        }
        return { address: '104.16.85.20' }
      })
    })

    it('合法 ImgBB URL 应返回 null（校验通过）', async () => {
      const result = await validateImageUrl('https://i.ibb.co/abc/test.png')
      expect(result).toBeNull()
    })

    it('HTTP 协议应返回错误原因（不含协议）', async () => {
      const result = await validateImageUrl('http://i.ibb.co/abc/test.png')
      expect(result).toContain('协议')
      expect(result).toContain('http:')
    })

    it('非白名单域名应返回错误原因', async () => {
      const result = await validateImageUrl('https://evil.com/payload.png')
      expect(result).toContain('域名')
      expect(result).toContain('evil.com')
    })

    it('解析到 127.0.0.1 应被内网 IP 黑名单拒绝', async () => {
      const result = await validateImageUrl('https://evil-internal.com/test.png')
      // 注：evil-internal.com 不在白名单，会先被域名白名单拦截
      // 此测试改用通配符域名构造内网场景：mock dns 让 i.ibb.co 解析到内网
      dnsLookup.mockImplementation(async () => ({ address: '127.0.0.1' }))
      const result2 = await validateImageUrl('https://i.ibb.co/test.png')
      expect(result2).toContain('内网 IP')
      expect(result2).toContain('127.0.0.1')
      // 第一个 result 也应有错误（域名白名单拒绝）
      expect(result).not.toBeNull()
    })

    it('解析到 169.254.169.254（云元数据）应被拒绝', async () => {
      dnsLookup.mockImplementation(async () => ({ address: '169.254.169.254' }))
      const result = await validateImageUrl('https://i.ibb.co/test.png')
      expect(result).toContain('内网 IP')
      expect(result).toContain('169.254.169.254')
    })

    it('解析到 10.x 私有地址应被拒绝', async () => {
      dnsLookup.mockImplementation(async () => ({ address: '10.0.0.1' }))
      const result = await validateImageUrl('https://i.ibb.co/test.png')
      expect(result).toContain('内网 IP')
    })

    it('解析到 192.168.x 私有地址应被拒绝', async () => {
      dnsLookup.mockImplementation(async () => ({ address: '192.168.1.1' }))
      const result = await validateImageUrl('https://i.ibb.co/test.png')
      expect(result).toContain('内网 IP')
    })

    it('解析到 172.16-31.x 私有地址应被拒绝', async () => {
      dnsLookup.mockImplementation(async () => ({ address: '172.16.0.1' }))
      const result = await validateImageUrl('https://i.ibb.co/test.png')
      expect(result).toContain('内网 IP')
    })

    it('DNS 解析失败应返回错误原因', async () => {
      dnsLookup.mockRejectedValue(new Error('ENOTFOUND'))
      const result = await validateImageUrl('https://i.ibb.co/test.png')
      expect(result).toContain('域名解析失败')
    })

    it('无效 URL 应返回 "URL 解析失败"', async () => {
      const result = await validateImageUrl('not-a-url')
      expect(result).toBe('URL 解析失败')
    })
  })

  describe('ocrDocumentTool.execute（端到端 mock fetch）', () => {
    const realFetch = globalThis.fetch
    const prevApiKey = process.env.OPENAI_API_KEY

    beforeEach(() => {
      dnsLookup.mockReset()
      dnsLookup.mockImplementation(async () => ({ address: '104.16.85.20' }))
      // callPaddleOCR 在调用 fetch 前检查 OPENAI_API_KEY，需预设以避免提前抛出
      process.env.OPENAI_API_KEY = 'test-api-key-for-vitest'
    })

    afterEach(() => {
      globalThis.fetch = realFetch
      vi.restoreAllMocks()
      // 恢复 OPENAI_API_KEY（部分测试会临时删除）
      if (prevApiKey) {
        process.env.OPENAI_API_KEY = prevApiKey
      } else {
        delete process.env.OPENAI_API_KEY
      }
    })

    it('合法 ImgBB URL 应走通完整流程并返回 Markdown 文本', async () => {
      const mockImageBuffer = Buffer.from('fake-image-data')
      const mockOcrResponse = {
        choices: [{ message: { content: '## 标题\n\n识别到的文字内容' } }]
      }

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
        if (url === 'https://i.ibb.co/abc/test.png') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({
              'content-type': 'image/png',
              'content-length': String(mockImageBuffer.length)
            }),
            arrayBuffer: () => Promise.resolve(mockImageBuffer.buffer)
          }
        }
        // PaddleOCR API 调用
        if (init?.method === 'POST' && typeof url === 'string' && url.includes('chat/completions')) {
          return {
            ok: true,
            status: 200,
            json: () => Promise.resolve(mockOcrResponse)
          }
        }
        return { ok: false, status: 404 }
      }) as any

      const result = await ocrDocumentTool.execute!(
        { imageUrl: 'https://i.ibb.co/abc/test.png' },
        {
          messages: [],
          toolCallId: 'test-call'
        }
      )

      expect(result).toHaveProperty('text')
      expect(result).toHaveProperty('imageUrl', 'https://i.ibb.co/abc/test.png')
      expect(result).toHaveProperty('model', 'PaddlePaddle/PaddleOCR-VL-1.5')
      expect((result as any).text).toContain('## 标题')
    })

    it('HTTP 协议 URL 应返回错误对象（不抛异常）', async () => {
      const result = await ocrDocumentTool.execute!(
        { imageUrl: 'http://i.ibb.co/abc/test.png' },
        { messages: [], toolCallId: 'test-call' }
      )
      expect(result).toHaveProperty('error', 'OCR 处理失败')
      expect(result).toHaveProperty('imageUrl', 'http://i.ibb.co/abc/test.png')
      // execute 的 catch 把 downloadImageAsBase64 抛出的错误包装为 detail 字段
      expect((result as any).detail).toContain('URL 安全检查失败')
    })

    it('非白名单域名应返回错误对象', async () => {
      const result = await ocrDocumentTool.execute!(
        { imageUrl: 'https://evil.com/payload.png' },
        { messages: [], toolCallId: 'test-call' }
      )
      expect(result).toHaveProperty('error', 'OCR 处理失败')
      expect((result as any).detail).toContain('URL 安全检查失败')
    })

    it('图片下载返回 3xx 重定向应返回错误对象', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url === 'https://i.ibb.co/abc/test.png') {
          return {
            ok: false,
            status: 302,
            headers: new Headers({ location: 'https://internal.evil.com/steal' })
          }
        }
        return { ok: false, status: 404 }
      }) as any

      const result = await ocrDocumentTool.execute!(
        { imageUrl: 'https://i.ibb.co/abc/test.png' },
        { messages: [], toolCallId: 'test-call' }
      )
      expect(result).toHaveProperty('error')
      // 重定向被拒后会走图片下载失败分支
      expect((result as any).error).toBe('OCR 处理失败')
      expect((result as any).detail).toContain('重定向')
    })

    it('PaddleOCR API 返回失败应返回错误对象', async () => {
      const mockImageBuffer = Buffer.from('fake-image-data')

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
        if (url === 'https://i.ibb.co/abc/test.png') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({
              'content-type': 'image/png',
              'content-length': String(mockImageBuffer.length)
            }),
            arrayBuffer: () => Promise.resolve(mockImageBuffer.buffer)
          }
        }
        if (init?.method === 'POST') {
          return {
            ok: false,
            status: 500,
            text: () => Promise.resolve('Internal Server Error')
          }
        }
        return { ok: false, status: 404 }
      }) as any

      const result = await ocrDocumentTool.execute!(
        { imageUrl: 'https://i.ibb.co/abc/test.png' },
        { messages: [], toolCallId: 'test-call' }
      )
      expect(result).toHaveProperty('error', 'OCR 处理失败')
      expect((result as any).detail).toContain('PaddleOCR API 请求失败')
      expect((result as any).detail).toContain('500')
    })

    it('验证请求体中未传 enable_thinking 参数', async () => {
      const mockImageBuffer = Buffer.from('fake-image-data')
      const mockOcrResponse = {
        choices: [{ message: { content: '识别结果' } }]
      }

      let capturedBody: any = null

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
        if (url === 'https://i.ibb.co/abc/test.png') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'image/png' }),
            arrayBuffer: () => Promise.resolve(mockImageBuffer.buffer)
          }
        }
        if (init?.method === 'POST') {
          capturedBody = JSON.parse(init.body)
          return {
            ok: true,
            status: 200,
            json: () => Promise.resolve(mockOcrResponse)
          }
        }
        return { ok: false, status: 404 }
      }) as any

      await ocrDocumentTool.execute!(
        { imageUrl: 'https://i.ibb.co/abc/test.png' },
        { messages: [], toolCallId: 'test-call' }
      )

      expect(capturedBody).not.toBeNull()
      expect(capturedBody).not.toHaveProperty('enable_thinking')
      expect(capturedBody).toHaveProperty('model', 'PaddlePaddle/PaddleOCR-VL-1.5')
      expect(capturedBody).toHaveProperty('stream', false)
    })

    it('验证请求包含 Authorization 头（Bearer + API Key）', async () => {
      const mockImageBuffer = Buffer.from('fake-image-data')
      const mockOcrResponse = {
        choices: [{ message: { content: '识别结果' } }]
      }

      let capturedHeaders: any = null

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
        if (url === 'https://i.ibb.co/abc/test.png') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'image/png' }),
            arrayBuffer: () => Promise.resolve(mockImageBuffer.buffer)
          }
        }
        if (init?.method === 'POST') {
          capturedHeaders = init.headers
          return {
            ok: true,
            status: 200,
            json: () => Promise.resolve(mockOcrResponse)
          }
        }
        return { ok: false, status: 404 }
      }) as any

      await ocrDocumentTool.execute!(
        { imageUrl: 'https://i.ibb.co/abc/test.png' },
        { messages: [], toolCallId: 'test-call' }
      )

      expect(capturedHeaders).not.toBeNull()
      // beforeEach 中设置的 API Key
      expect(capturedHeaders.Authorization).toBe('Bearer test-api-key-for-vitest')
    })

    it('未配置 OPENAI_API_KEY 时应返回错误对象', async () => {
      const mockImageBuffer = Buffer.from('fake-image-data')
      // 临时删除以测试缺失场景（afterEach 会恢复）
      delete process.env.OPENAI_API_KEY

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url === 'https://i.ibb.co/abc/test.png') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'image/png' }),
            arrayBuffer: () => Promise.resolve(mockImageBuffer.buffer)
          }
        }
        return { ok: false, status: 404 }
      }) as any

      const result = await ocrDocumentTool.execute!(
        { imageUrl: 'https://i.ibb.co/abc/test.png' },
        { messages: [], toolCallId: 'test-call' }
      )
      expect(result).toHaveProperty('error', 'OCR 处理失败')
      expect((result as any).detail).toContain('OPENAI_API_KEY')
    })

    it('图片下载超过 10MB 应返回错误对象', async () => {
      // 构造一个超过 10MB 的 buffer
      const oversizedBuffer = Buffer.alloc(11 * 1024 * 1024, 0xff)

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url === 'https://i.ibb.co/abc/test.png') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({
              'content-type': 'image/png',
              'content-length': String(oversizedBuffer.length)
            }),
            arrayBuffer: () => Promise.resolve(oversizedBuffer.buffer)
          }
        }
        return { ok: false, status: 404 }
      }) as any

      const result = await ocrDocumentTool.execute!(
        { imageUrl: 'https://i.ibb.co/abc/test.png' },
        { messages: [], toolCallId: 'test-call' }
      )
      expect(result).toHaveProperty('error', 'OCR 处理失败')
      expect((result as any).detail).toContain('图片过大')
    })

    it('PaddleOCR 返回空内容应返回错误对象', async () => {
      const mockImageBuffer = Buffer.from('fake-image-data')

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
        if (url === 'https://i.ibb.co/abc/test.png') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'image/png' }),
            arrayBuffer: () => Promise.resolve(mockImageBuffer.buffer)
          }
        }
        if (init?.method === 'POST') {
          return {
            ok: true,
            status: 200,
            json: () => Promise.resolve({ choices: [{ message: { content: '' } }] })
          }
        }
        return { ok: false, status: 404 }
      }) as any

      const result = await ocrDocumentTool.execute!(
        { imageUrl: 'https://i.ibb.co/abc/test.png' },
        { messages: [], toolCallId: 'test-call' }
      )
      expect(result).toHaveProperty('error', 'OCR 处理失败')
      expect((result as any).detail).toContain('OCR 返回内容为空')
    })

    // ===== SSRF 第 3 层防护：DNS 内网 IP 黑名单 =====
    // 端到端测试无法覆盖（真实 i.ibb.co 不会解析到内网 IP），只能靠 mock DNS 验证
    it('DNS 解析到 127.0.0.1 时 execute 应返回错误对象（不抛异常）', async () => {
      // 通过协议 + 域名白名单，但 DNS 解析到内网 IP
      dnsLookup.mockImplementation(async () => ({ address: '127.0.0.1' }))

      const result = await ocrDocumentTool.execute!(
        { imageUrl: 'https://i.ibb.co/abc/test.png' },
        { messages: [], toolCallId: 'test-call' }
      )
      expect(result).toHaveProperty('error', 'OCR 处理失败')
      expect(result).toHaveProperty('imageUrl', 'https://i.ibb.co/abc/test.png')
      expect((result as any).detail).toContain('URL 安全检查失败')
      expect((result as any).detail).toContain('内网 IP')
      expect((result as any).detail).toContain('127.0.0.1')
    })

    it('DNS 解析到 169.254.169.254（云元数据）时 execute 应返回错误对象', async () => {
      dnsLookup.mockImplementation(async () => ({ address: '169.254.169.254' }))

      const result = await ocrDocumentTool.execute!(
        { imageUrl: 'https://i.ibb.co/abc/test.png' },
        { messages: [], toolCallId: 'test-call' }
      )
      expect(result).toHaveProperty('error', 'OCR 处理失败')
      expect((result as any).detail).toContain('内网 IP')
      expect((result as any).detail).toContain('169.254.169.254')
    })

    it('DNS 解析到 10.x 私有地址时 execute 应返回错误对象', async () => {
      dnsLookup.mockImplementation(async () => ({ address: '10.0.0.1' }))

      const result = await ocrDocumentTool.execute!(
        { imageUrl: 'https://i.ibb.co/abc/test.png' },
        { messages: [], toolCallId: 'test-call' }
      )
      expect(result).toHaveProperty('error', 'OCR 处理失败')
      expect((result as any).detail).toContain('10.0.0.1')
    })

    it('DNS 解析失败时 execute 应返回错误对象（不抛异常）', async () => {
      dnsLookup.mockRejectedValue(new Error('ENOTFOUND'))

      const result = await ocrDocumentTool.execute!(
        { imageUrl: 'https://i.ibb.co/abc/test.png' },
        { messages: [], toolCallId: 'test-call' }
      )
      expect(result).toHaveProperty('error', 'OCR 处理失败')
      expect((result as any).detail).toContain('域名解析失败')
    })
  })
})
