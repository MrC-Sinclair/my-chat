import { useToast } from '~/composables/useToast'
import { useConfirmDialog } from '~/composables/useConfirmDialog'

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

export function useChatSession(
  setMessages: (msgs: Array<{ id: string; role: 'user' | 'assistant' | 'system'; content: string }>) => void
) {
  const sessionsList = ref<SessionItem[]>([])
  const currentSessionId = ref<string>('')
  const toast = useToast()
  const dialog = useConfirmDialog()

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
    currentSessionId.value = sessionId
    try {
      const historyMessages = await $fetch<MessageRecord[]>(`/api/sessions/${sessionId}`)
      if (historyMessages.length > 0) {
        setMessages(
          historyMessages.map((msg) => ({
            id: msg.id,
            role: msg.role as 'user' | 'assistant' | 'system',
            content: msg.content
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
    loadSessions,
    createNewSession,
    switchSession,
    deleteSession,
    renameSession
  }
}
