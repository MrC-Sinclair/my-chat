import { streamText, stepCountIs, createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import { createMCPClient } from '@ai-sdk/mcp'
import { Experimental_StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio'
import { db } from '~/server/db'
import { messages as messagesTable, sessions } from '~/server/db/schema'
import { eq } from 'drizzle-orm'
import { webSearchTool } from '~/server/tools/web-search'
import { ocrDocumentTool } from '~/server/tools/ocr-document'
import { recallMemoryTool } from '~/server/tools/recall-memory'
import { generateImageTool } from '~/server/tools/generate-image'
import { archiveSessionMessages } from '~/server/utils/memory-archive'
import { ALLOWED_MODEL_VALUES, getModelCapabilities } from '~/server/config/models'
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { uploadToImgBb } from '~/server/utils/imgbb'
import {
  createReasoningProvider,
  REASONING_PREFIX,
  REASONING_END
} from '~/server/utils/reasoning-provider'

const llmProvider = createReasoningProvider()

const DEFAULT_LLM_MODEL = process.env.LLM_MODEL || 'Qwen/Qwen3-8B'
const DEFAULT_ENABLE_THINKING = process.env.ENABLE_THINKING !== 'false'

const DEFAULT_SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  `你是一个友好的AI助手。请用简洁清晰的方式回答问题。

【重要规则】当用户问题涉及以下内容时，你【必须】调用网页搜索工具，禁止凭记忆回答：
- 任何包含"最新"、"今天"、"近期"、"当前"、"现在"、"最近"等时间词的问题
- 新闻、事件、政策、数据、价格等可能随时间变化的信息
- 你不确定的事实或数据

搜索后请综合搜索结果给出准确回答，并注明信息来源。
如果你没有调用搜索工具就回答了时效性问题，你的回答很可能是过时的。`

const TIME_KEYWORDS = [
  '最新',
  '今天',
  '近期',
  '当前',
  '现在',
  '最近',
  '新闻',
  '实时',
  '最新消息',
  '热点',
  '动态'
]

const MAX_MESSAGE_LENGTH = 10_00
const MAX_CONTEXT_MESSAGES = 50
const MAX_IMAGE_SIZE = 4 * 1024 * 1024
const MAX_IMAGES_PER_MESSAGE = 5
const UPLOAD_DIR = join(process.cwd(), 'public', 'uploads')

/**
 * 内网/保留 IP 判断（内联实现，不依赖 weather.ts 的 isPrivateIp）
 *
 * 用于过滤 x-forwarded-for 链路中的内网代理 IP，提取真实客户端公网 IP。
 * 与 server/tools/weather.ts 的 PRIVATE_IP_PATTERNS 保持一致，
 * 但此处独立实现以避免 chat.post.ts import weather.ts 业务函数（违反架构约束）。
 */
const PRIVATE_IP_INLINE_PATTERNS = [
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

function isPrivateIpInline(ip: string): boolean {
  return PRIVATE_IP_INLINE_PATTERNS.some((p) => p.test(ip.trim()))
}

/**
 * 读取客户端真实 IP（用于注入 system prompt，引导 LLM 调用 getCityByIp 工具）
 *
 * 优先级：
 *   1. x-forwarded-for 第一个非内网 IP（适配 Vercel/Cloudflare 等覆盖式代理）
 *   2. x-real-ip
 *   3. event.node.req.socket.remoteAddress
 *
 * 注意：当前"取第一个非内网 IP"策略不防御自建 Nginx appending 模式下的 X-Forwarded-For 伪造，
 * 影响仅限天气查询结果不准确，非安全风险。若未来 IP 定位用于敏感场景，需改为从右向左取
 * 第一个受信任的 IP（参考代理信任链配置）。
 *
 * @returns 客户端公网 IP 字符串，所有来源均为空/内网时返回空字符串
 */
function getClientIp(event: any): string {
  const headers = event?.node?.req?.headers || {}
  const remoteAddress = event?.node?.req?.socket?.remoteAddress as string | undefined

  // 收集所有可用 IP 来源（按优先级）
  const ipCandidates: string[] = []

  // 1. x-forwarded-for：逗号分隔的链路，可能含多个 IP
  const xff = headers['x-forwarded-for'] as string | undefined
  if (xff) {
    ipCandidates.push(...xff.split(',').map((s) => s.trim()).filter(Boolean))
  }

  // 2. x-real-ip
  const xRealIp = headers['x-real-ip'] as string | undefined
  if (xRealIp) {
    ipCandidates.push(xRealIp.trim())
  }

  // 3. socket remoteAddress
  if (remoteAddress) {
    ipCandidates.push(remoteAddress.trim())
  }

  // 策略一：优先返回第一个非内网 IP（适配 Vercel/Cloudflare 等覆盖式代理）
  // 在标准部署中，x-forwarded-for 第一个 IP 就是真实客户端公网 IP
  for (const ip of ipCandidates) {
    if (!isPrivateIpInline(ip)) {
      return ip
    }
  }

  // 策略二：所有来源均为内网 IP（本地开发场景），返回第一个内网 IP
  // 这样 LLM 调用 getCityByIp 时会触发 isLocal 短路，反问用户城市
  // 让本地开发也能测试整条链路（getCityByIp → isLocal → LLM 反问）
  if (ipCandidates.length > 0) {
    return ipCandidates[0]
  }

  return ''
}

/**
 * recall-memory 工具使用规则：追加到 system prompt 强化 LLM 调用判断
 * - 正向场景：用户提及过去会话内容、历史偏好、之前的技术决策
 * - 负向场景：当前会话内追问、纯知识问答、简单计算
 * - 调用后行为：基于检索结果回答，引用来源
 * - 防滥用：当前会话已有内容不调用
 */
const RECALL_MEMORY_TOOL_RULES = `
【长期记忆检索工具使用规则】
当用户问题涉及以下场景时，调用 recallMemory 工具检索跨会话的长期历史记忆：
- 用户明确提及过去会话的内容：「之前」「上次」「历史」「过去」「以前说过」「之前讨论的」「我记得」
- 需要回忆用户的历史偏好、技术决策、项目背景
- 用户询问之前讨论过但当前会话中不存在的内容

调用后行为：
- 基于检索结果回答用户问题
- 可引用来源，如「根据你之前提到的…」「在上次的讨论中…」
- 若检索返回空结果或未找到相关记忆，如实告知用户「未在历史记忆中找到相关内容」，不要编造

不要在以下场景调用此工具：
- 当前会话内已经讨论过的内容（当前会话的消息已在上下文中，无需检索）
- 纯知识问答（如「什么是 React」「解释 SSRF」）—— 这类问题用 webSearch 或直接回答
- 简单计算或事实查询（如「1+1」「中国的首都」）
- 用户未提及任何历史相关线索的常规问题
`.trim()

/**
 * OCR 工具使用规则：追加到 system prompt 强化 LLM 调用判断
 * - 正向场景：提取文字/OCR/识别/表格/印章/手写/扫描件等
 * - 负向场景：通用图像理解/图中是什么/描述图片/无图片/普通照片
 * - 关键指令：非视觉模型看到 [附图片N: URL] 时必须使用工具提取文字
 * - 防死循环：禁止重复调用同一图片
 */
const OCR_TOOL_RULES = `
【OCR 工具使用规则】
当用户上传图片且问题涉及以下场景时，调用 extractTextFromImage 工具提取文字：
- "提取文字"、"OCR"、"识别"、"转文字"
- "表格转 Markdown"、"文档结构化"
- "印章"、"签名"、"手写"
- 图片是文档、扫描件、发票、合同、表单等

重要提示：
- 用户上传图片会以两种形式之一出现在对话中：
  1. 多模态消息 parts（视觉模型可见，可直接看到图片内容）
  2. 「[附图片N: URL]」格式的文本引用（非视觉模型可见，看不到图片内容）
- 无论哪种形式，只要用户上传了图片，都表示存在待识别的图片。
- 对于非视觉模型：你只能通过「[附图片N: URL]」文本引用知道用户上传了图片。当消息中包含「[附图片N: URL]」时，你应使用 extractTextFromImage 工具提取图片中的文字，先调用工具获取文字，再基于文字内容回答用户的问题。
- 对于视觉模型：你看到的是多模态消息 parts，同样可以调用 extractTextFromImage 工具获取更精确的文字内容（尤其是表格、公式、印章、手写等需要高精度文字提取的场景）。

不要在以下场景调用此工具：
- 通用图像理解（"图中是什么"、"描述图片"）
- 用户未上传图片（既无多模态 parts，也无 [附图片N: URL] 文本引用）
- 图片是普通照片、人物、风景等
- 你已经成功获取了图片文字，不要重复调用同一图片
`.trim()

/**
 * generate-image 工具使用规则：追加到 system prompt 强化 LLM 调用判断
 * - 正向场景：用户明确请求生成图片（"画"、"生成图片"、"绘制"等）
 * - 负向场景：用户只要文字回答、用户上传图片要求识别（OCR 职责）
 * - Prompt 撰写：英文对 Kolors 效果更好，包含主体+风格+场景+细节
 * - 失败不重试：生图耗时长、消耗 API 配额，失败时解释原因不自动重试
 *
 * 注入条件：与工具注册条件严格一致（caps.toolCalling && enable_image_generation !== false）
 * 避免出现"规则说可以调用但工具未注册"（LLM 幻觉调用）或反向不一致
 */
const GENERATE_IMAGE_TOOL_RULES = `
【生图工具使用规则】
1. 当且仅当用户明确请求生成图片时才调用 generateImage 工具。典型触发词：「画」「生成图片」「绘制」「画一张」「给我画」「能画吗」「帮我画」。
2. 不要在以下场景调用：
   - 用户只要文字回答、解释、描述
   - 用户上传图片要求识别/分析（这是 OCR 工具的职责）
   - 用户描述一个场景但未要求生成图片
3. Prompt 撰写建议：
   - 英文 prompt 对 Kolors 效果更佳；如用户用中文描述，先翻译为英文再调用
   - 包含：主体（subject）+ 风格（style）+ 场景/背景（setting）+ 关键细节
   - 例：用户说"画一只在月亮下的白猫" → 调用时 prompt = "A white cat under the moonlight, soft illustration style, starry night sky background, peaceful and dreamy atmosphere"
4. 调用后基于工具返回的 imageUrl 在回答中用 markdown 图片语法 \`![描述](imageUrl)\` 嵌入，不要修改 URL。
5. 工具失败时（返回 error 字段），向用户解释失败原因，**不要**自动重试（生成耗时高，避免浪费）。
`.trim()

/**
 * 从消息中提取纯文本内容。
 * AI SDK v5 的 UIMessage 格式将文本放在 parts 数组中（{ type: 'text', text: '...' }），
 * 而旧格式直接用 content 字符串。此处兼容两种格式。
 */
function extractTextFromMessage(msg: { content?: unknown; parts?: unknown }): string {
  // AI SDK v5：优先从 parts 数组提取文本
  if (Array.isArray(msg.parts)) {
    const text = msg.parts
      .filter(
        (p: unknown) =>
          typeof p === 'object' &&
          p !== null &&
          (p as { type?: string }).type === 'text' &&
          typeof (p as { text?: string }).text === 'string'
      )
      .map((p: unknown) => (p as { text: string }).text)
      .join('')
    if (text) return text
  }
  // 旧格式或 parts 为空时回退到 content
  if (typeof msg.content === 'string') return msg.content
  return String(msg.content || '')
}

function saveBase64Image(base64: string): string {
  const match = base64.match(/^data:image\/(\w+);base64,(.+)$/)
  if (!match) throw new Error('Invalid image format')
  const ext = match[1]
  const data = match[2]
  const buffer = Buffer.from(data, 'base64')
  if (!existsSync(UPLOAD_DIR)) {
    mkdirSync(UPLOAD_DIR, { recursive: true })
  }
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  writeFileSync(join(UPLOAD_DIR, filename), buffer)
  return `/uploads/${filename}`
}

function parseBase64Meta(dataUrl: string): { base64: string; mimeType: string } | null {
  const match = dataUrl.match(/^data:([\w/+-]+);base64,(.+)$/)
  if (!match) return null
  return { mimeType: match[1], base64: match[2] }
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const {
    messages,
    sessionId,
    enable_thinking,
    thinking_budget: _thinking_budget,
    model,
    images,
    enable_web_search,
    enable_ocr,
    enable_image_generation,
    lastSessionId
  } = body ?? {}

  // 非严格 true 一律按 false 处理（默认关闭，与 enable_web_search 一致）
  const enableOcr = enable_ocr === true

  // 生图工具开关：默认开启（与 enable_web_search 一致），非严格 false 一律按 true 处理
  // 前端通过 toggle chip 控制是否允许 LLM 自主调用 generateImage 工具
  const enableImageGeneration = enable_image_generation !== false

  if (!messages || !Array.isArray(messages)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'messages 参数缺失或格式错误'
    })
  }

  let contextMessages = messages
  if (messages.length > MAX_CONTEXT_MESSAGES) {
    contextMessages = messages.slice(-MAX_CONTEXT_MESSAGES)
  }

  // 仅校验用户消息长度：AI 消息由服务端生成，长度天然可控
  // 若校验 AI 消息，长回复（含代码块/公式）会导致后续多轮对话被 400 阻断
  for (const msg of messages) {
    if (msg.role !== 'user') continue
    const text = extractTextFromMessage(msg)
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw createError({
        statusCode: 400,
        statusMessage: `单条消息长度超过限制（最多 ${MAX_MESSAGE_LENGTH} 字符）`
      })
    }
  }

  if (images && Array.isArray(images)) {
    if (images.length > MAX_IMAGES_PER_MESSAGE) {
      throw createError({
        statusCode: 400,
        statusMessage: `图片数量超过限制（最多 ${MAX_IMAGES_PER_MESSAGE} 张）`
      })
    }
    for (const img of images) {
      if (typeof img === 'string' && img.length > MAX_IMAGE_SIZE * 1.37) {
        throw createError({
          statusCode: 400,
          statusMessage: `图片大小超过限制（最多 4MB）`
        })
      }
    }
  }

  const useModel = ALLOWED_MODEL_VALUES.has(model) ? model : DEFAULT_LLM_MODEL
  const caps = getModelCapabilities(useModel)

  let imageUrls: string[] = []
  if (images && Array.isArray(images) && images.length > 0) {
    if (!process.env.IMGBB_API_KEY) {
      throw createError({
        statusCode: 400,
        statusMessage:
          '图片对话功能不可用：未配置 IMGBB_API_KEY。请在 .env 中设置 IMGBB_API_KEY 后重试。'
      })
    }
    const uploadPromises = images.map(async (img: string) => {
      if (img.startsWith('data:')) {
        const localPath = saveBase64Image(img)
        const fullPath = join(process.cwd(), 'public', localPath)
        try {
          const publicUrl = await uploadToImgBb(fullPath)
          return publicUrl
        } catch (err) {
          console.error('ImgBB 上传失败，降级使用 base64:', (err as Error).message)
          try {
            if (existsSync(fullPath)) unlinkSync(fullPath)
          } catch {
            // 忽略清理错误
          }
          return img
        }
      }
      return img
    })
    imageUrls = await Promise.all(uploadPromises)
  }

  const hasImages = imageUrls.length > 0
  const lastUserIdx = contextMessages.map((m: { role: string }) => m.role).lastIndexOf('user')

  const llmMessages = contextMessages
    .filter((msg: { role: string }) => msg.role !== 'system')
    .map((msg: { role: string; content: unknown; parts?: unknown }) => {
      const textContent = extractTextFromMessage(msg)

      if (msg.role === 'assistant') return { role: 'assistant' as const, content: textContent }

      if (contextMessages.indexOf(msg) === lastUserIdx && hasImages) {
        // 视觉/非视觉模型分流：
        // - 视觉模型（caps.vision=true）：图片作为多模态 parts 传入，LLM 直接看到图片
        // - 非视觉模型（caps.vision=false）：不能传多模态 parts（API 报错），改为将图片 URL
        //   以文本引用形式注入最后一条用户消息（如 [附图片1: URL]），LLM 通过 URL 调 OCR 工具
        if (caps.vision) {
          const parts: Array<
            | { type: 'text'; text: string }
            | { type: 'image'; image: string | URL; mimeType?: string }
          > = [{ type: 'text', text: textContent }]

          for (const url of imageUrls) {
            if (url.startsWith('data:')) {
              // ImgBB 失败降级：复用 parseBase64Meta 提取 base64 字符串（不是 data: URL 字符串）
              const meta = parseBase64Meta(url)
              parts.push({
                type: 'image',
                image: meta ? meta.base64 : url,
                mimeType: meta?.mimeType
              })
            } else {
              parts.push({ type: 'image', image: new URL(url) })
            }
          }
          return { role: 'user' as const, content: parts }
        } else {
          // 非视觉模型：过滤掉 data: 降级值（OCR 工具无法 fetch data URL）
          const publicUrls = imageUrls.filter((u) => !u.startsWith('data:'))
          const dataUrls = imageUrls.filter((u) => u.startsWith('data:'))
          let injectedText = textContent
          publicUrls.forEach((url, i) => {
            injectedText += `\n\n[附图片${i + 1}: ${url}]`
          })
          if (dataUrls.length > 0) {
            injectedText += `\n\n[提示：${dataUrls.length} 张图片上传失败，OCR 不可用，请重新上传]`
          }
          return { role: 'user' as const, content: injectedText }
        }
      }

      return { role: 'user' as const, content: textContent }
    })

  const thinkingEnabled = enable_thinking ?? DEFAULT_ENABLE_THINKING
  // 仅可切换思考模型（toggleableThinking）传 enable_thinking 参数给硅基流动
  // 强制思考模型（R1/GLM-Z1）不传：GLM-Z1 传了会 400 报错，R1 传了被忽略
  // 不支持思考的模型不传
  // 注：@ai-sdk/openai v2 的 providerOptions 不支持透传 enable_thinking（zod schema 严格校验），
  // 必须在 reasoning-provider.ts 的 customFetch 层注入请求体顶层字段
  const thinkingOptions = caps.toggleableThinking
    ? { enableThinking: thinkingEnabled }
    : undefined

  const webSearchEnabled = enable_web_search !== false

  let finalSystemPrompt = DEFAULT_SYSTEM_PROMPT

  // webSearch prompt 注入条件：视觉模型启用工具后也允许 web 搜索提示词注入
  // 前端按钮 v-if 保持 !caps.vision 不变（产品决策：视觉模型对话以图像理解为主，联网入口保持精简）
  if (webSearchEnabled && caps.toolCalling) {
    const lastUserMsg =
      contextMessages
        .filter((m: { role: string }) => m.role === 'user')
        .map((m: { content: unknown; parts?: unknown }) => extractTextFromMessage(m))
        .pop() || ''

    if (TIME_KEYWORDS.some((kw) => lastUserMsg.includes(kw))) {
      finalSystemPrompt +=
        '\n\n【系统提示】用户的问题涉及时效性信息，你【必须】调用网页搜索工具（webSearch）来获取最新信息，禁止凭记忆回答。'
    }
  }

  // OCR 工具规则追加：仅当 OCR toggle 开启且模型支持工具调用时
  if (enableOcr && caps.toolCalling) {
    finalSystemPrompt += `\n\n${OCR_TOOL_RULES}`
  }

  // generate-image 工具规则追加：注入条件必须与 toolsConfig 注册条件严格一致
  // （caps.toolCalling && enableImageGeneration），避免模型幻觉调用或规则与工具不一致
  if (enableImageGeneration && caps.toolCalling) {
    finalSystemPrompt += `\n\n${GENERATE_IMAGE_TOOL_RULES}`
  }

  // recall-memory 工具规则追加：模型支持工具调用时默认启用长期记忆检索
  // 注：工具本体在 toolsConfig 中注册（任务 8.1），此处仅注入使用规则指导 LLM 调用时机
  if (caps.toolCalling) {
    finalSystemPrompt += `\n\n${RECALL_MEMORY_TOOL_RULES}`
  }

  // 用户位置上下文注入：读取客户端 IP 并追加到 prompt
  // LLM 看到后自主决定是否调用 getCityByIp 工具（仅当用户未提供城市名时）
  if (caps.toolCalling) {
    const clientIp = getClientIp(event)
    if (clientIp) {
      finalSystemPrompt += `\n\n【用户位置上下文】用户当前请求 IP: ${clientIp}，如需定位用户所在城市请调用 getCityByIp 工具传入该 IP。`
    }
  }

  try {
    // 创建 MCP 客户端连接 Weather Server（stdio 传输）
    let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null
    let mcpTools: Record<string, any> = {}
    if (caps.toolCalling) {
      try {
        mcpClient = await createMCPClient({
          transport: new Experimental_StdioMCPTransport({
            // Windows 下需要用 shell 模式执行 npx，否则 spawn ENOENT
            // AI SDK 的 StdioMCPTransport 使用 shell: false，所以 Windows 上需要用完整命令
            command: process.platform === 'win32' ? 'cmd' : 'npx',
            args:
              process.platform === 'win32'
                ? ['/c', 'npx', 'tsx', 'server/mcp/weather-server.ts']
                : ['tsx', 'server/mcp/weather-server.ts'],
            stderr: 'pipe'
          })
        })
        mcpTools = await mcpClient.tools()
      } catch (err) {
        console.error('MCP Weather Server 连接失败，天气工具不可用:', err)
        // 继续运行，只是没有天气工具
      }
    }

    const toolsConfig: Record<string, any> = {
      ...mcpTools,
      // 显式 caps.toolCalling 守卫：防御性深度措施（tools 参数仅在 toolCalling=true 时传给 streamText，
      // 不加守卫工具也不会执行，但显式守卫更清晰）
      ...(webSearchEnabled && caps.toolCalling && { webSearch: webSearchTool }),
      // OCR 工具：仅当 enableOcr=true 且 caps.toolCalling=true 时注册
      // 防御性兜底：前端应已隐藏 OCR 按钮（supportsOcr = currentCapabilities.toolCalling），
      // 此处再次校验避免 enableOcr=true 但 caps.toolCalling=false 的不一致状态
      ...(enableOcr && caps.toolCalling && { extractTextFromImage: ocrDocumentTool }),
      // recall-memory 工具：仅当 caps.toolCalling=true 时注册（默认启用，无前端开关）
      // LLM 自主决定调用时机（Agentic RAG），使用规则已注入 system prompt
      ...(caps.toolCalling && { recallMemory: recallMemoryTool }),
      // generate-image 工具：仅当 enableImageGeneration=true 且 caps.toolCalling=true 时注册
      // 注入条件与 GENERATE_IMAGE_TOOL_RULES 严格一致（见上方 system prompt 注入），
      // 避免出现"规则说可以调用但工具未注册"或反向不一致
      ...(enableImageGeneration && caps.toolCalling && { generateImage: generateImageTool })
    }

    // 重构 maxSteps 逻辑：基于「是否有工具实际注册」而非 caps.vision || caps.deepThinking
    // 原逻辑导致 Qwen3-8B/Qwen3.5-4B 启用工具时 maxSteps=1，工具调用失效（LLM 调工具后无法基于结果生成回答）
    // 修复后：有工具时 maxSteps=5 允许多步循环，无工具时 maxSteps=1（纯对话/纯视觉/纯推理）
    const hasActiveTools = caps.toolCalling && Object.keys(toolsConfig).length > 0
    const stopWhen = stepCountIs(hasActiveTools ? 5 : 1)

    const result = streamText({
      model: llmProvider(useModel, thinkingOptions),
      system: finalSystemPrompt,
      messages: llmMessages as any,
      stopWhen,
      ...(caps.toolCalling &&
        Object.keys(toolsConfig).length > 0 && {
          tools: toolsConfig as Parameters<typeof streamText>[0]['tools']
        }),
      // 硅基流动不支持 OpenAI 的 structuredOutputs（strict 模式），需要禁用
      providerOptions: {
        openai: {
          structuredOutputs: false
        }
      },
      onFinish: async ({ text }) => {
        if (!sessionId) return
        try {
          // 从 text 中移除 reasoning 标记内容，只保留正式回答
          // text 格式：REASONING_PREFIX + 思考内容... + REASONING_END + 正式回答
          const reasoningStart = text.indexOf(REASONING_PREFIX)
          const reasoningEndIdx = text.indexOf(REASONING_END)
          let cleanText = text
          if (reasoningStart >= 0 && reasoningEndIdx >= 0) {
            // 有完整的 reasoning 段：取 REASONING_END 之后的内容
            cleanText = text.slice(reasoningEndIdx + REASONING_END.length).trim()
          } else if (reasoningStart >= 0) {
            // 只有 reasoning 没有正式回答（极端情况）
            cleanText = ''
          }
          await saveMessagesToDb(
            sessionId,
            messages,
            cleanText,
            useModel,
            hasImages ? imageUrls : undefined
          )
        } catch (err) {
          console.error('保存消息到数据库失败:', err)
        }

        // 服务端归档兜底：若 lastSessionId 存在且不等于当前 sessionId，fire-and-forget 触发归档
        // 覆盖浏览器关闭/刷新场景：前端 fire-and-forget 可能因网络抖动失败，服务端兜底补齐
        // 注：archiveSessionMessages 内置进程内并发锁，重复请求直接返回不重复执行
        // 注：不 await 完成，不阻塞 onFinish 返回和流结束信号（详见 design.md 决策 6）
        if (
          lastSessionId &&
          typeof lastSessionId === 'string' &&
          lastSessionId !== sessionId
        ) {
          archiveSessionMessages(lastSessionId).catch((err) => {
            console.error(`[chat.post] 服务端归档兜底失败（会话 ${lastSessionId}）:`, err)
          })
        }
      }
    })

    // 使用 createUIMessageStream 构建 UIMessage 流
    // 将 fullStream 中的 text-delta 按 REASONING 标记分类：
    // - 带 REASONING_PREFIX 的 → 转为 reasoning-delta 事件（思考过程）
    // - 带 REASONING_END 的 → 切换回 text-delta（正式回答开始）
    // - 其他 → 原样转为 UIMessageChunk 格式
    const uiStream = createUIMessageStream({
      execute({ writer }) {
        // 追踪 reasoning 状态和文本 ID
        let isReasoning = false
        let textId = ''
        let reasoningId = ''
        // 追踪是否已发送结束事件，避免重复发送
        let textEnded = false
        let reasoningEnded = false

        const reader = result.fullStream.getReader()

        function processChunk(): Promise<void> {
          return reader.read().then(({ done, value: chunk }) => {
            if (done) return

            if (chunk.type === 'text-delta') {
              const delta = chunk.text

              // 整个 delta 以 REASONING_PREFIX 开头：纯 reasoning 片段
              if (delta.startsWith(REASONING_PREFIX)) {
                const reasoningText = delta.slice(REASONING_PREFIX.length)
                if (reasoningText) {
                  if (!isReasoning) {
                    isReasoning = true
                    reasoningId = `rs-${Date.now()}`
                    writer.write({ type: 'reasoning-start', id: reasoningId })
                  }
                  writer.write({ type: 'reasoning-delta', id: reasoningId, delta: reasoningText })
                }
                return processChunk()
              }

              // delta 中间包含 REASONING_PREFIX：reasoning 和其他内容混合
              if (delta.includes(REASONING_PREFIX)) {
                const parts = delta.split(REASONING_PREFIX)
                for (const part of parts) {
                  if (!part) continue
                  if (part.includes(REASONING_END)) {
                    // reasoning → 正式回答的切换点
                    const subParts = part.split(REASONING_END)
                    if (subParts[0]) {
                      if (!isReasoning) {
                        isReasoning = true
                        reasoningId = `rs-${Date.now()}`
                        writer.write({ type: 'reasoning-start', id: reasoningId })
                      }
                      writer.write({ type: 'reasoning-delta', id: reasoningId, delta: subParts[0] })
                    }
                    if (isReasoning) {
                      writer.write({ type: 'reasoning-end', id: reasoningId })
                      isReasoning = false
                      reasoningEnded = true
                    }
                    if (subParts[1]) {
                      if (!textId) {
                        textId = `ts-${Date.now()}`
                        writer.write({ type: 'text-start', id: textId })
                      }
                      writer.write({ type: 'text-delta', id: textId, delta: subParts[1] })
                    }
                  } else {
                    if (!isReasoning) {
                      isReasoning = true
                      reasoningId = `rs-${Date.now()}`
                      writer.write({ type: 'reasoning-start', id: reasoningId })
                    }
                    writer.write({ type: 'reasoning-delta', id: reasoningId, delta: part })
                  }
                }
                return processChunk()
              }

              // delta 以 REASONING_END 开头：正式回答开始
              if (delta.startsWith(REASONING_END)) {
                const textAfter = delta.slice(REASONING_END.length)
                if (isReasoning) {
                  writer.write({ type: 'reasoning-end', id: reasoningId })
                  isReasoning = false
                  reasoningEnded = true
                }
                if (textAfter) {
                  if (!textId) {
                    textId = `ts-${Date.now()}`
                    writer.write({ type: 'text-start', id: textId })
                  }
                  writer.write({ type: 'text-delta', id: textId, delta: textAfter })
                }
                return processChunk()
              }

              // delta 中间包含 REASONING_END：reasoning 尾部和正式回答开头
              if (delta.includes(REASONING_END)) {
                const parts = delta.split(REASONING_END)
                if (parts[0]) {
                  if (!isReasoning) {
                    isReasoning = true
                    reasoningId = `rs-${Date.now()}`
                    writer.write({ type: 'reasoning-start', id: reasoningId })
                  }
                  writer.write({ type: 'reasoning-delta', id: reasoningId, delta: parts[0] })
                }
                if (isReasoning) {
                  writer.write({ type: 'reasoning-end', id: reasoningId })
                  isReasoning = false
                  reasoningEnded = true
                }
                if (parts[1]) {
                  if (!textId) {
                    textId = `ts-${Date.now()}`
                    writer.write({ type: 'text-start', id: textId })
                  }
                  writer.write({ type: 'text-delta', id: textId, delta: parts[1] })
                }
                return processChunk()
              }

              // 普通 text-delta
              if (isReasoning) {
                writer.write({ type: 'reasoning-delta', id: reasoningId, delta })
              } else {
                if (!textId) {
                  textId = `ts-${Date.now()}`
                  writer.write({ type: 'text-start', id: textId })
                }
                writer.write({ type: 'text-delta', id: textId, delta })
              }
              return processChunk()
            }

            if (chunk.type === 'reasoning-delta') {
              // 原生 reasoning-delta 事件（如果 provider 支持）
              if (!isReasoning) {
                isReasoning = true
                reasoningId = chunk.id || `rs-${Date.now()}`
                writer.write({ type: 'reasoning-start', id: reasoningId })
              }
              writer.write({ type: 'reasoning-delta', id: reasoningId, delta: chunk.text })
              return processChunk()
            }

            if (chunk.type === 'reasoning-start') {
              isReasoning = true
              reasoningId = chunk.id
              writer.write(chunk)
              return processChunk()
            }

            if (chunk.type === 'reasoning-end') {
              isReasoning = false
              reasoningEnded = true
              writer.write(chunk)
              return processChunk()
            }

            if (chunk.type === 'text-start') {
              textId = chunk.id
              writer.write(chunk)
              return processChunk()
            }

            if (chunk.type === 'text-end') {
              textEnded = true
              writer.write(chunk)
              return processChunk()
            }

            if (chunk.type === 'tool-call') {
              writer.write({
                type: 'tool-input-available',
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                input: chunk.input
              })
              return processChunk()
            }

            if (chunk.type === 'tool-input-delta') {
              writer.write({
                type: 'tool-input-delta',
                toolCallId: chunk.id,
                inputTextDelta: chunk.delta
              })
              return processChunk()
            }

            if (chunk.type === 'tool-input-start') {
              writer.write({
                type: 'tool-input-start',
                toolCallId: chunk.id,
                toolName: chunk.toolName
              })
              return processChunk()
            }

            if (chunk.type === 'tool-input-end') {
              // UIMessageChunk 中没有 tool-input-end，跳过
              return processChunk()
            }

            if (chunk.type === 'tool-result') {
              writer.write({
                type: 'tool-output-available',
                toolCallId: chunk.toolCallId,
                output: chunk.output
              })
              return processChunk()
            }

            if (chunk.type === 'tool-error') {
              writer.write({
                type: 'tool-output-error',
                toolCallId: chunk.toolCallId,
                errorText: chunk.error instanceof Error ? chunk.error.message : String(chunk.error)
              })
              return processChunk()
            }

            if (chunk.type === 'error') {
              writer.write({
                type: 'error',
                errorText: chunk.error instanceof Error ? chunk.error.message : String(chunk.error)
              })
              return processChunk()
            }

            if (chunk.type === 'finish') {
              // 关闭未关闭的 text/reasoning（避免重复发送已关闭的）
              if (isReasoning && reasoningId && !reasoningEnded) {
                writer.write({ type: 'reasoning-end', id: reasoningId })
              }
              if (textId && !textEnded) {
                writer.write({ type: 'text-end', id: textId })
              }
              writer.write({
                type: 'finish',
                finishReason: chunk.finishReason
              })
              // 流结束后关闭 MCP 客户端，释放子进程资源
              if (mcpClient) {
                mcpClient.close().catch((err: unknown) => console.error('MCP 客户端关闭失败:', err))
              }
              return processChunk()
            }

            // start / start-step / finish-step 事件需要剥离 fullStream 特有字段
            // uiMessageChunkSchema 使用 strictObject，不允许未定义的字段
            if (chunk.type === 'start') {
              writer.write({ type: 'start', messageId: crypto.randomUUID() })
            } else if (chunk.type === 'start-step') {
              // start-step 不需要 request/warnings 字段，客户端不使用
              writer.write({ type: 'start-step' })
            } else if (chunk.type === 'finish-step') {
              writer.write({ type: 'finish-step' })
            }

            return processChunk()
          })
        }

        return processChunk()
      }
    })

    return createUIMessageStreamResponse({ stream: uiStream })
  } catch (err) {
    console.error('streamText 调用失败:', err)
    throw createError({
      statusCode: 500,
      statusMessage: `AI 调用失败: ${err instanceof Error ? err.message : String(err)}`
    })
  }
})

async function saveMessagesToDb(
  sessionId: string,
  chatMessages: Array<{ role: string; content: unknown }>,
  assistantText: string,
  modelName: string,
  imageUrls?: string[]
) {
  if (chatMessages.length === 0) return
  const lastUserMessage = [...chatMessages].reverse().find((msg) => msg.role === 'user')
  if (lastUserMessage) {
    const meta: Record<string, unknown> = {}
    if (imageUrls && imageUrls.length > 0) {
      meta.images = imageUrls.map((url, i) => ({ index: i, url }))
    }
    // 兼容 AI SDK v5 的 parts 格式和旧 content 字符串格式
    const userText = extractTextFromMessage(lastUserMessage)
    await db.insert(messagesTable).values({
      id: crypto.randomUUID(),
      sessionId,
      role: 'user',
      content: userText,
      metadata: Object.keys(meta).length > 0 ? meta : undefined,
      createdAt: new Date()
    })
  }
  await db.insert(messagesTable).values({
    id: crypto.randomUUID(),
    sessionId,
    role: 'assistant',
    content: assistantText,
    metadata: { model: modelName },
    createdAt: new Date()
  })
  await db.update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, sessionId))
}
