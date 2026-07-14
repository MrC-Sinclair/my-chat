/**
 * @file 重要度筛选入库（归档）— 会话结束时 LLM 判断哪些消息值得长期记住
 *
 * 设计要点（详见 openspec/changes/add-long-term-memory/design.md 决策 5/6/7/11）：
 *   - 复用 createReasoningProvider() + AI SDK v5 generateText()（非流式）调用 LLM
 *   - 通过 llmProvider(modelId, { enableThinking: false }) 创建 provider
 *     enable_thinking: false 由 customFetch 层注入（非请求体直接传）
 *   - 输出严格 JSON 数组判断每条消息重要度
 *   - 仅对重要消息做 embedding 入库
 *   - 进程内并发锁（Map<string, Promise<void>>）防止重复归档
 *   - 消息级幂等：已存在 memory_vectors 记录的消息跳过
 *   - 失败容错：LLM 失败整体跳过，单条 embedding 失败跳过不阻断其他
 */

import { generateText } from 'ai'
import { eq } from 'drizzle-orm'
import { db } from '~/server/db'
import { messages as messagesTable, memoryVectors } from '~/server/db/schema'
import { createReasoningProvider } from '~/server/utils/reasoning-provider'
import { generateEmbedding } from '~/server/utils/embedding'

const llmProvider = createReasoningProvider()

/** LLM 重要度判断超时：30 秒 */
const ARCHIVE_TIMEOUT_MS = 30_000

/** 最短消息长度：content 长度 < 5 字符的空短消息跳过 */
const MIN_MESSAGE_LENGTH = 5

/** 传给 LLM 判断的单条消息 content 最大长度（字符） */
const MAX_CONTENT_FOR_LLM = 1000

/**
 * 敏感信息正则（仅对 role='user' 消息过滤）
 * - sk-xxx：OpenAI API Key 格式
 * - api_key=xxx / api-key:xxx：API Key 赋值
 * - password=xxx / password:xxx：密码赋值
 * - token=xxx / token:xxx：Token 赋值
 *
 * 注意：仅对 user 消息过滤，避免误杀 assistant 的代码回答（项目是编程助手，
 * assistant 大量讨论代码含 api key/token 字样，过滤会误杀重要技术决策）
 */
const SENSITIVE_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,
  /api[_-]?key[:=]\s*\S+/i,
  /password[:=]\s*\S+/i,
  /token[:=]\s*\S+/i
]

/**
 * 进程内并发锁：同一会话归档进行中时，重复请求直接返回不重复执行
 *
 * 注意：Map 是进程内变量，仅适用当前 docker 单进程部署；
 * 多进程部署需升级为 DB 行锁或 Redis 分布式锁（见 design.md Risks）
 */
const archivingSessions = new Map<string, Promise<void>>()

/**
 * LLM 重要度判断 prompt
 *
 * 要求 LLM 对每条消息判断是否值得长期记住，输出严格 JSON 数组。
 * 判断标准：长期价值（用户偏好、技术决策、事实性信息、项目背景）
 * vs 一次性/闲聊（问候、简单计算、纯知识问答）。
 */
const IMPORTANCE_JUDGE_PROMPT = `你是一个消息重要度判断助手。分析以下对话消息列表，判断每条消息是否值得作为长期记忆保存。

判断标准：
- 重要：用户偏好、技术决策、事实性信息、项目背景、关键讨论内容、用户提出的具体问题或需求
- 不重要：问候、简单计算、纯知识问答、闲聊、重复内容、无意义的短消息

输出格式：严格的 JSON 数组，不要包含任何其他文本（不要思考过程、不要 markdown 代码块标记）：
[
  { "message_id": "消息ID", "important": true, "reason": "简短理由" },
  { "message_id": "消息ID", "important": false, "reason": "简短理由" }
]

要求：
1. 对输入列表中的每条消息都给出判断
2. reason 字段简短说明理由（不超过 50 字）
3. 只输出 JSON 数组，不要输出任何其他内容`

/** LLM 返回的重要度判断结果单条结构 */
interface ImportanceJudgment {
  message_id: string
  important: boolean
  reason: string
}

/** LLM 返回的重要度判断结果单条结构（解析用，字段可选） */
interface RawImportanceItem {
  message_id?: unknown
  important?: unknown
  reason?: unknown
}

/**
 * 过滤候选消息：
 * 1. 排除 role='system' 消息（服务端提示词，不属于用户需回忆的内容）
 * 2. 排除 content 为空或长度 < 5 字符的空短消息
 * 3. 仅对 role='user' 消息做敏感信息过滤（assistant 消息是模型回答，不含用户真实密钥）
 *
 * 注：messages 表中不存在独立的工具调用结果消息（weather/OCR/webSearch 输出不持久化），
 * 无需额外过滤"工具调用结果消息"
 */
