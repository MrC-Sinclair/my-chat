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
  createdAt: string
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
      if (historyMessages.length > 0) {
        setMessages(
          historyMessages.map((msg) => ({
            id: msg.id,
            role: msg.role as 'user' | 'assistant',
            parts: [{ type: 'text' as const, text: msg.content }]
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

  return {
    sessionsList,
    currentSessionId,
    lastSessionId,
    loadSessions,
    createNewSession,
    switchSession,
    deleteSession,
    renameSession
  }
}
