import { tool } from 'ai'
import { z } from 'zod'

/**
 * GitHub 文件读取工具：LLM 自主调用 GitHub API 实时拉取指定文件内容
 *
 * 设计要点：
 * - 实时性：每次调用都请求 GitHub API，仓库更新立即生效，无缓存
 * - 鉴权可选：未配置 GITHUB_TOKEN 时可访问公开仓库（限额 60 次/小时/IP），
 *   配置后提升至 5000 次/小时并支持私有仓库（token 仅在服务端使用，不暴露前端）
 * - 大对象不进 LLM 上下文：超过字符上限的内容截断返回，并附 rawUrl 供引用完整文件
 * - 失败不抛异常：返回 { error, detail } 结构化错误，由 LLM 决定重试或换路径
 */

const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_API_VERSION = '2022-11-28'

/** GitHub API 调用超时：30 秒 */
const GITHUB_API_TIMEOUT_MS = 30_000

/** 注入 LLM 上下文的文件内容字符上限（超出截断，附 rawUrl 引用完整内容） */
const MAX_CONTENT_CHARS = 50_000

/** raw 文本响应之外的类型视为二进制文件，不注入 LLM 上下文 */
const BINARY_CONTENT_TYPE = 'application/octet-stream'

/** 仓库内路径按段编码（保留 / 分隔符，处理空格、#、? 等特殊字符） */
function encodeRepoPath(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

export interface GitHubFileResult {
  repo: string
  path: string
  branch: string | null
  size: number
  content: string
  truncated: boolean
  rawUrl: string
}

export interface GitHubFileError {
  error: string
  detail: string
}

/**
 * 调用 GitHub Contents API 拉取文件内容（raw 媒体类型，支持最大 100MB 的文件）
 *
 * @returns 成功返回文件内容与元数据，失败返回结构化错误（不抛异常）
 */
export async function fetchGitHubFile(params: {
  owner: string
  repo: string
  path: string
  branch?: string
}): Promise<GitHubFileResult | GitHubFileError> {
  const { owner, repo, path, branch } = params

  const url =
    `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    `/contents/${encodeRepoPath(path)}` +
    (branch ? `?ref=${encodeURIComponent(branch)}` : '')

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.raw+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    // GitHub API 要求所有请求携带 User-Agent，缺失会返回 403
    'User-Agent': 'my-chat-app'
  }
  const token = process.env.GITHUB_TOKEN
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GITHUB_API_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, { headers, signal: controller.signal })
  } catch (error) {
    // 仅吞掉网络层异常（DNS 失败/超时 abort/连接拒绝），此类错误统一降级为结构化错误返回
    const detail = error instanceof Error ? error.message : String(error)
    return { error: 'GitHub API 网络请求失败', detail }
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    if (response.status === 404) {
      return {
        error: '文件或仓库不存在',
        detail: `HTTP 404：请确认 owner/repo/path/branch 拼写是否正确（owner=${owner}, repo=${repo}, path=${path}${branch ? `, branch=${branch}` : ''}）。私有仓库在未配置 GITHUB_TOKEN 时也会返回 404。${errorText.slice(0, 200)}`
      }
    }
    if (response.status === 403) {
      return {
        error: 'GitHub API 请求受限',
        detail: `HTTP 403：可能触发了速率限制（未配置 token 限额 60 次/小时）或无权访问私有仓库。配置 GITHUB_TOKEN 环境变量后重试。${errorText.slice(0, 200)}`
      }
    }
    return {
      error: 'GitHub API 请求失败',
      detail: `HTTP ${response.status}: ${errorText.slice(0, 200)}`
    }
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes(BINARY_CONTENT_TYPE)) {
    return {
      error: '二进制文件不支持读取',
      detail: `该文件是二进制格式（${contentType}），无法作为文本注入对话。完整文件可通过 rawUrl 下载：https://raw.githubusercontent.com/${owner}/${repo}/${branch || 'HEAD'}/${encodeRepoPath(path)}`
    }
  }

  const raw = await response.text()
  const truncated = raw.length > MAX_CONTENT_CHARS

  return {
    repo: `${owner}/${repo}`,
    path,
    branch: branch ?? null,
    size: Buffer.byteLength(raw, 'utf8'),
    content: truncated ? raw.slice(0, MAX_CONTENT_CHARS) : raw,
    truncated,
    rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch || 'HEAD'}/${encodeRepoPath(path)}`
  }
}

/**
 * GitHub 文件读取工具
 *
 * 调用场景：用户要求查看/分析/引用 GitHub 仓库中的具体文件
 * 禁止场景：未提供仓库或路径（先向用户确认）、浏览目录结构、非 GitHub 托管的代码
 */
export const githubFileTool = tool({
  description:
    '实时读取 GitHub 仓库中指定文件的内容（源码、配置、文档等，支持公开与私有仓库）。当用户要求查看、分析或引用某个 GitHub 仓库文件时调用，需提供 owner/repo/path，可选 branch（默认仓库默认分支）。不要在以下场景调用：无法从对话中确定 owner/repo/path 时（应先向用户确认）；需要浏览仓库目录结构或搜索文件（本工具只支持精确文件路径，可提示用户给出路径）；非 GitHub 托管的代码链接（GitLab、Gitee 等）。',
  inputSchema: z.object({
    owner: z.string().min(1).describe('仓库所有者（用户名或组织名），如 "vercel"'),
    repo: z.string().min(1).describe('仓库名，如 "ai"'),
    path: z
      .string()
      .min(1)
      .describe('仓库内文件路径，如 "packages/ai/core/index.ts"，不含仓库根目录前缀和分支名'),
    branch: z
      .string()
      .optional()
      .describe('分支、tag 或 commit SHA，不传则使用仓库默认分支')
  }),
  execute: async ({ owner, repo, path, branch }) => {
    const result = await fetchGitHubFile({ owner, repo, path, branch })
    if ('error' in result) {
      return result
    }
    return {
      ...result,
      // 截断时明确告知 LLM 内容不完整，避免基于残缺内容编造结论
      ...(result.truncated && {
        notice: `文件共 ${result.size} 字节，已截断至前 ${MAX_CONTENT_CHARS} 字符，完整内容见 rawUrl`
      })
    }
  }
})
