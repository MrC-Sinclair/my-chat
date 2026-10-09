/**
 * @file 对话轮次持久化（user + assistant 消息落库）
 *
 * 从 `server/api/chat.post.ts` 抽出的持久化逻辑，供 `onFinish` 回调调用。
 * 抽出动机：这段逻辑决定会话历史的数据正确性（重复插入 / 覆盖错行都会污染上下文与归档输入），
 * 必须能被单元测试直接覆盖，而不是只能靠端到端跑通来间接验证。
 *
 * 调用方契约：
 *   - 只在 `streamText` 的 `onFinish` 中调用（禁止在 onChunk 中写库）
 *   - `userText` 由调用方从 UIMessage 的 parts / content 提取后传入；无可保存的用户消息时传 null
 *   - `isRegenerate` 由请求体的 `trigger === 'regenerate-message'` 决定（AI SDK 自带字段）
 *   - `pruneFromMessageId` 由请求体的 `editing_message_id` 决定（前端「编辑重发」时带上被编辑消息的库内 id）
 */
import { eq, and, desc, sql } from 'drizzle-orm'
import { db } from '~/server/db'
import { messages as messagesTable, sessions } from '~/server/db/schema'

/** 语音消息音频元信息（emotion 已在 body 解析阶段经 ALLOWED_EMOTIONS 白名单校验） */
export interface PersistedAudioMeta {
  url: string
  emotion: string | null
  duration: number
}

/**
 * 一轮写入所需的数据库句柄
 *
 * `db` 与其事务句柄 `tx` 都提供这几个方法；显式收窄成联合里公共的这部分，
 * 让各步骤函数既能接收事务句柄也能接收 `db`（单测里 mock 的也是这一组方法）。
 */
type SessionWriter = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

export interface PersistChatTurnOptions {
  sessionId: string
  /** 本轮用户消息纯文本；无可保存的用户消息时为 null */
  userText: string | null
  /** LLM 正式回答（已剔除 reasoning 段）；空串表示无文本输出 */
  assistantText: string
  modelName: string
  imageUrls?: string[]
  audio?: PersistedAudioMeta
  /** 是否为「重新生成」请求：为真时不重复插入用户消息，且替换既有助手回复 */
  isRegenerate?: boolean
  /** 「编辑重发」时被编辑消息的库内 id：插入新一轮前先删除该条及其后的全部历史 */
  pruneFromMessageId?: string
}

/**
 * 持久化一轮对话（用户消息 + AI 回复）
 *
 * 分支语义：
 *   - 常规发送：插入最后一条用户消息 + 插入 AI 回复（AI 回复为空时跳过，见下）
 *   - 重新生成：用户消息**不插入**（首次发送时已落库），并将既有助手回复**更新为**新回复
 *
 * 助手回复为空的处理：LLM 全程工具调用（agent-task 多步循环耗尽 stepCountIs 上限）或
 * 思考被打断时 text 为空，空消息重开后会渲染为空气泡，且污染归档输入与消息计数。
 * 工具产出已存 agent_tasks/artifacts 表，下次请求经检查点注入续作，跳过不丢信息；
 * user 消息无论如何都要保留（用户提问本身有价值，且归档/检查点依赖会话连续性）。
 * 重新生成场景下若无新文本可写入，则保留既有回复不删除，避免「改一次反而不见了」。
 */
