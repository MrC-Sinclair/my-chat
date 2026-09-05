/**
 * GitHub 文件读取工具单元测试（server/tools/github-file.ts）
 *
 * 测试覆盖：
 * - fetchGitHubFile 成功返回内容与元数据（repo/path/branch/size/rawUrl）
 * - GITHUB_TOKEN 配置与否的 Authorization 头行为
 * - 404 / 403（限流）/ 500 返回结构化错误对象（不抛异常）
 * - 二进制文件（application/octet-stream）拒绝注入并返回 rawUrl
 * - 超长内容截断（truncated + 截断长度）
 * - 网络异常降级为错误对象
 * - 路径特殊字符按段编码 / branch → ?ref= 查询参数
 * - githubFileTool.execute 包装（截断时附加 notice）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchGitHubFile, githubFileTool } from '~/server/tools/github-file'

describe('github-file.ts', () => {
  const realFetch = globalThis.fetch
  const prevToken = process.env.GITHUB_TOKEN

  beforeEach(() => {
    // 默认无 token 场景，具体用例按需覆盖
    delete process.env.GITHUB_TOKEN
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
    if (prevToken !== undefined) {
      process.env.GITHUB_TOKEN = prevToken
    } else {
      delete process.env.GITHUB_TOKEN
    }
  })

  describe('fetchGitHubFile 成功路径', () => {
    it('应返回文件内容与元数据（默认分支 → rawUrl 使用 HEAD）', async () => {
      let capturedUrl = ''
      let capturedHeaders: Record<string, string> = {}
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
        capturedUrl = url
        capturedHeaders = init?.headers || {}
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain; charset=utf-8' }),
          text: () => Promise.resolve('export const hello = "github"')
        }
      }) as any

      const result = await fetchGitHubFile({
        owner: 'vercel',
        repo: 'ai',
        path: 'packages/ai/core/index.ts'
      })

      expect(result).not.toHaveProperty('error')
      const ok = result as Exclude<typeof result, { error: string; detail: string }>
      expect(ok.content).toBe('export const hello = "github"')
      expect(ok.repo).toBe('vercel/ai')
      expect(ok.branch).toBeNull()
      expect(ok.truncated).toBe(false)
      expect(ok.size).toBe(Buffer.byteLength('export const hello = "github"', 'utf8'))
      expect(ok.rawUrl).toBe(
        'https://raw.githubusercontent.com/vercel/ai/HEAD/packages/ai/core/index.ts'
      )
      // 默认 Accept 为 raw 媒体类型（GitHub Contents API 支持最大 100MB 文件）
      expect(capturedHeaders.Accept).toBe('application/vnd.github.raw+json')
      expect(capturedUrl).toBe(
        'https://api.github.com/repos/vercel/ai/contents/packages/ai/core/index.ts'
      )
    })

    it('branch 参数应拼接为 ?ref= 查询参数，rawUrl 使用该分支', async () => {
      let capturedUrl = ''
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        capturedUrl = url
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: () => Promise.resolve('readme')
        }
      }) as any

      await fetchGitHubFile({ owner: 'o', repo: 'r', path: 'README.md', branch: 'main' })
      expect(capturedUrl).toContain('?ref=main')
      expect(capturedUrl).toBe('https://api.github.com/repos/o/r/contents/README.md?ref=main')
    })

    it('路径特殊字符应按段编码（空格/#/? 不破坏 URL 结构）', async () => {
      let capturedUrl = ''
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        capturedUrl = url
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: () => Promise.resolve('x')
        }
      }) as any

      await fetchGitHubFile({ owner: 'o', repo: 'r', path: 'a b/c#d.ts' })
      expect(capturedUrl).toBe('https://api.github.com/repos/o/r/contents/a%20b/c%23d.ts')
    })
  })

  describe('Authorization 头（GITHUB_TOKEN 可选）', () => {
    it('配置 GITHUB_TOKEN 时应携带 Bearer 头', async () => {
      process.env.GITHUB_TOKEN = 'ghp-test-token'
      let capturedHeaders: Record<string, string> = {}
      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: any) => {
        capturedHeaders = init?.headers || {}
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: () => Promise.resolve('x')
        }
      }) as any

      await fetchGitHubFile({ owner: 'o', repo: 'r', path: 'f.ts' })
      expect(capturedHeaders.Authorization).toBe('Bearer ghp-test-token')
    })

    it('未配置 GITHUB_TOKEN 时不应携带 Authorization 头', async () => {
      let capturedHeaders: Record<string, string> = {}
      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: any) => {
        capturedHeaders = init?.headers || {}
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: () => Promise.resolve('x')
        }
      }) as any

      await fetchGitHubFile({ owner: 'o', repo: 'r', path: 'f.ts' })
      expect(capturedHeaders).not.toHaveProperty('Authorization')
    })
  })

  describe('fetchGitHubFile 错误路径（返回错误对象，不抛异常）', () => {
    const mockTextResponse = (status: number, body = '') => ({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: () => Promise.resolve(body)
    })

    it('404 应返回「文件或仓库不存在」', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(mockTextResponse(404)) as any

      const result = await fetchGitHubFile({ owner: 'o', repo: 'r', path: 'no.ts' })
      expect(result).toHaveProperty('error', '文件或仓库不存在')
      expect((result as any).detail).toContain('404')
      // 错误详情应包含请求参数便于 LLM 自查
      expect((result as any).detail).toContain('o')
      expect((result as any).detail).toContain('no.ts')
    })

    it('403 应返回限流提示并建议配置 GITHUB_TOKEN', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(mockTextResponse(403)) as any

      const result = await fetchGitHubFile({ owner: 'o', repo: 'r', path: 'f.ts' })
      expect(result).toHaveProperty('error', 'GitHub API 请求受限')
      expect((result as any).detail).toContain('GITHUB_TOKEN')
    })

    it('500 应返回通用请求失败', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(mockTextResponse(500)) as any

      const result = await fetchGitHubFile({ owner: 'o', repo: 'r', path: 'f.ts' })
      expect(result).toHaveProperty('error', 'GitHub API 请求失败')
      expect((result as any).detail).toContain('500')
    })

    it('网络异常应降级为错误对象（不抛异常）', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any

      const result = await fetchGitHubFile({ owner: 'o', repo: 'r', path: 'f.ts' })
      expect(result).toHaveProperty('error', 'GitHub API 网络请求失败')
      expect((result as any).detail).toContain('ECONNREFUSED')
    })

    it('二进制文件（octet-stream）应拒绝注入并返回 rawUrl', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        text: () => Promise.resolve('\x00\x01binary')
      }) as any

      const result = await fetchGitHubFile({ owner: 'o', repo: 'r', path: 'img.png' })
      expect(result).toHaveProperty('error', '二进制文件不支持读取')
      expect((result as any).detail).toContain('rawUrl')
      expect((result as any).detail).toContain('https://raw.githubusercontent.com/')
    })
  })

  describe('超长内容截断', () => {
    it('超过字符上限应截断并标记 truncated', async () => {
      // MAX_CONTENT_CHARS = 50_000（工具内部常量，此处构造 60_000 字符触发截断）
      const longText = 'a'.repeat(60_000)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve(longText)
      }) as any

      const result = await fetchGitHubFile({ owner: 'o', repo: 'r', path: 'big.ts' })
      expect(result).not.toHaveProperty('error')
      const ok = result as Exclude<typeof result, { error: string; detail: string }>
      expect(ok.truncated).toBe(true)
      expect(ok.content.length).toBe(50_000)
    })
  })

  describe('githubFileTool.execute 包装', () => {
    it('截断时应在返回值附加 notice 提示', async () => {
      const longText = 'b'.repeat(60_000)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve(longText)
      }) as any

      const result = (await githubFileTool.execute!(
        { owner: 'o', repo: 'r', path: 'big.ts' },
        { messages: [], toolCallId: 'test-call' }
      )) as any

      expect(result.truncated).toBe(true)
      expect(result.notice).toContain('截断')
      expect(result.notice).toContain('rawUrl')
    })

    it('未截断时不应附加 notice', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve('short')
      }) as any

      const result = (await githubFileTool.execute!(
        { owner: 'o', repo: 'r', path: 'small.ts' },
        { messages: [], toolCallId: 'test-call' }
      )) as any

      expect(result.truncated).toBe(false)
      expect(result).not.toHaveProperty('notice')
    })

    it('上游错误应原样透传（不抛异常）', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve('Not Found')
      }) as any

      const result = (await githubFileTool.execute!(
        { owner: 'o', repo: 'r', path: 'no.ts' },
        { messages: [], toolCallId: 'test-call' }
      )) as any

      expect(result).toHaveProperty('error', '文件或仓库不存在')
      expect(result).toHaveProperty('detail')
    })
  })
})
