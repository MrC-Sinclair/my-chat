import { tool } from 'ai'
import { z } from 'zod'
import dns from 'node:dns/promises'

/**
 * PaddleOCR-VL-1.5 工具：作为通用对话模型可调用的 OCR 能力
 *
 * 设计要点（详见 openspec/changes/add-ocr-tool/design.md）：
 * - 不在模型选择器中暴露，完全隐入后端工具层
 * - 调用 PaddlePaddle/PaddleOCR-VL-1.5（硅基流动提供，复用 OPENAI_API_KEY）
 * - 单图处理（多图 API 报 400），固定 OCR 指令（空 prompt 触发 raw token）
 * - 不传 enable_thinking（实测会让输出降级）
 * - SSRF 三重防护：协议 + 域名白名单 + 内网 IP 黑名单
 */

/** PaddleOCR API 端点与模型名 */
const OCR_API_ENDPOINT =
  (process.env.OPENAI_BASE_URL || 'https://api.siliconflow.cn/v1') + '/chat/completions'
const OCR_MODEL = 'PaddlePaddle/PaddleOCR-VL-1.5'

/** 工具内部固定 OCR 指令（实测空 prompt 会触发 raw token 输出，必须明确指令） */
const OCR_INSTRUCTION = `请提取图片中的文字，按结构化 Markdown 输出：
- 标题用 ## / ###
- 表格用 Markdown 表格语法（| 列 | 列 | + --- 分隔行）
- 印章用「印章：内容」标记
- 公式用 LaTeX 包裹
- 保持原文版面结构`

/** 协议白名单：仅允许 HTTPS */
const ALLOWED_PROTOCOLS = ['https:']

/**
 * 域名白名单：仅允许常见公网图床
 * - i.ibb.co 是项目主用图床（ImgBB 直链）
 */
const ALLOWED_DOMAINS = [
  'i.ibb.co',
  'i.imgur.com',
  'cdn.discordapp.com',
  'pbs.twimg.com',
  '*.alicdn.com',
  '*.qpic.cn',
  '*.weixin.qq.com'
]

/**
 * 内网 IP 黑名单（IPv4 + IPv6）
 * - RFC 1918 私有地址
 * - link-local（含云元数据 169.254.169.254）
 * - IPv6 loopback / link-local / ULA
 */
const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^fe80:/i,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i
]

/** 图片下载大小上限：10MB（PaddleOCR 通常 4MB） */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** PaddleOCR API 调用超时：30 秒（OCR 推理比纯文本慢） */
const OCR_API_TIMEOUT_MS = 30_000

/**
 * 校验域名是否匹配白名单条目（支持通配符 *.example.com）
 */
export function matchDomain(hostname: string, entry: string): boolean {
  if (entry.startsWith('*.')) {
    return hostname.endsWith(entry.slice(1))
  }
  return hostname === entry
}

/**
 * 客户端可用的同步 URL 安全校验：仅检查协议 + 域名白名单
 * 不含 DNS 内网 IP 检查（Node API 仅服务端可用），用于 ToolInvocation 组件渲染缩略图前的安全校验
 *
 * @returns true 表示 URL 协议与域名通过白名单校验
 */
export function isAllowedImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) return false
    const hostname = parsed.hostname.toLowerCase()
    return ALLOWED_DOMAINS.some((d) => matchDomain(hostname, d))
  } catch {
    return false
  }
}

/**
 * SSRF 防护：校验图片 URL 是否安全（服务端，含 DNS 内网 IP 检查）
 * 三重防护：协议白名单 + 域名白名单 + 内网 IP 黑名单
 *
 * @returns 校验通过返回 null，失败返回错误原因
 */