function filterCandidateMessages<T extends { id: string; role: string; content: string }>(
  msgs: T[]
): T[] {
  return msgs.filter((msg) => {
    // 排除 system 角色
    if (msg.role === 'system') return false

    // 排除空短消息
    if (!msg.content || msg.content.trim().length < MIN_MESSAGE_LENGTH) return false

    // 仅对 user 消息做敏感信息过滤
    if (msg.role === 'user') {
      const hasSensitive = SENSITIVE_PATTERNS.some((p) => p.test(msg.content))
      if (hasSensitive) {
        console.warn(`[memory-archive] 消息 ${msg.id} 含疑似敏感信息，跳过归档`)
        return false
      }
    }

    return true
  })
}

/**
 * 解析 LLM 重要度判断响应
 *
 * 容错处理：
 * - 含 thinking 等思考标签 → 整体降级为不入库
 * - JSON 截断或格式错误 → 整体降级为不入库
 * - 单条字段缺失或类型错误 → 跳过该条
 *
 * @returns 解析成功返回 ImportanceJudgment 数组；解析失败返回 null（调用方整体跳过该次归档）
 */
function parseImportanceResponse(text: string): ImportanceJudgment[] | null {
  if (!text || typeof text !== 'string') {
    console.error('[memory-archive] LLM 返回为空')
    return null
  }

  let cleaned = text.trim()

  // 含思考标签：整体降级（避免污染记忆库）
  if (cleaned.includes('<thinking>') || cleaned.includes('<reflection>')) {
    console.error('[memory-archive] LLM 返回含思考标签，整体降级为不入库')
    return null
  }

  // 提取 JSON 数组：LLM 可能在前后附加文本，尝试提取第一个 [ 到最后一个 ]
  const firstBracket = cleaned.indexOf('[')
  const lastBracket = cleaned.lastIndexOf(']')
  if (firstBracket === -1 || lastBracket === -1 || lastBracket < firstBracket) {
    console.error('[memory-archive] LLM 返回未找到 JSON 数组结构')
    return null
  }
  cleaned = cleaned.slice(firstBracket, lastBracket + 1)

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (err) {
    console.error('[memory-archive] JSON 解析失败，整体降级为不入库:', err)
    return null
  }

  if (!Array.isArray(parsed)) {
    console.error('[memory-archive] LLM 返回非 JSON 数组')
    return null
  }

  // 逐条校验字段类型
  const items: ImportanceJudgment[] = []
  for (const raw of parsed as RawImportanceItem[]) {
    if (typeof raw.message_id !== 'string') continue
    if (typeof raw.important !== 'boolean') continue
    // reason 字段可选，但若存在必须为字符串
    const reason = typeof raw.reason === 'string' ? raw.reason : ''
    items.push({
      message_id: raw.message_id,
      important: raw.important,
      reason
    })
  }

  if (items.length === 0) {
    console.warn('[memory-archive] LLM 返回的 JSON 数组无有效条目')
    return null
  }

  return items
}

/**
 * 调用 LLM 判断消息重要度
 *
 * @param candidateMessages 候选消息列表（已过滤）
 * @returns ImportanceJudgment 数组；LLM 调用失败或解析失败返回 null（整体跳过该次归档）
 */
async function judgeImportance(
  candidateMessages: Array<{ id: string; role: string; content: string }>
): Promise<ImportanceJudgment[] | null> {
  const config = useRuntimeConfig()
  const modelId = config.memoryImportanceModel || 'Qwen/Qwen3.5-4B'

  // 构造传给 LLM 的消息列表：content 截断到 1000 字符
  const messagesForLLM = candidateMessages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content.slice(0, MAX_CONTENT_FOR_LLM)
  }))

  try {
    const result = await generateText({
      model: llmProvider(modelId, { enableThinking: false }),
      system: IMPORTANCE_JUDGE_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(messagesForLLM) }],
      temperature: 0.1,
      maxOutputTokens: 4096,
      abortSignal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS)
    })

    return parseImportanceResponse(result.text)
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('[memory-archive] LLM 重要度判断超时（30秒），整体跳过该次归档')
    } else {
      console.error('[memory-archive] LLM 重要度判断失败，整体跳过该次归档:', err)
    }
    return null
  }
}

/**
 * 查询会话中已归档的 message_id 集合（重复归档守卫）
 */
async function getArchivedMessageIds(sessionId: string): Promise<Set<string>> {
  const archived = await db
    .select({ messageId: memoryVectors.messageId })
    .from(memoryVectors)
    .where(eq(memoryVectors.sessionId, sessionId))

  return new Set(
    archived
      .map((r) => r.messageId)
      .filter((id): id is string => typeof id === 'string' && id !== null)
  )
}

/**
 * 对单条消息做 embedding 并写入 memory_vectors 表
 *
 * @returns 成功返回 true，失败返回 false（调用方继续处理其他消息）
 */