export async function persistChatTurn(options: PersistChatTurnOptions): Promise<void> {
  const {
    sessionId,
    userText,
    assistantText,
    modelName,
    imageUrls,
    audio,
    isRegenerate,
    pruneFromMessageId
  } = options
  if (!sessionId) return

  // 同一会话的「裁剪 + 插入」必须串行：两个标签页各自编辑不同轮次并发提交时，
  // 后提交的裁剪会把先提交那轮刚插入的消息整段删掉（实测一轮完整问答静默丢失）。
  // 用会话级 pg_advisory_xact_lock 让同会话写入排队，锁随事务结束自动释放；
  // 不同会话的 hashtext 不同，互不阻塞。
  await db.transaction(async (tx) => {
    const q: SessionWriter = tx
    await q.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${sessionId})::bigint)`)

    // 编辑重发：先删掉被替换的那一轮（含被编辑条自身），再按常规插入新一轮。
    // 必须插在插入语句之前，否则会把自己刚写入的消息一起删掉。
    if (pruneFromMessageId) {
      await pruneMessagesFrom(q, sessionId, pruneFromMessageId)
    }

    // 常规发送才插入用户消息。重新生成时该消息已存在于库中，重复插入会让
    // 会话历史出现「两条相同用户提问」，AI 上下文与归档输入同步被污染。
    if (userText !== null && !isRegenerate) {
      const meta: Record<string, unknown> = {}
      if (imageUrls && imageUrls.length > 0) {
        meta.images = imageUrls.map((url, i) => ({ index: i, url }))
      }
      if (audio && audio.url) {
        // 语音消息是单条消息的元信息快照（供 UI 展示情感标签），与「情感不作为长期状态注入」不矛盾
        meta.audio = {
          url: audio.url,
          emotion: audio.emotion,
          duration: audio.duration,
          createdAt: new Date().toISOString()
        }
      }
      await q.insert(messagesTable).values({
        id: crypto.randomUUID(),
        sessionId,
        role: 'user',
        content: userText,
        metadata: Object.keys(meta).length > 0 ? meta : undefined,
        createdAt: new Date()
      })
    }

    if (!assistantText.trim()) {
      await touchSession(q, sessionId)
      return
    }

    if (isRegenerate) {
      const replaced = await replaceLatestAssistantReply(q, sessionId, assistantText, modelName)
      if (replaced) {
        await touchSession(q, sessionId)
        return
      }
      // 无可替换的既有回复（首次发送失败未落库等）→ 退回常规插入
    }

    await q.insert(messagesTable).values({
      id: crypto.randomUUID(),
      sessionId,
      role: 'assistant',
      content: assistantText,
      metadata: { model: modelName },
      createdAt: new Date()
    })
    await touchSession(q, sessionId)
  })
}

/**
 * 将本会话「最后一条助手回复」更新为新内容（不新增行、保持原 createdAt 位置）
 *
 * 防误伤：只有当最新助手行晚于最新用户行（即它确实是这条用户消息的回复）时才替换。
 * 若上一轮 AI 回复为空未落库，最新助手行其实是更早一轮的回复，此时替换会丢历史，
 * 因此退回插入新行（此时库中本就没有本轮回复，不存在新旧并存问题）。
 *
 * @returns 是否完成替换
 */
async function replaceLatestAssistantReply(
  q: SessionWriter,
  sessionId: string,
  assistantText: string,
  modelName: string
): Promise<boolean> {
  const sessionCondition = eq(messagesTable.sessionId, sessionId)

  const [latestAssistant] = await q
    .select({ id: messagesTable.id, createdAt: messagesTable.createdAt })
    .from(messagesTable)
    .where(and(sessionCondition, eq(messagesTable.role, 'assistant')))
    .orderBy(desc(messagesTable.createdAt))
    .limit(1)

  if (!latestAssistant) return false

  const [latestUser] = await q
    .select({ id: messagesTable.id, createdAt: messagesTable.createdAt })
    .from(messagesTable)
    .where(and(sessionCondition, eq(messagesTable.role, 'user')))
    .orderBy(desc(messagesTable.createdAt))
    .limit(1)

  if (latestUser && latestAssistant.createdAt < latestUser.createdAt) return false

  await q
    .update(messagesTable)
    .set({ content: assistantText, metadata: { model: modelName } })
    .where(eq(messagesTable.id, latestAssistant.id))

  return true
}

/**
 * 删除锚点消息及其之后的全部历史（编辑重发）
 *
 * 单条 DELETE + 子查询定位锚点，避免「先查 createdAt 再删」的竞态窗口。
 * 锚点 id 必须同时匹配 sessionId，跨会话传入他人 id 时子查询为 NULL → 一行都不删。
 * 并发安全由调用方事务内的会话级 advisory lock 保证，本函数不自行加锁。
 */
async function pruneMessagesFrom(
  q: SessionWriter,
  sessionId: string,
  anchorMessageId: string
): Promise<void> {
  await q
    .delete(messagesTable)
    .where(
      and(
        eq(messagesTable.sessionId, sessionId),
        // 子查询里的表名与 messagesTable 的 pgTable('messages') 一致；锚点不存在时子查询为 NULL → 不删任何行
        sql`created_at >= (
          SELECT m2.created_at FROM messages m2
          WHERE m2.id = ${anchorMessageId} AND m2.session_id = ${sessionId}
        )`
      )
    )
}

/** 更新会话 updatedAt，让会话列表按最近活跃排序 */
async function touchSession(q: SessionWriter, sessionId: string): Promise<void> {
  await q.update(sessions).set({ updatedAt: new Date() }).where(eq(sessions.id, sessionId))
}