export async function validateImageUrl(url: string): Promise<string | null> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'URL 解析失败'
  }

  // 1. 协议白名单
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return `协议 ${parsed.protocol} 不被允许（仅支持 HTTPS）`
  }

  // 2. 域名白名单
  const hostname = parsed.hostname.toLowerCase()
  if (!ALLOWED_DOMAINS.some((d) => matchDomain(hostname, d))) {
    return `域名 ${hostname} 不在白名单中`
  }

  // 3. DNS 解析并检查内网 IP（防 DNS rebinding）
  let address: string
  try {
    const lookup = await dns.lookup(hostname)
    address = lookup.address
  } catch {
    return `域名解析失败: ${hostname}`
  }
  if (PRIVATE_IP_PATTERNS.some((p) => p.test(address))) {
    return `域名解析到内网 IP ${address}`
  }

  return null
}

/**
 * 调用 PaddleOCR-VL-1.5 API，传入 base64 图片，返回 Markdown 文本
 *
 * 关键约束：
 * - 不传 enable_thinking（实测会让输出降级）
 * - 单图调用（多图 API 报 400）
 * - 用 AbortController 设置 30 秒超时
 */
async function callPaddleOCR(imageBase64: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('未配置 OPENAI_API_KEY')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OCR_API_TIMEOUT_MS)

  try {
    const response = await fetch(OCR_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: OCR_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: OCR_INSTRUCTION },
              {
                type: 'image_url',
                image_url: { url: imageBase64.startsWith('data:') ? imageBase64 : `data:image/png;base64,${imageBase64}` }
              }
            ]
          }
        ],
        stream: false,
        temperature: 0,
        max_tokens: 4096
        // 注意：不传 enable_thinking（实测会让输出降级）
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`PaddleOCR API 请求失败 (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content) {
      throw new Error(`OCR 返回内容为空或格式异常: ${JSON.stringify(data).slice(0, 200)}`)
    }
    return content
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 下载图片并转为 base64 data URL
 *
 * SSRF 防护流程：
 * 1. validateImageUrl 三重校验
 * 2. fetch 使用 redirect: 'manual'，拒绝任何 3xx 重定向（防重定向到内网）
 * 3. 检查 Content-Length，超过 10MB 拒绝
 */
async function downloadImageAsBase64(url: string): Promise<string> {
  const reason = await validateImageUrl(url)
  if (reason) {
    throw new Error(`URL 安全检查失败: ${reason}`)
  }

  const response = await fetch(url, { redirect: 'manual' })

  if (response.status >= 300 && response.status < 400) {
    throw new Error('禁止自动重定向（防 SSRF）')
  }
  if (!response.ok) {
    throw new Error(`图片下载失败: HTTP ${response.status}`)
  }

  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > MAX_IMAGE_BYTES) {
    throw new Error(`图片过大: ${contentLength} 字节（上限 10MB）`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`图片过大: ${buffer.length} 字节（上限 10MB）`)
  }

  const contentType = response.headers.get('content-type') || 'image/png'
  return `data:${contentType};base64,${buffer.toString('base64')}`
}

/**
 * OCR 工具：提取图片中的文字并返回结构化 Markdown
 *
 * 调用场景：仅在用户上传图片且需要 OCR 时调用
 * 禁止场景：无图片、通用图像理解、普通照片、人物、风景
 */
export const ocrDocumentTool = tool({
  description:
    '提取图片中的文字，输出结构化 Markdown（含表格、印章、公式等）。仅在用户上传图片且需要 OCR（提取文字、识别、表格转 Markdown、文档结构化、印章/签名/手写识别等）时调用。无图片时禁止调用，不要在通用图像理解（如「图中是什么」「描述图片」）时调用。',
  inputSchema: z.object({
    imageUrl: z
      .string()
      .url()
      .describe('图片的公开 URL（仅支持 i.ibb.co 等白名单域名，必须 HTTPS）')
  }),
  execute: async ({ imageUrl }) => {
    try {
      const base64DataUrl = await downloadImageAsBase64(imageUrl)
      const markdownText = await callPaddleOCR(base64DataUrl)
      return {
        text: markdownText,
        imageUrl,
        model: OCR_MODEL
      }
    } catch (error) {
      // 与 web-search 模式一致：不抛异常，返回结构化错误对象让 LLM 处理
      const detail = error instanceof Error ? error.message : String(error)
      return {
        error: 'OCR 处理失败',
        detail,
        imageUrl
      }
    }
  }
})