async function embedAndStore(
  msg: { id: string; role: string; content: string; createdAt: Date },
  sessionId: string
): Promise<boolean> {
  const embedResult = await generateEmbedding(msg.content)
  if ('detail' in embedResult) {
    console.error(`[memory-archive] 消息 ${msg.id} embedding 失败，跳过:`, embedResult.detail)
    return false
  }

  try {
    await db.insert(memoryVectors).values({
      id: crypto.randomUUID(),
      messageId: msg.id,
      sessionId,
      content: msg.content,
      embedding: embedResult.embedding,
      role: msg.role,
      // created_at 从 messages.created_at 复制（消息原始创建时间）
      createdAt: msg.createdAt
      // archived_at 用 schema 中的 defaultNow()，此处不传
    })
    return true
  } catch (err) {
    // 可能是外键约束失败（会话/消息已删除）或唯一约束冲突（并发归档）
    console.error(`[memory-archive] 消息 ${msg.id} 写入 memory_vectors 失败，跳过:`, err)
    return false
  }
}

/**
 * 执行会话归档（内部实现，不含并发锁）
 *
 * 流程：
 * 1. 查询会话所有消息（按 createdAt 升序）
 * 2. 过滤候选消息（排除 system、敏感信息、空短消息）
 * 3. 查询已归档 message_id，排除已归档消息
 * 4. 调用 LLM 判断重要度
 * 5. 对重要消息做 embedding + 入库
 *
 * 失败容错：
 * - LLM 判断失败/超时 → 整体跳过该次归档（下次重试）
 * - 单条 embedding/写入失败 → 跳过该条，继续处理其他消息
 */
async function doArchiveSession(sessionId: string): Promise<void> {
  // 1. 查询会话所有消息（按 createdAt 升序，符合对话阅读顺序）
  const sessionMessages = await db
    .select({
      id: messagesTable.id,
      role: messagesTable.role,
      content: messagesTable.content,
      createdAt: messagesTable.createdAt
    })
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, sessionId))
    .orderBy(messagesTable.createdAt)

  if (sessionMessages.length === 0) {
    console.log(`[memory-archive] 会话 ${sessionId} 无消息，跳过归档`)
    return
  }

  // 2. 过滤候选消息
  const candidates = filterCandidateMessages(sessionMessages)
  if (candidates.length === 0) {
    console.log(`[memory-archive] 会话 ${sessionId} 过滤后无候选消息，跳过归档`)
    return
  }

  // 3. 查询已归档 message_id，排除已归档消息（消息级幂等守卫）
  const archivedIds = await getArchivedMessageIds(sessionId)
  const newCandidates = candidates.filter((m) => !archivedIds.has(m.id))
  if (newCandidates.length === 0) {
    console.log(`[memory-archive] 会话 ${sessionId} 所有消息已归档，跳过`)
    return
  }

  // 4. 调用 LLM 判断重要度
  const judgments = await judgeImportance(newCandidates)
  if (!judgments) {
    // LLM 失败或解析失败，整体跳过该次归档（下次重试）
    console.error(`[memory-archive] 会话 ${sessionId} 重要度判断失败，整体跳过该次归档`)
    return
  }

  // 5. 对重要消息做 embedding + 入库
  const importantIds = new Set(
    judgments.filter((j) => j.important).map((j) => j.message_id)
  )

  if (importantIds.size === 0) {
    console.log(`[memory-archive] 会话 ${sessionId} LLM 判断无重要消息，跳过入库`)
    return
  }

  // 构建 id → message 映射（含 createdAt，用于复制到 memory_vectors.createdAt）
  const messageMap = new Map(newCandidates.map((m) => [m.id, m]))

  let successCount = 0
  let failCount = 0
  for (const msgId of importantIds) {
    const msg = messageMap.get(msgId)
    if (!msg) {
      // LLM 返回的 message_id 不在候选列表中（理论不应发生），跳过
      console.warn(`[memory-archive] LLM 返回的 message_id ${msgId} 不在候选列表中，跳过`)
      continue
    }

    const ok = await embedAndStore(msg, sessionId)
    if (ok) successCount++
    else failCount++
  }

  console.log(
    `[memory-archive] 会话 ${sessionId} 归档完成: ${successCount} 条成功, ${failCount} 条失败`
  )
}

/**
 * 归档会话消息（公开接口，含进程内并发锁）
 *
 * 同一会话归档进行中时，重复请求直接返回不重复执行。
 * fire-and-forget 调用方可不 await，归档在后台异步执行。
 *
 * @param sessionId 待归档的会话 ID
 */
export async function archiveSessionMessages(sessionId: string): Promise<void> {
  // 并发锁：同一会话已有归档进行中，直接返回
  if (archivingSessions.has(sessionId)) {
    console.log(`[memory-archive] 会话 ${sessionId} 归档进行中，跳过重复请求`)
    return
  }

  const archivePromise = doArchiveSession(sessionId)
    .catch((err) => {
      // doArchiveSession 内部已处理各类错误并记录日志，
      // 此处兜底防止未预期错误导致 Promise rejection 传播
      console.error(`[memory-archive] 会话 ${sessionId} 归档异常:`, err)
    })
    .finally(() => {
      archivingSessions.delete(sessionId)
    })

  archivingSessions.set(sessionId, archivePromise)
  return archivePromise
}
