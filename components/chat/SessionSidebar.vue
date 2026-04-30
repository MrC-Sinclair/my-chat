<script setup lang="ts">
import type { SessionItem } from '~/composables/useChatSession'

defineProps<{
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
</script>

<template>
  <aside class="w-[85vw] sm:w-64 shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col h-full">
    <div class="flex items-center gap-2 p-3 sm:p-4 border-b border-gray-200">
      <button
        class="flex-1 px-3 sm:px-4 py-2.5 sm:py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2 min-h-[44px]"
        @click="emit('create')"
      >
        <span class="text-lg leading-none">+</span>
        新建会话
      </button>
      <button
        class="sm:hidden p-2 text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-200 active:scale-95 transition-all min-w-[36px] min-h-[36px] flex items-center justify-center"
        @click="$emit('close')"
        v-tooltip="'关闭侧边栏'"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-2">
      <div v-if="sessionsList.length === 0" class="text-sm text-gray-400 text-center py-8">
        暂无会话
      </div>

      <div
        v-for="session in sessionsList"
        :key="session.id"
        class="group flex items-center justify-between px-2 sm:px-3 py-2.5 mb-1 rounded-lg cursor-pointer transition-colors"
        :class="
          session.id === currentSessionId
            ? 'bg-blue-100 text-blue-800'
            : 'hover:bg-gray-200 text-gray-700'
        "
        @click="emit('switch', session.id)"
      >
        <div class="flex-1 min-w-0">
          <template v-if="renamingId === session.id">
            <input
              v-model="renamingText"
              class="w-full text-sm bg-white border border-blue-400 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[36px]"
              @keydown.enter="confirmRename"
              @keydown.escape="cancelRename"
              @blur="confirmRename"
              @click.stop
            />
          </template>
          <template v-else>
            <div
              class="text-sm font-medium truncate"
              @dblclick.stop="startRename(session)"
            >
              {{ session.title }}
            </div>
            <div class="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
              <span>{{ session.messageCount || 0 }} 条消息</span>
              <span>·</span>
              <span>{{ formatRelativeTime(session.updatedAt) }}</span>
            </div>
          </template>
        </div>
        <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity ml-1">
          <button
            class="p-1.5 text-gray-400 hover:text-blue-600 rounded transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
            v-tooltip="'重命名'"
            @click.stop="startRename(session)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
          </button>
          <button
            class="p-1.5 text-gray-400 hover:text-red-600 rounded transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
            v-tooltip="'删除会话'"
            @click="handleDelete(session.id, $event)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4">
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>
