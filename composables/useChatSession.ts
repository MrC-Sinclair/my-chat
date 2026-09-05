import { useToast } from '~/composables/useToast'
import { useConfirmDialog } from '~/composables/useConfirmDialog'
import type { UIMessage } from 'ai'

export interface SessionItem {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount?: number | bigint
}

export interface MessageRecord {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  /** DB metadata JSONB 字段（含 images / audio / model 等元信息） */
  metadata?: Record<string, unknown> | null
  createdAt: string
}

/**
 * 过滤会话历史中的空消息（供 switchSession 加载历史时调用）
 *
 * 背景：早期版本在 LLM 全程工具调用（无文本输出）时也会把空 assistant 回复落库，
 * 重开会话会渲染为空气泡。此类消息一律不展示。
 * 例外：带 audio / images 元数据的消息不算空 —— 语音气泡的音频、图片气泡的图
 * 都挂在 metadata 上，content 为空是正常形态。
 *
 * 独立导出以便单测直接覆盖真实实现（而非测试内复制的模拟逻辑）。
 */
export function filterVisibleMessages(messages: MessageRecord[]): MessageRecord[] {
  return messages.filter((msg) => {
    if (msg.content && msg.content.trim()) return true
    const meta = msg.metadata as Record<string, unknown> | undefined
    return Boolean(
      meta?.audio || (Array.isArray(meta?.images) && (meta.images as unknown[]).length > 0)
    )
  })
}

export function useChatSession(setMessages: (msgs: UIMessage[]) => void) {
  const sessionsList = ref<SessionItem[]>([])
  const currentSessionId = ref<string>('')
  /**
   * 上一个会话 ID — 用于服务端归档兜底
   *
   * 在会话切换时更新为 previousSessionId，ai-chat.vue 的 DefaultChatTransport.body
   * 会读取此值传入 /api/chat 请求，服务端 onFinish 据此 fire-and-forget 触发归档。
   * 首次加载时为空字符串，不触发归档。
   */
  const lastSessionId = ref<string>('')
  const toast = useToast()
  const dialog = useConfirmDialog()

  /**
   * 前端防重复守卫：记录正在归档的 sessionId
   *
   * 同一会话归档请求进行中时不重复调用，避免网络抖动场景下用户快速切换导致重复请求。
   * 注：服务端 memory-archive.ts 也有进程内并发锁，此处是前端层防御。
   */
  const archivingSessions = new Set<string>()

  /**
   * fire-and-forget 触发会话归档（静默失败）
   *
   * - 不 await 完成，不阻塞会话切换
   * - 失败仅 console.error，不弹 toast（归档是增强操作，失败不影响主流程）
   * - 同一会话归档进行中时跳过（防重复守卫）
   */
  function triggerArchive(sessionId: string) {
    if (!sessionId) return
    if (archivingSessions.has(sessionId)) return
    archivingSessions.add(sessionId)
    $fetch(`/api/sessions/${sessionId}/archive-memory`, { method: 'POST' })
      .catch((err) => {
        console.error(`[useChatSession] 归档会话 ${sessionId} 失败:`, err)
      })
      .finally(() => {
        archivingSessions.delete(sessionId)
      })
  }

  async function loadSessions() {
    try {
      const data = await $fetch<SessionItem[]>('/api/sessions')
      sessionsList.value = data
    } catch (err) {
      console.error('加载会话列表失败:', err)
      toast.error('加载会话列表失败')
    }
  }

  async function createNewSession() {
    try {
      // 在修改 currentSessionId 之前保存旧值，触发上一个会话的归档
      const previousSessionId = currentSessionId.value
      if (previousSessionId) {
        lastSessionId.value = previousSessionId
        triggerArchive(previousSessionId)
      }
      const res = await $fetch<SessionItem>('/api/sessions', {
        method: 'POST',
        body: { title: `新对话 ${new Date().toLocaleString('zh-CN')}` }
      })
      currentSessionId.value = res.id
      setMessages([])
      await loadSessions()
    } catch (err) {
      console.error('创建会话失败:', err)
      toast.error('创建会话失败')
    }
  }

  async function switchSession(sessionId: string) {
    // 在修改 currentSessionId 之前保存旧值，触发上一个会话的归档
    const previousSessionId = currentSessionId.value
    if (previousSessionId && previousSessionId !== sessionId) {
      lastSessionId.value = previousSessionId
      triggerArchive(previousSessionId)
    }
    currentSessionId.value = sessionId
    try {
      const historyMessages = await $fetch<MessageRecord[]>(`/api/sessions/${sessionId}`)
      const visibleMessages = filterVisibleMessages(historyMessages)
      if (visibleMessages.length > 0) {
        setMessages(
          visibleMessages.map((msg) => ({
            id: msg.id,
            role: msg.role as 'user' | 'assistant',
            parts: [{ type: 'text' as const, text: msg.content }],
            // 保留 DB metadata（含 audio/images/model 等元信息，供前端渲染语音气泡等）
            metadata: msg.metadata ?? undefined
          }))
        )
      } else {
        setMessages([])
      }
    } catch (err) {
      console.error('加载会话消息失败:', err)
      toast.error('加载会话消息失败')
    }
  }

  async function deleteSession(sessionId: string, event?: Event) {
    event?.stopPropagation()
    const confirmed = await dialog.open({
      title: '删除会话',
      message: '确定删除该会话？删除后无法恢复。'
    })
    if (!confirmed) return

    try {
      await $fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' })
      if (currentSessionId.value === sessionId) {
        currentSessionId.value = ''
        setMessages([])
      }
      await loadSessions()
      toast.success('会话已删除')
    } catch (err) {
      console.error('删除会话失败:', err)
      toast.error('删除会话失败')
    }
  }

  async function renameSession(sessionId: string, newTitle: string) {
    try {
      await $fetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        body: { title: newTitle }
      })
      await loadSessions()
      toast.success('重命名成功')
    } catch (err) {
      console.error('重命名会话失败:', err)
      toast.error('重命名失败')
    }
  }

  /**
   * 保存单条消息到数据库（用于 Workflow 路径）
   *
   * 使用场景：
   *   - 生图 Workflow：前端调用 /api/generate-image 后，将返回的 markdown 图片消息保存到数据库
   *   - 其他 Workflow 路径需要保存 assistant 消息时
   *
   * @param sessionId - 会话 ID
   * @param role - 消息角色（'user' | 'assistant' | 'system'）
   * @param content - 消息内容
   * @param metadata - 可选的元数据（如 { model: "xxx" }）
   * @returns 消息 ID
   */
  async function saveMessage(
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    try {
      const res = await $fetch<{ success: boolean; messageId: string }>('/api/messages', {
        method: 'POST',
        body: { sessionId, role, content, metadata }
      })
      return res.messageId
    } catch (err) {
      console.error('保存消息失败:', err)
      toast.error('保存消息失败')
      throw err
    }
  }

  return {
    sessionsList,
    currentSessionId,
    lastSessionId,
    loadSessions,
    createNewSession,
    switchSession,
    deleteSession,
    renameSession,
    saveMessage
  }
}
