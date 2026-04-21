/**
 * @file 会话管理 Composable
 *
 * 从 ai-chat.vue 中抽离的会话管理逻辑，负责：
 *   - 加载会话列表
 *   - 创建新会话
 *   - 切换会话（加载历史消息）
 *   - 删除会话
 *
 * 使用方式：
 *   const { sessionsList, currentSessionId, loadSessions, createNewSession, ... } = useChatSession(setMessages)
 */

/** 会话项的类型定义，对应数据库 sessions 表 + 关联消息数量 */
export interface SessionItem {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount?: number | bigint
}

/** 消息记录的类型定义，对应数据库 messages 表 */
export interface MessageRecord {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}

/**
 * 会话管理 Composable
 *
 * @param setMessages - useChat 提供的 setMessages 函数，用于加载历史消息到聊天界面
 * @returns 会话管理相关的响应式状态和方法
 */
export function useChatSession(
  setMessages: (msgs: Array<{ id: string; role: 'user' | 'assistant' | 'system'; content: string }>) => void
) {
  /** 会话列表数据 */
  const sessionsList = ref<SessionItem[]>([])

  /** 当前活跃的会话 ID，空字符串表示没有选中任何会话 */
  const currentSessionId = ref<string>('')

  /** 加载会话列表 */
  async function loadSessions() {
    try {
      const data = await $fetch<SessionItem[]>('/api/sessions')
      sessionsList.value = data
    } catch (err) {
      console.error('加载会话列表失败:', err)
    }
  }

  /** 创建新会话 */
  async function createNewSession() {
    const res = await $fetch<SessionItem>('/api/sessions', {
      method: 'POST',
      body: { title: `新对话 ${new Date().toLocaleString('zh-CN')}` }
    })
    currentSessionId.value = res.id
    setMessages([])
    await loadSessions()
  }

  /**
   * 切换到指定会话
   *
   * @param sessionId - 要切换到的会话 ID
   */
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
    }
  }

  /**
   * 删除指定会话
   *
   * @param sessionId - 要删除的会话 ID
   * @param event - 原生 DOM 事件，用于阻止事件冒泡
   */
  async function deleteSession(sessionId: string, event?: Event) {
    event?.stopPropagation()
    if (!confirm('确定删除该会话？')) return
    await $fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' })
    if (currentSessionId.value === sessionId) {
      currentSessionId.value = ''
      setMessages([])
    }
    await loadSessions()
  }

  return {
    sessionsList,
    currentSessionId,
    loadSessions,
    createNewSession,
    switchSession,
    deleteSession
  }
}
