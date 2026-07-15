<script setup lang="ts">
import type { SessionItem } from '~/composables/useChatSession'

const props = defineProps<{
  sessionsList: SessionItem[]
  currentSessionId: string
}>()

const emit = defineEmits<{
  create: []
  switch: [sessionId: string]
  delete: [sessionId: string]
  rename: [sessionId: string, newTitle: string]
  close: []
}>()

const renamingId = ref<string>('')
const renamingText = ref('')

function handleDelete(sessionId: string, event: Event) {
  event.stopPropagation()
  emit('delete', sessionId)
}

function startRename(session: SessionItem) {
  renamingId.value = session.id
  renamingText.value = session.title
}

function confirmRename() {
  const trimmed = renamingText.value.trim()
  if (trimmed) {
    emit('rename', renamingId.value, trimmed)
  }
  renamingId.value = ''
  renamingText.value = ''
}

function cancelRename() {
  renamingId.value = ''
  renamingText.value = ''
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHour = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  if (diffHour < 24) return `${diffHour} 小时前`
  if (diffDay < 7) return `${diffDay} 天前`
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function getDateGroup(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const weekAgo = new Date(today.getTime() - 7 * 86400000)
  const sessionDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  if (sessionDate.getTime() === today.getTime()) return '今天'
  if (sessionDate.getTime() === yesterday.getTime()) return '昨天'
  if (sessionDate > weekAgo) return '7天内'
  return '更早'
}

const groupedSessions = computed(() => {
  const groups: Record<string, SessionItem[]> = {}
  const order = ['今天', '昨天', '7天内', '更早']
  for (const s of props.sessionsList) {
    const g = getDateGroup(s.updatedAt)
    if (!groups[g]) groups[g] = []
    groups[g].push(s)
  }
  return order.filter((g) => groups[g]?.length).map((g) => ({ label: g, sessions: groups[g] }))
})
</script>

<template>
  <aside class="w-[85vw] sm:w-semi-sidebar shrink-0 border-r border-semi-border bg-semi-bg-1 flex flex-col h-full">
    <div class="flex items-center gap-2 p-3 sm:p-4 border-b border-semi-border">
      <button
        class="flex-1 px-3 sm:px-4 py-2.5 text-sm font-medium text-white bg-semi-primary rounded-xl hover:bg-semi-primary-hover active:scale-[0.98] transition-all flex items-center justify-center gap-2 min-h-[44px] shadow-sm"
        @click="emit('create')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4">
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
        新建会话
      </button>
      <button
        class="sm:hidden p-2 text-semi-text-3 hover:text-semi-text-0 rounded-lg hover:bg-semi-fill-2 active:scale-95 transition-all min-w-[36px] min-h-[36px] flex items-center justify-center"
        aria-label="关闭侧边栏"
        @click="$emit('close')"
        v-tooltip="'关闭侧边栏'"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="w-5 h-5"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-2">
      <div v-if="sessionsList.length === 0" class="flex flex-col items-center py-12 px-4">
        <div class="w-16 h-16 rounded-2xl bg-semi-fill-1 flex items-center justify-center mb-3">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-8 h-8 text-semi-text-3">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <p class="text-sm text-semi-text-3 text-center">暂无会话</p>
        <p class="text-xs text-semi-text-3/60 text-center mt-1">开始新对话吧</p>
      </div>

      <template v-else>
        <div v-for="group in groupedSessions" :key="group.label" class="mb-3">
          <div class="px-3 py-1.5 text-xs font-medium text-semi-text-3 uppercase tracking-wider">
            {{ group.label }}
          </div>
          <div
            v-for="session in group.sessions"
            :key="session.id"
            data-testid="session-item"
            class="group flex items-center justify-between px-2 sm:px-3 py-2.5 mb-0.5 rounded-lg cursor-pointer transition-all duration-semi-fast"
            :class="
              session.id === currentSessionId
                ? 'bg-semi-primary-light text-semi-primary-active'
                : 'hover:bg-semi-fill-1 text-semi-text-1'
            "
            @click="emit('switch', session.id)"
          >
            <div class="flex-1 min-w-0">
              <template v-if="renamingId === session.id">
                <input
                  v-model="renamingText"
                  class="w-full text-sm bg-semi-bg-0 border border-semi-primary rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-semi-primary/20 min-h-[36px]"
                  @keydown.enter="confirmRename"
                  @keydown.escape="cancelRename"
                  @blur="confirmRename"
                  @click.stop
                />
              </template>
              <template v-else>
                <div class="text-sm font-medium truncate" @dblclick.stop="startRename(session)">
                  {{ session.title }}
                </div>
                <div class="text-xs mt-0.5 flex items-center gap-1.5" :class="session.id === currentSessionId ? 'text-semi-primary-active/80' : 'text-semi-text-3'">
                  <span>{{ session.messageCount || 0 }} 条消息</span>
                  <span>·</span>
                  <span>{{ formatRelativeTime(session.updatedAt) }}</span>
                </div>
              </template>
            </div>
            <div
              class="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 sm:transition-opacity ml-1"
            >
              <button
                class="p-1.5 rounded-lg hover:bg-semi-fill-2 transition-all min-w-[32px] min-h-[32px] flex items-center justify-center"
                :class="session.id === currentSessionId ? 'text-semi-primary-active hover:bg-semi-primary/10' : 'text-semi-text-3 hover:text-semi-primary'"
                aria-label="重命名会话"
                v-tooltip="'重命名'"
                @click.stop="startRename(session)"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="w-3.5 h-3.5"
                >
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  <path d="m15 5 4 4" />
                </svg>
              </button>
              <button
                class="p-1.5 rounded-lg hover:bg-semi-danger-light transition-all min-w-[32px] min-h-[32px] flex items-center justify-center"
                :class="session.id === currentSessionId ? 'text-semi-primary-active hover:text-semi-danger' : 'text-semi-text-3 hover:text-semi-danger'"
                aria-label="删除会话"
                v-tooltip="'删除会话'"
                @click="handleDelete(session.id, $event)"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="w-3.5 h-3.5"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <div class="border-t border-semi-border p-3">
      <div class="flex items-center gap-2.5 px-2 py-1.5">
        <div class="w-8 h-8 rounded-full bg-gradient-to-br from-semi-primary to-blue-400 flex items-center justify-center text-white text-sm font-medium shrink-0">
          U
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-semi-text-0 truncate">My Chat 用户</div>
          <div class="text-xs text-semi-text-3 truncate">本地模式</div>
        </div>
        <button
          class="p-2 text-semi-text-3 hover:text-semi-text-1 hover:bg-semi-fill-1 rounded-lg transition-all"
          aria-label="设置"
          v-tooltip="'设置'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>
    </div>
  </aside>
</template>
